//! Dioxus fullstack page components.
//!
//! These pages use Dioxus signals and server functions instead of inline JavaScript.

mod dashboard;
mod hqplayer;
mod knobs;
mod lms;
mod settings;
mod zone;
mod zones;

pub use dashboard::Dashboard;
pub use hqplayer::HqPlayer;
pub use knobs::Knobs;
pub use lms::Lms;
pub use settings::Settings;
pub use zone::Zone;
pub use zones::Zones;
