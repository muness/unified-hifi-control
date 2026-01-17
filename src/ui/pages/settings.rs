//! Settings page component.
//!
//! Allows users to:
//! - Enable/disable adapter sources (Roon, LMS, OpenHome, UPnP)
//! - Show/hide navigation tabs (HQPlayer, LMS, Knobs)
//! - View auto-discovery status

use dioxus::prelude::*;

use crate::ui::components::Layout;

/// Client-side JavaScript for the Settings page.
const SETTINGS_SCRIPT: &str = r#"

// Discovery status - needs adapter settings to know what's enabled
async function loadDiscoveryStatus(adapterSettings) {
    const tbody = document.getElementById('discovery-table');
    try {
        const [openhome, upnp, roon] = await Promise.all([
            fetch('/openhome/status').then(r => r.json()).catch(() => ({ connected: false, device_count: 0 })),
            fetch('/upnp/status').then(r => r.json()).catch(() => ({ connected: false, renderer_count: 0 })),
            fetch('/roon/status').then(r => r.json()).catch(() => ({ connected: false }))
        ]);

        // Determine status text based on enabled state
        const roonEnabled = adapterSettings?.roon !== false;
        const openhomeEnabled = adapterSettings?.openhome === true;
        const upnpEnabled = adapterSettings?.upnp === true;

        function getDiscoveryStatus(enabled, hasDevices, activeText) {
            if (!enabled) return '<span class="status-disabled">Disabled</span>';
            if (hasDevices) return '<span class="status-ok">✓ ' + activeText + '</span>';
            return 'Searching...';
        }

        tbody.innerHTML = `
            <tr>
                <td>Roon</td>
                <td class="${roon.connected ? 'status-ok' : 'status-err'}">${
                    !roonEnabled ? '<span class="status-disabled">Disabled</span>' :
                    roon.connected ? '✓ Connected' : '✗ Not connected'
                }</td>
                <td>${roon.connected ? esc(roon.core_name || 'Core') : '-'}</td>
            </tr>
            <tr>
                <td>OpenHome</td>
                <td>${getDiscoveryStatus(openhomeEnabled, openhome.device_count > 0, 'Active')}</td>
                <td>${openhomeEnabled ? openhome.device_count + ' device' + (openhome.device_count !== 1 ? 's' : '') : '-'}</td>
            </tr>
            <tr>
                <td>UPnP/DLNA</td>
                <td>${getDiscoveryStatus(upnpEnabled, upnp.renderer_count > 0, 'Active')}</td>
                <td>${upnpEnabled ? upnp.renderer_count + ' renderer' + (upnp.renderer_count !== 1 ? 's' : '') : '-'}</td>
            </tr>
        `;
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="3" class="status-err">Error: ${esc(e.message)}</td></tr>`;
    }
}

// Adapter Settings - returns adapters object for use by loadDiscoveryStatus
async function loadAdapterSettings() {
    try {
        const res = await fetch('/api/settings');
        const settings = await res.json();
        const adapters = settings.adapters || {};
        document.getElementById('adapter-roon').checked = adapters.roon !== false;
        document.getElementById('adapter-lms').checked = adapters.lms === true;
        document.getElementById('adapter-openhome').checked = adapters.openhome === true;
        document.getElementById('adapter-upnp').checked = adapters.upnp === true;
        return adapters;
    } catch (e) {
        console.error('Failed to load adapter settings:', e);
        return {};
    }
}

async function saveAdapterSettings() {
    try {
        const res = await fetch('/api/settings');
        const settings = await res.json();
        settings.adapters = {
            roon: document.getElementById('adapter-roon').checked,
            lms: document.getElementById('adapter-lms').checked,
            openhome: document.getElementById('adapter-openhome').checked,
            upnp: document.getElementById('adapter-upnp').checked
        };
        await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });
        // Update local state and refresh discovery status
        currentAdapterSettings = settings.adapters;
        loadDiscoveryStatus(currentAdapterSettings);
    } catch (e) {
        console.error('Failed to save adapter settings:', e);
    }
}

// Wire up adapter toggle handlers
['roon', 'lms', 'openhome', 'upnp'].forEach(id => {
    document.getElementById('adapter-' + id).addEventListener('change', saveAdapterSettings);
});

// Store adapter settings for use by discovery status
let currentAdapterSettings = {};

// Load all on page load
async function initPage() {
    currentAdapterSettings = await loadAdapterSettings();
    loadDiscoveryStatus(currentAdapterSettings);
}
initPage();

// SSE for real-time updates (no polling jitter)
const es = new EventSource('/events');
es.onmessage = (e) => {
    try {
        const event = JSON.parse(e.data);
        // Reload discovery status on connection events
        if (['RoonConnected', 'RoonDisconnected', 'HqpConnected', 'HqpDisconnected',
             'LmsConnected', 'LmsDisconnected'].includes(event.type)) {
            loadDiscoveryStatus(currentAdapterSettings);
        }
    } catch (err) { console.error('SSE parse error:', err); }
};
es.onerror = () => {
    console.warn('SSE disconnected, falling back to polling');
    es.close();
    setInterval(() => loadDiscoveryStatus(currentAdapterSettings), 10000);
};
"#;

/// Settings page component.
#[component]
pub fn SettingsPage() -> Element {
    rsx! {
        Layout {
            title: "Settings".to_string(),
            nav_active: "settings".to_string(),
            scripts: Some(SETTINGS_SCRIPT.to_string()),

            h1 { "Settings" }

            // Adapter Settings section
            section { id: "adapter-settings",
                hgroup {
                    h2 { "Adapter Settings" }
                    p { "Enable or disable zone sources" }
                }
                article { id: "adapter-toggles",
                    div {
                        style: "display:flex;flex-wrap:wrap;gap:1.5rem;",
                        label {
                            input {
                                r#type: "checkbox",
                                id: "adapter-roon"
                            }
                            " Roon"
                        }
                        label {
                            input {
                                r#type: "checkbox",
                                id: "adapter-lms"
                            }
                            " LMS"
                        }
                        label {
                            input {
                                r#type: "checkbox",
                                id: "adapter-openhome"
                            }
                            " OpenHome"
                        }
                        label {
                            input {
                                r#type: "checkbox",
                                id: "adapter-upnp"
                            }
                            " UPnP/DLNA"
                        }
                    }
                    p {
                        style: "margin-top:0.5rem;",
                        small { "Changes take effect immediately. Disabled adapters won't contribute zones." }
                    }
                }
            }

            // Discovery Status section
            section { id: "discovery-status",
                hgroup {
                    h2 { "Auto-Discovery" }
                    p { "Devices found via SSDP (no configuration needed)" }
                }
                article {
                    table {
                        thead {
                            tr {
                                th { "Protocol" }
                                th { "Status" }
                                th { "Devices" }
                            }
                        }
                        tbody { id: "discovery-table",
                            tr {
                                td { colspan: "3", "Loading..." }
                            }
                        }
                    }
                }
            }
        }
    }
}
