//! AdapterHandle - Wraps AdapterLogic with consistent lifecycle management

use anyhow::Result;
use std::sync::Arc;
use tokio_util::sync::CancellationToken;
use tracing::{error, info};

use crate::adapters::traits::{AdapterContext, AdapterLogic};
use crate::bus::{BusEvent, SharedBus};

/// AdapterHandle wraps an AdapterLogic implementation and provides:
/// - Consistent shutdown handling (can't forget it)
/// - Automatic ACK on stop via AdapterStopped event
/// - ShuttingDown event watching
pub struct AdapterHandle<T: AdapterLogic> {
    logic: Arc<T>,
    bus: SharedBus,
    shutdown: CancellationToken,
}

impl<T: AdapterLogic> AdapterHandle<T> {
    pub fn new(logic: T, bus: SharedBus, shutdown: CancellationToken) -> Self {
        Self {
            logic: Arc::new(logic),
            bus,
            shutdown,
        }
    }

    /// Get the adapter's prefix
    pub fn prefix(&self) -> &'static str {
        self.logic.prefix()
    }

    /// Get access to the underlying logic (for command handling)
    pub fn logic(&self) -> &Arc<T> {
        &self.logic
    }

    /// Run the adapter with lifecycle management
    /// - Calls init() if implemented
    /// - Runs the adapter's main loop
    /// - Watches for ShuttingDown events on the bus
    /// - Publishes AdapterStopped on exit
    pub async fn run(self) -> Result<()> {
        let prefix = self.logic.prefix();
        info!("Starting adapter: {}", prefix);

        // Initialize
        if let Err(e) = self.logic.init().await {
            error!("Adapter {} init failed: {}", prefix, e);
            return Err(e);
        }

        // Subscribe to bus for shutdown signal
        let mut rx = self.bus.subscribe();

        // Create context for the adapter
        let ctx = AdapterContext {
            bus: self.bus.clone(),
            shutdown: self.shutdown.clone(),
        };

        // Run with lifecycle management
        tokio::select! {
            // Run adapter-specific logic
            result = self.logic.run(ctx) => {
                match &result {
                    Ok(()) => info!("Adapter {} completed normally", prefix),
                    Err(e) => error!("Adapter {} error: {}", prefix, e),
                }
            }

            // Watch for shutdown signal on bus
            _ = async {
                while let Ok(event) = rx.recv().await {
                    if matches!(event, BusEvent::ShuttingDown { .. }) {
                        info!("Adapter {} received ShuttingDown event", prefix);
                        break;
                    }
                }
            } => {
                info!("Adapter {} stopping due to ShuttingDown event", prefix);
            }

            // Direct cancellation (backup mechanism)
            _ = self.shutdown.cancelled() => {
                info!("Adapter {} cancelled via token", prefix);
            }
        }

        // Automatic ACK - publish AdapterStopped
        self.bus.publish(BusEvent::AdapterStopped {
            adapter: prefix.to_string(),
        });

        info!("Adapter {} stopped", prefix);
        Ok(())
    }
}
