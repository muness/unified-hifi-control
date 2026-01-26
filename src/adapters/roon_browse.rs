//! Roon Browse adapter for library search, browse, and queue operations
//!
//! This adapter has its own Roon Core connection, separate from RoonAdapter.
//! It only requests the Browse service (no Transport/Image needed).
//! Per AI DJ Phase 1.

use anyhow::Result;
use async_trait::async_trait;
use roon_api::{
    browse::{
        Browse, BrowseOpts, BrowseResult, Item as BrowseItem, ItemHint, LoadOpts, LoadResult,
    },
    info, CoreEvent, Info, Parsed, RoonApi, Services, Svc,
};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{oneshot, RwLock};
use tokio_util::sync::CancellationToken;

use crate::adapters::handle::{AdapterHandle, RetryConfig};
use crate::adapters::traits::{
    AdapterCommand, AdapterCommandResponse, AdapterContext, AdapterLogic,
};
use crate::bus::SharedBus;
use crate::config::get_config_file_path;

const BROWSE_STATE_FILE: &str = "roon_browse_state.json";

/// Timeout for browse/load requests
const BROWSE_TIMEOUT: Duration = Duration::from_secs(10);

/// Default search result limit
const DEFAULT_SEARCH_LIMIT: usize = 50;

/// Search source - where to search
#[derive(Debug, Clone, Copy, Default)]
pub enum SearchSource {
    #[default]
    Library,
    Tidal,
    Qobuz,
}

/// Get the Roon Browse state file path
fn get_browse_state_path() -> PathBuf {
    get_config_file_path(BROWSE_STATE_FILE)
}

/// Pending browse request - stores the oneshot sender to deliver the result
type BrowseRequest = oneshot::Sender<Result<BrowseResult>>;

/// Pending load request - stores the oneshot sender to deliver the result
type LoadRequest = oneshot::Sender<Result<LoadResult>>;

/// Internal state for browse operations
#[derive(Default)]
struct BrowseState {
    connected: bool,
    core_name: Option<String>,
    /// Browse service from Roon Core
    browse: Option<Browse>,
    /// Pending browse requests: request_id -> (session_key, oneshot sender)
    pending_browses: HashMap<usize, (Option<String>, BrowseRequest)>,
    /// Pending load requests: request_id -> (session_key, oneshot sender)
    pending_loads: HashMap<usize, (Option<String>, LoadRequest)>,
}

/// Roon Browse adapter
///
/// Provides library search, browse, and queue operations via the Roon Browse API.
/// Has its own connection to Roon Core (separate extension).
#[derive(Clone)]
pub struct RoonBrowseAdapter {
    state: Arc<RwLock<BrowseState>>,
    bus: SharedBus,
    /// Cancellation token for shutdown
    shutdown: Arc<RwLock<CancellationToken>>,
    /// Whether the adapter has been started
    started: Arc<AtomicBool>,
}

impl RoonBrowseAdapter {
    /// Create a new RoonBrowseAdapter
    pub fn new(bus: SharedBus) -> Self {
        Self {
            state: Arc::new(RwLock::new(BrowseState::default())),
            bus,
            shutdown: Arc::new(RwLock::new(CancellationToken::new())),
            started: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Check if connected to Roon Core
    pub async fn is_connected(&self) -> bool {
        self.state.read().await.connected
    }

    /// Browse the Roon library hierarchy
    pub async fn browse(&self, opts: BrowseOpts) -> Result<BrowseResult> {
        let (tx, rx) = oneshot::channel();
        let session_key = opts.multi_session_key.clone();

        // Clone browse service while holding lock, then release before await
        let browse = {
            let state = self.state.read().await;
            state.browse.clone().ok_or_else(|| {
                anyhow::anyhow!("Browse service not available - not connected to Roon")
            })?
        };

        // Make the browse request (lock not held)
        let req_id = browse.browse(&opts).await;

        let req_id = match req_id {
            Some(id) => {
                // Re-acquire lock to insert pending request
                let mut state = self.state.write().await;
                state.pending_browses.insert(id, (session_key.clone(), tx));
                id
            }
            None => return Err(anyhow::anyhow!("Failed to initiate browse request")),
        };

        tracing::debug!("Browse request initiated with req_id {}", req_id);

        // Wait for response with timeout
        let result = tokio::time::timeout(BROWSE_TIMEOUT, rx).await;

        // Clean up pending request on timeout or cancellation
        if result.is_err() {
            let mut state = self.state.write().await;
            state.pending_browses.remove(&req_id);
        }

        match result {
            Ok(Ok(data)) => data,
            Ok(Err(_)) => Err(anyhow::anyhow!("Browse request cancelled")),
            Err(_) => Err(anyhow::anyhow!("Browse request timed out")),
        }
    }

    /// Load items from the current browse position (for pagination)
    pub async fn load(&self, opts: LoadOpts) -> Result<LoadResult> {
        let (tx, rx) = oneshot::channel();
        let session_key = opts.multi_session_key.clone();

        // Clone browse service while holding lock, then release before await
        let browse = {
            let state = self.state.read().await;
            state.browse.clone().ok_or_else(|| {
                anyhow::anyhow!("Browse service not available - not connected to Roon")
            })?
        };

        // Make the load request (lock not held)
        let req_id = browse.load(&opts).await;

        let req_id = match req_id {
            Some(id) => {
                // Re-acquire lock to insert pending request
                let mut state = self.state.write().await;
                state.pending_loads.insert(id, (session_key.clone(), tx));
                id
            }
            None => return Err(anyhow::anyhow!("Failed to initiate load request")),
        };

        tracing::debug!("Load request initiated with req_id {}", req_id);

        // Wait for response with timeout
        let result = tokio::time::timeout(BROWSE_TIMEOUT, rx).await;

        // Clean up pending request on timeout or cancellation
        if result.is_err() {
            let mut state = self.state.write().await;
            state.pending_loads.remove(&req_id);
        }

        match result {
            Ok(Ok(data)) => data,
            Ok(Err(_)) => Err(anyhow::anyhow!("Load request cancelled")),
            Err(_) => Err(anyhow::anyhow!("Load request timed out")),
        }
    }

    /// Search the Roon library, TIDAL, or Qobuz
    ///
    /// Returns search results for tracks, albums, artists, etc.
    /// `limit` controls max results returned (default: 50).
    /// `source` determines where to search (Library, TIDAL, or Qobuz).
    pub async fn search(
        &self,
        query: &str,
        zone_id: Option<&str>,
        limit: Option<usize>,
        source: SearchSource,
    ) -> Result<Vec<BrowseItem>> {
        let session_key = format!(
            "search_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        );

        let source_name = match source {
            SearchSource::Library => "Library",
            SearchSource::Tidal => "TIDAL",
            SearchSource::Qobuz => "Qobuz",
        };

        // Step 1: Navigate to root
        let root_opts = BrowseOpts {
            multi_session_key: Some(session_key.clone()),
            zone_or_output_id: zone_id.map(|z| z.to_string()),
            pop_all: true,
            ..Default::default()
        };
        self.browse(root_opts).await?;

        // Load root items to find source
        let root_load = LoadOpts {
            multi_session_key: Some(session_key.clone()),
            count: Some(10),
            ..Default::default()
        };
        let root_items = self.load(root_load).await?;

        // Find source item (Library, TIDAL, or Qobuz)
        let source_item = root_items
            .items
            .iter()
            .find(|item| item.title == source_name)
            .ok_or_else(|| anyhow::anyhow!("{} not found in browse root", source_name))?;

        let source_key = source_item
            .item_key
            .clone()
            .ok_or_else(|| anyhow::anyhow!("{} has no item_key", source_name))?;

        // Step 2: Browse into source
        let source_opts = BrowseOpts {
            multi_session_key: Some(session_key.clone()),
            item_key: Some(source_key),
            zone_or_output_id: zone_id.map(|z| z.to_string()),
            ..Default::default()
        };
        self.browse(source_opts).await?;

        // Load source items to find Search
        let source_load = LoadOpts {
            multi_session_key: Some(session_key.clone()),
            count: Some(10),
            ..Default::default()
        };
        let source_items = self.load(source_load).await?;

        // Find Search item
        let search_item = source_items
            .items
            .iter()
            .find(|item| item.title == "Search")
            .ok_or_else(|| anyhow::anyhow!("Search not found in {}", source_name))?;

        let search_key = search_item
            .item_key
            .clone()
            .ok_or_else(|| anyhow::anyhow!("Search has no item_key"))?;

        // Step 3: Browse into Search WITH the query as input
        let search_opts = BrowseOpts {
            multi_session_key: Some(session_key.clone()),
            item_key: Some(search_key),
            input: Some(query.to_string()),
            zone_or_output_id: zone_id.map(|z| z.to_string()),
            ..Default::default()
        };
        let search_result = self.browse(search_opts).await?;

        // Step 4: Load search results
        if let Some(list) = &search_result.list {
            if list.count > 0 {
                let load_opts = LoadOpts {
                    multi_session_key: Some(session_key),
                    count: Some(limit.unwrap_or(DEFAULT_SEARCH_LIMIT)),
                    ..Default::default()
                };
                let load_result = self.load(load_opts).await?;
                return Ok(load_result.items);
            }
        }

        Ok(vec![])
    }

    /// Search and play the first matching result
    ///
    /// This is the AI DJ convenience method - search for music and start playing it.
    /// `action` can be "play" (play now), "queue" (add to queue), or "radio" (start radio).
    pub async fn search_and_play(
        &self,
        query: &str,
        zone_id: &str,
        source: SearchSource,
        action: &str,
    ) -> Result<String> {
        let session_key = format!(
            "play_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        );

        let source_name = match source {
            SearchSource::Library => "Library",
            SearchSource::Tidal => "TIDAL",
            SearchSource::Qobuz => "Qobuz",
        };

        // Strip roon: prefix from zone_id if present (Roon API expects bare IDs)
        let bare_zone_id = zone_id.strip_prefix("roon:").unwrap_or(zone_id);

        // Step 1: Navigate to root
        let root_opts = BrowseOpts {
            multi_session_key: Some(session_key.clone()),
            zone_or_output_id: Some(bare_zone_id.to_string()),
            pop_all: true,
            ..Default::default()
        };
        self.browse(root_opts).await?;

        // Load root items
        let root_load = LoadOpts {
            multi_session_key: Some(session_key.clone()),
            count: Some(10),
            ..Default::default()
        };
        let root_items = self.load(root_load).await?;

        // Find source
        let source_item = root_items
            .items
            .iter()
            .find(|item| item.title == source_name)
            .ok_or_else(|| anyhow::anyhow!("{} not found", source_name))?;

        let source_key = source_item
            .item_key
            .clone()
            .ok_or_else(|| anyhow::anyhow!("{} has no item_key", source_name))?;

        // Step 2: Browse into source
        self.browse(BrowseOpts {
            multi_session_key: Some(session_key.clone()),
            item_key: Some(source_key),
            zone_or_output_id: Some(bare_zone_id.to_string()),
            ..Default::default()
        })
        .await?;

        let source_items = self
            .load(LoadOpts {
                multi_session_key: Some(session_key.clone()),
                count: Some(10),
                ..Default::default()
            })
            .await?;

        // Find Search
        let search_item = source_items
            .items
            .iter()
            .find(|item| item.title == "Search")
            .ok_or_else(|| anyhow::anyhow!("Search not found in {}", source_name))?;

        let search_key = search_item
            .item_key
            .clone()
            .ok_or_else(|| anyhow::anyhow!("Search has no item_key"))?;

        // Step 3: Search with query
        self.browse(BrowseOpts {
            multi_session_key: Some(session_key.clone()),
            item_key: Some(search_key),
            input: Some(query.to_string()),
            zone_or_output_id: Some(bare_zone_id.to_string()),
            ..Default::default()
        })
        .await?;

        let search_results = self
            .load(LoadOpts {
                multi_session_key: Some(session_key.clone()),
                count: Some(20),
                ..Default::default()
            })
            .await?;

        // Find first playable item (hint is Action or ActionList)
        let playable = search_results
            .items
            .iter()
            .find(|item| {
                matches!(
                    item.hint,
                    Some(ItemHint::Action) | Some(ItemHint::ActionList)
                )
            })
            .ok_or_else(|| anyhow::anyhow!("No playable results found for '{}'", query))?;

        let playable_title = playable.title.clone();
        let playable_key = playable
            .item_key
            .clone()
            .ok_or_else(|| anyhow::anyhow!("Playable item has no item_key"))?;

        // Step 4: Browse into the playable item to get actions
        self.browse(BrowseOpts {
            multi_session_key: Some(session_key.clone()),
            item_key: Some(playable_key),
            zone_or_output_id: Some(bare_zone_id.to_string()),
            ..Default::default()
        })
        .await?;

        let mut actions = self
            .load(LoadOpts {
                multi_session_key: Some(session_key.clone()),
                count: Some(10),
                ..Default::default()
            })
            .await?;

        // Sometimes we get another action_list level (the track itself) before the actions
        // If so, browse one more level to get the actual actions (Play Now, Queue, etc.)
        if actions.items.len() == 1 {
            if let Some(item) = actions.items.first() {
                if matches!(item.hint, Some(ItemHint::ActionList)) {
                    if let Some(key) = &item.item_key {
                        self.browse(BrowseOpts {
                            multi_session_key: Some(session_key.clone()),
                            item_key: Some(key.clone()),
                            zone_or_output_id: Some(bare_zone_id.to_string()),
                            ..Default::default()
                        })
                        .await?;

                        actions = self
                            .load(LoadOpts {
                                multi_session_key: Some(session_key.clone()),
                                count: Some(10),
                                ..Default::default()
                            })
                            .await?;
                    }
                }
            }
        }

        // Find the requested action
        let action_title = match action {
            "play" => "Play Now",
            "queue" => "Queue",
            "radio" => "Start Radio",
            other => other,
        };

        let action_item = actions
            .items
            .iter()
            .find(|item| item.title == action_title)
            .ok_or_else(|| {
                let available: Vec<_> = actions.items.iter().map(|i| &i.title).collect();
                anyhow::anyhow!(
                    "Action '{}' not available. Available: {:?}",
                    action_title,
                    available
                )
            })?;

        let action_key = action_item
            .item_key
            .clone()
            .ok_or_else(|| anyhow::anyhow!("Action has no item_key"))?;

        // Step 5: Execute the action
        self.browse(BrowseOpts {
            multi_session_key: Some(session_key.clone()),
            item_key: Some(action_key),
            zone_or_output_id: Some(bare_zone_id.to_string()),
            ..Default::default()
        })
        .await?;

        Ok(format!("{}: {} '{}'", action_title, playable_title, query))
    }
}

#[async_trait]
impl AdapterLogic for RoonBrowseAdapter {
    fn prefix(&self) -> &'static str {
        "roon_browse"
    }

    async fn run(&self, ctx: AdapterContext) -> Result<()> {
        run_browse_loop(self.state.clone(), ctx.shutdown).await
    }

    async fn handle_command(
        &self,
        _zone_id: &str,
        _command: AdapterCommand,
    ) -> Result<AdapterCommandResponse> {
        // Browse adapter doesn't handle transport commands
        // Future: Could handle queue commands here
        Ok(AdapterCommandResponse {
            success: false,
            error: Some("RoonBrowseAdapter does not handle transport commands".to_string()),
        })
    }
}

/// Main Roon Browse event loop
async fn run_browse_loop(
    state: Arc<RwLock<BrowseState>>,
    shutdown: CancellationToken,
) -> Result<()> {
    tracing::info!("RoonBrowseAdapter: Starting Roon discovery...");

    let restart_needed = Arc::new(AtomicBool::new(false));

    // Ensure config subdirectory exists for state persistence
    let state_path = get_browse_state_path();
    if let Some(parent) = state_path.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent)?;
        }
    }
    let state_path_str = state_path.to_string_lossy().to_string();
    tracing::info!("RoonBrowseAdapter: State file: {}", state_path_str);

    // Extension info - use different ID from RoonAdapter to register as separate extension
    let info = info!("com.muness.browse", "Unified Hi-Fi Control - Browse");

    // Create API instance
    let mut roon = RoonApi::new(info);

    // Only request Browse service
    let services = vec![Services::Browse(Browse::new())];

    // No provided services (we're a client only)
    let provided: HashMap<String, Svc> = HashMap::new();

    // State persistence callback
    let state_path_clone = state_path_str.clone();
    let get_roon_state = move || RoonApi::load_roon_state(&state_path_clone);

    // Start discovery
    let (mut handles, mut core_rx) = roon
        .start_discovery(Box::new(get_roon_state), provided, Some(services))
        .await
        .ok_or_else(|| anyhow::anyhow!("Failed to start Roon discovery for Browse"))?;

    tracing::info!("RoonBrowseAdapter: Discovery started, waiting for core...");

    // Event processing task
    let state_for_events = state.clone();
    let state_path_for_events = state_path_str.clone();
    let shutdown_for_events = shutdown.clone();
    let restart_needed_for_events = restart_needed.clone();
    handles.spawn(async move {
        loop {
            let event_result = tokio::select! {
                _ = shutdown_for_events.cancelled() => {
                    tracing::info!("RoonBrowseAdapter: Shutdown requested");
                    break;
                }
                result = core_rx.recv() => result
            };

            let Some((event, msg)) = event_result else {
                tracing::info!("RoonBrowseAdapter: Event channel closed");
                restart_needed_for_events.store(true, std::sync::atomic::Ordering::SeqCst);
                break;
            };

            match event {
                CoreEvent::Registered(mut core, _token) => {
                    let core_name = core.display_name.clone();
                    tracing::info!("RoonBrowseAdapter: Connected to Roon Core: {}", core_name);

                    let browse = core.get_browse().cloned();

                    {
                        let mut s = state_for_events.write().await;
                        s.connected = true;
                        s.core_name = Some(core_name);
                        s.browse = browse;
                    }
                }
                CoreEvent::Lost(core) => {
                    tracing::warn!("RoonBrowseAdapter: Lost connection to Roon Core: {}", core.display_name);

                    {
                        let mut s = state_for_events.write().await;
                        s.connected = false;
                        s.core_name = None;
                        s.browse = None;
                        s.pending_browses.clear();
                        s.pending_loads.clear();
                    }

                    restart_needed_for_events.store(true, std::sync::atomic::Ordering::SeqCst);
                    break;
                }
                _ => {}
            }

            // Handle parsed messages
            if let Some((_, parsed)) = msg {
                match parsed {
                    Parsed::RoonState(roon_state) => {
                        if let Err(e) = RoonApi::save_roon_state(&state_path_for_events, roon_state) {
                            tracing::warn!("RoonBrowseAdapter: Failed to save state: {}", e);
                        }
                    }
                    Parsed::BrowseResult(result, session_key) => {
                        tracing::debug!(
                            "RoonBrowseAdapter: BrowseResult action={:?}, session_key={:?}",
                            result.action,
                            session_key
                        );
                        let mut s = state_for_events.write().await;
                        if let Some(req_id) = s
                            .pending_browses
                            .iter()
                            .find(|(_, (key, _))| key == &session_key)
                            .map(|(k, _)| *k)
                        {
                            if let Some((_key, sender)) = s.pending_browses.remove(&req_id) {
                                if sender.send(Ok(result)).is_err() {
                                    tracing::debug!(
                                        "RoonBrowseAdapter: Browse request cancelled (receiver dropped): {:?}",
                                        session_key
                                    );
                                }
                            }
                        }
                    }
                    Parsed::LoadResult(result, session_key) => {
                        tracing::debug!(
                            "RoonBrowseAdapter: LoadResult {} items, session_key={:?}",
                            result.items.len(),
                            session_key
                        );
                        let mut s = state_for_events.write().await;
                        if let Some(req_id) = s
                            .pending_loads
                            .iter()
                            .find(|(_, (key, _))| key == &session_key)
                            .map(|(k, _)| *k)
                        {
                            if let Some((_key, sender)) = s.pending_loads.remove(&req_id) {
                                if sender.send(Ok(result)).is_err() {
                                    tracing::debug!(
                                        "RoonBrowseAdapter: Load request cancelled (receiver dropped): {:?}",
                                        session_key
                                    );
                                }
                            }
                        }
                    }
                    Parsed::Error(err) => {
                        tracing::warn!("RoonBrowseAdapter: API error: {:?}", err);
                    }
                    _ => {}
                }
            }
        }
    });

    // Wait for handles
    while handles.join_next().await.is_some() {
        if restart_needed.load(std::sync::atomic::Ordering::SeqCst) {
            tracing::info!("RoonBrowseAdapter: Restart signaled, aborting tasks");
            handles.abort_all();
            break;
        }
    }

    // Clear state before returning
    {
        let mut s = state.write().await;
        s.connected = false;
        s.browse = None;
        s.pending_browses.clear();
        s.pending_loads.clear();
    }

    if restart_needed.load(std::sync::atomic::Ordering::SeqCst) {
        Err(anyhow::anyhow!("Roon core lost, restart needed"))
    } else {
        Ok(())
    }
}

impl RoonBrowseAdapter {
    /// Start the adapter (internal - use Startable trait)
    async fn start_internal(&self) -> Result<()> {
        use std::sync::atomic::Ordering;

        if self.started.swap(true, Ordering::SeqCst) {
            return Ok(()); // Already started
        }

        let shutdown = {
            let mut token = self.shutdown.write().await;
            *token = CancellationToken::new();
            token.clone()
        };

        let handle = AdapterHandle::new(self.clone(), self.bus.clone(), shutdown);
        let config = RetryConfig::new(Duration::from_secs(1), Duration::from_secs(60));

        tokio::spawn(async move {
            if let Err(e) = handle.run_with_retry(config).await {
                tracing::error!("RoonBrowseAdapter exited with error: {}", e);
            }
        });

        Ok(())
    }

    /// Stop the adapter (internal - use Startable trait)
    async fn stop_internal(&self) {
        use std::sync::atomic::Ordering;

        self.shutdown.read().await.cancel();
        self.started.store(false, Ordering::SeqCst);

        // Clear pending requests
        {
            let mut state = self.state.write().await;
            state.connected = false;
            state.browse = None;
            state.pending_browses.clear();
            state.pending_loads.clear();
        }

        tracing::info!("RoonBrowseAdapter stopped");
    }
}

// Startable trait implementation via macro
crate::impl_startable!(RoonBrowseAdapter, "roon_browse");
