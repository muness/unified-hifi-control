//! Ingest wire protocol types for muse-ingest.
//!
//! These types define the format expected by the muse-ingest proxy
//! when UHC's EventReporter forwards events.

use serde::{Deserialize, Serialize};

/// Event payload sent to the ingest proxy.
///
/// This is a generic envelope that wraps any event type with
/// metadata needed for processing.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct IngestEvent {
    /// Event type identifier (e.g., "now_playing_changed")
    pub event_type: String,

    /// Unix timestamp in seconds
    pub timestamp: u64,

    /// Event-specific payload as JSON
    pub payload: serde_json::Value,
}

/// Request body for the ingest endpoint.
///
/// Events are batched for efficiency - UHC buffers events
/// and sends them in batches to reduce network overhead.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct IngestRequest {
    /// Batch of events to process
    pub events: Vec<IngestEvent>,
}

impl IngestRequest {
    /// Create a new request with the given events
    pub fn new(events: Vec<IngestEvent>) -> Self {
        Self { events }
    }

    /// Check if the request is empty
    pub fn is_empty(&self) -> bool {
        self.events.is_empty()
    }

    /// Get the number of events
    pub fn len(&self) -> usize {
        self.events.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ingest_event_serialization() {
        let event = IngestEvent {
            event_type: "now_playing_changed".to_string(),
            timestamp: 1234567890,
            payload: serde_json::json!({
                "zone_id": "roon:123",
                "title": "Test Song",
                "artist": "Test Artist"
            }),
        };

        let json = serde_json::to_string(&event).unwrap();
        let deserialized: IngestEvent = serde_json::from_str(&json).unwrap();
        assert_eq!(event, deserialized);
    }

    #[test]
    fn test_ingest_request_serialization() {
        let request = IngestRequest {
            events: vec![
                IngestEvent {
                    event_type: "zone_discovered".to_string(),
                    timestamp: 1234567890,
                    payload: serde_json::json!({"zone_id": "roon:1"}),
                },
                IngestEvent {
                    event_type: "now_playing_changed".to_string(),
                    timestamp: 1234567891,
                    payload: serde_json::json!({"zone_id": "roon:1", "title": "Song"}),
                },
            ],
        };

        let json = serde_json::to_string(&request).unwrap();
        let deserialized: IngestRequest = serde_json::from_str(&json).unwrap();
        assert_eq!(request, deserialized);
        assert_eq!(request.len(), 2);
        assert!(!request.is_empty());
    }

    #[test]
    fn test_empty_request() {
        let request = IngestRequest::new(vec![]);
        assert!(request.is_empty());
        assert_eq!(request.len(), 0);
    }
}
