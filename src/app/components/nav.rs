//! Navigation component using Tailwind CSS.

use crate::app::Route;
use dioxus::prelude::*;

#[derive(Props, Clone, PartialEq)]
pub struct NavProps {
    /// The currently active page ID (e.g., "dashboard", "zones")
    pub active: String,
    /// Hide HQPlayer tab
    #[props(default = false)]
    pub hide_hqp: bool,
    /// Hide LMS tab
    #[props(default = false)]
    pub hide_lms: bool,
    /// Hide Knobs tab
    #[props(default = false)]
    pub hide_knobs: bool,
}

/// Navigation bar using Tailwind CSS with mobile toggle.
#[component]
pub fn Nav(props: NavProps) -> Element {
    let mut menu_open = use_signal(|| false);

    let nav_link_class = |page: &str| {
        if props.active == page {
            "nav-link-active"
        } else {
            "nav-link"
        }
    };

    let mobile_menu_class = if menu_open() {
        "block lg:hidden"
    } else {
        "hidden lg:hidden"
    };

    rsx! {
        nav { class: "nav-container",
            div { class: "nav-inner",
                // Logo / Brand
                div { class: "flex items-center",
                    Link { class: "nav-brand", to: Route::Dashboard {}, "Hi-Fi Control" }
                }

                // Desktop navigation - use Link for client-side routing (no page reload)
                div { class: "hidden lg:flex items-center space-x-4",
                    Link { class: nav_link_class("dashboard"), to: Route::Dashboard {}, "Dashboard" }
                    Link { class: nav_link_class("zones"), to: Route::Zones {}, "Zones" }
                    Link { class: nav_link_class("zone"), to: Route::Zone {}, "Zone" }
                    if !props.hide_hqp {
                        Link { class: nav_link_class("hqplayer"), to: Route::HqPlayer {}, "HQPlayer" }
                    }
                    if !props.hide_lms {
                        Link { class: nav_link_class("lms"), to: Route::Lms {}, "LMS" }
                    }
                    if !props.hide_knobs {
                        Link { class: nav_link_class("knobs"), to: Route::Knobs {}, "Knobs" }
                    }
                    Link { class: nav_link_class("settings"), to: Route::Settings {}, "Settings" }
                }

                // Mobile menu button
                div { class: "lg:hidden",
                    button {
                        class: "inline-flex items-center justify-center p-2 rounded-md text-muted hover:text-primary hover:bg-hover focus:outline-none",
                        r#type: "button",
                        onclick: move |_| menu_open.toggle(),
                        span { class: "sr-only", "Toggle menu" }
                        if menu_open() {
                            // X icon
                            svg { class: "h-6 w-6", fill: "none", view_box: "0 0 24 24", stroke: "currentColor", "stroke-width": "2",
                                path { "stroke-linecap": "round", "stroke-linejoin": "round", d: "M6 18L18 6M6 6l12 12" }
                            }
                        } else {
                            // Hamburger icon
                            svg { class: "h-6 w-6", fill: "none", view_box: "0 0 24 24", stroke: "currentColor", "stroke-width": "2",
                                path { "stroke-linecap": "round", "stroke-linejoin": "round", d: "M4 6h16M4 12h16M4 18h16" }
                            }
                        }
                    }
                }
            }

            // Mobile menu - use Link for client-side routing
            div { class: "{mobile_menu_class}", id: "mobile-menu",
                div { class: "px-2 pt-2 pb-3 space-y-1",
                    Link { class: nav_link_class("dashboard"), to: Route::Dashboard {}, onclick: move |_| menu_open.set(false), "Dashboard" }
                    Link { class: nav_link_class("zones"), to: Route::Zones {}, onclick: move |_| menu_open.set(false), "Zones" }
                    Link { class: nav_link_class("zone"), to: Route::Zone {}, onclick: move |_| menu_open.set(false), "Zone" }
                    if !props.hide_hqp {
                        Link { class: nav_link_class("hqplayer"), to: Route::HqPlayer {}, onclick: move |_| menu_open.set(false), "HQPlayer" }
                    }
                    if !props.hide_lms {
                        Link { class: nav_link_class("lms"), to: Route::Lms {}, onclick: move |_| menu_open.set(false), "LMS" }
                    }
                    if !props.hide_knobs {
                        Link { class: nav_link_class("knobs"), to: Route::Knobs {}, onclick: move |_| menu_open.set(false), "Knobs" }
                    }
                    Link { class: nav_link_class("settings"), to: Route::Settings {}, onclick: move |_| menu_open.set(false), "Settings" }
                }
            }
        }
    }
}
