//! Zones listing page component.
//!
//! Shows all available zones using Dioxus resources.

use crate::app::api::{NowPlaying, Zone, ZonesResponse};
use crate::app::components::{Layout, VolumeControlsCompact};
use crate::app::sse::{use_sse, SseEvent};
use dioxus::prelude::*;
use std::collections::HashMap;

/// Control request body
#[derive(Clone, serde::Serialize)]
struct ControlRequest {
    zone_id: String,
    action: String,
}

/// Fetch now playing for all zones
async fn fetch_all_now_playing(zones: &[Zone]) -> HashMap<String, NowPlaying> {
    let mut np_map = HashMap::new();
    for zone in zones {
        let url = format!(
            "/now_playing?zone_id={}",
            urlencoding::encode(&zone.zone_id)
        );
        if let Ok(np) = crate::app::api::fetch_json::<NowPlaying>(&url).await {
            np_map.insert(zone.zone_id.clone(), np);
        }
    }
    np_map
}

/// Zones listing page component.
#[component]
pub fn Zones() -> Element {
    let sse = use_sse();

    // Load zones resource
    let mut zones = use_resource(|| async {
        crate::app::api::fetch_json::<ZonesResponse>("/zones")
            .await
            .ok()
    });

    // Now playing state (populated after zones load and refreshed on SSE events)
    let mut now_playing = use_signal(HashMap::<String, NowPlaying>::new);

    // Track zones list for now_playing refresh
    let zones_list_signal = use_memo(move || {
        zones
            .read()
            .clone()
            .flatten()
            .map(|r| r.zones)
            .unwrap_or_default()
    });

    // Load now playing for each zone when zones change
    use_effect(move || {
        let zone_list = zones_list_signal();
        if !zone_list.is_empty() {
            spawn(async move {
                let np_map = fetch_all_now_playing(&zone_list).await;
                now_playing.set(np_map);
            });
        }
    });

    // Refresh on SSE events
    use_effect(move || {
        let _ = (sse.event_count)();
        let event = (sse.last_event)();

        // Refresh zones list on structural changes
        if matches!(
            event.as_ref(),
            Some(SseEvent::ZoneUpdated { .. })
                | Some(SseEvent::ZoneRemoved { .. })
                | Some(SseEvent::RoonConnected)
                | Some(SseEvent::RoonDisconnected)
                | Some(SseEvent::LmsConnected)
                | Some(SseEvent::LmsDisconnected)
        ) {
            zones.restart();
        }

        // Refresh now_playing on playback/volume changes (without reloading zones)
        if matches!(
            event.as_ref(),
            Some(SseEvent::NowPlayingChanged { .. })
                | Some(SseEvent::VolumeChanged { .. })
                | Some(SseEvent::LmsPlayerStateChanged { .. })
        ) {
            let zone_list = zones_list_signal();
            if !zone_list.is_empty() {
                spawn(async move {
                    let np_map = fetch_all_now_playing(&zone_list).await;
                    now_playing.set(np_map);
                });
            }
        }
    });

    // Control handler
    let control = move |(zone_id, action): (String, String)| {
        spawn(async move {
            let req = ControlRequest { zone_id, action };
            if let Err(e) = crate::app::api::post_json_no_response("/control", &req).await {
                #[cfg(target_arch = "wasm32")]
                web_sys::console::warn_1(&format!("Control request failed: {e}").into());
                #[cfg(not(target_arch = "wasm32"))]
                tracing::warn!("Control request failed: {e}");
            }
        });
    };

    let is_loading = zones.read().is_none();
    let zones_list = zones
        .read()
        .clone()
        .flatten()
        .map(|r| r.zones)
        .unwrap_or_default();
    let np_map = now_playing();

    let content = if is_loading {
        rsx! {
            div { class: "card p-6", aria_busy: "true", "Loading zones..." }
        }
    } else if zones_list.is_empty() {
        rsx! {
            div { class: "card p-6", "No zones available. Check that adapters are connected." }
        }
    } else {
        rsx! {
            div { class: "zone-grid",
                for zone in zones_list {
                    ZoneCard {
                        key: "{zone.zone_id}",
                        zone: zone.clone(),
                        now_playing: np_map.get(&zone.zone_id).cloned(),
                        on_control: control,
                    }
                }
            }
        }
    };

    rsx! {
        Layout {
            title: "Zones".to_string(),
            nav_active: "zones".to_string(),

            h1 { class: "text-2xl font-bold mb-6", "Zones" }

            section { id: "zones",
                {content}
            }
        }
    }
}

/// Zone card component
#[component]
fn ZoneCard(
    zone: Zone,
    now_playing: Option<NowPlaying>,
    on_control: EventHandler<(String, String)>,
) -> Element {
    let zone_id = zone.zone_id.clone();
    let zone_id_prev = zone_id.clone();
    let zone_id_play = zone_id.clone();
    let zone_id_next = zone_id.clone();
    let zone_id_vol_down = zone_id.clone();
    let zone_id_vol_up = zone_id.clone();

    let np = now_playing.as_ref();
    let is_playing = np.map(|n| n.is_playing).unwrap_or(false);
    let play_icon = if is_playing { "⏸︎" } else { "▶" };

    let has_hqp = zone
        .dsp
        .as_ref()
        .map(|d| d.r#type.as_deref() == Some("hqplayer"))
        .unwrap_or(false);

    // Extract volume info for component
    let volume = np.and_then(|n| n.volume);
    let volume_type = np.and_then(|n| n.volume_type.clone());

    // Now playing display
    let (track, artist) = np
        .map(|n| {
            if n.line1.as_deref().unwrap_or("Idle") != "Idle" {
                (
                    n.line1.clone().unwrap_or_default(),
                    n.line2.clone().unwrap_or_default(),
                )
            } else {
                (String::new(), String::new())
            }
        })
        .unwrap_or_default();

    rsx! {
        div { class: "card p-4",
            // Header with zone name and badges
            div { class: "flex items-center gap-2 mb-3",
                span { class: "font-semibold text-lg", "{zone.zone_name}" }
                if has_hqp {
                    span { class: "badge badge-primary", "HQP" }
                }
                if let Some(ref source) = zone.source {
                    span { class: "badge badge-secondary", "{source}" }
                }
            }

            // Now playing info
            div { class: "min-h-[40px] overflow-hidden mb-4",
                if !track.is_empty() {
                    p { class: "font-medium text-sm truncate", "{track}" }
                    p { class: "text-sm text-gray-400 truncate", "{artist}" }
                } else {
                    p { class: "text-sm text-gray-500", "Nothing playing" }
                }
            }

            // Transport controls
            div { class: "flex items-center gap-2",
                button {
                    class: "btn btn-ghost",
                    onclick: move |_| on_control.call((zone_id_prev.clone(), "previous".to_string())),
                    "◀◀"
                }
                button {
                    class: "btn btn-primary",
                    onclick: move |_| on_control.call((zone_id_play.clone(), "play_pause".to_string())),
                    "{play_icon}"
                }
                button {
                    class: "btn btn-ghost",
                    onclick: move |_| on_control.call((zone_id_next.clone(), "next".to_string())),
                    "▶▶"
                }

                VolumeControlsCompact {
                    volume: volume,
                    volume_type: volume_type,
                    on_vol_down: move |_| on_control.call((zone_id_vol_down.clone(), "vol_down".to_string())),
                    on_vol_up: move |_| on_control.call((zone_id_vol_up.clone(), "vol_up".to_string())),
                }
            }
        }
    }
}
