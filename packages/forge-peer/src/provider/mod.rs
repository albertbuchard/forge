use std::collections::{BTreeMap, VecDeque};
use std::pin::Pin;
use std::sync::{Arc, RwLock};
use std::time::Duration;

use async_trait::async_trait;
use bincode::{Decode, Encode};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::sync::Mutex;

use crate::codec::{BoundedBytes, BoundedString, BoundedVec, Validate};
use crate::endpoint::EndpointDescriptor;
use crate::envelope::{EnvelopeMessageId, SignedEnvelope};
use crate::error::{PeerError, Result, invalid};
use crate::identity::DeviceId;

pub mod direct;
pub mod iroh;
pub mod mailbox;
pub mod stream;
pub mod tor;

pub const PROVIDER_OPERATION_TIMEOUT: Duration = Duration::from_secs(30);
pub const MAX_PROVIDER_BATCH: usize = 64;
pub const MAX_PROVIDER_INBOX: usize = 1_024;

pub trait PeerStream: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T> PeerStream for T where T: AsyncRead + AsyncWrite + Unpin + Send {}
pub type BoxPeerStream = Pin<Box<dyn PeerStream>>;

#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    PartialOrd,
    Ord,
    Encode,
    Decode,
    serde::Serialize,
    serde::Deserialize,
)]
#[serde(rename_all = "snake_case")]
pub enum ProviderKind {
    LocalDirect,
    Iroh,
    TorOnion,
    HttpMailbox,
}

impl Validate for ProviderKind {
    fn validate(&self) -> Result<()> {
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderRuntimeState {
    Ready,
    Degraded,
    Stopped,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProviderReadiness {
    pub kind: ProviderKind,
    pub state: ProviderRuntimeState,
    pub detail_code: String,
    pub checked_at: u64,
}

impl Validate for ProviderReadiness {
    fn validate(&self) -> Result<()> {
        self.kind.validate()?;
        if self.checked_at == 0
            || self.detail_code.is_empty()
            || self.detail_code.len() > 64
            || !self
                .detail_code
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte == b'_')
        {
            return Err(invalid("provider readiness detail is invalid"));
        }
        Ok(())
    }
}

#[derive(Clone, Default)]
pub struct ProviderReadinessRegistry {
    inner: Arc<RwLock<BTreeMap<ProviderKind, ProviderReadiness>>>,
}

impl ProviderReadinessRegistry {
    pub fn configured(kinds: impl IntoIterator<Item = ProviderKind>, checked_at: u64) -> Self {
        let registry = Self::default();
        for kind in kinds {
            registry.set(kind, ProviderRuntimeState::Ready, "operational", checked_at);
        }
        registry
    }

    pub fn set(
        &self,
        kind: ProviderKind,
        state: ProviderRuntimeState,
        detail_code: &'static str,
        checked_at: u64,
    ) {
        if let Ok(mut readiness) = self.inner.write() {
            readiness.insert(
                kind,
                ProviderReadiness {
                    kind,
                    state,
                    detail_code: detail_code.to_owned(),
                    checked_at,
                },
            );
        }
    }

    pub fn snapshot(&self) -> Result<Vec<ProviderReadiness>> {
        self.inner
            .read()
            .map(|readiness| readiness.values().cloned().collect())
            .map_err(|_| PeerError::StateConflict("transport readiness lock poisoned".into()))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProviderCapabilities {
    pub presence: bool,
    pub mailbox: bool,
    pub key_packages: bool,
    pub envelope_stream: bool,
    pub hides_client_address_from_peer: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode)]
pub struct PresenceRecord {
    pub device_id: DeviceId,
    pub sequence: u64,
    pub endpoints: BoundedVec<EndpointDescriptor, 8>,
    pub expires_at: u64,
}

impl Validate for PresenceRecord {
    fn validate(&self) -> Result<()> {
        self.device_id.validate()?;
        if self.sequence == 0 {
            return Err(invalid("presence sequence must be non-zero"));
        }
        self.endpoints.validate()?;
        if self.endpoints.is_empty() {
            return Err(invalid("presence record has no endpoints"));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode)]
pub struct EnvelopeReceipt {
    pub message_id: EnvelopeMessageId,
    pub sequence: u64,
    pub received_at: u64,
}

impl Validate for EnvelopeReceipt {
    fn validate(&self) -> Result<()> {
        self.message_id.validate()?;
        if self.sequence == 0 {
            return Err(invalid("receipt sequence must be non-zero"));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode)]
pub struct ProviderKeyPackage {
    pub device_id: DeviceId,
    pub expires_at: u64,
    pub bytes: BoundedBytes<{ 64 * 1024 }>,
}

impl Validate for ProviderKeyPackage {
    fn validate(&self) -> Result<()> {
        self.device_id.validate()?;
        self.bytes.validate()?;
        if self.bytes.is_empty() {
            return Err(invalid("provider key package is empty"));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderHealth {
    pub kind: ProviderKind,
    pub healthy: bool,
    pub detail: BoundedString<256>,
}

#[async_trait]
pub trait TransportProvider: Send + Sync {
    fn kind(&self) -> ProviderKind;
    fn capabilities(&self) -> ProviderCapabilities;

    async fn publish_presence(&self, _presence: &PresenceRecord) -> Result<()> {
        Err(unsupported(self.kind(), "publish_presence"))
    }

    async fn resolve_presence(&self) -> Result<Option<PresenceRecord>> {
        Err(unsupported(self.kind(), "resolve_presence"))
    }

    async fn send_envelope(&self, envelope: &SignedEnvelope) -> Result<()>;
    async fn receive_envelopes(&self, limit: usize) -> Result<Vec<SignedEnvelope>>;

    async fn ack_envelope(&self, _receipt: &EnvelopeReceipt) -> Result<()> {
        Err(unsupported(self.kind(), "ack_envelope"))
    }

    async fn publish_key_package(&self, _key_package: &ProviderKeyPackage) -> Result<()> {
        Err(unsupported(self.kind(), "publish_key_package"))
    }

    async fn fetch_key_package(&self) -> Result<Option<ProviderKeyPackage>> {
        Err(unsupported(self.kind(), "fetch_key_package"))
    }

    async fn health(&self) -> Result<ProviderHealth>;
}

pub(crate) struct BoundedInbox {
    queue: Mutex<VecDeque<SignedEnvelope>>,
}

impl Default for BoundedInbox {
    fn default() -> Self {
        Self {
            queue: Mutex::new(VecDeque::new()),
        }
    }
}

impl BoundedInbox {
    pub async fn push(&self, envelope: SignedEnvelope) -> Result<()> {
        envelope.validate()?;
        let mut queue = self.queue.lock().await;
        if queue.len() >= MAX_PROVIDER_INBOX {
            return Err(PeerError::Transport(
                "provider inbound queue reached its hard limit".into(),
            ));
        }
        queue.push_back(envelope);
        Ok(())
    }

    pub async fn drain(&self, limit: usize) -> Result<Vec<SignedEnvelope>> {
        if limit == 0 || limit > MAX_PROVIDER_BATCH {
            return Err(PeerError::LimitExceeded(format!(
                "provider receive limit must be within 1..={MAX_PROVIDER_BATCH}"
            )));
        }
        let mut queue = self.queue.lock().await;
        Ok((0..limit).filter_map(|_| queue.pop_front()).collect())
    }
}

fn unsupported(kind: ProviderKind, operation: &str) -> PeerError {
    PeerError::Transport(format!("{kind:?} does not support {operation}"))
}
