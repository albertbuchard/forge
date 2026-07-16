use std::sync::Arc;

use async_trait::async_trait;
use iroh::endpoint::presets;
use iroh::{Endpoint, EndpointAddr, EndpointId, SecretKey};

use crate::PEER_ALPN;
use crate::codec::{BoundedString, FrameType, Validate, read_frame, write_frame};
use crate::endpoint::IrohEndpointDescriptor;
use crate::envelope::SignedEnvelope;
use crate::error::{PeerError, Result};
use crate::provider::{
    BoundedInbox, PROVIDER_OPERATION_TIMEOUT, ProviderCapabilities, ProviderHealth, ProviderKind,
    TransportProvider,
};

pub struct IrohProvider {
    endpoint: Endpoint,
    remote: IrohEndpointDescriptor,
    inbox: Arc<BoundedInbox>,
}

impl IrohProvider {
    pub async fn bind(
        secret_key: Option<[u8; 32]>,
        remote: IrohEndpointDescriptor,
    ) -> Result<Self> {
        remote.validate()?;
        if remote.relay_origin.is_some() {
            return Err(PeerError::Endpoint(
                "peer-selected custom Iroh relay origins are disabled; configure trusted relays locally"
                    .into(),
            ));
        }
        let secret_key = validated_secret_key(secret_key)?;
        let endpoint = tokio::time::timeout(
            PROVIDER_OPERATION_TIMEOUT,
            Endpoint::builder(presets::N0)
                .secret_key(secret_key)
                .alpns(vec![PEER_ALPN.to_vec()])
                .bind(),
        )
        .await
        .map_err(|_| PeerError::Timeout("binding Iroh endpoint"))?
        .map_err(|error| PeerError::Transport(format!("binding Iroh endpoint: {error}")))?;
        Ok(Self {
            endpoint,
            remote,
            inbox: Arc::new(BoundedInbox::default()),
        })
    }

    pub fn endpoint_id(&self) -> [u8; 32] {
        *self.endpoint.id().as_bytes()
    }

    pub async fn accept_once(&self) -> Result<()> {
        let envelope = tokio::time::timeout(PROVIDER_OPERATION_TIMEOUT, async {
            let incoming = self
                .endpoint
                .accept()
                .await
                .ok_or_else(|| PeerError::Transport("Iroh endpoint is closed".into()))?;
            let connection = incoming.await.map_err(|error| {
                PeerError::Transport(format!("accepting Iroh connection: {error}"))
            })?;
            if connection.remote_id().as_bytes() != &self.remote.endpoint_id {
                return Err(PeerError::Authentication(
                    "Iroh connection came from an unexpected endpoint id".into(),
                ));
            }
            let (_send, mut receive) = connection
                .accept_bi()
                .await
                .map_err(|error| PeerError::Transport(format!("accepting Iroh stream: {error}")))?;
            read_frame(&mut receive, FrameType::PeerEnvelope).await
        })
        .await
        .map_err(|_| PeerError::Timeout("accepting Iroh peer envelope"))??;
        self.inbox.push(envelope).await
    }

    pub async fn close(&self) -> Result<()> {
        tokio::time::timeout(PROVIDER_OPERATION_TIMEOUT, self.endpoint.close())
            .await
            .map_err(|_| PeerError::Timeout("closing Iroh endpoint"))?;
        Ok(())
    }

    fn remote_addr(&self) -> Result<EndpointAddr> {
        let endpoint_id = EndpointId::from_bytes(&self.remote.endpoint_id)
            .map_err(|error| PeerError::Endpoint(format!("invalid Iroh endpoint id: {error}")))?;
        let mut address = EndpointAddr::new(endpoint_id);
        if let Some(relay) = &self.remote.relay_origin {
            let relay = relay
                .as_str()
                .parse()
                .map_err(|error| PeerError::Endpoint(format!("invalid Iroh relay URL: {error}")))?;
            address = address.with_relay_url(relay);
        }
        Ok(address)
    }
}

fn validated_secret_key(secret_key: Option<[u8; 32]>) -> Result<SecretKey> {
    match secret_key {
        Some(bytes) if bytes == [0; 32] => Err(PeerError::Authentication(
            "Iroh endpoint secret key cannot be all zero".into(),
        )),
        Some(bytes) => Ok(SecretKey::from_bytes(&bytes)),
        None => Ok(SecretKey::generate()),
    }
}

#[async_trait]
impl TransportProvider for IrohProvider {
    fn kind(&self) -> ProviderKind {
        ProviderKind::Iroh
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
        let connection = tokio::time::timeout(
            PROVIDER_OPERATION_TIMEOUT,
            self.endpoint.connect(self.remote_addr()?, PEER_ALPN),
        )
        .await
        .map_err(|_| PeerError::Timeout("connecting Iroh peer"))?
        .map_err(|error| PeerError::Transport(format!("connecting Iroh peer: {error}")))?;
        let (mut send, _receive) =
            tokio::time::timeout(PROVIDER_OPERATION_TIMEOUT, connection.open_bi())
                .await
                .map_err(|_| PeerError::Timeout("opening Iroh peer stream"))?
                .map_err(|error| PeerError::Transport(format!("opening Iroh stream: {error}")))?;
        write_frame(&mut send, FrameType::PeerEnvelope, envelope).await?;
        send.finish()
            .map_err(|error| PeerError::Transport(format!("finishing Iroh stream: {error}")))?;
        Ok(())
    }

    async fn receive_envelopes(&self, limit: usize) -> Result<Vec<SignedEnvelope>> {
        self.inbox.drain(limit).await
    }

    async fn health(&self) -> Result<ProviderHealth> {
        Ok(ProviderHealth {
            kind: self.kind(),
            healthy: true,
            detail: BoundedString::new(format!(
                "Iroh 1.0.2 endpoint {} with dedicated forge-peer/1 ALPN",
                self.endpoint.id()
            ))?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn peer_alpn_is_disjoint_from_companion() {
        assert_eq!(PEER_ALPN, b"forge-peer/1");
        assert_ne!(PEER_ALPN, b"forge-companion/1");
    }

    #[test]
    fn all_zero_endpoint_secret_is_rejected() {
        assert!(validated_secret_key(Some([0; 32])).is_err());
        assert!(validated_secret_key(Some([7; 32])).is_ok());
    }

    #[tokio::test]
    async fn default_provider_rejects_peer_selected_relay_origin() -> Result<()> {
        let remote = IrohEndpointDescriptor {
            endpoint_id: [7; 32],
            relay_origin: Some(BoundedString::new("https://relay.example")?),
        };
        assert!(IrohProvider::bind(None, remote).await.is_err());
        Ok(())
    }
}
