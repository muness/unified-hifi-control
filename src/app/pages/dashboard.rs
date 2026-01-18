//! Dashboard page component.
//!
//! Shows service status overview using Dioxus resources for async data fetching.

use dioxus::prelude::*;

use crate::app::api::{AppStatus, HqpStatus, LmsStatus, RoonStatus};
use crate::app::components::Layout;
use crate::app::sse::use_sse;

/// Dashboard page component.
#[component]
pub fn Dashboard() -> Element {
    let sse = use_sse();

    // Use resources for async data fetching (handles SSR/client properly)
    let status = use_resource(|| async {
        crate::app::api::fetch_json::<AppStatus>("/status")
            .await
            .ok()
    });
    let mut roon = use_resource(|| async {
        crate::app::api::fetch_json::<RoonStatus>("/roon/status")
            .await
            .ok()
    });
    let mut hqp = use_resource(|| async {
        crate::app::api::fetch_json::<HqpStatus>("/hqp/status")
            .await
            .ok()
    });
    let mut lms = use_resource(|| async {
        crate::app::api::fetch_json::<LmsStatus>("/lms/status")
            .await
            .ok()
    });

    // Refresh on SSE events
    let event_count = sse.event_count;
    use_effect(move || {
        let _ = event_count();
        if sse.should_refresh_roon() || sse.should_refresh_hqp() || sse.should_refresh_lms() {
            roon.restart();
            hqp.restart();
            lms.restart();
        }
    });

    let is_loading = status.read().is_none() || roon.read().is_none();

    let status_content = if is_loading {
        rsx! {
            div { class: "card p-6", aria_busy: "true", "Loading status..." }
        }
    } else {
        let app_status = status.read().clone().flatten().unwrap_or_default();
        let roon_status = roon.read().clone().flatten().unwrap_or_default();
        let hqp_status = hqp.read().clone().flatten().unwrap_or_default();
        let lms_status = lms.read().clone().flatten().unwrap_or_default();

        rsx! {
            div { class: "card p-6",
                div { class: "mb-4 space-y-1",
                    p { span { class: "font-semibold", "Version:" } " {app_status.version}" }
                    p { span { class: "font-semibold", "Uptime:" } " {app_status.uptime_secs}s" }
                    p { span { class: "font-semibold", "Event Bus Subscribers:" } " {app_status.bus_subscribers}" }
                }
                div { class: "border-t border-default my-4" }
                table { class: "w-full",
                    thead {
                        tr { class: "border-b border-default",
                            th { class: "text-left py-2 px-3 font-semibold", "Adapter" }
                            th { class: "text-left py-2 px-3 font-semibold", "Status" }
                            th { class: "text-left py-2 px-3 font-semibold", "Details" }
                        }
                    }
                    tbody {
                        // Roon row
                        tr { class: "border-b border-default",
                            td { class: "py-2 px-3", "Roon" }
                            td { class: "py-2 px-3",
                                span {
                                    class: if roon_status.connected { "status-ok" } else { "status-err" },
                                    if roon_status.connected { "✓ Connected" } else { "✗ Disconnected" }
                                }
                            }
                            td { class: "py-2 px-3 text-sm text-muted",
                                if let Some(name) = &roon_status.core_name {
                                    "{name} "
                                }
                                if let Some(ver) = &roon_status.core_version {
                                    "v{ver}"
                                }
                            }
                        }
                        // HQPlayer row
                        tr { class: "border-b border-default",
                            td { class: "py-2 px-3", "HQPlayer" }
                            td { class: "py-2 px-3",
                                span {
                                    class: if hqp_status.connected { "status-ok" } else { "status-err" },
                                    if hqp_status.connected { "✓ Connected" } else { "✗ Disconnected" }
                                }
                            }
                            td { class: "py-2 px-3 text-sm text-muted",
                                if let Some(host) = &hqp_status.host {
                                    "{host}"
                                }
                            }
                        }
                        // LMS row
                        tr {
                            td { class: "py-2 px-3", "LMS" }
                            td { class: "py-2 px-3",
                                span {
                                    class: if lms_status.connected { "status-ok" } else { "status-err" },
                                    if lms_status.connected { "✓ Connected" } else { "✗ Disconnected" }
                                }
                            }
                            td { class: "py-2 px-3 text-sm text-muted",
                                if let (Some(host), Some(port)) = (&lms_status.host, lms_status.port) {
                                    "{host}:{port}"
                                }
                            }
                        }
                    }
                }
            }
        }
    };

    rsx! {
        Layout {
            title: "Dashboard".to_string(),
            nav_active: "dashboard".to_string(),

            h1 { class: "text-2xl font-bold mb-6", "Dashboard" }

            section { id: "status",
                div { class: "mb-4",
                    h2 { class: "text-xl font-semibold", "Service Status" }
                    p { class: "text-muted text-sm", "Connection status for all adapters" }
                }
                {status_content}
            }
        }
    }
}
