//! Unified Hi-Fi Control - Rust Implementation
//!
//! A source-agnostic hi-fi control bridge for hardware surfaces and Home Assistant.
//!
//! This library provides:
//! - Roon audio system control
//! - HQPlayer upsampling engine control
//! - Logitech Media Server (LMS) control
//! - MQTT integration for Home Assistant
//! - Server-Sent Events for real-time updates
//! - Web UI (Dioxus + Tailwind CSS + DioxusLabs components)

// =============================================================================
// Lints - Enforce code quality and consistency
// =============================================================================

// Deny truly dangerous patterns (these will fail the build)
#![deny(unsafe_code)]
#![deny(unused_must_use)]

// Note: The following lints are NOT enabled because the pre-commit hook
// uses `cargo clippy -- -D warnings` which promotes all warnings to errors.
// These should be enabled once violations are fixed:
// - clippy::unwrap_used, clippy::expect_used (31 violations)
// - clippy::panic, clippy::todo, clippy::unimplemented
// - clippy::pedantic, clippy::nursery, clippy::cargo (hundreds of violations)

// Dioxus UI app (shared between server SSR and WASM client)
pub mod app;

// Dioxus components (official dx components)
pub mod components;

// Server-only modules (excluded from WASM build)
#[cfg(feature = "server")]
pub mod adapters;
#[cfg(feature = "server")]
pub mod aggregator;
#[cfg(feature = "server")]
pub mod api;
#[cfg(feature = "server")]
pub mod bus;
#[cfg(feature = "server")]
pub mod config;
#[cfg(feature = "server")]
pub mod coordinator;
#[cfg(feature = "server")]
pub mod firmware;
#[cfg(feature = "server")]
pub mod knobs;
#[cfg(feature = "server")]
pub mod mdns;
