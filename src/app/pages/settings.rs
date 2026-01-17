//! Settings page using Dioxus signals.
//!
//! Replaces inline JavaScript with idiomatic Dioxus patterns:
//! - use_signal() for reactive state
//! - use_resource() for async data fetching
//! - Rust event handlers (onclick, onchange)

use dioxus::prelude::*;
use serde::{Deserialize, Serialize};

use crate::app::components::Layout;

/// Adapter settings from /api/settings
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct AdapterSettings {
    pub roon: bool,
    pub lms: bool,
    pub openhome: bool,
    pub upnp: bool,
}

/// Full app settings
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct AppSettings {
    pub adapters: AdapterSettings,
}

/// Server function to fetch settings
#[server]
pub async fn get_settings() -> Result<AppSettings, ServerFnError> {
    let client = reqwest::Client::new();
    let resp = client
        .get("http://127.0.0.1:8088/api/settings")
        .send()
        .await
        .map_err(|e| ServerFnError::new(e.to_string()))?;

    resp.json::<AppSettings>()
        .await
        .map_err(|e| ServerFnError::new(e.to_string()))
}

/// Server function to save settings
#[server]
pub async fn save_settings(settings: AppSettings) -> Result<(), ServerFnError> {
    let client = reqwest::Client::new();
    client
        .post("http://127.0.0.1:8088/api/settings")
        .json(&settings)
        .send()
        .await
        .map_err(|e| ServerFnError::new(e.to_string()))?;
    Ok(())
}

/// Client-side script to fetch discovery status
const DISCOVERY_SCRIPT: &str = r#"
async function loadDiscoveryStatus() {
    try {
        const [roon, openhome, upnp] = await Promise.all([
            fetch('/roon/status').then(r => r.json()).catch(() => ({ connected: false })),
            fetch('/openhome/status').then(r => r.json()).catch(() => ({ device_count: 0 })),
            fetch('/upnp/status').then(r => r.json()).catch(() => ({ renderer_count: 0 }))
        ]);

        // Update Roon row
        const roonRow = document.querySelector('#discovery-table tr[data-protocol="roon"]');
        if (roonRow) {
            const statusCell = roonRow.querySelector('.status-cell');
            const devicesCell = roonRow.querySelector('.devices-cell');
            const roonEnabled = document.querySelector('input[data-adapter="roon"]')?.checked ?? true;

            if (!roonEnabled) {
                statusCell.innerHTML = '<span class="status-disabled">Disabled</span>';
                statusCell.className = 'status-cell';
                devicesCell.textContent = '-';
            } else if (roon.connected) {
                statusCell.textContent = '✓ Connected';
                statusCell.className = 'status-cell status-ok';
                devicesCell.textContent = roon.core_name || 'Core';
            } else {
                statusCell.textContent = '✗ Not connected';
                statusCell.className = 'status-cell status-err';
                devicesCell.textContent = '-';
            }
        }

        // Update OpenHome row
        const ohRow = document.querySelector('#discovery-table tr[data-protocol="openhome"]');
        if (ohRow) {
            const statusCell = ohRow.querySelector('.status-cell');
            const devicesCell = ohRow.querySelector('.devices-cell');
            const ohEnabled = document.querySelector('input[data-adapter="openhome"]')?.checked ?? false;

            if (!ohEnabled) {
                statusCell.innerHTML = '<span class="status-disabled">Disabled</span>';
                statusCell.className = 'status-cell';
                devicesCell.textContent = '-';
            } else if (openhome.device_count > 0) {
                statusCell.innerHTML = '<span class="status-ok">✓ Active</span>';
                statusCell.className = 'status-cell';
                devicesCell.textContent = openhome.device_count + ' device(s)';
            } else {
                statusCell.textContent = 'Searching...';
                statusCell.className = 'status-cell';
                devicesCell.textContent = '0 device(s)';
            }
        }

        // Update UPnP row
        const upnpRow = document.querySelector('#discovery-table tr[data-protocol="upnp"]');
        if (upnpRow) {
            const statusCell = upnpRow.querySelector('.status-cell');
            const devicesCell = upnpRow.querySelector('.devices-cell');
            const upnpEnabled = document.querySelector('input[data-adapter="upnp"]')?.checked ?? false;

            if (!upnpEnabled) {
                statusCell.innerHTML = '<span class="status-disabled">Disabled</span>';
                statusCell.className = 'status-cell';
                devicesCell.textContent = '-';
            } else if (upnp.renderer_count > 0) {
                statusCell.innerHTML = '<span class="status-ok">✓ Active</span>';
                statusCell.className = 'status-cell';
                devicesCell.textContent = upnp.renderer_count + ' renderer(s)';
            } else {
                statusCell.textContent = 'Searching...';
                statusCell.className = 'status-cell';
                devicesCell.textContent = '0 renderer(s)';
            }
        }
    } catch (e) {
        console.error('Failed to load discovery status:', e);
    }
}

// Load on page load and set up SSE for updates
loadDiscoveryStatus();

const es = new EventSource('/events');
es.onmessage = (e) => {
    try {
        const event = JSON.parse(e.data);
        if (['RoonConnected', 'RoonDisconnected', 'OpenHomeDeviceFound', 'OpenHomeDeviceLost',
             'UpnpRendererFound', 'UpnpRendererLost'].includes(event.type)) {
            loadDiscoveryStatus();
        }
    } catch (err) { console.error('SSE parse error:', err); }
};
es.onerror = () => {
    console.warn('SSE disconnected, falling back to polling');
    es.close();
    setInterval(loadDiscoveryStatus, 10000);
};
"#;

/// Settings page component
#[component]
pub fn Settings() -> Element {
    // Reactive state for adapter toggles
    let mut roon_enabled = use_signal(|| true);
    let mut lms_enabled = use_signal(|| false);
    let mut openhome_enabled = use_signal(|| false);
    let mut upnp_enabled = use_signal(|| false);

    // Load initial settings
    let settings_resource = use_resource(move || async move { get_settings().await });

    // Update signals when settings load
    use_effect(move || {
        if let Some(Ok(settings)) = settings_resource.read().as_ref() {
            roon_enabled.set(settings.adapters.roon);
            lms_enabled.set(settings.adapters.lms);
            openhome_enabled.set(settings.adapters.openhome);
            upnp_enabled.set(settings.adapters.upnp);
        }
    });

    // Save settings handler
    let save = move |_| {
        spawn(async move {
            let settings = AppSettings {
                adapters: AdapterSettings {
                    roon: roon_enabled(),
                    lms: lms_enabled(),
                    openhome: openhome_enabled(),
                    upnp: upnp_enabled(),
                },
            };
            let _ = save_settings(settings).await;
        });
    };

    rsx! {
        Layout {
            title: "Settings".to_string(),
            nav_active: "settings".to_string(),
            scripts: Some(DISCOVERY_SCRIPT.to_string()),

            h1 { "Settings" }

            // Adapter Settings section
            section {
                h2 { "Adapter Settings" }
                p { "Enable or disable zone sources" }

                article {
                    div { style: "display:flex;flex-wrap:wrap;gap:1.5rem;",
                        label {
                            input {
                                r#type: "checkbox",
                                "data-adapter": "roon",
                                checked: roon_enabled(),
                                onchange: move |_| {
                                    roon_enabled.toggle();
                                    save(());
                                }
                            }
                            " Roon"
                        }
                        label {
                            input {
                                r#type: "checkbox",
                                "data-adapter": "lms",
                                checked: lms_enabled(),
                                onchange: move |_| {
                                    lms_enabled.toggle();
                                    save(());
                                }
                            }
                            " LMS"
                        }
                        label {
                            input {
                                r#type: "checkbox",
                                "data-adapter": "openhome",
                                checked: openhome_enabled(),
                                onchange: move |_| {
                                    openhome_enabled.toggle();
                                    save(());
                                }
                            }
                            " OpenHome"
                        }
                        label {
                            input {
                                r#type: "checkbox",
                                "data-adapter": "upnp",
                                checked: upnp_enabled(),
                                onchange: move |_| {
                                    upnp_enabled.toggle();
                                    save(());
                                }
                            }
                            " UPnP/DLNA"
                        }
                    }
                    p { style: "margin-top:0.5rem;",
                        small { "Changes take effect immediately. Disabled adapters won't contribute zones." }
                    }
                }
            }

            // Discovery Status section
            section {
                h2 { "Auto-Discovery" }
                p { "Devices found via SSDP (no configuration needed)" }

                article {
                    table { id: "discovery-table",
                        thead {
                            tr {
                                th { "Protocol" }
                                th { "Status" }
                                th { "Devices" }
                            }
                        }
                        tbody {
                            // Roon row
                            tr { "data-protocol": "roon",
                                td { "Roon" }
                                td { class: "status-cell", "Loading..." }
                                td { class: "devices-cell", "-" }
                            }
                            // OpenHome row
                            tr { "data-protocol": "openhome",
                                td { "OpenHome" }
                                td { class: "status-cell", "Loading..." }
                                td { class: "devices-cell", "-" }
                            }
                            // UPnP row
                            tr { "data-protocol": "upnp",
                                td { "UPnP/DLNA" }
                                td { class: "status-cell", "Loading..." }
                                td { class: "devices-cell", "-" }
                            }
                        }
                    }
                }
            }
        }
    }
}
