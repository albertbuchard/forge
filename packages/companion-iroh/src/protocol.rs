use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: u32 = 1;
pub const COMPANION_ALPN: &[u8] = b"forge-companion/1";
pub const FORGE_AGENT_NAME: &str = "forge";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PairPayload {
    pub v: u32,
    pub node_id: String,
    pub token: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relay: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentWire {
    HttpJson,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentInfo {
    pub name: String,
    pub display_name: String,
    pub wire: AgentWire,
    pub available: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum BridgeRequest {
    ListAgents {
        v: u32,
        token: String,
    },
    Connect {
        v: u32,
        token: String,
        agent: String,
    },
}

impl BridgeRequest {
    pub fn version(&self) -> u32 {
        match self {
            Self::ListAgents { v, .. } | Self::Connect { v, .. } => *v,
        }
    }

    pub fn token(&self) -> &str {
        match self {
            Self::ListAgents { token, .. } | Self::Connect { token, .. } => token,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BridgeResponse {
    pub v: u32,
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agents: Option<Vec<AgentInfo>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl BridgeResponse {
    pub fn ok() -> Self {
        Self {
            v: PROTOCOL_VERSION,
            ok: true,
            agents: None,
            error: None,
        }
    }

    pub fn agents() -> Self {
        Self {
            v: PROTOCOL_VERSION,
            ok: true,
            agents: Some(vec![AgentInfo {
                name: FORGE_AGENT_NAME.to_string(),
                display_name: "Forge Companion".to_string(),
                wire: AgentWire::HttpJson,
                available: true,
            }]),
            error: None,
        }
    }

    pub fn error(error: impl Into<String>) -> Self {
        Self {
            v: PROTOCOL_VERSION,
            ok: false,
            agents: None,
            error: Some(error.into()),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ForgeHttpRequest {
    pub v: u32,
    pub method: String,
    pub path: String,
    #[serde(default)]
    pub headers: Vec<HeaderPair>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body_base64: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ForgeHttpResponse {
    pub v: u32,
    pub status: u16,
    #[serde(default)]
    pub headers: Vec<HeaderPair>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body_base64: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HeaderPair {
    pub name: String,
    pub value: String,
}
