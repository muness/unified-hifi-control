//! Theme switcher component for light/dark/black modes.

use dioxus::prelude::*;

/// Theme switcher with light, dark, and black (OLED) options.
/// Uses localStorage for persistence and Pico CSS data-theme attribute.
#[component]
pub fn ThemeSwitcher() -> Element {
    let mut current_theme = use_signal(|| "dark".to_string());

    // Load theme from localStorage on mount
    use_effect(move || {
        #[cfg(target_arch = "wasm32")]
        {
            if let Some(window) = web_sys::window() {
                if let Ok(Some(storage)) = window.local_storage() {
                    if let Ok(Some(theme)) = storage.get_item("hifi-theme") {
                        current_theme.set(theme);
                    }
                }
            }
        }
    });

    let mut set_theme = move |theme: &'static str| {
        current_theme.set(theme.to_string());

        #[cfg(target_arch = "wasm32")]
        {
            if let Some(window) = web_sys::window() {
                if let Some(document) = window.document() {
                    if let Some(root) = document.document_element() {
                        // Set data-theme
                        let data_theme = if theme == "black" { "dark" } else { theme };
                        let _ = root.set_attribute("data-theme", data_theme);

                        // Set/remove data-variant for black theme
                        if theme == "black" {
                            let _ = root.set_attribute("data-variant", "black");
                        } else {
                            let _ = root.remove_attribute("data-variant");
                        }
                    }
                }

                // Save to localStorage
                if let Ok(Some(storage)) = window.local_storage() {
                    let _ = storage.set_item("hifi-theme", theme);
                }
            }
        }
    };

    let theme = current_theme();

    rsx! {
        div { class: "theme-switcher",
            button {
                id: "theme-light",
                class: if theme == "light" { "active" } else { "" },
                onclick: move |_| set_theme("light"),
                "Light"
            }
            button {
                id: "theme-dark",
                class: if theme == "dark" { "active" } else { "" },
                onclick: move |_| set_theme("dark"),
                "Dark"
            }
            button {
                id: "theme-black",
                class: if theme == "black" { "active" } else { "" },
                onclick: move |_| set_theme("black"),
                "Black"
            }
        }
    }
}

/// Client-side JavaScript for initial theme setup (included in head).
/// Runs immediately to prevent flash of wrong theme.
pub const THEME_SCRIPT: &str = r#"
(function(){
    const t = localStorage.getItem('hifi-theme') || 'dark';
    document.documentElement.setAttribute('data-theme', t === 'black' ? 'dark' : t);
    if (t === 'black') document.documentElement.setAttribute('data-variant', 'black');
})();
"#;
