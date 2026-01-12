//! Configuration management

use anyhow::Result;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct Config {
    #[serde(default = "default_port")]
    pub port: u16,

    #[serde(default)]
    pub roon: RoonConfig,

    #[serde(default)]
    pub hqplayer: Option<HqpConfig>,

    #[serde(default)]
    pub lms: Option<LmsConfig>,

    #[serde(default)]
    pub mqtt: Option<MqttConfig>,
}

fn default_port() -> u16 {
    3000
}

#[derive(Debug, Default, Deserialize)]
pub struct RoonConfig {
    pub extension_id: Option<String>,
    pub display_name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct HqpConfig {
    pub host: String,
    #[serde(default = "default_hqp_port")]
    pub port: u16,
    pub username: Option<String>,
    pub password: Option<String>,
}

fn default_hqp_port() -> u16 {
    8088
}

#[derive(Debug, Deserialize)]
pub struct LmsConfig {
    pub host: String,
    #[serde(default = "default_lms_port")]
    pub port: u16,
    pub username: Option<String>,
    pub password: Option<String>,
}

fn default_lms_port() -> u16 {
    9000
}

#[derive(Debug, Deserialize)]
pub struct MqttConfig {
    pub host: String,
    #[serde(default = "default_mqtt_port")]
    pub port: u16,
    pub username: Option<String>,
    pub password: Option<String>,
    pub topic_prefix: Option<String>,
}

fn default_mqtt_port() -> u16 {
    1883
}

pub fn load_config() -> Result<Config> {
    let config_dir = directories::ProjectDirs::from("com", "open-horizon-labs", "unified-hifi-control")
        .map(|dirs| dirs.config_dir().to_path_buf())
        .unwrap_or_else(|| std::path::PathBuf::from("."));

    let config = ::config::Config::builder()
        // Start with defaults
        .set_default("port", 3000)?
        // Load from config file if it exists
        .add_source(
            ::config::File::with_name(&config_dir.join("config").to_string_lossy())
                .required(false),
        )
        // Override with environment variables (UHC_PORT, UHC_ROON__EXTENSION_ID, etc.)
        .add_source(
            ::config::Environment::with_prefix("UHC")
                .separator("__")
                .try_parsing(true),
        )
        .build()?;

    Ok(config.try_deserialize()?)
}
