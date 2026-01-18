//! Zones listing page component.
//!
//! Shows all available zones using Dioxus resources.

use dioxus::prelude::*;
use std::collections::HashMap;

use crate::app::api::{NowPlaying, Zone, ZonesResponse};
use crate::app::components::Layout;
use crate::app::sse::use_sse;

/// Control request body
#[derive(Clone, serde::Serialize)]
struct ControlRequest {
    zone_id: String,
    action: String,
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

    // Now playing state (populated after zones load)
    let mut now_playing = use_signal(HashMap::<String, NowPlaying>::new);

    // Load now playing for each zone when zones change
    use_effect(move || {
        if let Some(Some(ref resp)) = zones.read().as_ref() {
            let zone_list = resp.zones.clone();
            spawn(async move {
                let mut np_map = HashMap::new();
                for zone in &zone_list {
                    let url = format!(
                        "/now_playing?zone_id={}",
                        urlencoding::encode(&zone.zone_id)
                    );
                    if let Ok(np) = crate::app::api::fetch_json::<NowPlaying>(&url).await {
                        np_map.insert(zone.zone_id.clone(), np);
                    }
                }
                now_playing.set(np_map);
            });
        }
    });

    // Refresh on SSE events
    let event_count = sse.event_count;
    use_effect(move || {
        let _ = event_count();
        if sse.should_refresh_zones() {
            zones.restart();
        }
    });

    // Control handler
    let control = move |(zone_id, action): (String, String)| {
        spawn(async move {
            let req = ControlRequest { zone_id, action };
            let _ = crate::app::api::post_json_no_response("/control", &req).await;
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

    // Format volume display
    let volume_display = np
        .and_then(|n| {
            n.volume.map(|v| {
                let suffix = if n.volume_type.as_deref() == Some("db") {
                    " dB"
                } else {
                    ""
                };
                format!("{}{}", v.round() as i32, suffix)
            })
        })
        .unwrap_or_else(|| "—".to_string());

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

                // Volume controls
                div { class: "ml-auto flex items-center gap-1",
                    button {
                        class: "btn btn-outline btn-sm",
                        onclick: move |_| on_control.call((zone_id_vol_down.clone(), "vol_down".to_string())),
                        "−"
                    }
                    span { class: "min-w-[3.5rem] text-center text-sm",
                        "{volume_display}"
                    }
                    button {
                        class: "btn btn-outline btn-sm",
                        onclick: move |_| on_control.call((zone_id_vol_up.clone(), "vol_up".to_string())),
                        "+"
                    }
                }
            }
        }
    }
}
