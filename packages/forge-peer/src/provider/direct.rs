use std::sync::Arc;

use async_trait::async_trait;

use crate::codec::{BoundedString, Validate};
use crate::endpoint::DirectEndpoint;
use crate::envelope::SignedEnvelope;
use crate::error::{PeerError, Result};
use crate::provider::stream::{receive_on_stream, send_on_stream};
use crate::provider::{
    BoundedInbox, BoxPeerStream, PROVIDER_OPERATION_TIMEOUT, ProviderCapabilities, ProviderHealth,
    ProviderKind, TransportProvider,
};

#[async_trait]
pub trait DirectStreamConnector: Send + Sync {
    async fn connect(&self, endpoint: &DirectEndpoint) -> Result<BoxPeerStream>;
}

#[derive(Debug, Default, Clone, Copy)]
pub struct TcpDirectConnector;

#[async_trait]
impl DirectStreamConnector for TcpDirectConnector {
    async fn connect(&self, endpoint: &DirectEndpoint) -> Result<BoxPeerStream> {
        let address = endpoint.socket_addr()?;
        let stream = tokio::time::timeout(
            PROVIDER_OPERATION_TIMEOUT,
            tokio::net::TcpStream::connect(address),
        )
        .await
        .map_err(|_| PeerError::Timeout("connecting direct peer stream"))?
        .map_err(|error| PeerError::Transport(format!("direct TCP connect failed: {error}")))?;
        stream
            .set_nodelay(true)
            .map_err(|error| PeerError::Transport(format!("setting TCP_NODELAY: {error}")))?;
        Ok(Box::pin(stream))
    }
}

pub struct DirectStreamProvider<C> {
    remote: DirectEndpoint,
    connector: C,
    inbox: Arc<BoundedInbox>,
}

impl<C> DirectStreamProvider<C> {
    pub fn new(remote: DirectEndpoint, connector: C) -> Result<Self> {
        remote.validate()?;
        Ok(Self {
            remote,
            connector,
            inbox: Arc::new(BoundedInbox::default()),
        })
    }

    pub async fn ingest_stream(&self, stream: BoxPeerStream) -> Result<()> {
        self.inbox.push(receive_on_stream(stream).await?).await
    }
}

impl<C: DirectStreamConnector> DirectStreamProvider<C> {
    async fn connect_bounded(&self) -> Result<BoxPeerStream> {
        tokio::time::timeout(
            PROVIDER_OPERATION_TIMEOUT,
            self.connector.connect(&self.remote),
        )
        .await
        .map_err(|_| PeerError::Timeout("connecting direct provider"))?
    }
}

#[async_trait]
impl<C: DirectStreamConnector> TransportProvider for DirectStreamProvider<C> {
    fn kind(&self) -> ProviderKind {
        ProviderKind::LocalDirect
    }

    fn capabilities(&self) -> ProviderCapabilities {
        ProviderCapabilities {
            presence: false,
            mailbox: false,
            key_packages: false,
            envelope_stream: true,
            hides_client_address_from_peer: false,
        }
    }

    async fn send_envelope(&self, envelope: &SignedEnvelope) -> Result<()> {
        envelope.validate()?;
        send_on_stream(self.connect_bounded().await?, envelope).await
    }

    async fn receive_envelopes(&self, limit: usize) -> Result<Vec<SignedEnvelope>> {
        self.inbox.drain(limit).await
    }

    async fn health(&self) -> Result<ProviderHealth> {
        Ok(ProviderHealth {
            kind: self.kind(),
            healthy: true,
            detail: BoundedString::new("configured direct stream endpoint")?,
        })
    }
}
