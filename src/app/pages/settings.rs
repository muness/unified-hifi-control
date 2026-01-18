//! Settings page component.
//!
//! Adapter settings and discovery status using Dioxus resources.

use dioxus::prelude::*;

use crate::app::api::{AdapterSettings, AppSettings, RoonStatus};
use crate::app::components::Layout;
use crate::app::sse::use_sse;

/// OpenHome status response
#[derive(Clone, Debug, Default, serde::Deserialize, PartialEq)]
struct OpenHomeStatus {
    device_count: usize,
}

/// UPnP status response
#[derive(Clone, Debug, Default, serde::Deserialize, PartialEq)]
struct UpnpStatus {
    renderer_count: usize,
}

/// Settings page component.
#[component]
pub fn Settings() -> Element {
    let sse = use_sse();

    // Adapter toggle signals
    let mut roon_enabled = use_signal(|| true);
    let mut lms_enabled = use_signal(|| false);
    let mut openhome_enabled = use_signal(|| false);
    let mut upnp_enabled = use_signal(|| false);

    // Load settings resource
    let settings = use_resource(|| async {
        crate::app::api::fetch_json::<AppSettings>("/api/settings")
            .await
            .ok()
    });

    // Sync settings to signals when loaded
    use_effect(move || {
        if let Some(Some(s)) = settings.read().as_ref() {
            roon_enabled.set(s.adapters.roon);
            lms_enabled.set(s.adapters.lms);
            openhome_enabled.set(s.adapters.openhome);
            upnp_enabled.set(s.adapters.upnp);
        }
    });

    // Discovery status resources
    let mut roon_status = use_resource(|| async {
        crate::app::api::fetch_json::<RoonStatus>("/roon/status")
            .await
            .ok()
    });
    let mut openhome_status = use_resource(|| async {
        crate::app::api::fetch_json::<OpenHomeStatus>("/openhome/status")
            .await
            .ok()
    });
    let mut upnp_status = use_resource(|| async {
        crate::app::api::fetch_json::<UpnpStatus>("/upnp/status")
            .await
            .ok()
    });

    // Refresh discovery on SSE events
    let event_count = sse.event_count;
    use_effect(move || {
        let _ = event_count();
        if sse.should_refresh_discovery() {
            roon_status.restart();
            openhome_status.restart();
            upnp_status.restart();
        }
    });

    // Save settings handler
    let save_settings = move || {
        let settings = AppSettings {
            adapters: AdapterSettings {
                roon: roon_enabled(),
                lms: lms_enabled(),
                openhome: openhome_enabled(),
                upnp: upnp_enabled(),
            },
        };
        spawn(async move {
            let _ = crate::app::api::post_json_no_response("/api/settings", &settings).await;
        });
    };

    let roon_st = roon_status.read().clone().flatten();
    let openhome_st = openhome_status.read().clone().flatten();
    let upnp_st = upnp_status.read().clone().flatten();

    rsx! {
        Layout {
            title: "Settings".to_string(),
            nav_active: "settings".to_string(),

            h1 { class: "text-2xl font-bold mb-6", "Settings" }

            // Adapter Settings section
            section { class: "mb-8",
                div { class: "mb-4",
                    h2 { class: "text-xl font-semibold", "Adapter Settings" }
                    p { class: "text-gray-400 text-sm", "Enable or disable zone sources" }
                }

                div { class: "card p-6",
                    div { class: "flex flex-wrap gap-6",
                        label { class: "flex items-center gap-2",
                            input {
                                r#type: "checkbox",
                                class: "checkbox",
                                checked: roon_enabled(),
                                onchange: move |_| {
                                    roon_enabled.toggle();
                                    save_settings();
                                }
                            }
                            "Roon"
                        }
                        label { class: "flex items-center gap-2",
                            input {
                                r#type: "checkbox",
                                class: "checkbox",
                                checked: lms_enabled(),
                                onchange: move |_| {
                                    lms_enabled.toggle();
                                    save_settings();
                                }
                            }
                            "LMS"
                        }
                        label { class: "flex items-center gap-2",
                            input {
                                r#type: "checkbox",
                                class: "checkbox",
                                checked: openhome_enabled(),
                                onchange: move |_| {
                                    openhome_enabled.toggle();
                                    save_settings();
                                }
                            }
                            "OpenHome"
                        }
                        label { class: "flex items-center gap-2",
                            input {
                                r#type: "checkbox",
                                class: "checkbox",
                                checked: upnp_enabled(),
                                onchange: move |_| {
                                    upnp_enabled.toggle();
                                    save_settings();
                                }
                            }
                            "UPnP/DLNA"
                        }
                    }
                    p { class: "mt-3 text-sm text-gray-400",
                        "Changes take effect immediately. Disabled adapters won't contribute zones."
                    }
                }
            }

            // Discovery Status section
            section {
                div { class: "mb-4",
                    h2 { class: "text-xl font-semibold", "Auto-Discovery" }
                    p { class: "text-gray-400 text-sm", "Devices found via SSDP (no configuration needed)" }
                }

                div { class: "card p-6",
                    table { class: "w-full", id: "discovery-table",
                        thead {
                            tr { class: "border-b border-gray-700",
                                th { class: "text-left py-2 px-3 font-semibold", "Protocol" }
                                th { class: "text-left py-2 px-3 font-semibold", "Status" }
                                th { class: "text-left py-2 px-3 font-semibold", "Devices" }
                            }
                        }
                        tbody {
                            // Roon row
                            tr { class: "border-b border-gray-800",
                                td { class: "py-2 px-3", "Roon" }
                                td { class: "py-2 px-3",
                                    if !roon_enabled() {
                                        span { class: "status-disabled", "Disabled" }
                                    } else if let Some(ref status) = roon_st {
                                        if status.connected {
                                            span { class: "status-ok", "✓ Connected" }
                                        } else {
                                            span { class: "status-err", "✗ Not connected" }
                                        }
                                    } else {
                                        "Loading..."
                                    }
                                }
                                td { class: "py-2 px-3 text-gray-400",
                                    if !roon_enabled() {
                                        "-"
                                    } else if let Some(ref status) = roon_st {
                                        if status.connected {
                                            if let Some(ref name) = status.core_name {
                                                "{name}"
                                            } else {
                                                "Core"
                                            }
                                        } else {
                                            "-"
                                        }
                                    } else {
                                        "-"
                                    }
                                }
                            }
                            // OpenHome row
                            tr { class: "border-b border-gray-800",
                                td { class: "py-2 px-3", "OpenHome" }
                                td { class: "py-2 px-3",
                                    if !openhome_enabled() {
                                        span { class: "status-disabled", "Disabled" }
                                    } else if let Some(ref status) = openhome_st {
                                        if status.device_count > 0 {
                                            span { class: "status-ok", "✓ Active" }
                                        } else {
                                            "Searching..."
                                        }
                                    } else {
                                        "Loading..."
                                    }
                                }
                                td { class: "py-2 px-3 text-gray-400",
                                    if !openhome_enabled() {
                                        "-"
                                    } else if let Some(ref status) = openhome_st {
                                        "{status.device_count} device(s)"
                                    } else {
                                        "-"
                                    }
                                }
                            }
                            // UPnP row
                            tr {
                                td { class: "py-2 px-3", "UPnP/DLNA" }
                                td { class: "py-2 px-3",
                                    if !upnp_enabled() {
                                        span { class: "status-disabled", "Disabled" }
                                    } else if let Some(ref status) = upnp_st {
                                        if status.renderer_count > 0 {
                                            span { class: "status-ok", "✓ Active" }
                                        } else {
                                            "Searching..."
                                        }
                                    } else {
                                        "Loading..."
                                    }
                                }
                                td { class: "py-2 px-3 text-gray-400",
                                    if !upnp_enabled() {
                                        "-"
                                    } else if let Some(ref status) = upnp_st {
                                        "{status.renderer_count} renderer(s)"
                                    } else {
                                        "-"
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
