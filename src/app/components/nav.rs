//! Navigation component using Tailwind CSS.

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
            "block px-3 py-2 rounded-md text-sm font-medium text-white bg-gray-900"
        } else {
            "block px-3 py-2 rounded-md text-sm font-medium text-gray-300 hover:text-white hover:bg-gray-700"
        }
    };

    let mobile_menu_class = if menu_open() {
        "block lg:hidden"
    } else {
        "hidden lg:hidden"
    };

    rsx! {
        nav { class: "bg-gray-800",
            div { class: "max-w-7xl mx-auto px-4 sm:px-6 lg:px-8",
                div { class: "flex items-center justify-between h-16",
                    // Logo / Brand
                    div { class: "flex items-center",
                        a { class: "text-white font-bold text-xl", href: "/", "Hi-Fi Control" }
                    }

                    // Desktop navigation
                    div { class: "hidden lg:flex items-center space-x-4",
                        a { class: nav_link_class("dashboard"), href: "/", "Dashboard" }
                        a { class: nav_link_class("zones"), href: "/ui/zones", "Zones" }
                        a { class: nav_link_class("zone"), href: "/zone", "Zone" }
                        if !props.hide_hqp {
                            a { class: nav_link_class("hqplayer"), href: "/hqplayer", "HQPlayer" }
                        }
                        if !props.hide_lms {
                            a { class: nav_link_class("lms"), href: "/lms", "LMS" }
                        }
                        if !props.hide_knobs {
                            a { class: nav_link_class("knobs"), href: "/knobs", "Knobs" }
                        }
                        a { class: nav_link_class("settings"), href: "/settings", "Settings" }
                    }

                    // Mobile menu button
                    div { class: "lg:hidden",
                        button {
                            class: "inline-flex items-center justify-center p-2 rounded-md text-gray-400 hover:text-white hover:bg-gray-700 focus:outline-none",
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
            }

            // Mobile menu
            div { class: "{mobile_menu_class}", id: "mobile-menu",
                div { class: "px-2 pt-2 pb-3 space-y-1",
                    a { class: nav_link_class("dashboard"), href: "/", onclick: move |_| menu_open.set(false), "Dashboard" }
                    a { class: nav_link_class("zones"), href: "/ui/zones", onclick: move |_| menu_open.set(false), "Zones" }
                    a { class: nav_link_class("zone"), href: "/zone", onclick: move |_| menu_open.set(false), "Zone" }
                    if !props.hide_hqp {
                        a { class: nav_link_class("hqplayer"), href: "/hqplayer", onclick: move |_| menu_open.set(false), "HQPlayer" }
                    }
                    if !props.hide_lms {
                        a { class: nav_link_class("lms"), href: "/lms", onclick: move |_| menu_open.set(false), "LMS" }
                    }
                    if !props.hide_knobs {
                        a { class: nav_link_class("knobs"), href: "/knobs", onclick: move |_| menu_open.set(false), "Knobs" }
                    }
                    a { class: nav_link_class("settings"), href: "/settings", onclick: move |_| menu_open.set(false), "Settings" }
                }
            }
        }
    }
}
