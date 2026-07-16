use std::fmt;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use ed25519_dalek::{Signer as _, SigningKey};
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE, HeaderMap, HeaderValue};
use reqwest::{Client, Method, StatusCode, Url, redirect, tls};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq as _;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use zeroize::{Zeroize, Zeroizing};

use crate::codec::{BoundedString, MAX_PEER_FRAME_BYTES, Validate, decode_limited, encode_limited};
use crate::endpoint::{MailboxEndpointDescriptor, ValidatedMailboxOrigin};
use crate::error::{PeerError, Result, invalid, limit};
use crate::identity::{DeviceCertificate, DeviceSigner, PrincipalId, SignatureBytes};
use crate::local_identity::LocalIdentityState;
use crate::transport::{PeerWirePacket, SignedDeliveryAck};

const JSON_CONTENT_TYPE: &str = "application/json";
const CONNECTIVITY_AUTH_DOMAIN: &str = "forge-connectivity-request-signature-v1";
const CONNECTIVITY_CHANNEL_DOMAIN: &[u8] = b"forge-connectivity-channel-id-v1\0";
const ED25519_SPKI_PREFIX: [u8; 12] = [
    0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
];
const MAILBOX_PACKET_SIGNATURE_DOMAIN: &[u8] = b"forge-peer/1 mailbox packet\0";
const MAILBOX_SECRET_DOMAIN: &str = "forge-peer/1 relationship mailbox secret";
const MAILBOX_CHANNEL_SEED_DOMAIN: &str = "forge-peer/1 relationship mailbox channel seed";
const MAILBOX_CONTENT_KEY_DOMAIN: &str = "forge-peer/1 mailbox content encryption";
const MAILBOX_NONCE_DOMAIN: &str = "forge-peer/1 mailbox deterministic nonce";
const MAILBOX_MESSAGE_ID_DOMAIN: &str = "forge-peer/1 mailbox opaque message id";
const MAILBOX_IDEMPOTENCY_DOMAIN: &str = "forge-peer/1 mailbox mutation idempotency";
const MAILBOX_CIPHERTEXT_MAGIC: &[u8; 8] = b"FGMBX001";
const MAILBOX_CIPHERTEXT_VERSION: u8 = 1;
const MAILBOX_WIRE_VERSION: u16 = 1;
const MAILBOX_RUNTIME_ITEM_BYTES: usize = MAX_PEER_FRAME_BYTES + 32 * 1024;
const MAX_EXPLICIT_CA_BYTES: usize = 64 * 1024;
const MAX_MAILBOX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
const MAX_MAILBOX_CIPHERTEXT_BYTES: usize = 256 * 1024;
const MAILBOX_TIMEOUT: Duration = Duration::from_secs(30);
const MAILBOX_ENVELOPE_TTL_SECONDS: u64 = 60 * 60;
const PADDING_BUCKETS: [usize; 5] = [4 * 1024, 16 * 1024, 64 * 1024, 128 * 1024, 262_080];
pub const MAX_RUNTIME_MAILBOX_BATCH: usize = 4;

#[derive(Debug, Clone, Default)]
pub enum MailboxTlsRoots {
    #[default]
    System,
    ExclusivePem(Vec<u8>),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MailboxChannelRole {
    InviterInbox,
    AccepterInbox,
}

impl MailboxChannelRole {
    const fn label(self) -> &'static [u8] {
        match self {
            Self::InviterInbox => b"inviter-inbox",
            Self::AccepterInbox => b"accepter-inbox",
        }
    }

    #[must_use]
    pub const fn opposite(self) -> Self {
        match self {
            Self::InviterInbox => Self::AccepterInbox,
            Self::AccepterInbox => Self::InviterInbox,
        }
    }
}

pub struct MailboxRelationshipSecret([u8; 32]);

impl MailboxRelationshipSecret {
    pub fn derive(
        bootstrap_proof: &[u8; 32],
        invite_id: &[u8; 16],
        inviter_principal_id: PrincipalId,
    ) -> Result<Self> {
        if bootstrap_proof == &[0; 32] || invite_id == &[0; 16] {
            return Err(invalid("mailbox relationship secret input is all zero"));
        }
        let mut input = Vec::with_capacity(80);
        input.extend_from_slice(bootstrap_proof);
        input.extend_from_slice(invite_id);
        input.extend_from_slice(&inviter_principal_id.0);
        let secret = blake3::derive_key(MAILBOX_SECRET_DOMAIN, &input);
        input.zeroize();
        if secret == [0; 32] {
            return Err(invalid("derived mailbox relationship secret is all zero"));
        }
        Ok(Self(secret))
    }

    pub fn from_stored(secret: &[u8; 32]) -> Result<Self> {
        if secret == &[0; 32] {
            return Err(invalid("stored mailbox relationship secret is all zero"));
        }
        Ok(Self(*secret))
    }

    pub fn expose_for_sealed_storage(&self) -> [u8; 32] {
        self.0
    }

    pub fn credential(
        &self,
        role: MailboxChannelRole,
        origin: &str,
    ) -> Result<MailboxChannelCredential> {
        let mut input = Vec::with_capacity(64);
        input.extend_from_slice(&self.0);
        input.extend_from_slice(role.label());
        let seed = blake3::derive_key(MAILBOX_CHANNEL_SEED_DOMAIN, &input);
        input.zeroize();
        MailboxChannelCredential::from_seed(origin, seed)
    }
}

impl Clone for MailboxRelationshipSecret {
    fn clone(&self) -> Self {
        Self(self.0)
    }
}

impl Drop for MailboxRelationshipSecret {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

impl fmt::Debug for MailboxRelationshipSecret {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("MailboxRelationshipSecret([REDACTED])")
    }
}

pub struct MailboxChannelCredential {
    seed: Zeroizing<[u8; 32]>,
    endpoint: MailboxEndpointDescriptor,
}

impl MailboxChannelCredential {
    pub fn from_seed(origin: &str, seed: [u8; 32]) -> Result<Self> {
        if seed == [0; 32] {
            return Err(invalid("mailbox channel seed is all zero"));
        }
        let signing_key = SigningKey::from_bytes(&seed);
        let mut spki = Vec::with_capacity(44);
        spki.extend_from_slice(&ED25519_SPKI_PREFIX);
        spki.extend_from_slice(signing_key.verifying_key().as_bytes());
        let mut channel_input = Vec::with_capacity(CONNECTIVITY_CHANNEL_DOMAIN.len() + 59);
        channel_input.extend_from_slice(CONNECTIVITY_CHANNEL_DOMAIN);
        channel_input.extend_from_slice(URL_SAFE_NO_PAD.encode(&spki).as_bytes());
        let opaque_channel: [u8; 32] = Sha256::digest(&channel_input).into();
        channel_input.zeroize();
        let endpoint = MailboxEndpointDescriptor {
            origin: BoundedString::new(origin.to_owned())?,
            opaque_channel,
        };
        endpoint.validate()?;
        Ok(Self {
            seed: Zeroizing::new(seed),
            endpoint,
        })
    }

    pub fn endpoint(&self) -> &MailboxEndpointDescriptor {
        &self.endpoint
    }

    pub fn require_endpoint(&self, endpoint: &MailboxEndpointDescriptor) -> Result<()> {
        endpoint.validate()?;
        if self.endpoint != *endpoint {
            return Err(PeerError::Authentication(
                "mailbox capability is not bound to the requested endpoint".into(),
            ));
        }
        Ok(())
    }

    fn signing_key(&self) -> SigningKey {
        SigningKey::from_bytes(&self.seed)
    }

    fn spki(&self) -> [u8; 44] {
        let mut value = [0_u8; 44];
        value[..ED25519_SPKI_PREFIX.len()].copy_from_slice(&ED25519_SPKI_PREFIX);
        value[ED25519_SPKI_PREFIX.len()..]
            .copy_from_slice(self.signing_key().verifying_key().as_bytes());
        value
    }

    pub fn seal_item(&self, item: &MailboxRuntimeItem) -> Result<SealedMailboxItem> {
        item.validate()?;
        let encoded = encode_limited::<MAILBOX_RUNTIME_ITEM_BYTES, _>(item)?;
        let required = encoded
            .len()
            .checked_add(4)
            .ok_or_else(|| limit("mailbox plaintext length overflow"))?;
        let bucket = PADDING_BUCKETS
            .iter()
            .copied()
            .find(|candidate| *candidate >= required)
            .ok_or_else(|| {
                limit("peer packet exceeds the bounded HTTPS mailbox ciphertext ceiling")
            })?;
        let message_id = self.message_id(item.item_id);
        let item_hash = item.hash()?;
        let encryption_key = blake3::derive_key(MAILBOX_CONTENT_KEY_DOMAIN, self.seed.as_ref());
        let mut nonce_hasher = blake3::Hasher::new_keyed(&blake3::derive_key(
            MAILBOX_NONCE_DOMAIN,
            self.seed.as_ref(),
        ));
        nonce_hasher.update(&item.item_id);
        nonce_hasher.update(&item_hash);
        let nonce_hash = nonce_hasher.finalize();
        let mut nonce = [0_u8; 24];
        nonce.copy_from_slice(&nonce_hash.as_bytes()[..24]);
        let mut plaintext = Zeroizing::new(vec![0_u8; bucket]);
        let length = u32::try_from(encoded.len())
            .map_err(|_| limit("mailbox runtime item length exceeds u32"))?;
        plaintext[..4].copy_from_slice(&length.to_be_bytes());
        plaintext[4..required].copy_from_slice(&encoded);
        let aad = ciphertext_aad(&self.endpoint.opaque_channel, &message_id, bucket);
        let ciphertext = XChaCha20Poly1305::new((&encryption_key).into())
            .encrypt(
                XNonce::from_slice(&nonce),
                Payload {
                    msg: plaintext.as_slice(),
                    aad: &aad,
                },
            )
            .map_err(|_| PeerError::Authentication("sealing mailbox item failed".into()))?;
        let mut wire = Vec::with_capacity(9 + nonce.len() + ciphertext.len());
        wire.extend_from_slice(MAILBOX_CIPHERTEXT_MAGIC);
        wire.push(MAILBOX_CIPHERTEXT_VERSION);
        wire.extend_from_slice(&nonce);
        wire.extend_from_slice(&ciphertext);
        if wire.len() > MAX_MAILBOX_CIPHERTEXT_BYTES {
            return Err(limit(
                "sealed mailbox item exceeds the service envelope limit",
            ));
        }
        Ok(SealedMailboxItem {
            message_id,
            ciphertext: wire,
        })
    }

    pub fn open_item(&self, message_id: &str, wire: &[u8]) -> Result<MailboxRuntimeItem> {
        validate_opaque_id(message_id, "mailbox message id")?;
        if wire.len() < 9 + 24 + 16 || wire.len() > MAX_MAILBOX_CIPHERTEXT_BYTES {
            return Err(limit("mailbox ciphertext has an invalid bounded length"));
        }
        if wire.get(..8) != Some(MAILBOX_CIPHERTEXT_MAGIC)
            || wire.get(8) != Some(&MAILBOX_CIPHERTEXT_VERSION)
        {
            return Err(PeerError::Authentication(
                "mailbox ciphertext header is invalid".into(),
            ));
        }
        let nonce = wire
            .get(9..33)
            .ok_or_else(|| invalid("mailbox ciphertext nonce is truncated"))?;
        let ciphertext = wire
            .get(33..)
            .ok_or_else(|| invalid("mailbox ciphertext is truncated"))?;
        let bucket = ciphertext
            .len()
            .checked_sub(16)
            .ok_or_else(|| invalid("mailbox ciphertext tag is truncated"))?;
        if !PADDING_BUCKETS.contains(&bucket) {
            return Err(PeerError::Authentication(
                "mailbox ciphertext does not use a canonical padding bucket".into(),
            ));
        }
        let aad = ciphertext_aad(&self.endpoint.opaque_channel, message_id, bucket);
        let encryption_key = blake3::derive_key(MAILBOX_CONTENT_KEY_DOMAIN, self.seed.as_ref());
        let plaintext = Zeroizing::new(
            XChaCha20Poly1305::new((&encryption_key).into())
                .decrypt(
                    XNonce::from_slice(nonce),
                    Payload {
                        msg: ciphertext,
                        aad: &aad,
                    },
                )
                .map_err(|_| {
                    PeerError::Authentication("opening mailbox ciphertext failed".into())
                })?,
        );
        let length_bytes: [u8; 4] = plaintext
            .get(..4)
            .ok_or_else(|| invalid("mailbox plaintext is truncated"))?
            .try_into()
            .map_err(|_| invalid("mailbox plaintext length is invalid"))?;
        let length = usize::try_from(u32::from_be_bytes(length_bytes))
            .map_err(|_| limit("mailbox plaintext length exceeds usize"))?;
        let end = 4_usize
            .checked_add(length)
            .ok_or_else(|| limit("mailbox plaintext length overflow"))?;
        let encoded = plaintext
            .get(4..end)
            .ok_or_else(|| invalid("mailbox plaintext item is truncated"))?;
        if plaintext
            .get(end..)
            .is_none_or(|padding| padding.iter().any(|byte| *byte != 0))
        {
            return Err(PeerError::Authentication(
                "mailbox plaintext padding is non-canonical".into(),
            ));
        }
        let item: MailboxRuntimeItem = decode_limited::<MAILBOX_RUNTIME_ITEM_BYTES, _>(encoded)?;
        item.validate()?;
        let expected_message_id = self.message_id(item.item_id);
        if expected_message_id
            .as_bytes()
            .ct_eq(message_id.as_bytes())
            .unwrap_u8()
            != 1
        {
            return Err(PeerError::Replay(
                "mailbox message id is not bound to its authenticated item".into(),
            ));
        }
        Ok(item)
    }

    fn message_id(&self, item_id: [u8; 16]) -> String {
        let key = blake3::derive_key(MAILBOX_MESSAGE_ID_DOMAIN, self.seed.as_ref());
        let mut hasher = blake3::Hasher::new_keyed(&key);
        hasher.update(&item_id);
        URL_SAFE_NO_PAD.encode(&hasher.finalize().as_bytes()[..16])
    }

    fn idempotency_key(&self, operation: &[u8], body_binding: &[u8]) -> String {
        let key = blake3::derive_key(MAILBOX_IDEMPOTENCY_DOMAIN, self.seed.as_ref());
        let mut hasher = blake3::Hasher::new_keyed(&key);
        hasher.update(operation);
        hasher.update(body_binding);
        URL_SAFE_NO_PAD.encode(hasher.finalize().as_bytes())
    }
}

pub fn mailbox_endpoint_for_identity(
    identity: &LocalIdentityState,
    origin: &ValidatedMailboxOrigin,
) -> Result<MailboxEndpointDescriptor> {
    let seed = identity.derive_storage_key("HTTPS mailbox configuration marker")?;
    Ok(
        MailboxChannelCredential::from_seed(origin.canonical_origin(), *seed)?
            .endpoint
            .clone(),
    )
}

impl Clone for MailboxChannelCredential {
    fn clone(&self) -> Self {
        Self {
            seed: Zeroizing::new(*self.seed),
            endpoint: self.endpoint.clone(),
        }
    }
}

impl fmt::Debug for MailboxChannelCredential {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("MailboxChannelCredential")
            .field("origin", &self.endpoint.origin.as_str())
            .field(
                "opaque_channel",
                &URL_SAFE_NO_PAD.encode(self.endpoint.opaque_channel),
            )
            .field("seed", &"[REDACTED]")
            .finish()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, bincode::Encode, bincode::Decode)]
pub struct MailboxPacketBody {
    pub version: u16,
    pub packet: PeerWirePacket,
    pub reply_to: MailboxEndpointDescriptor,
    pub sender_certificate: DeviceCertificate,
}

impl Validate for MailboxPacketBody {
    fn validate(&self) -> Result<()> {
        if self.version != MAILBOX_WIRE_VERSION {
            return Err(invalid("mailbox packet version is unsupported"));
        }
        self.packet.validate()?;
        self.reply_to.validate()?;
        self.sender_certificate.validate()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, bincode::Encode, bincode::Decode)]
pub struct SignedMailboxPacket {
    pub body: MailboxPacketBody,
    pub signature: SignatureBytes,
}

impl SignedMailboxPacket {
    pub fn sign(
        packet: PeerWirePacket,
        reply_to: MailboxEndpointDescriptor,
        sender_certificate: DeviceCertificate,
        signer: &DeviceSigner,
    ) -> Result<Self> {
        if sender_certificate.body.device_id != signer.device_id {
            return Err(PeerError::Authentication(
                "mailbox packet signer does not match its certificate".into(),
            ));
        }
        let body = MailboxPacketBody {
            version: MAILBOX_WIRE_VERSION,
            packet,
            reply_to,
            sender_certificate,
        };
        body.validate()?;
        Ok(Self {
            signature: signer.sign(MAILBOX_PACKET_SIGNATURE_DOMAIN, &body)?,
            body,
        })
    }

    pub fn verify(&self, now: u64) -> Result<()> {
        self.validate()?;
        self.body.packet.validate_at(now)?;
        self.body.sender_certificate.verify(now)?;
        self.body.sender_certificate.verify_device_signature(
            MAILBOX_PACKET_SIGNATURE_DOMAIN,
            &self.body,
            &self.signature,
        )
    }
}

impl Validate for SignedMailboxPacket {
    fn validate(&self) -> Result<()> {
        self.body.validate()?;
        self.signature.validate()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, bincode::Encode, bincode::Decode)]
pub enum MailboxRuntimePayload {
    Packet(Box<SignedMailboxPacket>),
    Acknowledgement(Box<SignedDeliveryAck>),
}

impl Validate for MailboxRuntimePayload {
    fn validate(&self) -> Result<()> {
        match self {
            Self::Packet(packet) => packet.validate(),
            Self::Acknowledgement(acknowledgement) => acknowledgement.validate(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, bincode::Encode, bincode::Decode)]
pub struct MailboxRuntimeItem {
    pub item_id: [u8; 16],
    pub payload: MailboxRuntimePayload,
}

impl MailboxRuntimeItem {
    pub fn packet(packet: SignedMailboxPacket) -> Result<Self> {
        let item = Self {
            item_id: packet.body.packet.packet_id,
            payload: MailboxRuntimePayload::Packet(Box::new(packet)),
        };
        item.validate()?;
        Ok(item)
    }

    pub fn acknowledgement(acknowledgement: SignedDeliveryAck) -> Result<Self> {
        let item = Self {
            item_id: acknowledgement_item_id(&acknowledgement),
            payload: MailboxRuntimePayload::Acknowledgement(Box::new(acknowledgement)),
        };
        item.validate()?;
        Ok(item)
    }

    pub fn hash(&self) -> Result<[u8; 32]> {
        let encoded = encode_limited::<MAILBOX_RUNTIME_ITEM_BYTES, _>(self)?;
        Ok(*blake3::hash(&encoded).as_bytes())
    }
}

impl Validate for MailboxRuntimeItem {
    fn validate(&self) -> Result<()> {
        if self.item_id == [0; 16] {
            return Err(invalid("mailbox item id is all zero"));
        }
        self.payload.validate()?;
        let expected = match &self.payload {
            MailboxRuntimePayload::Packet(packet) => packet.body.packet.packet_id,
            MailboxRuntimePayload::Acknowledgement(acknowledgement) => {
                acknowledgement_item_id(acknowledgement)
            }
        };
        if self.item_id != expected {
            return Err(PeerError::Authentication(
                "mailbox item id is not bound to its authenticated payload".into(),
            ));
        }
        Ok(())
    }
}

fn acknowledgement_item_id(acknowledgement: &SignedDeliveryAck) -> [u8; 16] {
    let mut hasher = blake3::Hasher::new_derive_key("forge-peer/1 mailbox acknowledgement item id");
    hasher.update(&acknowledgement.body.packet_id);
    hasher.update(&acknowledgement.body.packet_hash);
    let mut id = [0_u8; 16];
    id.copy_from_slice(&hasher.finalize().as_bytes()[..16]);
    id
}

#[derive(Debug, Clone)]
pub struct SealedMailboxItem {
    pub message_id: String,
    pub ciphertext: Vec<u8>,
}

#[derive(Debug)]
pub struct FetchedMailboxItem {
    pub service_message_id: String,
    pub item: Result<MailboxRuntimeItem>,
}

#[derive(Clone)]
pub struct MailboxPacketClient {
    client: Client,
    origin: ValidatedMailboxOrigin,
}

impl MailboxPacketClient {
    pub fn new(origin: ValidatedMailboxOrigin, roots: MailboxTlsRoots) -> Result<Self> {
        Ok(Self {
            client: build_client(&origin, roots)?,
            origin,
        })
    }

    pub fn canonical_origin(&self) -> &str {
        self.origin.canonical_origin()
    }

    pub async fn probe(&self) -> Result<()> {
        let url = self.origin.url().join("/healthz").map_err(|error| {
            PeerError::Transport(format!("building mailbox health URL: {error}"))
        })?;
        let response = self
            .client
            .get(url)
            .send()
            .await
            .map_err(|_| PeerError::Transport("mailbox health request failed".into()))?;
        let health: HealthResponse =
            bounded_json_response(response, &[StatusCode::OK], "mailbox health").await?;
        if health.status != "ok"
            || health.service != "forge-connectivity-service"
            || health.storage.status != "ok"
            || health.storage.schema_version == 0
            || health.version.is_empty()
            || health.version.len() > 64
        {
            return Err(PeerError::Transport(
                "mailbox connectivity service is not operational".into(),
            ));
        }
        Ok(())
    }

    pub async fn enqueue(
        &self,
        credential: &MailboxChannelCredential,
        item: &MailboxRuntimeItem,
    ) -> Result<()> {
        self.require_bound_credential(credential)?;
        let sealed = credential.seal_item(item)?;
        let body = PostEnvelopeBody {
            message_id: sealed.message_id.clone(),
            ciphertext: URL_SAFE_NO_PAD.encode(&sealed.ciphertext),
            expires_in_seconds: MAILBOX_ENVELOPE_TTL_SECONDS,
        };
        let body_bytes = canonical_json(&body)?;
        let idempotency =
            credential.idempotency_key(b"post-envelope", sealed.message_id.as_bytes());
        let target = format!(
            "/v1/envelopes/{}",
            URL_SAFE_NO_PAD.encode(credential.endpoint.opaque_channel)
        );
        let url = self.operation_url(&target)?;
        let response = self
            .client
            .post(url)
            .headers(channel_headers(
                credential,
                &Method::POST,
                &target,
                &body_bytes,
                Some(&idempotency),
            )?)
            .header(CONTENT_TYPE, JSON_CONTENT_TYPE)
            .body(body_bytes)
            .send()
            .await
            .map_err(|_| PeerError::Transport("mailbox envelope enqueue failed".into()))?;
        require_idempotency_replay_header(&response)?;
        let result: PostEnvelopeResponse = bounded_json_response(
            response,
            &[StatusCode::OK, StatusCode::ACCEPTED],
            "mailbox envelope enqueue",
        )
        .await?;
        validate_opaque_id(&result.message_id, "mailbox response message id")?;
        validate_timestamp(&result.expires_at, "mailbox response expiresAt")?;
        if result.message_id != sealed.message_id
            || result.accepted == result.duplicate
            || result.state != EnvelopeState::Pending
        {
            return Err(PeerError::Authentication(
                "mailbox enqueue response is not bound to the requested pending envelope".into(),
            ));
        }
        Ok(())
    }

    pub async fn fetch(
        &self,
        credential: &MailboxChannelCredential,
        requested_limit: usize,
    ) -> Result<Vec<FetchedMailboxItem>> {
        self.require_bound_credential(credential)?;
        if requested_limit == 0 || requested_limit > MAX_RUNTIME_MAILBOX_BATCH {
            return Err(limit(format!(
                "mailbox fetch limit must be within 1..={MAX_RUNTIME_MAILBOX_BATCH}"
            )));
        }
        let target = format!(
            "/v1/envelopes/{}?limit={requested_limit}&waitSeconds=0",
            URL_SAFE_NO_PAD.encode(credential.endpoint.opaque_channel)
        );
        let url = self.operation_url(&target)?;
        let response = self
            .client
            .get(url)
            .headers(channel_headers(
                credential,
                &Method::GET,
                &target,
                &[],
                None,
            )?)
            .send()
            .await
            .map_err(|_| PeerError::Transport("mailbox envelope fetch failed".into()))?;
        let page: EnvelopePageResponse =
            bounded_json_response(response, &[StatusCode::OK], "mailbox envelope fetch").await?;
        validate_cursor(&page.next_cursor)?;
        if page.poll_timed_out {
            return Err(PeerError::Authentication(
                "non-waiting mailbox fetch reported a poll timeout".into(),
            ));
        }
        if page.envelopes.len() > requested_limit {
            return Err(limit("mailbox returned more envelopes than requested"));
        }
        page.envelopes
            .into_iter()
            .map(|record| {
                validate_opaque_id(&record.message_id, "mailbox fetched message id")?;
                validate_timestamp(&record.created_at, "mailbox record createdAt")?;
                validate_timestamp(&record.expires_at, "mailbox record expiresAt")?;
                let ciphertext = decode_base64url(
                    &record.ciphertext,
                    MAX_MAILBOX_CIPHERTEXT_BYTES,
                    "mailbox ciphertext",
                )?;
                if ciphertext.len() < 32 {
                    return Err(invalid("mailbox ciphertext is shorter than 32 bytes"));
                }
                let item = credential.open_item(&record.message_id, &ciphertext);
                Ok(FetchedMailboxItem {
                    service_message_id: record.message_id,
                    item,
                })
            })
            .collect()
    }

    pub async fn acknowledge(
        &self,
        credential: &MailboxChannelCredential,
        message_ids: &[String],
    ) -> Result<()> {
        self.require_bound_credential(credential)?;
        if message_ids.is_empty() || message_ids.len() > MAX_RUNTIME_MAILBOX_BATCH {
            return Err(limit("mailbox acknowledgement count is out of bounds"));
        }
        let mut canonical_ids = message_ids.to_vec();
        canonical_ids.sort();
        canonical_ids.dedup();
        if canonical_ids.len() != message_ids.len() {
            return Err(invalid("mailbox acknowledgement ids are not unique"));
        }
        for message_id in &canonical_ids {
            validate_opaque_id(message_id, "mailbox acknowledgement message id")?;
        }
        let body = AckEnvelopeBody {
            message_ids: canonical_ids,
        };
        let body_bytes = canonical_json(&body)?;
        let idempotency =
            credential.idempotency_key(b"ack-envelopes", &Sha256::digest(&body_bytes));
        let target = format!(
            "/v1/envelopes/{}/ack",
            URL_SAFE_NO_PAD.encode(credential.endpoint.opaque_channel)
        );
        let url = self.operation_url(&target)?;
        let response = self
            .client
            .post(url)
            .headers(channel_headers(
                credential,
                &Method::POST,
                &target,
                &body_bytes,
                Some(&idempotency),
            )?)
            .header(CONTENT_TYPE, JSON_CONTENT_TYPE)
            .body(body_bytes)
            .send()
            .await
            .map_err(|_| PeerError::Transport("mailbox envelope acknowledgement failed".into()))?;
        require_idempotency_replay_header(&response)?;
        let result: AckEnvelopeResponse = bounded_json_response(
            response,
            &[StatusCode::OK],
            "mailbox envelope acknowledgement",
        )
        .await?;
        let total = result
            .acknowledged
            .checked_add(result.already_finalized)
            .and_then(|count| count.checked_add(result.unknown))
            .ok_or_else(|| limit("mailbox acknowledgement count overflow"))?;
        if total != message_ids.len() || result.unknown != 0 {
            return Err(PeerError::StateConflict(
                "mailbox service did not finalize every requested envelope".into(),
            ));
        }
        Ok(())
    }

    fn require_bound_credential(&self, credential: &MailboxChannelCredential) -> Result<()> {
        credential.endpoint.validate()?;
        if credential.endpoint.origin.as_str() != self.origin.canonical_origin() {
            return Err(PeerError::Authentication(
                "mailbox channel capability is bound to a different configured provider".into(),
            ));
        }
        Ok(())
    }

    fn operation_url(&self, target: &str) -> Result<Url> {
        if !target.starts_with('/') || target.contains("..") || target.contains('#') {
            return Err(invalid("mailbox canonical target is invalid"));
        }
        self.origin.url().join(target).map_err(|error| {
            PeerError::Transport(format!("building mailbox operation URL: {error}"))
        })
    }
}

fn build_client(origin: &ValidatedMailboxOrigin, roots: MailboxTlsRoots) -> Result<Client> {
    let mut builder = Client::builder()
        .https_only(true)
        .tls_version_min(tls::Version::TLS_1_2)
        .redirect(redirect::Policy::none())
        .no_proxy()
        .connect_timeout(Duration::from_secs(10))
        .timeout(MAILBOX_TIMEOUT)
        .user_agent("forge-peer/1")
        .resolve_to_addrs(origin.host(), origin.pinned_addresses());
    if let MailboxTlsRoots::ExclusivePem(pem) = roots {
        if pem.is_empty() || pem.len() > MAX_EXPLICIT_CA_BYTES {
            return Err(limit("explicit mailbox CA bundle is empty or oversized"));
        }
        let certificates = reqwest::Certificate::from_pem_bundle(&pem).map_err(|_| {
            PeerError::Authentication("explicit mailbox CA bundle is invalid".into())
        })?;
        if certificates.is_empty() || certificates.len() > 16 {
            return Err(limit(
                "explicit mailbox CA bundle must contain 1..=16 certificates",
            ));
        }
        builder = builder.tls_certs_only(certificates);
    }
    builder
        .build()
        .map_err(|error| PeerError::Transport(format!("building mailbox client: {error}")))
}

fn channel_headers(
    credential: &MailboxChannelCredential,
    method: &Method,
    canonical_target: &str,
    canonical_body: &[u8],
    idempotency_key: Option<&str>,
) -> Result<HeaderMap> {
    channel_headers_at(
        credential,
        method,
        canonical_target,
        canonical_body,
        idempotency_key,
        unix_time()?,
        rand::random(),
    )
}

fn channel_headers_at(
    credential: &MailboxChannelCredential,
    method: &Method,
    canonical_target: &str,
    canonical_body: &[u8],
    idempotency_key: Option<&str>,
    timestamp: u64,
    nonce: [u8; 16],
) -> Result<HeaderMap> {
    if !(10..=12).contains(&timestamp.to_string().len()) {
        return Err(invalid("mailbox authorization timestamp is out of range"));
    }
    if !canonical_target.starts_with('/')
        || canonical_target.contains('#')
        || canonical_target.contains("..")
    {
        return Err(invalid("mailbox authorization target is invalid"));
    }
    if let Some(key) = idempotency_key {
        validate_opaque_id(key, "mailbox idempotency key")?;
    }
    let nonce = URL_SAFE_NO_PAD.encode(nonce);
    let body_hash = URL_SAFE_NO_PAD.encode(Sha256::digest(canonical_body));
    let payload = format!(
        "{CONNECTIVITY_AUTH_DOMAIN}\n{}\n{canonical_target}\n{timestamp}\n{nonce}\n{body_hash}\n{}",
        method.as_str().to_ascii_uppercase(),
        idempotency_key.unwrap_or("-")
    );
    let signature = credential.signing_key().sign(payload.as_bytes()).to_bytes();
    let authorization = format!(
        "ForgeChannel v1.{}.{}.{}.{}",
        URL_SAFE_NO_PAD.encode(credential.spki()),
        timestamp,
        nonce,
        URL_SAFE_NO_PAD.encode(signature)
    );
    let mut headers = HeaderMap::new();
    headers.insert(AUTHORIZATION, header_value(&authorization)?);
    if let Some(key) = idempotency_key {
        headers.insert("idempotency-key", header_value(key)?);
    }
    Ok(headers)
}

fn require_idempotency_replay_header(response: &reqwest::Response) -> Result<bool> {
    let values = response.headers().get_all("idempotency-replayed");
    let mut values = values.iter();
    let value = values
        .next()
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| {
            PeerError::Authentication("mailbox mutation omitted its replay header".into())
        })?;
    if values.next().is_some() || !matches!(value, "true" | "false") {
        return Err(PeerError::Authentication(
            "mailbox mutation returned an invalid replay header".into(),
        ));
    }
    Ok(value == "true")
}

async fn bounded_json_response<T: for<'de> Deserialize<'de>>(
    mut response: reqwest::Response,
    expected_statuses: &[StatusCode],
    label: &str,
) -> Result<T> {
    if !expected_statuses.contains(&response.status()) {
        return Err(PeerError::Transport(format!(
            "{label} returned status {}",
            response.status()
        )));
    }
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    if content_type != JSON_CONTENT_TYPE && !content_type.starts_with("application/json;") {
        return Err(PeerError::Authentication(format!(
            "{label} returned an unexpected content type"
        )));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_MAILBOX_RESPONSE_BYTES as u64)
    {
        return Err(limit("mailbox response Content-Length exceeds 2 MiB"));
    }
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| PeerError::Transport(format!("reading bounded {label} response failed")))?
    {
        if body.len().saturating_add(chunk.len()) > MAX_MAILBOX_RESPONSE_BYTES {
            return Err(limit("streamed mailbox response exceeds 2 MiB"));
        }
        body.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&body)
        .map_err(|_| PeerError::Authentication(format!("{label} returned invalid strict JSON")))
}

fn canonical_json<T: Serialize>(value: &T) -> Result<Vec<u8>> {
    serde_json_canonicalizer::to_vec(value)
        .map_err(|error| invalid(format!("canonicalizing mailbox JSON: {error}")))
}

fn ciphertext_aad(channel: &[u8; 32], message_id: &str, bucket: usize) -> Vec<u8> {
    let mut aad = Vec::with_capacity(96);
    aad.extend_from_slice(MAILBOX_CIPHERTEXT_MAGIC);
    aad.push(MAILBOX_CIPHERTEXT_VERSION);
    aad.extend_from_slice(channel);
    aad.extend_from_slice(message_id.as_bytes());
    aad.extend_from_slice(&u64::try_from(bucket).unwrap_or(u64::MAX).to_be_bytes());
    aad
}

fn validate_opaque_id(value: &str, label: &str) -> Result<()> {
    if !(16..=128).contains(&value.len())
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
    {
        return Err(invalid(format!(
            "{label} must contain 16..=128 unpadded base64url characters"
        )));
    }
    Ok(())
}

fn validate_cursor(value: &str) -> Result<()> {
    let decoded = decode_base64url(value, 8, "mailbox cursor")?;
    if value.len() != 11 || decoded.len() != 8 {
        return Err(invalid("mailbox cursor is not canonical"));
    }
    Ok(())
}

fn validate_timestamp(value: &str, label: &str) -> Result<()> {
    if value.len() > 40 || OffsetDateTime::parse(value, &Rfc3339).is_err() {
        return Err(invalid(format!("{label} is not canonical RFC 3339")));
    }
    Ok(())
}

fn decode_base64url(value: &str, maximum: usize, label: &str) -> Result<Vec<u8>> {
    if value.is_empty()
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
    {
        return Err(invalid(format!("{label} is not unpadded base64url")));
    }
    let decoded = URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| invalid(format!("{label} is not valid base64url")))?;
    if decoded.len() > maximum || URL_SAFE_NO_PAD.encode(&decoded) != value {
        return Err(limit(format!("{label} is oversized or non-canonical")));
    }
    Ok(decoded)
}

fn header_value(value: &str) -> Result<HeaderValue> {
    HeaderValue::from_str(value).map_err(|_| invalid("generated mailbox header is invalid"))
}

fn unix_time() -> Result<u64> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .map_err(|_| PeerError::Transport("system clock predates Unix epoch".into()))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PostEnvelopeBody {
    message_id: String,
    ciphertext: String,
    expires_in_seconds: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PostEnvelopeResponse {
    accepted: bool,
    duplicate: bool,
    message_id: String,
    state: EnvelopeState,
    expires_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
enum EnvelopeState {
    Pending,
    Acked,
    Expired,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EnvelopePageResponse {
    envelopes: Vec<EnvelopeRecordResponse>,
    next_cursor: String,
    poll_timed_out: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EnvelopeRecordResponse {
    message_id: String,
    ciphertext: String,
    created_at: String,
    expires_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AckEnvelopeBody {
    message_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AckEnvelopeResponse {
    acknowledged: usize,
    already_finalized: usize,
    unknown: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HealthResponse {
    status: String,
    service: String,
    version: String,
    storage: HealthStorage,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HealthStorage {
    status: String,
    schema_version: u64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::codec::BoundedBytes;
    use crate::identity::PrincipalId;
    use crate::transport::PeerWirePayload;

    fn credential(role: MailboxChannelRole) -> Result<MailboxChannelCredential> {
        MailboxRelationshipSecret::derive(&[7; 32], &[8; 16], PrincipalId([9; 32]))?
            .credential(role, "https://mailbox.example")
    }

    fn runtime_item(
        reply_to: MailboxEndpointDescriptor,
        payload_len: usize,
    ) -> Result<MailboxRuntimeItem> {
        let now = unix_time()?;
        let identity = LocalIdentityState::generate(now.saturating_sub(1), 86_400)?;
        let packet = PeerWirePacket::new(
            PeerWirePayload::PairingAcceptance(BoundedBytes::new(vec![7; payload_len])?),
            now,
            now.saturating_add(300),
        )?;
        MailboxRuntimeItem::packet(SignedMailboxPacket::sign(
            packet,
            reply_to,
            identity.certificate().clone(),
            identity.device_signer(),
        )?)
    }

    #[test]
    fn channel_derivation_matches_connectivity_service_spki_contract() -> Result<()> {
        let credential = MailboxChannelCredential::from_seed("https://mailbox.example", [1; 32])?;
        assert_eq!(URL_SAFE_NO_PAD.encode(credential.spki()).len(), 59);
        assert_eq!(
            URL_SAFE_NO_PAD
                .encode(credential.endpoint.opaque_channel)
                .len(),
            43
        );
        assert_eq!(
            URL_SAFE_NO_PAD.encode(credential.endpoint.opaque_channel),
            "nyGaCwRjLSwb-GvP28dKjWmvJH4OEZKUakw1MCNiSSk"
        );
        Ok(())
    }

    #[test]
    fn channel_authorization_has_exact_service_shape_and_no_secret() -> Result<()> {
        let credential = MailboxChannelCredential::from_seed("https://mailbox.example", [1; 32])?;
        let channel = URL_SAFE_NO_PAD.encode(credential.endpoint.opaque_channel);
        let target = format!("/v1/envelopes/{channel}?limit=4&waitSeconds=0");
        let headers = channel_headers_at(
            &credential,
            &Method::GET,
            &target,
            &[],
            None,
            1_700_000_000,
            [2; 16],
        )?;
        let authorization = headers
            .get(AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .ok_or_else(|| invalid("authorization header missing"))?;
        let parts = authorization
            .strip_prefix("ForgeChannel v1.")
            .ok_or_else(|| invalid("authorization prefix missing"))?
            .split('.')
            .collect::<Vec<_>>();
        assert_eq!(parts.len(), 4);
        assert_eq!(parts[0].len(), 59);
        assert_eq!(parts[1], "1700000000");
        assert_eq!(parts[2], "AgICAgICAgICAgICAgICAg");
        assert_eq!(parts[3].len(), 86);
        assert_eq!(
            authorization,
            "ForgeChannel v1.MCowBQYDK2VwAyEAiojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w.1700000000.AgICAgICAgICAgICAgICAg.QbGwezkgBnbmbm2LpdKG_6GBmkXYhVLKqTkWF4bTtZ92lFL6usp7dMvIXW0N7UkiUvZrlU3y_xUnUZrkxAPvCg"
        );
        assert!(!authorization.contains(&URL_SAFE_NO_PAD.encode([1; 32])));
        Ok(())
    }

    #[test]
    fn directional_credentials_are_distinct_and_endpoint_bound() -> Result<()> {
        let inviter = credential(MailboxChannelRole::InviterInbox)?;
        let accepter = credential(MailboxChannelRole::AccepterInbox)?;
        assert_ne!(inviter.endpoint, accepter.endpoint);
        assert!(inviter.require_endpoint(&accepter.endpoint).is_err());
        let wrong_provider =
            MailboxChannelCredential::from_seed("https://other.example", *inviter.seed)?;
        assert_ne!(inviter.endpoint, wrong_provider.endpoint);
        Ok(())
    }

    #[test]
    fn strict_service_responses_reject_schema_drift() {
        let response = serde_json::json!({
            "envelopes": [],
            "nextCursor": "AAAAAAAAAAA",
            "pollTimedOut": false,
            "unexpected": true
        });
        assert!(serde_json::from_value::<EnvelopePageResponse>(response).is_err());
    }

    #[test]
    fn opaque_identifiers_and_cursors_are_canonical_and_bounded() {
        assert!(validate_opaque_id("AAAAAAAAAAAAAAAA", "id").is_ok());
        assert!(validate_opaque_id("short", "id").is_err());
        assert!(validate_opaque_id("AAAAAAAAAAAAAAAA=", "id").is_err());
        assert!(validate_cursor("AAAAAAAAAAA").is_ok());
        assert!(validate_cursor("AAAAAAAAAA=").is_err());
    }

    #[test]
    fn mailbox_items_are_deterministically_encrypted_padded_and_tamper_evident() -> Result<()> {
        let recipient = credential(MailboxChannelRole::InviterInbox)?;
        let reply = credential(MailboxChannelRole::AccepterInbox)?;
        let item = runtime_item(reply.endpoint().clone(), 128)?;
        let first = recipient.seal_item(&item)?;
        let replayed_item = recipient.seal_item(&item)?;
        assert_eq!(first.message_id, replayed_item.message_id);
        assert_eq!(first.ciphertext, replayed_item.ciphertext);
        assert!(
            PADDING_BUCKETS
                .iter()
                .any(|bucket| { first.ciphertext.len() == 9 + 24 + bucket + 16 })
        );
        assert_eq!(
            recipient.open_item(&first.message_id, &first.ciphertext)?,
            item
        );

        let mut tampered = first.ciphertext.clone();
        let last = tampered
            .last_mut()
            .ok_or_else(|| invalid("sealed test item is empty"))?;
        *last ^= 1;
        assert!(recipient.open_item(&first.message_id, &tampered).is_err());
        assert!(
            reply
                .open_item(&first.message_id, &first.ciphertext)
                .is_err()
        );
        let substituted_id = URL_SAFE_NO_PAD.encode([44_u8; 16]);
        assert!(
            recipient
                .open_item(&substituted_id, &first.ciphertext)
                .is_err()
        );
        Ok(())
    }

    #[test]
    fn mailbox_padding_hides_nearby_plaintext_lengths_and_secrets_are_redacted() -> Result<()> {
        let recipient = credential(MailboxChannelRole::InviterInbox)?;
        let reply = credential(MailboxChannelRole::AccepterInbox)?;
        let small = recipient.seal_item(&runtime_item(reply.endpoint().clone(), 64)?)?;
        let nearby = recipient.seal_item(&runtime_item(reply.endpoint().clone(), 96)?)?;
        assert_eq!(small.ciphertext.len(), nearby.ciphertext.len());
        assert!(!format!("{recipient:?}").contains(&URL_SAFE_NO_PAD.encode(*recipient.seed)));
        let secret = MailboxRelationshipSecret::derive(&[7; 32], &[8; 16], PrincipalId([9; 32]))?;
        assert_eq!(
            format!("{secret:?}"),
            "MailboxRelationshipSecret([REDACTED])"
        );
        Ok(())
    }
}
