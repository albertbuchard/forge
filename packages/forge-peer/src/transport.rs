use std::future::Future;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use async_trait::async_trait;
use bincode::{Decode, Encode};
use iroh::endpoint::presets;
use iroh::{Endpoint, EndpointAddr, EndpointId, SecretKey};
use tokio::net::{TcpListener, TcpStream};
use tokio::task::JoinSet;
use zeroize::Zeroizing;

use crate::PEER_ALPN;
use crate::codec::{
    BoundedBytes, FrameType, MAX_PEER_FRAME_BYTES, Validate, encode_limited, read_frame,
    write_frame,
};
use crate::endpoint::{
    DirectEndpoint, EndpointDescriptor, IrohEndpointDescriptor, MailboxEndpointDescriptor,
};
use crate::envelope::SignedEnvelope;
use crate::error::{PeerError, Result, invalid, limit};
use crate::identity::{
    DeviceCertificate, DeviceId, DeviceSigner, DeviceTrustResolver, MemoryDeviceTrustStore,
    SignatureBytes,
};
use crate::local_identity::LocalIdentityState;
use crate::provider::mailbox::{
    MAX_RUNTIME_MAILBOX_BATCH, MailboxChannelCredential, MailboxPacketClient, MailboxRuntimeItem,
    MailboxRuntimePayload, SignedMailboxPacket,
};
use crate::provider::tor::TorRuntime;
use crate::provider::{ProviderKind, ProviderReadinessRegistry, ProviderRuntimeState};

const WIRE_VERSION: u16 = 1;
const MAX_WIRE_LIFETIME_SECONDS: u64 = 24 * 60 * 60;
const MAX_BOOTSTRAP_ACCEPTANCE_BYTES: usize = 96 * 1024;
const MAX_MLS_WELCOME_BYTES: usize = 192 * 1024;
const MAX_DUE_DISPATCHES: usize = 16;
const DIRECT_CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const DIRECT_CONNECTION_TIMEOUT: Duration = Duration::from_secs(15);
const IROH_ONLINE_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_DIRECT_CONNECTIONS: usize = 32;
const OUTBOX_POLL_INTERVAL: Duration = Duration::from_millis(100);
const MIN_MAILBOX_POLL_INTERVAL: Duration = Duration::from_millis(100);
const MAX_MAILBOX_POLL_INTERVAL: Duration = Duration::from_secs(30);
const MLS_WELCOME_SIGNATURE_DOMAIN: &[u8] = b"forge-peer/1 MLS welcome transport\0";
const DELIVERY_ACK_SIGNATURE_DOMAIN: &[u8] = b"forge-peer/1 delivery acknowledgement\0";
const HOST_CREDENTIAL_ROTATION_SIGNATURE_DOMAIN: &[u8] = b"forge-peer/1 host credential rotation\0";

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode)]
#[allow(clippy::large_enum_variant)]
pub enum PeerWirePayload {
    PairingAcceptance(BoundedBytes<MAX_BOOTSTRAP_ACCEPTANCE_BYTES>),
    MlsWelcome(SignedMlsWelcome),
    HostCredentialRotation(SignedHostCredentialRotation),
    Envelope(Box<SignedEnvelope>),
}

impl Validate for PeerWirePayload {
    fn validate(&self) -> Result<()> {
        match self {
            Self::PairingAcceptance(bytes) => {
                bytes.validate()?;
                if bytes.is_empty() {
                    return Err(invalid("pairing acceptance packet is empty"));
                }
                Ok(())
            }
            Self::MlsWelcome(welcome) => welcome.validate(),
            Self::HostCredentialRotation(rotation) => rotation.validate(),
            Self::Envelope(envelope) => envelope.validate(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode)]
pub struct HostCredentialRotationBody {
    pub version: u16,
    pub relationship_id: [u8; 16],
    pub predecessor_certificate: DeviceCertificate,
    pub successor_certificate: DeviceCertificate,
    pub mls_commit: BoundedBytes<MAX_MLS_WELCOME_BYTES>,
    pub created_at: u64,
    pub expires_at: u64,
}

impl Validate for HostCredentialRotationBody {
    fn validate(&self) -> Result<()> {
        if self.version != WIRE_VERSION || self.relationship_id == [0; 16] {
            return Err(invalid("host credential rotation header is invalid"));
        }
        self.predecessor_certificate.validate()?;
        self.successor_certificate.validate()?;
        self.mls_commit.validate()?;
        if self.mls_commit.is_empty()
            || self.created_at >= self.expires_at
            || self.expires_at - self.created_at > MAX_WIRE_LIFETIME_SECONDS
        {
            return Err(invalid(
                "host credential rotation lifetime or MLS commit is invalid",
            ));
        }
        validate_host_certificate_successor(
            &self.predecessor_certificate,
            &self.successor_certificate,
            self.created_at,
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode)]
pub struct SignedHostCredentialRotation {
    pub body: HostCredentialRotationBody,
    pub predecessor_signature: SignatureBytes,
}

impl SignedHostCredentialRotation {
    pub fn sign(body: HostCredentialRotationBody, predecessor: &DeviceSigner) -> Result<Self> {
        body.validate()?;
        if predecessor.device_id != body.predecessor_certificate.body.device_id {
            return Err(PeerError::Authentication(
                "host credential rotation signer is not the predecessor device".into(),
            ));
        }
        Ok(Self {
            predecessor_signature: predecessor
                .sign(HOST_CREDENTIAL_ROTATION_SIGNATURE_DOMAIN, &body)?,
            body,
        })
    }

    pub fn verify(&self, now: u64) -> Result<()> {
        self.validate()?;
        if now > self.body.expires_at || self.body.created_at > now.saturating_add(300) {
            return Err(PeerError::Authentication(
                "host credential rotation is expired or from the future".into(),
            ));
        }
        validate_host_certificate_successor(
            &self.body.predecessor_certificate,
            &self.body.successor_certificate,
            now,
        )?;
        self.body.predecessor_certificate.verify_device_signature(
            HOST_CREDENTIAL_ROTATION_SIGNATURE_DOMAIN,
            &self.body,
            &self.predecessor_signature,
        )
    }
}

impl Validate for SignedHostCredentialRotation {
    fn validate(&self) -> Result<()> {
        self.body.validate()?;
        self.predecessor_signature.validate()
    }
}

fn validate_host_certificate_successor(
    predecessor: &DeviceCertificate,
    successor: &DeviceCertificate,
    now: u64,
) -> Result<()> {
    predecessor.verify(predecessor.body.not_before)?;
    successor.verify(now)?;
    if predecessor.body.capabilities != successor.body.capabilities
        || predecessor.body.protocol_range != successor.body.protocol_range
        || predecessor.body.device_public_key == successor.body.device_public_key
        || predecessor.body.device_key_agreement_public_key
            == successor.body.device_key_agreement_public_key
    {
        return Err(PeerError::Authorization(
            "host credential rotation changes capabilities, protocol policy, or reuses keys".into(),
        ));
    }
    let trust = MemoryDeviceTrustStore::default();
    trust.trust_principal(predecessor.root_public_key)?;
    trust.admit_certificate(predecessor, predecessor.body.not_before)?;
    trust.admit_certificate(successor, now)?;
    trust.verify_certificate_transition(predecessor, successor, now)
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode)]
pub struct PeerWirePacket {
    pub version: u16,
    pub packet_id: [u8; 16],
    pub created_at: u64,
    pub expires_at: u64,
    pub payload: PeerWirePayload,
}

impl PeerWirePacket {
    pub fn new(payload: PeerWirePayload, created_at: u64, expires_at: u64) -> Result<Self> {
        let packet = Self {
            version: WIRE_VERSION,
            packet_id: nonzero_random_16(),
            created_at,
            expires_at,
            payload,
        };
        packet.validate()?;
        Ok(packet)
    }

    pub fn validate_at(&self, now: u64) -> Result<()> {
        self.validate()?;
        if now > self.expires_at {
            return Err(PeerError::Authentication(
                "peer transport packet expired".into(),
            ));
        }
        if self.created_at > now.saturating_add(300) {
            return Err(PeerError::Authentication(
                "peer transport packet is too far in the future".into(),
            ));
        }
        Ok(())
    }

    pub fn hash(&self) -> Result<[u8; 32]> {
        let encoded = encode_limited::<MAX_PEER_FRAME_BYTES, _>(self)?;
        Ok(*blake3::hash(&encoded).as_bytes())
    }
}

impl Validate for PeerWirePacket {
    fn validate(&self) -> Result<()> {
        if self.version != WIRE_VERSION || self.packet_id == [0; 16] {
            return Err(invalid("peer transport packet header is invalid"));
        }
        if self.created_at >= self.expires_at
            || self.expires_at - self.created_at > MAX_WIRE_LIFETIME_SECONDS
        {
            return Err(invalid("peer transport packet lifetime is invalid"));
        }
        self.payload.validate()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode)]
pub struct MlsWelcomeBody {
    pub version: u16,
    pub relationship_id: [u8; 16],
    pub sender_certificate: DeviceCertificate,
    pub receiver_device_id: DeviceId,
    pub transcript_hash: [u8; 32],
    pub welcome: BoundedBytes<MAX_MLS_WELCOME_BYTES>,
    pub created_at: u64,
    pub expires_at: u64,
}

impl Validate for MlsWelcomeBody {
    fn validate(&self) -> Result<()> {
        if self.version != WIRE_VERSION
            || self.relationship_id == [0; 16]
            || self.transcript_hash == [0; 32]
        {
            return Err(invalid("MLS Welcome transport header is invalid"));
        }
        self.sender_certificate.validate()?;
        self.receiver_device_id.validate()?;
        self.welcome.validate()?;
        if self.welcome.is_empty()
            || self.created_at >= self.expires_at
            || self.expires_at - self.created_at > MAX_WIRE_LIFETIME_SECONDS
        {
            return Err(invalid(
                "MLS Welcome transport lifetime or payload is invalid",
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode)]
pub struct SignedMlsWelcome {
    pub body: MlsWelcomeBody,
    pub signature: SignatureBytes,
}

impl SignedMlsWelcome {
    pub fn sign(body: MlsWelcomeBody, signer: &DeviceSigner) -> Result<Self> {
        body.validate()?;
        if signer.device_id != body.sender_certificate.body.device_id {
            return Err(PeerError::Authentication(
                "MLS Welcome signer does not match its certificate".into(),
            ));
        }
        Ok(Self {
            signature: signer.sign(MLS_WELCOME_SIGNATURE_DOMAIN, &body)?,
            body,
        })
    }

    pub fn verify(&self, now: u64) -> Result<()> {
        self.validate()?;
        if now > self.body.expires_at || self.body.created_at > now.saturating_add(300) {
            return Err(PeerError::Authentication(
                "MLS Welcome is expired or from the future".into(),
            ));
        }
        self.body.sender_certificate.verify(now)?;
        self.body.sender_certificate.verify_device_signature(
            MLS_WELCOME_SIGNATURE_DOMAIN,
            &self.body,
            &self.signature,
        )
    }
}

impl Validate for SignedMlsWelcome {
    fn validate(&self) -> Result<()> {
        self.body.validate()?;
        self.signature.validate()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode)]
pub struct DeliveryAckBody {
    pub version: u16,
    pub packet_id: [u8; 16],
    pub packet_hash: [u8; 32],
    pub receiver_certificate: DeviceCertificate,
    pub received_at: u64,
}

impl Validate for DeliveryAckBody {
    fn validate(&self) -> Result<()> {
        if self.version != WIRE_VERSION
            || self.packet_id == [0; 16]
            || self.packet_hash == [0; 32]
            || self.received_at == 0
        {
            return Err(invalid("delivery acknowledgement header is invalid"));
        }
        self.receiver_certificate.validate()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode)]
pub struct SignedDeliveryAck {
    pub body: DeliveryAckBody,
    pub signature: SignatureBytes,
}

impl SignedDeliveryAck {
    pub fn sign(
        packet: &PeerWirePacket,
        receiver_certificate: DeviceCertificate,
        signer: &DeviceSigner,
        received_at: u64,
    ) -> Result<Self> {
        if receiver_certificate.body.device_id != signer.device_id {
            return Err(PeerError::Authentication(
                "delivery acknowledgement signer does not match its certificate".into(),
            ));
        }
        let body = DeliveryAckBody {
            version: WIRE_VERSION,
            packet_id: packet.packet_id,
            packet_hash: packet.hash()?,
            receiver_certificate,
            received_at,
        };
        body.validate()?;
        Ok(Self {
            signature: signer.sign(DELIVERY_ACK_SIGNATURE_DOMAIN, &body)?,
            body,
        })
    }

    pub fn verify(
        &self,
        packet: &PeerWirePacket,
        expected_receiver: &DeviceCertificate,
        now: u64,
    ) -> Result<()> {
        self.validate()?;
        self.body.receiver_certificate.verify(now)?;
        if self.body.packet_id != packet.packet_id
            || self.body.packet_hash != packet.hash()?
            || self.body.receiver_certificate.fingerprint()? != expected_receiver.fingerprint()?
            || self.body.received_at > now.saturating_add(300)
        {
            return Err(PeerError::Authentication(
                "delivery acknowledgement does not bind the dispatched packet and peer".into(),
            ));
        }
        self.body.receiver_certificate.verify_device_signature(
            DELIVERY_ACK_SIGNATURE_DOMAIN,
            &self.body,
            &self.signature,
        )
    }

    pub fn verify_signature(&self, now: u64) -> Result<()> {
        self.validate()?;
        self.body.receiver_certificate.verify(now)?;
        if self.body.received_at > now.saturating_add(300) {
            return Err(PeerError::Authentication(
                "delivery acknowledgement is too far in the future".into(),
            ));
        }
        self.body.receiver_certificate.verify_device_signature(
            DELIVERY_ACK_SIGNATURE_DOMAIN,
            &self.body,
            &self.signature,
        )
    }
}

impl Validate for SignedDeliveryAck {
    fn validate(&self) -> Result<()> {
        self.body.validate()?;
        self.signature.validate()
    }
}

#[derive(Debug, Clone)]
pub struct OutboundWireDispatch {
    pub relationship_id: Option<String>,
    pub endpoint: EndpointDescriptor,
    pub expected_receiver: DeviceCertificate,
    pub packet: PeerWirePacket,
}

pub struct MailboxDispatchBinding {
    pub target_credential: MailboxChannelCredential,
    pub reply_to: MailboxEndpointDescriptor,
}

#[async_trait]
pub trait PeerWireHandler: Send + Sync {
    async fn ingest_and_ack(&self, packet: PeerWirePacket) -> Result<SignedDeliveryAck>;
    async fn ingest_mailbox_and_ack(
        &self,
        packet: PeerWirePacket,
        authenticated_sender: DeviceCertificate,
    ) -> Result<SignedDeliveryAck>;
    async fn sign_mailbox_packet(
        &self,
        packet: PeerWirePacket,
        reply_to: MailboxEndpointDescriptor,
    ) -> Result<SignedMailboxPacket>;
    async fn mailbox_poll_credentials(&self, now: u64) -> Result<Vec<MailboxChannelCredential>>;
    async fn mailbox_dispatch_binding(
        &self,
        relationship_id: Option<&str>,
        target: &MailboxEndpointDescriptor,
    ) -> Result<MailboxDispatchBinding>;
    async fn due_outbound(&self, now: u64, limit: usize) -> Result<Vec<OutboundWireDispatch>>;
    async fn acknowledge_outbound(
        &self,
        packet: &PeerWirePacket,
        expected_receiver: &DeviceCertificate,
        acknowledgement: SignedDeliveryAck,
        now: u64,
    ) -> Result<()>;
    async fn record_outbound_failure(
        &self,
        packet_id: [u8; 16],
        packet_hash: [u8; 32],
        now: u64,
    ) -> Result<()>;
    async fn defer_outbound(
        &self,
        packet_id: [u8; 16],
        packet_hash: [u8; 32],
        now: u64,
    ) -> Result<()>;
    async fn acknowledge_mailbox(&self, acknowledgement: SignedDeliveryAck, now: u64)
    -> Result<()>;
    fn readiness_registry(&self) -> ProviderReadinessRegistry;
}

pub struct DirectTransportRuntime<H> {
    listeners: Vec<TcpListener>,
    iroh_endpoint: Option<Endpoint>,
    tor_runtime: Option<TorRuntime>,
    tor_listener: Option<TcpListener>,
    mailbox_runtime: Option<MailboxTransportRuntime>,
    handler: Arc<H>,
    allow_loopback: bool,
    readiness: ProviderReadinessRegistry,
}

pub struct OptionalTransportRuntimes {
    pub tor: Option<(TorRuntime, TcpListener)>,
    pub mailbox: Option<MailboxTransportRuntime>,
}

impl OptionalTransportRuntimes {
    pub const fn none() -> Self {
        Self {
            tor: None,
            mailbox: None,
        }
    }
}

#[derive(Clone)]
pub struct MailboxTransportRuntime {
    client: MailboxPacketClient,
    configuration_endpoint: MailboxEndpointDescriptor,
    poll_interval: Duration,
}

impl MailboxTransportRuntime {
    pub async fn prepare(
        client: MailboxPacketClient,
        configuration_endpoint: MailboxEndpointDescriptor,
        poll_interval: Duration,
    ) -> Result<Self> {
        if !(MIN_MAILBOX_POLL_INTERVAL..=MAX_MAILBOX_POLL_INTERVAL).contains(&poll_interval) {
            return Err(invalid(
                "mailbox poll interval must be within 100 milliseconds and 30 seconds",
            ));
        }
        configuration_endpoint.validate()?;
        if configuration_endpoint.origin.as_str() != client.canonical_origin() {
            return Err(PeerError::Authentication(
                "mailbox configuration marker is bound to another provider".into(),
            ));
        }
        client.probe().await?;
        Ok(Self {
            client,
            configuration_endpoint,
            poll_interval,
        })
    }

    pub fn endpoint_descriptor(&self) -> MailboxEndpointDescriptor {
        self.configuration_endpoint.clone()
    }

    pub fn canonical_origin(&self) -> &str {
        self.client.canonical_origin()
    }
}

pub struct IrohRuntimeIdentity {
    secret_key: Zeroizing<[u8; 32]>,
    endpoint_id: [u8; 32],
}

impl IrohRuntimeIdentity {
    pub fn derive(identity: &LocalIdentityState) -> Result<Self> {
        let secret_key = identity.derive_storage_key("Iroh endpoint identity")?;
        let endpoint_id = *SecretKey::from_bytes(&secret_key).public().as_bytes();
        Ok(Self {
            secret_key,
            endpoint_id,
        })
    }

    pub fn endpoint_descriptor(&self) -> EndpointDescriptor {
        EndpointDescriptor::Iroh(IrohEndpointDescriptor {
            endpoint_id: self.endpoint_id,
            relay_origin: None,
        })
    }
}

impl<H: PeerWireHandler + 'static> DirectTransportRuntime<H> {
    pub async fn bind(
        endpoints: &[DirectEndpoint],
        handler: Arc<H>,
        allow_loopback: bool,
    ) -> Result<Self> {
        if endpoints.is_empty() {
            return Err(limit(
                "direct transport requires at least one listener endpoint",
            ));
        }
        Self::bind_operational(endpoints, None, handler, allow_loopback).await
    }

    pub async fn bind_operational(
        direct_endpoints: &[DirectEndpoint],
        iroh_identity: Option<IrohRuntimeIdentity>,
        handler: Arc<H>,
        allow_loopback: bool,
    ) -> Result<Self> {
        Self::bind_with_optional(
            direct_endpoints,
            iroh_identity,
            OptionalTransportRuntimes::none(),
            handler,
            allow_loopback,
        )
        .await
    }

    pub async fn bind_with_optional(
        direct_endpoints: &[DirectEndpoint],
        iroh_identity: Option<IrohRuntimeIdentity>,
        optional: OptionalTransportRuntimes,
        handler: Arc<H>,
        allow_loopback: bool,
    ) -> Result<Self> {
        if direct_endpoints.len() > 8
            || (direct_endpoints.is_empty()
                && iroh_identity.is_none()
                && optional.tor.is_none()
                && optional.mailbox.is_none())
        {
            return Err(limit("direct transport requires 1..=8 listener endpoints"));
        }
        let mut listeners = Vec::with_capacity(direct_endpoints.len());
        for endpoint in direct_endpoints {
            let address = endpoint.socket_addr_with_loopback(allow_loopback)?;
            let listener = TcpListener::bind(address).await.map_err(|error| {
                PeerError::Transport(format!("binding direct peer listener {address}: {error}"))
            })?;
            listeners.push(listener);
        }
        let iroh_endpoint = if let Some(identity) = iroh_identity {
            let secret_key = SecretKey::from_bytes(&identity.secret_key);
            let endpoint = tokio::time::timeout(
                DIRECT_CONNECTION_TIMEOUT,
                Endpoint::builder(presets::N0)
                    .secret_key(secret_key)
                    .alpns(vec![PEER_ALPN.to_vec()])
                    .bind(),
            )
            .await
            .map_err(|_| PeerError::Timeout("binding operational Iroh endpoint"))?
            .map_err(|error| {
                PeerError::Transport(format!("binding operational Iroh endpoint: {error}"))
            })?;
            if endpoint.id().as_bytes() != &identity.endpoint_id {
                return Err(PeerError::Authentication(
                    "bound Iroh endpoint id differs from the authenticated descriptor".into(),
                ));
            }
            tokio::time::timeout(IROH_ONLINE_TIMEOUT, endpoint.online())
                .await
                .map_err(|_| {
                    PeerError::Timeout("publishing operational Iroh endpoint through a relay")
                })?;
            Some(endpoint)
        } else {
            None
        };
        let (tor_runtime, tor_listener) =
            optional.tor.map_or((None, None), |(runtime, listener)| {
                (Some(runtime), Some(listener))
            });
        let readiness = handler.readiness_registry();
        Ok(Self {
            listeners,
            iroh_endpoint,
            tor_runtime,
            tor_listener,
            mailbox_runtime: optional.mailbox,
            handler,
            allow_loopback,
            readiness,
        })
    }

    pub async fn serve_until<F>(self, shutdown: F) -> Result<()>
    where
        F: Future<Output = ()> + Send + 'static,
    {
        let mut tasks = JoinSet::new();
        for listener in self.listeners {
            tasks.spawn(accept_loop(listener, Arc::clone(&self.handler)));
        }
        if let Some(listener) = self.tor_listener {
            tasks.spawn(accept_loop(listener, Arc::clone(&self.handler)));
        }
        if let Some(endpoint) = &self.iroh_endpoint {
            tasks.spawn(iroh_accept_loop(
                endpoint.clone(),
                Arc::clone(&self.handler),
            ));
        }
        if let Some(runtime) = &self.tor_runtime {
            let readiness = self.readiness.clone();
            tasks.spawn(runtime.clone().supervise_until(
                std::future::pending(),
                move |ready, detail| {
                    readiness.set(
                        ProviderKind::TorOnion,
                        if ready {
                            ProviderRuntimeState::Ready
                        } else {
                            ProviderRuntimeState::Degraded
                        },
                        detail,
                        unix_time().unwrap_or(0),
                    );
                },
            ));
        }
        if let Some(runtime) = &self.mailbox_runtime {
            tasks.spawn(mailbox_loop(
                runtime.clone(),
                Arc::clone(&self.handler),
                self.readiness.clone(),
            ));
        }
        tasks.spawn(outbound_loop(
            Arc::clone(&self.handler),
            self.allow_loopback,
            self.iroh_endpoint.clone(),
            self.tor_runtime.clone(),
            self.mailbox_runtime.clone(),
        ));
        tokio::pin!(shutdown);
        tokio::select! {
            () = &mut shutdown => {}
            completed = tasks.join_next() => {
                match completed {
                    Some(Ok(result)) => result?,
                    Some(Err(error)) => {
                        return Err(PeerError::Transport(format!("direct transport task failed: {error}")));
                    }
                    None => return Err(PeerError::Transport("direct transport stopped unexpectedly".into())),
                }
            }
        }
        if let Some(endpoint) = self.iroh_endpoint {
            endpoint.close().await;
        }
        if let Some(runtime) = &self.tor_runtime {
            runtime.stop().await?;
            self.readiness.set(
                ProviderKind::TorOnion,
                ProviderRuntimeState::Stopped,
                "shutdown",
                unix_time().unwrap_or(0),
            );
        }
        if self.mailbox_runtime.is_some() {
            self.readiness.set(
                ProviderKind::HttpMailbox,
                ProviderRuntimeState::Stopped,
                "shutdown",
                unix_time().unwrap_or(0),
            );
        }
        tasks.abort_all();
        while tasks.join_next().await.is_some() {}
        Ok(())
    }
}

async fn accept_loop<H: PeerWireHandler + 'static>(
    listener: TcpListener,
    handler: Arc<H>,
) -> Result<()> {
    let mut connections = JoinSet::new();
    loop {
        while connections.len() >= MAX_DIRECT_CONNECTIONS {
            let _ = connections.join_next().await;
        }
        let (mut stream, _) = listener.accept().await.map_err(|error| {
            PeerError::Transport(format!("accepting direct peer connection: {error}"))
        })?;
        let connection_handler = Arc::clone(&handler);
        connections.spawn(async move {
            let result = tokio::time::timeout(DIRECT_CONNECTION_TIMEOUT, async {
                stream.set_nodelay(true).map_err(|error| {
                    PeerError::Transport(format!("setting TCP_NODELAY: {error}"))
                })?;
                let packet: PeerWirePacket =
                    read_frame(&mut stream, FrameType::PeerEnvelope).await?;
                let acknowledgement = connection_handler.ingest_and_ack(packet).await?;
                write_frame(&mut stream, FrameType::PeerEnvelope, &acknowledgement).await
            })
            .await;
            match result {
                Ok(result) => result,
                Err(_) => Err(PeerError::Timeout("serving direct peer connection")),
            }
        });
        while connections.try_join_next().is_some() {}
    }
}

async fn outbound_loop<H: PeerWireHandler + 'static>(
    handler: Arc<H>,
    allow_loopback: bool,
    iroh_endpoint: Option<Endpoint>,
    tor_runtime: Option<TorRuntime>,
    mailbox_runtime: Option<MailboxTransportRuntime>,
) -> Result<()> {
    loop {
        let now = unix_time()?;
        let dispatches = handler.due_outbound(now, MAX_DUE_DISPATCHES).await?;
        for dispatch in dispatches {
            let packet_id = dispatch.packet.packet_id;
            let packet_hash = dispatch.packet.hash()?;
            match send_dispatch(
                &dispatch,
                allow_loopback,
                iroh_endpoint.as_ref(),
                tor_runtime.as_ref(),
                mailbox_runtime.as_ref(),
                handler.as_ref(),
            )
            .await
            {
                Ok(DispatchResult::Acknowledged(acknowledgement)) => {
                    handler
                        .acknowledge_outbound(
                            &dispatch.packet,
                            &dispatch.expected_receiver,
                            *acknowledgement,
                            unix_time()?,
                        )
                        .await?;
                    let acknowledged_at = unix_time()?;
                    handler.readiness_registry().set(
                        dispatch_provider_kind(&dispatch.endpoint),
                        ProviderRuntimeState::Ready,
                        "operational",
                        acknowledged_at,
                    );
                }
                Ok(DispatchResult::Deferred) => {
                    handler
                        .defer_outbound(packet_id, packet_hash, unix_time()?)
                        .await?;
                }
                Err(error) => {
                    let failure_code = dispatch_failure_code(&error);
                    tracing::warn!(
                        transport = dispatch_transport_code(&dispatch.endpoint),
                        packet = dispatch_packet_code(&dispatch.packet.payload),
                        failure = failure_code,
                        "peer dispatch failed; bounded retry scheduled"
                    );
                    let failed_at = unix_time()?;
                    handler.readiness_registry().set(
                        dispatch_provider_kind(&dispatch.endpoint),
                        ProviderRuntimeState::Degraded,
                        failure_code,
                        failed_at,
                    );
                    handler
                        .record_outbound_failure(packet_id, packet_hash, failed_at)
                        .await?;
                }
            }
        }
        tokio::time::sleep(OUTBOX_POLL_INTERVAL).await;
    }
}

enum DispatchResult {
    Acknowledged(Box<SignedDeliveryAck>),
    Deferred,
}

async fn send_dispatch<H: PeerWireHandler + 'static>(
    dispatch: &OutboundWireDispatch,
    allow_loopback: bool,
    iroh_endpoint: Option<&Endpoint>,
    tor_runtime: Option<&TorRuntime>,
    mailbox_runtime: Option<&MailboxTransportRuntime>,
    handler: &H,
) -> Result<DispatchResult> {
    tokio::time::timeout(
        DIRECT_CONNECTION_TIMEOUT,
        send_dispatch_inner(
            dispatch,
            allow_loopback,
            iroh_endpoint,
            tor_runtime,
            mailbox_runtime,
            handler,
        ),
    )
    .await
    .map_err(|_| PeerError::Timeout("completing bounded peer dispatch"))?
}

async fn send_dispatch_inner<H: PeerWireHandler + 'static>(
    dispatch: &OutboundWireDispatch,
    allow_loopback: bool,
    iroh_endpoint: Option<&Endpoint>,
    tor_runtime: Option<&TorRuntime>,
    mailbox_runtime: Option<&MailboxTransportRuntime>,
    handler: &H,
) -> Result<DispatchResult> {
    match &dispatch.endpoint {
        EndpointDescriptor::Direct(endpoint) => {
            send_direct_dispatch(dispatch, endpoint, allow_loopback)
                .await
                .map(|acknowledgement| DispatchResult::Acknowledged(Box::new(acknowledgement)))
        }
        EndpointDescriptor::Iroh(endpoint) => send_iroh_dispatch(
            dispatch,
            endpoint,
            iroh_endpoint.ok_or_else(|| {
                PeerError::Transport("Iroh dispatch has no supervised local endpoint".into())
            })?,
        )
        .await
        .map(|acknowledgement| DispatchResult::Acknowledged(Box::new(acknowledgement))),
        EndpointDescriptor::Tor(endpoint) => {
            let runtime = tor_runtime.ok_or_else(|| {
                PeerError::Transport(
                    "Tor endpoint is authenticated but no Tor runtime is configured".into(),
                )
            })?;
            send_tor_dispatch(dispatch, endpoint, runtime)
                .await
                .map(|acknowledgement| DispatchResult::Acknowledged(Box::new(acknowledgement)))
        }
        EndpointDescriptor::HttpMailbox(endpoint) => {
            let runtime = mailbox_runtime.ok_or_else(|| {
                PeerError::Transport(
                    "mailbox endpoint is authenticated but no mailbox runtime is configured".into(),
                )
            })?;
            let binding = handler
                .mailbox_dispatch_binding(dispatch.relationship_id.as_deref(), endpoint)
                .await?;
            binding.target_credential.require_endpoint(endpoint)?;
            let packet = handler
                .sign_mailbox_packet(dispatch.packet.clone(), binding.reply_to)
                .await?;
            runtime
                .client
                .enqueue(
                    &binding.target_credential,
                    &MailboxRuntimeItem::packet(packet)?,
                )
                .await?;
            Ok(DispatchResult::Deferred)
        }
    }
}

async fn send_tor_dispatch(
    dispatch: &OutboundWireDispatch,
    endpoint: &crate::endpoint::TorEndpoint,
    runtime: &TorRuntime,
) -> Result<SignedDeliveryAck> {
    let mut stream = runtime.connect(endpoint).await?;
    write_frame(&mut stream, FrameType::PeerEnvelope, &dispatch.packet).await?;
    read_frame(&mut stream, FrameType::PeerEnvelope).await
}

async fn mailbox_loop<H: PeerWireHandler + 'static>(
    runtime: MailboxTransportRuntime,
    handler: Arc<H>,
    readiness: ProviderReadinessRegistry,
) -> Result<()> {
    let mut consecutive_failures = 0_u8;
    loop {
        let credentials = handler.mailbox_poll_credentials(unix_time()?).await?;
        if credentials.len() > 512 {
            return Err(limit("mailbox poll credential count exceeds 512"));
        }
        let mut successful_polls = 0_usize;
        let mut failed_polls = 0_usize;
        for credential in credentials {
            match runtime
                .client
                .fetch(&credential, MAX_RUNTIME_MAILBOX_BATCH)
                .await
            {
                Ok(items) => {
                    successful_polls = successful_polls.saturating_add(1);
                    for fetched in items {
                        let process_result = match &fetched.item {
                            Ok(item) => {
                                process_mailbox_item(&runtime, handler.as_ref(), item).await
                            }
                            Err(error) if discard_mailbox_item(error) => Ok(()),
                            Err(_) => Err(PeerError::Transport(
                                "mailbox item could not be processed".into(),
                            )),
                        };
                        match process_result {
                            Ok(()) => {
                                runtime
                                    .client
                                    .acknowledge(
                                        &credential,
                                        std::slice::from_ref(&fetched.service_message_id),
                                    )
                                    .await?;
                            }
                            Err(error) if discard_mailbox_item(&error) => {
                                runtime
                                    .client
                                    .acknowledge(
                                        &credential,
                                        std::slice::from_ref(&fetched.service_message_id),
                                    )
                                    .await?;
                            }
                            Err(_) => {
                                failed_polls = failed_polls.saturating_add(1);
                                break;
                            }
                        }
                    }
                }
                Err(_) => {
                    failed_polls = failed_polls.saturating_add(1);
                }
            }
        }
        if failed_polls == 0 {
            consecutive_failures = 0;
            readiness.set(
                ProviderKind::HttpMailbox,
                ProviderRuntimeState::Ready,
                if successful_polls == 0 {
                    "operational_idle"
                } else {
                    "operational"
                },
                unix_time()?,
            );
        } else {
            consecutive_failures = consecutive_failures.saturating_add(1);
            readiness.set(
                ProviderKind::HttpMailbox,
                ProviderRuntimeState::Degraded,
                if successful_polls == 0 {
                    "poll_failed"
                } else {
                    "partial_poll_failure"
                },
                unix_time()?,
            );
        }
        let exponent = u32::from(consecutive_failures.min(6));
        let multiplier = 1_u32 << exponent;
        let base_delay = runtime
            .poll_interval
            .saturating_mul(multiplier)
            .min(MAX_MAILBOX_POLL_INTERVAL);
        let jitter_millionths = 750_000_u32.saturating_add(rand::random::<u32>() % 500_001);
        let delay = base_delay
            .mul_f64(f64::from(jitter_millionths) / 1_000_000.0)
            .clamp(MIN_MAILBOX_POLL_INTERVAL, MAX_MAILBOX_POLL_INTERVAL);
        tokio::time::sleep(delay).await;
    }
}

fn discard_mailbox_item(error: &PeerError) -> bool {
    matches!(
        error,
        PeerError::InvalidData(_)
            | PeerError::LimitExceeded(_)
            | PeerError::Authentication(_)
            | PeerError::Authorization(_)
            | PeerError::Version(_)
            | PeerError::Replay(_)
            | PeerError::InviteConflict(_)
            | PeerError::Mls(_)
            | PeerError::Endpoint(_)
    )
}

async fn process_mailbox_item<H: PeerWireHandler + 'static>(
    runtime: &MailboxTransportRuntime,
    handler: &H,
    item: &MailboxRuntimeItem,
) -> Result<()> {
    item.validate()?;
    let now = unix_time()?;
    match &item.payload {
        MailboxRuntimePayload::Packet(packet) => {
            packet.verify(now)?;
            let acknowledgement = handler
                .ingest_mailbox_and_ack(
                    packet.body.packet.clone(),
                    packet.body.sender_certificate.clone(),
                )
                .await?;
            let binding = handler
                .mailbox_dispatch_binding(None, &packet.body.reply_to)
                .await?;
            binding
                .target_credential
                .require_endpoint(&packet.body.reply_to)?;
            runtime
                .client
                .enqueue(
                    &binding.target_credential,
                    &MailboxRuntimeItem::acknowledgement(acknowledgement)?,
                )
                .await
        }
        MailboxRuntimePayload::Acknowledgement(acknowledgement) => {
            acknowledgement.verify_signature(now)?;
            handler
                .acknowledge_mailbox(acknowledgement.as_ref().clone(), now)
                .await
        }
    }
}

async fn send_direct_dispatch(
    dispatch: &OutboundWireDispatch,
    endpoint: &DirectEndpoint,
    allow_loopback: bool,
) -> Result<SignedDeliveryAck> {
    let address = endpoint.socket_addr_with_loopback(allow_loopback)?;
    let mut stream = tokio::time::timeout(DIRECT_CONNECT_TIMEOUT, TcpStream::connect(address))
        .await
        .map_err(|_| PeerError::Timeout("connecting direct transport listener"))?
        .map_err(|error| {
            PeerError::Transport(format!("connecting direct peer {address}: {error}"))
        })?;
    stream
        .set_nodelay(true)
        .map_err(|error| PeerError::Transport(format!("setting TCP_NODELAY: {error}")))?;
    write_frame(&mut stream, FrameType::PeerEnvelope, &dispatch.packet).await?;
    read_frame(&mut stream, FrameType::PeerEnvelope).await
}

async fn iroh_accept_loop<H: PeerWireHandler + 'static>(
    endpoint: Endpoint,
    handler: Arc<H>,
) -> Result<()> {
    let mut connections = JoinSet::new();
    loop {
        while connections.len() >= MAX_DIRECT_CONNECTIONS {
            let _ = connections.join_next().await;
        }
        let incoming = endpoint
            .accept()
            .await
            .ok_or_else(|| PeerError::Transport("Iroh endpoint closed unexpectedly".into()))?;
        let connection_handler = Arc::clone(&handler);
        connections.spawn(async move {
            tokio::time::timeout(DIRECT_CONNECTION_TIMEOUT, async {
                let connection = incoming.await.map_err(|error| {
                    PeerError::Transport(format!("accepting Iroh connection: {error}"))
                })?;
                let (mut send, mut receive) = connection.accept_bi().await.map_err(|error| {
                    PeerError::Transport(format!("accepting Iroh peer stream: {error}"))
                })?;
                let packet: PeerWirePacket =
                    read_frame(&mut receive, FrameType::PeerEnvelope).await?;
                let acknowledgement = connection_handler.ingest_and_ack(packet).await?;
                write_frame(&mut send, FrameType::PeerEnvelope, &acknowledgement).await?;
                send.finish().map_err(|error| {
                    PeerError::Transport(format!("finishing Iroh acknowledgement: {error}"))
                })?;
                match send.stopped().await.map_err(|_| {
                    PeerError::Transport("waiting for Iroh acknowledgement receipt failed".into())
                })? {
                    None => Ok(()),
                    Some(_) => Err(PeerError::Transport(
                        "peer stopped the Iroh acknowledgement stream".into(),
                    )),
                }
            })
            .await
            .map_err(|_| PeerError::Timeout("serving Iroh peer connection"))?
        });
        while connections.try_join_next().is_some() {}
    }
}

async fn send_iroh_dispatch(
    dispatch: &OutboundWireDispatch,
    remote: &IrohEndpointDescriptor,
    local: &Endpoint,
) -> Result<SignedDeliveryAck> {
    if remote.relay_origin.is_some() {
        return Err(PeerError::Endpoint(
            "peer-selected custom Iroh relay origins are not operational".into(),
        ));
    }
    let endpoint_id = EndpointId::from_bytes(&remote.endpoint_id)
        .map_err(|error| PeerError::Endpoint(format!("invalid Iroh endpoint id: {error}")))?;
    let connection = local
        .connect(EndpointAddr::new(endpoint_id), PEER_ALPN)
        .await
        .map_err(|error| PeerError::Transport(format!("connecting Iroh peer: {error}")))?;
    let (mut send, mut receive) = connection
        .open_bi()
        .await
        .map_err(|error| PeerError::Transport(format!("opening Iroh peer stream: {error}")))?;
    write_frame(&mut send, FrameType::PeerEnvelope, &dispatch.packet)
        .await
        .map_err(|_| PeerError::Transport("writing Iroh peer request failed".into()))?;
    send.finish()
        .map_err(|error| PeerError::Transport(format!("finishing Iroh dispatch: {error}")))?;
    let acknowledgement = read_frame(&mut receive, FrameType::PeerEnvelope)
        .await
        .map_err(|_| PeerError::Transport("reading Iroh peer acknowledgement failed".into()))?;
    let trailing = receive.read_to_end(0).await.map_err(|_| {
        PeerError::Transport("finishing Iroh acknowledgement receive failed".into())
    })?;
    if !trailing.is_empty() {
        return Err(PeerError::Authentication(
            "Iroh acknowledgement stream contains trailing bytes".into(),
        ));
    }
    Ok(acknowledgement)
}

fn dispatch_transport_code(endpoint: &EndpointDescriptor) -> &'static str {
    match endpoint {
        EndpointDescriptor::Direct(_) => "local_direct",
        EndpointDescriptor::Iroh(_) => "iroh",
        EndpointDescriptor::Tor(_) => "tor_onion",
        EndpointDescriptor::HttpMailbox(_) => "http_mailbox",
    }
}

fn dispatch_provider_kind(endpoint: &EndpointDescriptor) -> ProviderKind {
    match endpoint {
        EndpointDescriptor::Direct(_) => ProviderKind::LocalDirect,
        EndpointDescriptor::Iroh(_) => ProviderKind::Iroh,
        EndpointDescriptor::Tor(_) => ProviderKind::TorOnion,
        EndpointDescriptor::HttpMailbox(_) => ProviderKind::HttpMailbox,
    }
}

fn dispatch_packet_code(payload: &PeerWirePayload) -> &'static str {
    match payload {
        PeerWirePayload::PairingAcceptance(_) => "pairing_acceptance",
        PeerWirePayload::MlsWelcome(_) => "mls_welcome",
        PeerWirePayload::HostCredentialRotation(_) => "host_credential_rotation",
        PeerWirePayload::Envelope(_) => "authenticated_envelope",
    }
}

fn dispatch_failure_code(error: &PeerError) -> &'static str {
    match error {
        PeerError::Timeout(_) => "timeout",
        PeerError::Transport(detail) if detail.starts_with("connecting Iroh peer") => {
            "iroh_connect"
        }
        PeerError::Transport(detail) if detail.starts_with("opening Iroh peer stream") => {
            "iroh_open"
        }
        PeerError::Transport(detail) if detail.starts_with("writing Iroh peer request") => {
            "iroh_write"
        }
        PeerError::Transport(detail) if detail.starts_with("finishing Iroh dispatch") => {
            "iroh_finish"
        }
        PeerError::Transport(detail) if detail.starts_with("reading Iroh peer acknowledgement") => {
            "iroh_read_ack"
        }
        PeerError::Authentication(_) => "authentication",
        PeerError::Authorization(_) => "authorization",
        PeerError::Replay(_) => "replay",
        PeerError::Version(_) => "version",
        PeerError::Endpoint(_) => "endpoint",
        PeerError::Ipc(_) => "frame",
        PeerError::Io(_) => "io",
        PeerError::InvalidData(_) => "invalid_data",
        PeerError::LimitExceeded(_) => "limit",
        PeerError::StateConflict(_) | PeerError::InviteConflict(_) => "conflict",
        PeerError::Rollback(_) => "rollback",
        PeerError::Transport(_) => "transport",
        PeerError::Mls(_) => "mls",
        PeerError::Manifest(_) => "manifest",
    }
}

fn nonzero_random_16() -> [u8; 16] {
    loop {
        let value = rand::random();
        if value != [0; 16] {
            return value;
        }
    }
}

fn unix_time() -> Result<u64> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .map_err(|_| PeerError::StateConflict("system clock predates Unix epoch".into()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::identity::{DeviceCapabilities, PrincipalRootSigner, ProtocolRange};

    #[test]
    fn delivery_ack_rejects_packet_or_receiver_substitution() -> Result<()> {
        let now = 10_000;
        let root = PrincipalRootSigner::generate();
        let signer = DeviceSigner::generate(crate::identity::DeviceId::random());
        let certificate = DeviceCertificate::issue(
            &root,
            &signer,
            DeviceCapabilities::all_known(),
            ProtocolRange::CURRENT,
            1,
            now - 1,
            now + 3_600,
        )?;
        let packet = PeerWirePacket::new(
            PeerWirePayload::PairingAcceptance(BoundedBytes::new(vec![1, 2, 3])?),
            now,
            now + 300,
        )?;
        let acknowledgement = SignedDeliveryAck::sign(&packet, certificate.clone(), &signer, now)?;
        acknowledgement.verify(&packet, &certificate, now)?;

        let mut changed = packet.clone();
        changed.packet_id = nonzero_random_16();
        assert!(acknowledgement.verify(&changed, &certificate, now).is_err());

        let other_root = PrincipalRootSigner::generate();
        let other_signer = DeviceSigner::generate(crate::identity::DeviceId::random());
        let other_certificate = DeviceCertificate::issue(
            &other_root,
            &other_signer,
            DeviceCapabilities::all_known(),
            ProtocolRange::CURRENT,
            1,
            now - 1,
            now + 3_600,
        )?;
        assert!(
            acknowledgement
                .verify(&packet, &other_certificate, now)
                .is_err()
        );
        Ok(())
    }
}
