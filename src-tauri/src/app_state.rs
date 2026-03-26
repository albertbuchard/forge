use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
pub struct AppState {
    pub api_version: &'static str,
    pub backend_mode: &'static str,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            api_version: "v1",
            backend_mode: "rust-target",
        }
    }
}
