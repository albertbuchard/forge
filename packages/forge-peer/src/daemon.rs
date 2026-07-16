use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

use arc_swap::ArcSwap;
use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use bincode::{Decode, Encode};
use chacha20poly1305::aead::{Aead as _, KeyInit as _, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};
use subtle::ConstantTimeEq as _;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use x25519_dalek::{PublicKey as X25519PublicKey, StaticSecret};
use zeroize::{Zeroize as _, Zeroizing};

use crate::PROTOCOL_NAME;
use crate::codec::{
    BoundedBytes, BoundedString, BoundedVec, MAX_IPC_FRAME_BYTES, Validate, decode_limited,
    encode_limited,
};
use crate::command_auth::{
    COMMAND_AUTHORITY_STATE_FILE, CommandAuthorityState, CommandAuthorization,
    CommandAuthorizationExpectation, CommandAuthorizationProvenance, CommandCapabilityKind,
    CommandCapabilityState, MAX_COMMAND_AUTHORITY_STATE_BYTES, NodeCommandAuthority,
    VerifiedCommandAuthorityState, command_authorization_hash,
};
use crate::endpoint::{
    DirectEndpoint, EndpointDescriptor, IpAddress, IrohEndpointDescriptor,
    MailboxEndpointDescriptor, TorEndpoint,
};
use crate::envelope::{
    ChannelId, EnvelopeBody, EnvelopeMessageId, PreviousAcknowledgement, SignedEnvelope,
    decode_application, encode_application,
};
use crate::error::{PeerError, Result, invalid, limit};
use crate::grant::{
    GrantParty, GrantSignatureAlgorithm, GrantSignerMetadata, GrantStatus, MemoryGrantTrustStore,
    PeerShareGrantVersion, ShareDirection, TrustedGrantSigner, sign_grant_consent,
    verify_active_grant, verify_grant_consent_signature,
};
use crate::identity::{
    DeviceCapabilities, DeviceCertificate, DeviceSigner, DeviceTrustResolver,
    MemoryDeviceTrustStore, ProtocolRange, ProtocolVersion, SignatureBytes,
};
use crate::ipc::{IpcErrorCode, IpcHandler, IpcRequest, IpcResponse};
use crate::local_identity::LocalIdentityState;
use crate::message::{
    ApplicationMessage, Completeness, DeviceRemoval, FreshnessState, GrantId, Granularity,
    OpaqueRecordId, Precision, ProjectionDelta, ProjectionField, ProjectionId, ProtocolErrorCode,
    ProtocolErrorMessage, QueryId, QueryOutcome, QueryRequest, QueryRequestV2, QueryResponse,
    RecordOperation, RelationshipId, RelationshipRevocation, ResponseMetadata, ResyncRequest,
    TimeRange, TypedQuery, UnavailableReason,
};
use crate::mls::{
    CertifiedKeyPackage, MlsClient, MlsDeviceIdentity, MlsSession, ProcessedMlsMessage,
    state_id_for_group,
};
use crate::pairing::{
    InviteId, PairingInviteBody, PairingQrBundle, PairingTranscriptBody, SignedPairingInvite,
    SignedPairingTranscript,
};
use crate::persistence::{
    AntiRollbackCheckpointStore, CheckpointRecord, MlsStateStore, PersistedMlsState,
    PersistedStateCoordinator, StateEncryptionKey, StateId, XChaChaStateSealer,
};
use crate::provider::mailbox::{
    MailboxChannelCredential, MailboxChannelRole, MailboxRelationshipSecret, SignedMailboxPacket,
};
use crate::provider::{ProviderKind, ProviderReadiness, ProviderReadinessRegistry};
use crate::replay::ReplayState;
use crate::secure_fs::{SecureDirectory, SecureFileLock};
use crate::transport::{
    HostCredentialRotationBody, MailboxDispatchBinding, MlsWelcomeBody, OutboundWireDispatch,
    PeerWireHandler, PeerWirePacket, PeerWirePayload, SignedDeliveryAck,
    SignedHostCredentialRotation, SignedMlsWelcome,
};

const DAEMON_STATE_FILE: &str = "daemon-state.bin";
const DAEMON_LOCK_FILE: &str = "daemon-state.lock";
const IDENTITY_STATE_FILE: &str = "identity-state.bin";
const DAEMON_STATE_MAGIC: &[u8; 5] = b"FGDS9";
const DAEMON_EVIDENCE_PROTOCOL: &str = "forge-peer-daemon-evidence/v1";
const DAEMON_STATEMENT_HASH_DOMAIN: &[u8] = b"forge-peer/daemon-statement/v1\0";
const DAEMON_EVIDENCE_SIGNATURE_DOMAIN: &[u8] = b"forge-peer/daemon-evidence-signature/v1\0";
const PRE_MAILBOX_DAEMON_STATE_MAGIC: &[u8; 5] = b"FGDS8";
const PRE_QUERY_BRIDGE_DAEMON_STATE_MAGIC: &[u8; 5] = b"FGDS7";
const PRE_ROTATION_DAEMON_STATE_MAGIC: &[u8; 5] = b"FGDS6";
const IDENTITY_BOUNDARY_DAEMON_STATE_MAGIC: &[u8; 5] = b"FGDS5";
const ENDPOINT_DAEMON_STATE_MAGIC: &[u8; 5] = b"FGDS4";
const PREVIOUS_DAEMON_STATE_MAGIC: &[u8; 5] = b"FGDS3";
const LEGACY_DAEMON_STATE_MAGIC: &[u8; 5] = b"FGDS2";
const DAEMON_STATE_VERSION: u16 = 9;
const PRE_MAILBOX_DAEMON_STATE_VERSION: u16 = 8;
const PRE_QUERY_BRIDGE_DAEMON_STATE_VERSION: u16 = 7;
const PRE_ROTATION_DAEMON_STATE_VERSION: u16 = 6;
const IDENTITY_BOUNDARY_DAEMON_STATE_VERSION: u16 = 5;
const ENDPOINT_DAEMON_STATE_VERSION: u16 = 4;
const PREVIOUS_DAEMON_STATE_VERSION: u16 = 3;
const LEGACY_DAEMON_STATE_VERSION: u16 = 2;
const DAEMON_STATE_LIMIT: usize = 8 * 1024 * 1024;
const MAX_INVITATIONS: usize = 128;
const MAX_PAIRINGS: usize = 128;
const MAX_PENDING_DECISIONS: usize = 4_096;
const MAX_RELATIONSHIPS: usize = 256;
const MAX_GRANTS_PER_RELATIONSHIP: usize = 1_024;
const MAX_RELATIONSHIP_CERTIFICATE_HISTORY: usize = 32;
const MAX_COMMAND_RECEIPTS: usize = 4_096;
const RETAINED_EMPTY_QUERY_CLAIM_RECEIPTS: usize = 256;
const MAX_GRANT_REVOCATIONS: usize = 4_096;
const MAX_REVOCATION_EVENTS: usize = 1_024;
const MAX_REVOCATION_CONSUMERS: usize = 64;
const MAX_QUERY_RESULTS: usize = 256;
const MAX_TRANSPORT_OUTBOX: usize = 256;
const MAX_INBOUND_RECEIPTS: usize = 4_096;
const MAX_PENDING_MLS_CLIENTS: usize = 128;
const MAX_QUERY_EXCHANGES: usize = 256;
const MAX_TRANSPORT_ATTEMPTS: u16 = 16;
const MAX_MLS_CLIENT_SNAPSHOT_BYTES: usize = 4 * 1024 * 1024;
const QUERY_IPC_RESPONSE_OVERHEAD_BYTES: usize = 16 * 1024;
const MAX_QUERY_JSON_BYTES: usize = MAX_IPC_FRAME_BYTES - QUERY_IPC_RESPONSE_OVERHEAD_BYTES;
const MAX_WIRE_QUERY_RESPONSE_BYTES: u32 = 48 * 1024;
const MAX_REQUESTED_QUERY_RECORDS: usize = 1_000;
const MAX_QUERY_RECORDS: usize = 64;
const MAX_QUERY_FIELDS: usize = 64;
const MAX_TEXT_BYTES: usize = 240;
const MAX_REASON_BYTES: usize = 1_024;
const MAX_CLOCK_SKEW_SECONDS: u64 = 300;
const MAX_QUERY_TIMEOUT_MS: u32 = 12_000;
const MAX_APPROVAL_WINDOW_SECONDS: u64 = 24 * 60 * 60;
const PAIRING_ACCEPTANCE_DOMAIN: &[u8] = b"forge-peer/1 pairing acceptance envelope\0";
const REVOCATION_EVENT_SIGNATURE_DOMAIN: &[u8] = b"forge-peer/revocation-event/v1\0";

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, Encode, Decode,
)]
#[serde(rename_all = "snake_case")]
pub enum TransportKind {
    LocalDirect,
    Iroh,
    TorOnion,
    HttpMailbox,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Encode, Decode)]
#[serde(rename_all = "snake_case")]
pub enum PrivacyMode {
    Fastest,
    HideNetworkAddress,
    Custom,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ApiTransportEndpoint {
    LocalDirect {
        host: String,
        port: u16,
    },
    Iroh {
        endpoint_id: String,
        relay_origin: Option<String>,
    },
    TorOnion {
        onion_host: String,
        port: u16,
    },
    HttpMailbox {
        origin: String,
        opaque_channel: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateInvitationInput {
    pub owner_user_id: String,
    pub label: String,
    pub expires_at: String,
    pub privacy_mode: PrivacyMode,
    pub transport_kinds: Vec<TransportKind>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApiPairingInvitation {
    pub id: String,
    pub owner_user_id: String,
    pub inviter_principal_id: String,
    pub inviter_device_id: String,
    pub fingerprint: String,
    pub expires_at: String,
    pub protocol_version: String,
    pub transport_kinds: Vec<TransportKind>,
    pub bootstrap: String,
    pub signature: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AcceptInvitationInput {
    pub owner_user_id: String,
    pub invitation: ApiPairingInvitation,
    pub local_device_id: String,
    pub privacy_mode: PrivacyMode,
    pub scanned_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CancelInvitationInput {
    pub owner_user_id: String,
    pub invitation_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PairingRequestPayload {
    pub protocol_version: String,
    pub invitation_id: String,
    pub transcript_hash: String,
    pub verification_phrase: String,
    pub verification_phrase_hash: String,
    pub local_principal_id: String,
    pub local_device_id: String,
    pub remote_principal_id: String,
    pub remote_device_id: String,
    pub state_binding: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConfirmPairingInput {
    pub owner_user_id: String,
    pub pairing_id: String,
    pub request_payload: PairingRequestPayload,
    pub transcript_hash: String,
    pub verification_phrase: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalIdentityInput {
    pub owner_user_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommandReceiptInput {
    pub owner_user_id: String,
    pub command_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RotateHostCredentialInput {
    pub owner_user_id: String,
    pub not_after: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommandReceiptView {
    pub command_id: String,
    pub operation: String,
    pub request_hash: String,
    pub approval_deadline: Option<String>,
    pub committed_at: Option<String>,
    pub authorization: Option<CommandAuthorizationProvenance>,
    pub result: serde_json::Value,
    pub evidence: DaemonEvidence,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DaemonEvidenceStatementType {
    CommandReceipt,
    RevocationEventPage,
}

impl DaemonEvidenceStatementType {
    const fn as_str(self) -> &'static str {
        match self {
            Self::CommandReceipt => "command_receipt",
            Self::RevocationEventPage => "revocation_event_page",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DaemonEvidence {
    pub protocol: String,
    pub statement_type: DaemonEvidenceStatementType,
    pub statement_hash: String,
    pub owner_user_id: String,
    pub local_principal_id: String,
    pub local_device_id: String,
    pub signing_certificate_hash: String,
    pub issued_at: String,
    pub signature: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommandAuthorityStateInput {
    pub owner_user_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommandAuthorityStateView {
    pub command_id: String,
    pub authority_key_id: String,
    pub invalidation_epoch: String,
    pub state_hash: String,
    pub committed_at: String,
    pub authorization: CommandAuthorizationProvenance,
    pub provenance: AuthenticatedProvenance,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PendingRequestKind {
    Pairing,
    Device,
    Grant,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PendingRequestStatus {
    Pending,
    Accepted,
    Rejected,
    Expired,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApiPendingRequest {
    pub id: String,
    pub owner_user_id: String,
    pub relationship_id: Option<String>,
    pub kind: PendingRequestKind,
    pub status: PendingRequestStatus,
    pub version: u64,
    pub payload: serde_json::Map<String, serde_json::Value>,
    pub payload_hash: String,
    pub expires_at: String,
    pub decided_at: Option<String>,
    pub decision_reason: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AcceptPendingRequestInput {
    pub owner_user_id: String,
    pub request: ApiPendingRequest,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PendingDevicePayload {
    device_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SignGrantInput {
    pub owner_user_id: String,
    pub relationship_id: String,
    pub grant: PeerShareGrantVersion,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AcceptGrantInput {
    pub owner_user_id: String,
    pub grant: PeerShareGrantVersion,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RevokeGrantInput {
    pub owner_user_id: String,
    pub grant: PeerShareGrantVersion,
    pub reason: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeviceAction {
    Approve,
    Remove,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateDeviceInput {
    pub owner_user_id: String,
    pub relationship_id: String,
    pub device_id: String,
    pub action: DeviceAction,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RevokeRelationshipInput {
    pub owner_user_id: String,
    pub relationship_id: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RequestResyncInput {
    pub owner_user_id: String,
    pub relationship_id: String,
    pub projection_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApiTypedQuery {
    pub projection_id: String,
    pub parameters: serde_json::Map<String, serde_json::Value>,
    pub interval: Option<ApiQueryInterval>,
    pub entity_ids: Vec<String>,
    pub fields: Vec<String>,
    pub precision: String,
    pub maximum_result_count: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApiQueryInterval {
    pub starts_at: String,
    pub ends_at: String,
    pub time_zone: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecuteQueryInput {
    pub owner_user_id: String,
    pub relationship_id: String,
    pub person_id: String,
    pub query: ApiTypedQuery,
    pub timeout_ms: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClaimInboundQueryInput {
    pub owner_user_id: String,
    pub worker_id: String,
    pub lease_ms: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InboundQueryClaim {
    pub claim_id: String,
    pub query_id: String,
    pub relationship_id: String,
    pub requester: QuerySource,
    pub query: ApiTypedQuery,
    pub entity_ids_are_opaque: bool,
    pub interval_time_zone_authenticated: bool,
    pub grant_id: String,
    pub grant_sequence: String,
    pub grant_verification_id: String,
    pub verified_grant_hash: String,
    pub rule_id: String,
    pub maximum_payload_bytes: u32,
    pub redacted_fields: Vec<String>,
    pub received_at: String,
    pub expires_at: String,
    pub lease_expires_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InboundQueryClaimResult {
    pub claim: Option<InboundQueryClaim>,
    pub provenance: AuthenticatedProvenance,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InboundQueryCompleteness {
    Complete,
    Partial,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RespondInboundQueryInput {
    pub owner_user_id: String,
    pub worker_id: String,
    pub claim_id: String,
    pub query_id: String,
    pub payload: ApiQueryPayload,
    pub as_of: String,
    pub completeness: InboundQueryCompleteness,
    pub redacted_fields: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InboundQueryResponseResult {
    pub query_id: String,
    pub envelope_id: String,
    pub provenance: AuthenticatedProvenance,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Encode, Decode)]
#[serde(rename_all = "snake_case")]
pub enum RevocationEventKind {
    Grant,
    Device,
    Relationship,
    CredentialRetirement,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Encode, Decode)]
#[serde(rename_all = "snake_case")]
pub enum RevocationEventSource {
    LocalOperator,
    AuthenticatedPeer,
    CertifiedRotation,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ListRevocationEventsInput {
    pub owner_user_id: String,
    pub consumer_id: String,
    pub after_cursor: String,
    pub limit: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AckRevocationEventsInput {
    pub owner_user_id: String,
    pub consumer_id: String,
    pub through_cursor: String,
    pub event_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RevocationEventView {
    pub cursor: String,
    pub event_hash: String,
    pub previous_event_hash: String,
    pub kind: RevocationEventKind,
    pub source: RevocationEventSource,
    pub relationship_id: String,
    pub grant_id: Option<String>,
    pub device_id: Option<String>,
    pub target_certificate: Option<String>,
    pub target_certificate_hash: Option<String>,
    pub target_certificate_serial: Option<String>,
    pub reason: String,
    pub occurred_at: String,
    pub authenticated_remote_principal_id: Option<String>,
    pub authenticated_remote_device_id: Option<String>,
    pub signing_device_id: String,
    pub signing_certificate: String,
    pub signing_certificate_hash: String,
    pub signature: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RevocationEventPage {
    pub events: Vec<RevocationEventView>,
    pub acknowledged_cursor: String,
    pub next_cursor: String,
    pub has_more: bool,
    pub provenance: AuthenticatedProvenance,
    pub evidence: DaemonEvidence,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RevocationAckResult {
    pub consumer_id: String,
    pub acknowledged_cursor: String,
    pub event_hash: String,
    pub acknowledged_at: String,
    pub provenance: AuthenticatedProvenance,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthenticatedProvenance {
    pub protocol_version: String,
    pub owner_user_id: String,
    pub relationship_id: Option<String>,
    pub local_principal_id: String,
    pub local_device_id: String,
    pub remote_principal_id: Option<String>,
    pub remote_device_id: Option<String>,
    pub evidence_hash: String,
    pub authenticated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InvitationMaterial {
    pub invitation: ApiPairingInvitation,
    pub bootstrap_ciphertext: String,
    pub bootstrap_nonce: String,
    pub bootstrap_hash: String,
    pub provenance: AuthenticatedProvenance,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PairingAcceptance {
    pub request_id: String,
    pub request_payload: PairingRequestPayload,
    pub expires_at: String,
    pub provenance: AuthenticatedProvenance,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PairingConfirmation {
    pub relationship: PairingRelationship,
    pub outbound_envelope: Option<String>,
    pub provenance: AuthenticatedProvenance,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PairingRelationship {
    pub id: String,
    pub local_principal: PairingPrincipal,
    pub remote_principal: PairingPrincipal,
    pub local_device: PairingDevice,
    pub remote_device: PairingDevice,
    pub negotiated_protocol_version: String,
    pub verification_phrase_hash: String,
    pub privacy_mode: PrivacyMode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PrincipalTrustState {
    Verified,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PairingPrincipal {
    pub id: String,
    pub root_public_key: String,
    pub trust_state: PrincipalTrustState,
    pub certificate_hash: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PairingDeviceStatus {
    Approved,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PairingDevice {
    pub id: String,
    pub principal_id: String,
    pub signing_public_key: String,
    pub key_agreement_public_key: String,
    pub certificate_serial: String,
    pub certificate: String,
    pub certificate_hash: String,
    pub capabilities: Vec<PairingDeviceCapability>,
    pub transport_endpoints: Vec<ApiTransportEndpoint>,
    pub status: PairingDeviceStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PairingDeviceCapability {
    DirectStream,
    Iroh,
    Tor,
    HttpMailbox,
    Query,
    Projection,
    KeyPackage,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GrantOperationResult {
    pub grant: PeerShareGrantVersion,
    pub provenance: AuthenticatedProvenance,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MutationResult {
    pub provenance: AuthenticatedProvenance,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HostCredentialRotationState {
    AwaitingPeerAcknowledgements,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostCredentialRotationResult {
    pub predecessor_certificate_hash: String,
    pub successor: PairingDevice,
    pub relationship_ids: Vec<String>,
    pub state: HostCredentialRotationState,
    pub provenance: AuthenticatedProvenance,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InvitationCancellation {
    pub invitation_id: String,
    pub provenance: AuthenticatedProvenance,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PendingRequestResult {
    pub request_id: String,
    pub kind: PendingRequestKind,
    pub provenance: AuthenticatedProvenance,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalIdentityView {
    pub principal: PairingPrincipal,
    pub device: PairingDevice,
    pub provenance: AuthenticatedProvenance,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResyncResult {
    pub envelope_ids: Vec<String>,
    pub provenance: AuthenticatedProvenance,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApiQueryRecord {
    pub record_id: String,
    pub fields: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApiQueryPayload {
    pub records: Vec<ApiQueryRecord>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QueryGatewayResult {
    pub state: QueryResultState,
    pub payload: ApiQueryPayload,
    pub metadata: QueryMetadata,
    pub provenance: AuthenticatedProvenance,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QueryResultState {
    Live,
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QueryMetadata {
    pub source: QuerySource,
    pub projection_id: String,
    pub projection_version: u8,
    pub grant_id: String,
    pub grant_sequence: u64,
    pub grant_verification_id: String,
    pub verified_grant_hash: String,
    pub as_of: String,
    pub received_at: String,
    pub valid_until: Option<String>,
    pub completeness: f64,
    pub precision: String,
    pub redacted_fields: Vec<String>,
    pub state: QueryResultState,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuerySource {
    pub principal_id: String,
    pub device_id: String,
    pub relationship_id: String,
}

#[derive(Clone, Encode, Decode)]
struct DurableDaemonState {
    version: u16,
    owner_user_id: String,
    high_water_unix_time: u64,
    invitations: Vec<StoredInvitation>,
    pairings: Vec<StoredPairing>,
    relationships: Vec<StoredRelationship>,
    query_results: Vec<StoredQueryResult>,
    accepted_pending_requests: Vec<AcceptedPendingRequest>,
    grant_revocations: Vec<StoredGrantRevocation>,
    mls_states: Vec<(StateId, PersistedMlsState)>,
    mls_checkpoints: Vec<(StateId, CheckpointRecord)>,
    pending_mls_clients: Vec<StoredPendingMlsClient>,
    mls_relationships: Vec<StoredMlsRelationship>,
    transport_outbox: Vec<StoredOutboundPacket>,
    pending_applications: Vec<StoredPendingApplication>,
    inbound_receipts: Vec<StoredInboundReceipt>,
    query_exchanges: Vec<StoredQueryExchange>,
    inbound_queries: Vec<StoredInboundQuery>,
    projection_deltas: Vec<ProjectionDelta>,
    revocation_events: Vec<StoredRevocationEvent>,
    revocation_consumers: Vec<StoredRevocationConsumer>,
    host_credential_rotation: Option<StoredHostCredentialRotation>,
    command_receipts: Vec<CommandReceipt>,
}

#[derive(Clone, Encode, Decode)]
struct PreMailboxDaemonState {
    version: u16,
    owner_user_id: String,
    high_water_unix_time: u64,
    invitations: Vec<StoredInvitation>,
    pairings: Vec<StoredPairing>,
    relationships: Vec<PreMailboxStoredRelationship>,
    query_results: Vec<StoredQueryResult>,
    accepted_pending_requests: Vec<AcceptedPendingRequest>,
    grant_revocations: Vec<StoredGrantRevocation>,
    mls_states: Vec<(StateId, PersistedMlsState)>,
    mls_checkpoints: Vec<(StateId, CheckpointRecord)>,
    pending_mls_clients: Vec<StoredPendingMlsClient>,
    mls_relationships: Vec<StoredMlsRelationship>,
    transport_outbox: Vec<StoredOutboundPacket>,
    pending_applications: Vec<StoredPendingApplication>,
    inbound_receipts: Vec<StoredInboundReceipt>,
    query_exchanges: Vec<StoredQueryExchange>,
    inbound_queries: Vec<StoredInboundQuery>,
    projection_deltas: Vec<ProjectionDelta>,
    revocation_events: Vec<StoredRevocationEvent>,
    revocation_consumers: Vec<StoredRevocationConsumer>,
    host_credential_rotation: Option<StoredHostCredentialRotation>,
    command_receipts: Vec<CommandReceipt>,
}

#[derive(Clone, Encode, Decode)]
struct PreQueryBridgeDaemonState {
    version: u16,
    owner_user_id: String,
    high_water_unix_time: u64,
    invitations: Vec<StoredInvitation>,
    pairings: Vec<StoredPairing>,
    relationships: Vec<PreMailboxStoredRelationship>,
    query_results: Vec<StoredQueryResult>,
    accepted_pending_requests: Vec<AcceptedPendingRequest>,
    grant_revocations: Vec<StoredGrantRevocation>,
    mls_states: Vec<(StateId, PersistedMlsState)>,
    mls_checkpoints: Vec<(StateId, CheckpointRecord)>,
    pending_mls_clients: Vec<StoredPendingMlsClient>,
    mls_relationships: Vec<StoredMlsRelationship>,
    transport_outbox: Vec<StoredOutboundPacket>,
    pending_applications: Vec<StoredPendingApplication>,
    inbound_receipts: Vec<StoredInboundReceipt>,
    query_exchanges: Vec<StoredQueryExchange>,
    inbound_queries: Vec<LegacyStoredInboundQuery>,
    projection_deltas: Vec<ProjectionDelta>,
    host_credential_rotation: Option<StoredHostCredentialRotation>,
    command_receipts: Vec<CommandReceipt>,
}

#[derive(Clone, Encode, Decode)]
struct PreRotationDaemonState {
    version: u16,
    owner_user_id: String,
    high_water_unix_time: u64,
    invitations: Vec<StoredInvitation>,
    pairings: Vec<StoredPairing>,
    relationships: Vec<PreMailboxStoredRelationship>,
    query_results: Vec<StoredQueryResult>,
    accepted_pending_requests: Vec<AcceptedPendingRequest>,
    grant_revocations: Vec<StoredGrantRevocation>,
    mls_states: Vec<(StateId, PersistedMlsState)>,
    mls_checkpoints: Vec<(StateId, CheckpointRecord)>,
    pending_mls_clients: Vec<StoredPendingMlsClient>,
    mls_relationships: Vec<StoredMlsRelationship>,
    transport_outbox: Vec<StoredOutboundPacket>,
    pending_applications: Vec<StoredPendingApplication>,
    inbound_receipts: Vec<StoredInboundReceipt>,
    query_exchanges: Vec<StoredQueryExchange>,
    inbound_queries: Vec<LegacyStoredInboundQuery>,
    projection_deltas: Vec<ProjectionDelta>,
    command_receipts: Vec<CommandReceipt>,
}

#[derive(Clone, Encode, Decode)]
struct IdentityBoundaryDaemonState {
    version: u16,
    owner_user_id: String,
    high_water_unix_time: u64,
    invitations: Vec<StoredInvitation>,
    pairings: Vec<StoredPairing>,
    relationships: Vec<IdentityBoundaryStoredRelationship>,
    query_results: Vec<StoredQueryResult>,
    accepted_pending_requests: Vec<AcceptedPendingRequest>,
    grant_revocations: Vec<StoredGrantRevocation>,
    mls_states: Vec<(StateId, PersistedMlsState)>,
    mls_checkpoints: Vec<(StateId, CheckpointRecord)>,
    pending_mls_clients: Vec<StoredPendingMlsClient>,
    mls_relationships: Vec<StoredMlsRelationship>,
    transport_outbox: Vec<StoredOutboundPacket>,
    pending_applications: Vec<StoredPendingApplication>,
    inbound_receipts: Vec<StoredInboundReceipt>,
    query_exchanges: Vec<StoredQueryExchange>,
    inbound_queries: Vec<LegacyStoredInboundQuery>,
    projection_deltas: Vec<ProjectionDelta>,
    command_receipts: Vec<CommandReceipt>,
}

#[derive(Clone, Encode, Decode)]
struct EndpointDurableDaemonState {
    version: u16,
    owner_user_id: String,
    high_water_unix_time: u64,
    invitations: Vec<StoredInvitation>,
    pairings: Vec<StoredPairing>,
    relationships: Vec<IdentityBoundaryStoredRelationship>,
    query_results: Vec<StoredQueryResult>,
    accepted_pending_requests: Vec<AcceptedPendingRequest>,
    grant_revocations: Vec<StoredGrantRevocation>,
    command_receipts: Vec<CommandReceipt>,
}

#[derive(Clone, Encode, Decode)]
struct LegacyDurableDaemonState {
    version: u16,
    owner_user_id: String,
    high_water_unix_time: u64,
    invitations: Vec<StoredInvitation>,
    pairings: Vec<StoredPairing>,
    relationships: Vec<LegacyStoredRelationship>,
    query_results: Vec<StoredQueryResult>,
    command_receipts: Vec<CommandReceipt>,
}

#[derive(Clone, Encode, Decode)]
struct PreviousDurableDaemonState {
    version: u16,
    owner_user_id: String,
    high_water_unix_time: u64,
    invitations: Vec<StoredInvitation>,
    pairings: Vec<StoredPairing>,
    relationships: Vec<LegacyStoredRelationship>,
    query_results: Vec<StoredQueryResult>,
    accepted_pending_requests: Vec<AcceptedPendingRequest>,
    grant_revocations: Vec<StoredGrantRevocation>,
    command_receipts: Vec<CommandReceipt>,
}

#[derive(Clone, Encode, Decode)]
struct CommandReceipt {
    command_id: String,
    operation: String,
    request_hash: [u8; 32],
    response_json: Vec<u8>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredCommandResponse<T> {
    receipt_version: u8,
    approval_deadline: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    approval_deadline_rfc3339: Option<String>,
    committed_at: u64,
    #[serde(default)]
    authorization: Option<CommandAuthorizationProvenance>,
    #[serde(default)]
    authorization_document_hash: Option<String>,
    result: T,
}

fn is_proven_empty_query_claim_receipt(receipt: &CommandReceipt) -> bool {
    receipt.operation == "claim_inbound_query"
        && serde_json::from_slice::<StoredCommandResponse<InboundQueryClaimResult>>(
            &receipt.response_json,
        )
        .is_ok_and(|stored| stored.result.claim.is_none())
}

fn compact_empty_query_claim_receipts(receipts: &mut Vec<CommandReceipt>) {
    let mut removals = receipts
        .iter()
        .filter(|receipt| is_proven_empty_query_claim_receipt(receipt))
        .count()
        .saturating_sub(RETAINED_EMPTY_QUERY_CLAIM_RECEIPTS);
    if removals == 0 {
        return;
    }
    receipts.retain(|receipt| {
        if removals > 0 && is_proven_empty_query_claim_receipt(receipt) {
            removals -= 1;
            false
        } else {
            true
        }
    });
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CommandReceiptEvidenceStatement<'a> {
    command_id: &'a str,
    operation: &'a str,
    request_hash: &'a str,
    approval_deadline: &'a Option<String>,
    committed_at: &'a Option<String>,
    authorization: &'a Option<CommandAuthorizationProvenance>,
    result: &'a serde_json::Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RevocationEventPageEvidenceStatement<'a> {
    events: &'a [RevocationEventView],
    acknowledged_cursor: &'a str,
    next_cursor: &'a str,
    has_more: bool,
    provenance: &'a AuthenticatedProvenance,
}

#[derive(Clone, Encode, Decode)]
struct AcceptedPendingRequest {
    request_id: [u8; 16],
    request_hash: [u8; 32],
    accepted_at: u64,
}

#[derive(Clone, Encode, Decode)]
struct StoredGrantRevocation {
    relationship_id: String,
    grant_id: String,
    sequence: u64,
    reason: String,
    revoked_at: u64,
}

#[derive(Clone, Encode, Decode)]
struct RevocationEventBody {
    cursor: u64,
    previous_event_hash: [u8; 32],
    kind: RevocationEventKind,
    source: RevocationEventSource,
    relationship_id: String,
    grant_id: Option<String>,
    device_id: Option<String>,
    target_certificate: Option<DeviceCertificate>,
    reason: String,
    occurred_at: u64,
    authenticated_remote_principal_id: Option<String>,
    authenticated_remote_device_id: Option<String>,
}

#[derive(Clone, Encode, Decode)]
struct StoredRevocationEvent {
    body: RevocationEventBody,
    signing_certificate: DeviceCertificate,
    signature: SignatureBytes,
}

#[derive(Clone, Encode, Decode)]
struct StoredRevocationConsumer {
    consumer_id: String,
    acknowledged_cursor: u64,
    event_hash: [u8; 32],
    acknowledged_at: u64,
}

impl Validate for RevocationEventBody {
    fn validate(&self) -> Result<()> {
        if self.cursor == 0
            || (self.cursor == 1) != (self.previous_event_hash == [0; 32])
            || self.occurred_at == 0
        {
            return Err(invalid("revocation event cursor chain header is invalid"));
        }
        decode_hex_array::<16>(&self.relationship_id, "revocation relationship id")?;
        if let Some(grant_id) = &self.grant_id {
            validate_text(grant_id, 1, MAX_TEXT_BYTES, "revocation grant id")?;
        }
        if let Some(device_id) = &self.device_id {
            validate_text(device_id, 1, MAX_TEXT_BYTES, "revocation device id")?;
        }
        validate_text(&self.reason, 1, MAX_REASON_BYTES, "revocation event reason")?;
        let remote_binding_is_valid = match self.source {
            RevocationEventSource::AuthenticatedPeer => {
                self.authenticated_remote_principal_id.is_some()
                    && self.authenticated_remote_device_id.is_some()
            }
            RevocationEventSource::LocalOperator | RevocationEventSource::CertifiedRotation => {
                self.authenticated_remote_principal_id.is_none()
                    && self.authenticated_remote_device_id.is_none()
            }
        };
        let target_is_valid = match self.kind {
            RevocationEventKind::Grant => {
                self.grant_id.is_some()
                    && self.device_id.is_none()
                    && self.target_certificate.is_none()
            }
            RevocationEventKind::Device | RevocationEventKind::CredentialRetirement => {
                self.grant_id.is_none()
                    && self.device_id.is_some()
                    && self.target_certificate.as_ref().is_some_and(|certificate| {
                        self.device_id.as_deref() == Some(device_id(certificate).as_str())
                            && certificate.verify(self.occurred_at).is_ok()
                    })
            }
            RevocationEventKind::Relationship => {
                self.grant_id.is_none()
                    && self.device_id.is_none()
                    && self.target_certificate.is_none()
            }
        };
        if !remote_binding_is_valid || !target_is_valid {
            return Err(invalid(
                "revocation event source or target binding is invalid",
            ));
        }
        if let Some(principal_id) = &self.authenticated_remote_principal_id {
            validate_text(
                principal_id,
                1,
                MAX_TEXT_BYTES,
                "authenticated revocation principal id",
            )?;
        }
        if let Some(device_id) = &self.authenticated_remote_device_id {
            validate_text(
                device_id,
                1,
                MAX_TEXT_BYTES,
                "authenticated revocation device id",
            )?;
        }
        Ok(())
    }
}

impl Validate for StoredRevocationEvent {
    fn validate(&self) -> Result<()> {
        self.body.validate()?;
        self.signing_certificate.verify(self.body.occurred_at)?;
        self.signature.validate()?;
        self.signing_certificate.verify_device_signature(
            REVOCATION_EVENT_SIGNATURE_DOMAIN,
            &self.body,
            &self.signature,
        )
    }
}

struct RevocationEventDraft {
    kind: RevocationEventKind,
    source: RevocationEventSource,
    relationship_id: String,
    grant_id: Option<String>,
    device_id: Option<String>,
    target_certificate: Option<DeviceCertificate>,
    reason: String,
    occurred_at: u64,
    authenticated_remote_principal_id: Option<String>,
    authenticated_remote_device_id: Option<String>,
}

fn revocation_event_hash(event: &StoredRevocationEvent) -> Result<[u8; 32]> {
    let encoded = encode_limited::<{ 64 * 1024 }, _>(event)?;
    let mut hasher = Sha256::new();
    hasher.update(b"forge-peer/revocation-event-hash/v1\0");
    hasher.update(encoded);
    Ok(hasher.finalize().into())
}

fn append_revocation_event(
    state: &mut DurableDaemonState,
    draft: RevocationEventDraft,
    signing_certificate: &DeviceCertificate,
    signer: &DeviceSigner,
) -> Result<()> {
    if state.revocation_events.len() >= MAX_REVOCATION_EVENTS {
        return Err(limit("durable revocation event log reached its limit"));
    }
    let cursor = u64::try_from(state.revocation_events.len())
        .ok()
        .and_then(|value| value.checked_add(1))
        .ok_or_else(|| PeerError::StateConflict("revocation cursor overflow".into()))?;
    let previous_event_hash = state
        .revocation_events
        .last()
        .map(revocation_event_hash)
        .transpose()?
        .unwrap_or([0; 32]);
    let body = RevocationEventBody {
        cursor,
        previous_event_hash,
        kind: draft.kind,
        source: draft.source,
        relationship_id: draft.relationship_id,
        grant_id: draft.grant_id,
        device_id: draft.device_id,
        target_certificate: draft.target_certificate,
        reason: draft.reason,
        occurred_at: draft.occurred_at,
        authenticated_remote_principal_id: draft.authenticated_remote_principal_id,
        authenticated_remote_device_id: draft.authenticated_remote_device_id,
    };
    body.validate()?;
    let event = StoredRevocationEvent {
        signature: signer.sign(REVOCATION_EVENT_SIGNATURE_DOMAIN, &body)?,
        signing_certificate: signing_certificate.clone(),
        body,
    };
    event.validate()?;
    state.revocation_events.push(event);
    Ok(())
}

#[derive(Clone, Encode, Decode)]
struct StoredPendingMlsClient {
    relationship_id: String,
    transcript_hash: [u8; 32],
    snapshot: Vec<u8>,
}

#[derive(Clone, Encode, Decode)]
struct StoredMlsRelationship {
    relationship_id: String,
    state_id: StateId,
    inbound_replay: ReplayState,
}

#[derive(Clone, Encode, Decode)]
struct StoredOutboundPacket {
    relationship_id: Option<String>,
    packet: PeerWirePacket,
    endpoints: Vec<EndpointDescriptor>,
    expected_receiver: DeviceCertificate,
    attempts: u16,
    next_attempt_at: u64,
}

#[derive(Clone, Encode, Decode)]
struct StoredPendingApplication {
    message_id: EnvelopeMessageId,
    relationship_id: String,
    message: ApplicationMessage,
    created_at: u64,
    expires_at: u64,
}

#[derive(Clone, Encode, Decode)]
struct StoredInboundReceipt {
    packet_id: [u8; 16],
    packet_hash: [u8; 32],
    acknowledgement: SignedDeliveryAck,
}

#[derive(Clone, Encode, Decode)]
struct StoredHostCredentialRotation {
    predecessor_certificate: DeviceCertificate,
    successor_certificate: DeviceCertificate,
    successor_identity: Vec<u8>,
    relationships: Vec<StoredRelationshipRotation>,
    started_at: u64,
}

impl Drop for StoredHostCredentialRotation {
    fn drop(&mut self) {
        self.successor_identity.zeroize();
    }
}

#[derive(Clone, Encode, Decode)]
struct StoredRelationshipRotation {
    relationship_id: String,
    packet_id: [u8; 16],
    packet_hash: [u8; 32],
    acknowledged: bool,
}

#[derive(Clone, Encode, Decode)]
struct StoredQueryExchange {
    query_id: QueryId,
    relationship_id: String,
    grant_id: GrantId,
    grant_sequence: u64,
    projection: ProjectionId,
    requested_at: u64,
    expires_at: u64,
    response: Option<QueryResponse>,
}

#[derive(Clone, Copy, Encode, Decode)]
struct LegacyStoredInboundQuery {
    query_id: QueryId,
    request_hash: [u8; 32],
}

#[derive(Clone, Encode, Decode)]
enum StoredInboundWireQuery {
    V1(QueryRequest),
    V2(QueryRequestV2),
}

impl StoredInboundWireQuery {
    const fn request(&self) -> &QueryRequest {
        match self {
            Self::V1(request) => request,
            Self::V2(request) => &request.request,
        }
    }
}

#[derive(Clone, Encode, Decode)]
struct StoredInboundQueryClaim {
    claim_id: [u8; 16],
    worker_id: String,
    claimed_at: u64,
    lease_expires_at: u64,
}

#[derive(Clone, Encode, Decode)]
struct StoredInboundQuery {
    query_id: QueryId,
    request_hash: [u8; 32],
    relationship_id: Option<String>,
    wire_query: Option<StoredInboundWireQuery>,
    grant_id: Option<String>,
    rule_id: Option<String>,
    grant_verification_id: Option<String>,
    verified_grant_hash: Option<String>,
    effective_fields: Vec<ProjectionField>,
    redacted_fields: Vec<ProjectionField>,
    maximum_result_count: u16,
    maximum_payload_bytes: u32,
    requester_device_id: Option<crate::identity::DeviceId>,
    requester_certificate_hash: Option<[u8; 32]>,
    received_at: u64,
    expires_at: u64,
    claim: Option<StoredInboundQueryClaim>,
    response_message_id: Option<EnvelopeMessageId>,
}

struct InboundQueryAuthorization {
    grant_id: String,
    grant_sequence: u64,
    rule_id: String,
    grant_verification_id: String,
    verified_grant_hash: String,
    effective_fields: Vec<ProjectionField>,
    redacted_fields: Vec<ProjectionField>,
    maximum_result_count: u16,
    maximum_payload_bytes: u32,
}

impl StoredInboundQuery {
    fn legacy(value: LegacyStoredInboundQuery) -> Self {
        Self {
            query_id: value.query_id,
            request_hash: value.request_hash,
            relationship_id: None,
            wire_query: None,
            grant_id: None,
            rule_id: None,
            grant_verification_id: None,
            verified_grant_hash: None,
            effective_fields: Vec::new(),
            redacted_fields: Vec::new(),
            maximum_result_count: 0,
            maximum_payload_bytes: 0,
            requester_device_id: None,
            requester_certificate_hash: None,
            received_at: 0,
            expires_at: 0,
            claim: None,
            response_message_id: None,
        }
    }

    const fn request(&self) -> Option<&QueryRequest> {
        match &self.wire_query {
            Some(query) => Some(query.request()),
            None => None,
        }
    }
}

#[derive(Clone, Encode, Decode)]
struct StoredInvitation {
    bundle: PairingQrBundle,
    bootstrap_private_key: [u8; 32],
    label: String,
    privacy_mode: PrivacyMode,
    transport_kinds: Vec<TransportKind>,
    consumed: bool,
}

impl Drop for StoredInvitation {
    fn drop(&mut self) {
        self.bootstrap_private_key.zeroize();
        self.bundle.bootstrap_proof.zeroize();
    }
}

#[derive(Clone, Encode, Decode)]
struct StoredPairing {
    request_id: [u8; 16],
    state_binding: [u8; 32],
    invitation_owner_user_id: String,
    signed_invite: SignedPairingInvite,
    transcript_body: PairingTranscriptBody,
    accepter_signature: SignatureBytes,
    bootstrap_proof: [u8; 32],
    verification_phrase: String,
    privacy_mode: PrivacyMode,
    confirmed_relationship_id: Option<String>,
    outbound_envelope: Option<Vec<u8>>,
}

impl Drop for StoredPairing {
    fn drop(&mut self) {
        self.bootstrap_proof.zeroize();
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Encode, Decode)]
enum RelationshipStatus {
    Active,
    Revoked,
}

#[derive(Clone, Encode, Decode)]
struct StoredRelationship {
    id: String,
    local_certificate: DeviceCertificate,
    remote_certificate: DeviceCertificate,
    local_certificate_history: Vec<DeviceCertificate>,
    remote_certificate_history: Vec<DeviceCertificate>,
    status: RelationshipStatus,
    privacy_mode: PrivacyMode,
    verification_phrase_hash: [u8; 32],
    local_endpoints: Vec<EndpointDescriptor>,
    remote_endpoints: Vec<EndpointDescriptor>,
    mailbox_secret: Option<[u8; 32]>,
    devices: Vec<StoredDevice>,
    grants: Vec<StoredGrant>,
    outbound_sequence: u64,
    revoked_reason: Option<String>,
}

#[derive(Clone, Encode, Decode)]
struct PreMailboxStoredRelationship {
    id: String,
    local_certificate: DeviceCertificate,
    remote_certificate: DeviceCertificate,
    status: RelationshipStatus,
    privacy_mode: PrivacyMode,
    verification_phrase_hash: [u8; 32],
    local_endpoints: Vec<EndpointDescriptor>,
    remote_endpoints: Vec<EndpointDescriptor>,
    devices: Vec<StoredDevice>,
    grants: Vec<StoredGrant>,
    outbound_sequence: u64,
    revoked_reason: Option<String>,
}

#[derive(Clone, Encode, Decode)]
struct IdentityBoundaryStoredRelationship {
    id: String,
    remote_certificate: DeviceCertificate,
    status: RelationshipStatus,
    privacy_mode: PrivacyMode,
    verification_phrase_hash: [u8; 32],
    local_endpoints: Vec<EndpointDescriptor>,
    remote_endpoints: Vec<EndpointDescriptor>,
    devices: Vec<StoredDevice>,
    grants: Vec<StoredGrant>,
    outbound_sequence: u64,
    revoked_reason: Option<String>,
}

#[derive(Clone, Encode, Decode)]
struct LegacyStoredRelationship {
    id: String,
    remote_certificate: DeviceCertificate,
    status: RelationshipStatus,
    privacy_mode: PrivacyMode,
    verification_phrase_hash: [u8; 32],
    devices: Vec<StoredDevice>,
    grants: Vec<StoredGrant>,
    outbound_sequence: u64,
    revoked_reason: Option<String>,
}

#[derive(Clone, Copy, PartialEq, Eq, Encode, Decode)]
enum StoredDeviceStatus {
    Approved,
    Removed,
}

#[derive(Clone, Encode, Decode)]
struct StoredDevice {
    external_device_id: String,
    certificate: DeviceCertificate,
    status: StoredDeviceStatus,
}

#[derive(Clone, Encode, Decode)]
struct StoredGrant {
    grant: PeerShareGrantVersion,
    verification_id: Option<String>,
    verified_hash: Option<String>,
}

#[derive(Clone, Encode, Decode)]
struct StoredQueryResult {
    relationship_id: String,
    query_hash: [u8; 32],
    payload_json: Vec<u8>,
    as_of: u64,
    valid_until: Option<u64>,
    completeness_millionths: u32,
    redacted_fields: Vec<String>,
}

impl Validate for DurableDaemonState {
    #[allow(clippy::too_many_lines)]
    fn validate(&self) -> Result<()> {
        if self.version != DAEMON_STATE_VERSION {
            return Err(PeerError::Version(
                "unsupported daemon state version".into(),
            ));
        }
        validate_text(&self.owner_user_id, 1, MAX_TEXT_BYTES, "owner user id")?;
        if self.invitations.len() > MAX_INVITATIONS
            || self.pairings.len() > MAX_PAIRINGS
            || self.relationships.len() > MAX_RELATIONSHIPS
            || self.query_results.len() > MAX_QUERY_RESULTS
            || self.accepted_pending_requests.len() > MAX_PENDING_DECISIONS
            || self.grant_revocations.len() > MAX_GRANT_REVOCATIONS
            || self.mls_states.len() > MAX_RELATIONSHIPS
            || self.mls_checkpoints.len() > MAX_RELATIONSHIPS
            || self.pending_mls_clients.len() > MAX_PENDING_MLS_CLIENTS
            || self.mls_relationships.len() > MAX_RELATIONSHIPS
            || self.transport_outbox.len() > MAX_TRANSPORT_OUTBOX
            || self.pending_applications.len() > MAX_TRANSPORT_OUTBOX
            || self.inbound_receipts.len() > MAX_INBOUND_RECEIPTS
            || self.query_exchanges.len() > MAX_QUERY_EXCHANGES
            || self.inbound_queries.len() > MAX_QUERY_EXCHANGES
            || self.projection_deltas.len() > MAX_QUERY_RESULTS
            || self.revocation_events.len() > MAX_REVOCATION_EVENTS
            || self.revocation_consumers.len() > MAX_REVOCATION_CONSUMERS
            || self.command_receipts.len() > MAX_COMMAND_RECEIPTS
        {
            return Err(limit("durable daemon state exceeds collection limits"));
        }
        if self
            .relationships
            .iter()
            .any(|relationship| relationship.grants.len() > MAX_GRANTS_PER_RELATIONSHIP)
        {
            return Err(limit(
                "durable relationship grant history exceeds its limit",
            ));
        }
        let mut accepted_ids = BTreeSet::new();
        for accepted in &self.accepted_pending_requests {
            if accepted.request_id == [0; 16]
                || accepted.request_hash == [0; 32]
                || !accepted_ids.insert(accepted.request_id)
            {
                return Err(PeerError::Rollback(
                    "durable pending-request decision state is invalid".into(),
                ));
            }
        }
        let mut revoked_grants = BTreeSet::new();
        for revocation in &self.grant_revocations {
            validate_text(
                &revocation.relationship_id,
                1,
                MAX_TEXT_BYTES,
                "revoked grant relationship id",
            )?;
            validate_text(&revocation.grant_id, 1, MAX_TEXT_BYTES, "revoked grant id")?;
            validate_text(
                &revocation.reason,
                1,
                MAX_REASON_BYTES,
                "grant revocation reason",
            )?;
            let key = (
                revocation.relationship_id.as_str(),
                revocation.grant_id.as_str(),
                revocation.sequence,
            );
            let matching_grant = self.relationships.iter().any(|relationship| {
                relationship.id == revocation.relationship_id
                    && relationship.grants.iter().any(|stored| {
                        stored.grant.id == revocation.grant_id
                            && stored.grant.sequence == revocation.sequence
                            && stored.grant.status == GrantStatus::Revoked
                    })
            });
            if revocation.sequence == 0
                || revocation.revoked_at == 0
                || !revoked_grants.insert(key)
                || !matching_grant
            {
                return Err(PeerError::Rollback(
                    "durable grant revocation state is invalid".into(),
                ));
            }
        }
        let mut relationship_ids = BTreeSet::new();
        for relationship in &self.relationships {
            decode_hex_array::<16>(&relationship.id, "relationship id")?;
            if !relationship_ids.insert(relationship.id.as_str()) {
                return Err(PeerError::Rollback(
                    "durable relationships contain duplicate ids".into(),
                ));
            }
            relationship
                .local_certificate
                .verify(relationship.local_certificate.body.not_before)?;
            relationship
                .remote_certificate
                .verify(relationship.remote_certificate.body.not_before)?;
            validate_relationship_certificate_history(
                &relationship.local_certificate_history,
                &relationship.local_certificate,
            )?;
            validate_relationship_certificate_history(
                &relationship.remote_certificate_history,
                &relationship.remote_certificate,
            )?;
            if relationship.local_certificate.body.principal_id
                == relationship.remote_certificate.body.principal_id
                || relationship.local_certificate.body.device_id
                    == relationship.remote_certificate.body.device_id
                || relationship.verification_phrase_hash == [0; 32]
            {
                return Err(PeerError::Rollback(
                    "durable relationship identity binding is invalid".into(),
                ));
            }
            validate_canonical_endpoints(&relationship.local_endpoints)?;
            validate_canonical_endpoints(&relationship.remote_endpoints)?;
            validate_stored_relationship_mailbox(relationship)?;
            if relationship.devices.len() > 256
                || (relationship.status == RelationshipStatus::Active
                    && relationship.devices.is_empty())
            {
                return Err(limit("durable relationship device count is invalid"));
            }
            let mut device_ids = BTreeSet::new();
            let mut current_remote_count = 0_usize;
            for device in &relationship.devices {
                validate_text(
                    &device.external_device_id,
                    1,
                    MAX_TEXT_BYTES,
                    "relationship device id",
                )?;
                device
                    .certificate
                    .verify(device.certificate.body.not_before)?;
                if device.external_device_id != device_id(&device.certificate)
                    || device.certificate.body.principal_id
                        != relationship.remote_certificate.body.principal_id
                    || !device_ids.insert(device.external_device_id.as_str())
                {
                    return Err(PeerError::Rollback(
                        "durable relationship device binding is invalid".into(),
                    ));
                }
                if device.certificate == relationship.remote_certificate {
                    current_remote_count = current_remote_count.saturating_add(1);
                }
            }
            if (relationship.status == RelationshipStatus::Active && current_remote_count != 1)
                || current_remote_count > 1
            {
                return Err(PeerError::Rollback(
                    "durable relationship does not contain its unique current host device".into(),
                ));
            }
            let mut grant_heads = BTreeMap::<&str, (u64, String)>::new();
            let mut grant_versions = BTreeSet::new();
            for stored in &relationship.grants {
                stored.grant.validate()?;
                validate_directional_grant_signatures(
                    &stored.grant,
                    relationship,
                    stored.grant.owner_user_id == self.owner_user_id,
                )
                .map_err(|_| {
                    PeerError::Rollback(
                        "durable grant signature direction binding is invalid".into(),
                    )
                })?;
                if stored.grant.relationship_id != relationship.id
                    || !grant_versions.insert((stored.grant.id.as_str(), stored.grant.sequence))
                {
                    return Err(PeerError::Rollback(
                        "durable grant owner, relationship, or version binding is invalid".into(),
                    ));
                }
                match grant_heads.get(stored.grant.id.as_str()) {
                    Some((sequence, hash))
                        if stored.grant.sequence == sequence.saturating_add(1)
                            && stored.grant.previous_version_hash.as_deref()
                                == Some(hash.as_str()) => {}
                    None if stored.grant.sequence == 1
                        && stored.grant.previous_version_hash.is_none() => {}
                    _ => {
                        return Err(PeerError::Rollback(
                            "durable grant hash chain is not contiguous".into(),
                        ));
                    }
                }
                let version_hash = stored.grant.version_hash_hex()?;
                match (&stored.verification_id, &stored.verified_hash) {
                    (Some(verification_id), Some(verified_hash))
                        if stored.grant.status == GrantStatus::Active
                            && verified_hash == &version_hash
                            && verification_id == &format!("fpv_{}", &version_hash[..32]) => {}
                    (None, None) => {}
                    _ => {
                        return Err(PeerError::Rollback(
                            "durable grant verification evidence is inconsistent".into(),
                        ));
                    }
                }
                grant_heads.insert(
                    stored.grant.id.as_str(),
                    (stored.grant.sequence, version_hash),
                );
            }
        }
        let mut previous_event_hash = [0; 32];
        for (index, event) in self.revocation_events.iter().enumerate() {
            event.validate()?;
            let expected_cursor = u64::try_from(index)
                .ok()
                .and_then(|value| value.checked_add(1))
                .ok_or_else(|| PeerError::Rollback("revocation cursor overflow".into()))?;
            let relationship = self
                .relationships
                .iter()
                .find(|relationship| relationship.id == event.body.relationship_id)
                .ok_or_else(|| {
                    PeerError::Rollback(
                        "revocation event references an unknown relationship".into(),
                    )
                })?;
            if event.body.cursor != expected_cursor
                || event.body.previous_event_hash != previous_event_hash
                || event.body.occurred_at > self.high_water_unix_time
                || event.signing_certificate.root_public_key
                    != relationship.local_certificate.root_public_key
                || event.signing_certificate.body.principal_id
                    != relationship.local_certificate.body.principal_id
            {
                return Err(PeerError::Rollback(
                    "durable revocation event chain or signer binding is invalid".into(),
                ));
            }
            if event.body.source == RevocationEventSource::AuthenticatedPeer
                && (event.body.authenticated_remote_principal_id.as_deref()
                    != Some(principal_id(&relationship.remote_certificate).as_str())
                    || event.body.authenticated_remote_device_id.as_deref()
                        != Some(device_id(&relationship.remote_certificate).as_str()))
            {
                return Err(PeerError::Rollback(
                    "authenticated revocation source does not match its relationship".into(),
                ));
            }
            if let Some(target) = &event.body.target_certificate {
                let target_principal = target.body.principal_id;
                let expected_principal = match (event.body.kind, event.body.source) {
                    (RevocationEventKind::Device, RevocationEventSource::LocalOperator)
                    | (
                        RevocationEventKind::CredentialRetirement,
                        RevocationEventSource::AuthenticatedPeer,
                    ) => relationship.remote_certificate.body.principal_id,
                    (RevocationEventKind::Device, RevocationEventSource::AuthenticatedPeer)
                    | (
                        RevocationEventKind::CredentialRetirement,
                        RevocationEventSource::CertifiedRotation,
                    ) => relationship.local_certificate.body.principal_id,
                    _ => {
                        return Err(PeerError::Rollback(
                            "revocation target has an invalid source and kind combination".into(),
                        ));
                    }
                };
                if target_principal != expected_principal {
                    return Err(PeerError::Rollback(
                        "revocation target certificate is bound to the wrong principal".into(),
                    ));
                }
            }
            previous_event_hash = revocation_event_hash(event)?;
        }
        let mut revocation_consumers = BTreeSet::new();
        for consumer in &self.revocation_consumers {
            validate_text(
                &consumer.consumer_id,
                1,
                MAX_TEXT_BYTES,
                "revocation consumer id",
            )?;
            let Some(event_index) = consumer.acknowledged_cursor.checked_sub(1) else {
                return Err(PeerError::Rollback(
                    "durable revocation acknowledgement has a zero cursor".into(),
                ));
            };
            let event_index = usize::try_from(event_index).map_err(|_| {
                PeerError::Rollback("durable revocation acknowledgement cursor overflows".into())
            })?;
            let event = self.revocation_events.get(event_index).ok_or_else(|| {
                PeerError::Rollback(
                    "durable revocation acknowledgement is ahead of the event log".into(),
                )
            })?;
            if !revocation_consumers.insert(consumer.consumer_id.as_str())
                || consumer.event_hash != revocation_event_hash(event)?
                || consumer.acknowledged_at < event.body.occurred_at
                || consumer.acknowledged_at > self.high_water_unix_time
            {
                return Err(PeerError::Rollback(
                    "durable revocation acknowledgement binding is invalid".into(),
                ));
            }
        }
        if self
            .mls_states
            .windows(2)
            .any(|pair| pair[0].0 >= pair[1].0)
            || self
                .mls_checkpoints
                .windows(2)
                .any(|pair| pair[0].0 >= pair[1].0)
        {
            return Err(PeerError::Rollback(
                "embedded MLS state is not uniquely sorted".into(),
            ));
        }
        for (state_id, persisted) in &self.mls_states {
            state_id.validate()?;
            persisted.validate()?;
        }
        for (state_id, checkpoint) in &self.mls_checkpoints {
            state_id.validate()?;
            checkpoint.validate()?;
        }
        let mut pending_relationships = BTreeSet::new();
        for pending in &self.pending_mls_clients {
            validate_text(
                &pending.relationship_id,
                1,
                MAX_TEXT_BYTES,
                "pending MLS relationship id",
            )?;
            if pending.transcript_hash == [0; 32]
                || pending.snapshot.is_empty()
                || pending.snapshot.len() > MAX_MLS_CLIENT_SNAPSHOT_BYTES
                || !pending_relationships.insert(pending.relationship_id.as_str())
                || !relationship_ids.contains(pending.relationship_id.as_str())
            {
                return Err(PeerError::Rollback(
                    "durable pending MLS client state is invalid".into(),
                ));
            }
        }
        let mut mls_relationships = BTreeSet::new();
        for mls in &self.mls_relationships {
            mls.state_id.validate()?;
            mls.inbound_replay.validate()?;
            if !mls_relationships.insert(mls.relationship_id.as_str())
                || !relationship_ids.contains(mls.relationship_id.as_str())
            {
                return Err(PeerError::Rollback(
                    "durable MLS relationship binding is invalid".into(),
                ));
            }
            if self
                .mls_states
                .binary_search_by_key(&mls.state_id, |(state_id, _)| *state_id)
                .is_err()
                || self
                    .mls_checkpoints
                    .binary_search_by_key(&mls.state_id, |(state_id, _)| *state_id)
                    .is_err()
            {
                return Err(PeerError::Rollback(
                    "MLS relationship has no matching embedded state".into(),
                ));
            }
        }
        let mut outbox_ids = BTreeSet::new();
        for outbound in &self.transport_outbox {
            outbound.packet.validate()?;
            outbound.expected_receiver.validate()?;
            if outbound.endpoints.is_empty()
                || outbound.endpoints.len() > 8
                || outbound.attempts > MAX_TRANSPORT_ATTEMPTS
                || !outbox_ids.insert(outbound.packet.packet_id)
            {
                return Err(PeerError::Rollback(
                    "durable transport outbox entry is invalid".into(),
                ));
            }
            validate_canonical_endpoints(&outbound.endpoints)?;
            if outbound.endpoints.iter().any(|endpoint| {
                !matches!(
                    endpoint,
                    EndpointDescriptor::Direct(_)
                        | EndpointDescriptor::Iroh(IrohEndpointDescriptor {
                            relay_origin: None,
                            ..
                        })
                        | EndpointDescriptor::Tor(_)
                        | EndpointDescriptor::HttpMailbox(_)
                )
            }) {
                return Err(PeerError::Rollback(
                    "durable outbox contains a non-operational endpoint".into(),
                ));
            }
            if outbound
                .relationship_id
                .as_ref()
                .is_some_and(|id| !relationship_ids.contains(id.as_str()))
            {
                return Err(PeerError::Rollback(
                    "transport outbox references an unknown relationship".into(),
                ));
            }
        }
        let mut inbound_ids = BTreeSet::new();
        let mut pending_message_ids = BTreeSet::new();
        for pending in &self.pending_applications {
            pending.message_id.validate()?;
            pending.message.validate()?;
            if pending.created_at >= pending.expires_at
                || pending.expires_at - pending.created_at > 24 * 60 * 60
                || !relationship_ids.contains(pending.relationship_id.as_str())
                || !pending_message_ids.insert(pending.message_id.0)
            {
                return Err(PeerError::Rollback(
                    "durable pending application is invalid".into(),
                ));
            }
        }
        for inbound in &self.inbound_receipts {
            inbound.acknowledgement.validate()?;
            if inbound.packet_id == [0; 16]
                || inbound.packet_hash == [0; 32]
                || inbound.acknowledgement.body.packet_id != inbound.packet_id
                || inbound.acknowledgement.body.packet_hash != inbound.packet_hash
                || !inbound_ids.insert(inbound.packet_id)
            {
                return Err(PeerError::Rollback(
                    "durable inbound transport receipt is invalid".into(),
                ));
            }
        }
        let mut query_ids = BTreeSet::new();
        for exchange in &self.query_exchanges {
            exchange.query_id.validate()?;
            exchange.grant_id.validate()?;
            exchange.projection.validate()?;
            if exchange.requested_at >= exchange.expires_at
                || exchange.grant_sequence == 0
                || !query_ids.insert(exchange.query_id.0)
                || !relationship_ids.contains(exchange.relationship_id.as_str())
            {
                return Err(PeerError::Rollback(
                    "durable query exchange is invalid".into(),
                ));
            }
            if let Some(response) = &exchange.response {
                response.validate()?;
                if response.query_id != exchange.query_id {
                    return Err(PeerError::Rollback(
                        "query response does not match its durable exchange".into(),
                    ));
                }
            }
        }
        let mut inbound_query_ids = BTreeSet::new();
        for query in &self.inbound_queries {
            query.query_id.validate()?;
            if query.request_hash == [0; 32] || !inbound_query_ids.insert(query.query_id.0) {
                return Err(PeerError::Rollback(
                    "durable inbound query replay state is invalid".into(),
                ));
            }
            let Some(request) = query.request() else {
                if query.relationship_id.is_some()
                    || query.grant_id.is_some()
                    || query.rule_id.is_some()
                    || query.grant_verification_id.is_some()
                    || query.verified_grant_hash.is_some()
                    || !query.effective_fields.is_empty()
                    || !query.redacted_fields.is_empty()
                    || query.maximum_result_count != 0
                    || query.maximum_payload_bytes != 0
                    || query.requester_device_id.is_some()
                    || query.requester_certificate_hash.is_some()
                    || query.received_at != 0
                    || query.expires_at != 0
                    || query.claim.is_some()
                    || query.response_message_id.is_some()
                {
                    return Err(PeerError::Rollback(
                        "legacy inbound query tombstone contains active bridge state".into(),
                    ));
                }
                continue;
            };
            request.validate()?;
            if request.query_id != query.query_id
                || query
                    .relationship_id
                    .as_ref()
                    .is_none_or(|relationship_id| {
                        !relationship_ids.contains(relationship_id.as_str())
                    })
                || query.grant_id.as_ref().is_none_or(|grant_id| {
                    validate_text(grant_id, 1, MAX_TEXT_BYTES, "inbound query grant id").is_err()
                })
                || query.rule_id.as_ref().is_none_or(|rule_id| {
                    validate_text(rule_id, 1, MAX_TEXT_BYTES, "inbound query rule id").is_err()
                })
                || query
                    .grant_verification_id
                    .as_ref()
                    .is_none_or(|value| !value.starts_with("fpv_") || value.len() != 36)
                || query.verified_grant_hash.as_ref().is_none_or(|value| {
                    validate_sha256_hex(value, "inbound verified grant hash").is_err()
                })
                || query.effective_fields.is_empty()
                || query.effective_fields.len() > MAX_QUERY_FIELDS
                || query.redacted_fields.len() > MAX_QUERY_FIELDS
                || query
                    .effective_fields
                    .iter()
                    .enumerate()
                    .any(|(index, field)| query.effective_fields[..index].contains(field))
                || query
                    .redacted_fields
                    .iter()
                    .enumerate()
                    .any(|(index, field)| {
                        query.redacted_fields[..index].contains(field)
                            || query.effective_fields.contains(field)
                    })
                || query.maximum_result_count == 0
                || usize::from(query.maximum_result_count) > MAX_QUERY_RECORDS
                || !(256..=MAX_WIRE_QUERY_RESPONSE_BYTES).contains(&query.maximum_payload_bytes)
                || query.requester_device_id.is_none()
                || query
                    .requester_certificate_hash
                    .is_none_or(|hash| hash == [0; 32])
                || query.received_at == 0
                || query.received_at > request.expires_at
                || query.expires_at != request.expires_at
            {
                return Err(PeerError::Rollback(
                    "durable inbound query bridge binding is invalid".into(),
                ));
            }
            if let Some(claim) = &query.claim
                && (claim.claim_id == [0; 16]
                    || validate_text(&claim.worker_id, 1, MAX_TEXT_BYTES, "query worker id")
                        .is_err()
                    || claim.claimed_at < query.received_at
                    || claim.claimed_at >= claim.lease_expires_at
                    || claim.lease_expires_at > query.expires_at)
            {
                return Err(PeerError::Rollback(
                    "durable inbound query claim is invalid".into(),
                ));
            }
            if let Some(message_id) = query.response_message_id {
                message_id.validate()?;
                if query.claim.is_none() {
                    return Err(PeerError::Rollback(
                        "durable inbound query response has no worker claim".into(),
                    ));
                }
            }
        }
        for projection in &self.projection_deltas {
            projection.validate()?;
        }
        if let Some(rotation) = &self.host_credential_rotation {
            if rotation.started_at == 0
                || rotation.successor_identity.is_empty()
                || rotation.successor_identity.len() > 1024 * 1024
                || rotation.relationships.is_empty()
                || rotation.relationships.len() > MAX_RELATIONSHIPS
            {
                return Err(PeerError::Rollback(
                    "durable host credential rotation header is invalid".into(),
                ));
            }
            validate_certificate_successor(
                &rotation.predecessor_certificate,
                &rotation.successor_certificate,
                rotation.started_at,
            )?;
            let successor = LocalIdentityState::decode_secret(&rotation.successor_identity)?;
            if successor.certificate() != &rotation.successor_certificate {
                return Err(PeerError::Rollback(
                    "durable host credential rotation secret does not match its certificate".into(),
                ));
            }
            let active_relationships = self
                .relationships
                .iter()
                .filter(|relationship| relationship.status == RelationshipStatus::Active)
                .map(|relationship| relationship.id.as_str())
                .collect::<BTreeSet<_>>();
            let mut rotated_relationships = BTreeSet::new();
            for relationship_rotation in &rotation.relationships {
                if relationship_rotation.packet_id == [0; 16]
                    || relationship_rotation.packet_hash == [0; 32]
                    || !rotated_relationships.insert(relationship_rotation.relationship_id.as_str())
                {
                    return Err(PeerError::Rollback(
                        "durable relationship credential rotation is invalid".into(),
                    ));
                }
                let relationship = self
                    .relationships
                    .iter()
                    .find(|relationship| relationship.id == relationship_rotation.relationship_id)
                    .ok_or_else(|| {
                        PeerError::Rollback(
                            "credential rotation references an unknown relationship".into(),
                        )
                    })?;
                if relationship.status != RelationshipStatus::Active
                    || relationship.local_certificate != rotation.predecessor_certificate
                {
                    return Err(PeerError::Rollback(
                        "credential rotation relationship has the wrong predecessor".into(),
                    ));
                }
                let matching_outbox = self.transport_outbox.iter().any(|outbound| {
                    outbound.packet.packet_id == relationship_rotation.packet_id
                        && outbound
                            .packet
                            .hash()
                            .is_ok_and(|hash| hash == relationship_rotation.packet_hash)
                        && outbound.relationship_id.as_deref()
                            == Some(relationship_rotation.relationship_id.as_str())
                });
                if relationship_rotation.acknowledged == matching_outbox {
                    return Err(PeerError::Rollback(
                        "credential rotation acknowledgement/outbox state is inconsistent".into(),
                    ));
                }
            }
            if active_relationships != rotated_relationships {
                return Err(PeerError::Rollback(
                    "credential rotation does not cover every active relationship".into(),
                ));
            }
        }
        Ok(())
    }
}

impl Validate for PreRotationDaemonState {
    fn validate(&self) -> Result<()> {
        if self.version != PRE_ROTATION_DAEMON_STATE_VERSION {
            return Err(PeerError::Version(
                "unsupported pre-rotation daemon state version".into(),
            ));
        }
        DurableDaemonState::from_pre_rotation(self.clone()).validate()
    }
}

impl Validate for PreMailboxDaemonState {
    fn validate(&self) -> Result<()> {
        if self.version != PRE_MAILBOX_DAEMON_STATE_VERSION {
            return Err(PeerError::Version(
                "unsupported pre-mailbox daemon state version".into(),
            ));
        }
        DurableDaemonState::from_pre_mailbox(self.clone()).validate()
    }
}

impl Validate for PreQueryBridgeDaemonState {
    fn validate(&self) -> Result<()> {
        if self.version != PRE_QUERY_BRIDGE_DAEMON_STATE_VERSION {
            return Err(PeerError::Version(
                "unsupported pre-query-bridge daemon state version".into(),
            ));
        }
        DurableDaemonState::from_pre_query_bridge(self.clone()).validate()
    }
}

impl Validate for LegacyDurableDaemonState {
    fn validate(&self) -> Result<()> {
        if self.version != LEGACY_DAEMON_STATE_VERSION {
            return Err(PeerError::Version(
                "unsupported legacy daemon state version".into(),
            ));
        }
        validate_text(&self.owner_user_id, 1, MAX_TEXT_BYTES, "owner user id")?;
        if self.invitations.len() > MAX_INVITATIONS
            || self.pairings.len() > MAX_PAIRINGS
            || self.relationships.len() > MAX_RELATIONSHIPS
            || self.query_results.len() > MAX_QUERY_RESULTS
            || self.command_receipts.len() > 4_096
            || self
                .relationships
                .iter()
                .any(|relationship| relationship.grants.len() > MAX_GRANTS_PER_RELATIONSHIP)
        {
            return Err(limit(
                "legacy durable daemon state exceeds collection limits",
            ));
        }
        Ok(())
    }
}

impl Validate for IdentityBoundaryDaemonState {
    fn validate(&self) -> Result<()> {
        if self.version != IDENTITY_BOUNDARY_DAEMON_STATE_VERSION {
            return Err(PeerError::Version(
                "unsupported identity-boundary daemon state version".into(),
            ));
        }
        validate_text(&self.owner_user_id, 1, MAX_TEXT_BYTES, "owner user id")?;
        if self.invitations.len() > MAX_INVITATIONS
            || self.pairings.len() > MAX_PAIRINGS
            || self.relationships.len() > MAX_RELATIONSHIPS
            || self.query_results.len() > MAX_QUERY_RESULTS
            || self.accepted_pending_requests.len() > MAX_PENDING_DECISIONS
            || self.grant_revocations.len() > MAX_GRANT_REVOCATIONS
            || self.mls_states.len() > MAX_RELATIONSHIPS
            || self.mls_checkpoints.len() > MAX_RELATIONSHIPS
            || self.pending_mls_clients.len() > MAX_PENDING_MLS_CLIENTS
            || self.mls_relationships.len() > MAX_RELATIONSHIPS
            || self.transport_outbox.len() > MAX_TRANSPORT_OUTBOX
            || self.pending_applications.len() > MAX_TRANSPORT_OUTBOX
            || self.inbound_receipts.len() > MAX_INBOUND_RECEIPTS
            || self.query_exchanges.len() > MAX_QUERY_EXCHANGES
            || self.inbound_queries.len() > MAX_QUERY_EXCHANGES
            || self.projection_deltas.len() > MAX_QUERY_RESULTS
            || self.command_receipts.len() > 4_096
            || self
                .relationships
                .iter()
                .any(|relationship| relationship.grants.len() > MAX_GRANTS_PER_RELATIONSHIP)
        {
            return Err(limit(
                "identity-boundary daemon state exceeds collection limits",
            ));
        }
        for relationship in &self.relationships {
            relationship.remote_certificate.validate()?;
            validate_canonical_endpoints(&relationship.local_endpoints)?;
            validate_canonical_endpoints(&relationship.remote_endpoints)?;
        }
        Ok(())
    }
}

impl Validate for PreviousDurableDaemonState {
    fn validate(&self) -> Result<()> {
        if self.version != PREVIOUS_DAEMON_STATE_VERSION {
            return Err(PeerError::Version(
                "unsupported previous daemon state version".into(),
            ));
        }
        validate_text(&self.owner_user_id, 1, MAX_TEXT_BYTES, "owner user id")?;
        if self.invitations.len() > MAX_INVITATIONS
            || self.pairings.len() > MAX_PAIRINGS
            || self.relationships.len() > MAX_RELATIONSHIPS
            || self.query_results.len() > MAX_QUERY_RESULTS
            || self.accepted_pending_requests.len() > MAX_PENDING_DECISIONS
            || self.grant_revocations.len() > MAX_GRANT_REVOCATIONS
            || self.command_receipts.len() > 4_096
            || self
                .relationships
                .iter()
                .any(|relationship| relationship.grants.len() > MAX_GRANTS_PER_RELATIONSHIP)
        {
            return Err(limit(
                "previous durable daemon state exceeds collection limits",
            ));
        }
        Ok(())
    }
}

impl Validate for EndpointDurableDaemonState {
    fn validate(&self) -> Result<()> {
        if self.version != ENDPOINT_DAEMON_STATE_VERSION {
            return Err(PeerError::Version(
                "unsupported endpoint daemon state version".into(),
            ));
        }
        validate_text(&self.owner_user_id, 1, MAX_TEXT_BYTES, "owner user id")?;
        if self.invitations.len() > MAX_INVITATIONS
            || self.pairings.len() > MAX_PAIRINGS
            || self.relationships.len() > MAX_RELATIONSHIPS
            || self.query_results.len() > MAX_QUERY_RESULTS
            || self.accepted_pending_requests.len() > MAX_PENDING_DECISIONS
            || self.grant_revocations.len() > MAX_GRANT_REVOCATIONS
            || self.command_receipts.len() > 4_096
            || self
                .relationships
                .iter()
                .any(|relationship| relationship.grants.len() > MAX_GRANTS_PER_RELATIONSHIP)
        {
            return Err(limit(
                "endpoint durable daemon state exceeds collection limits",
            ));
        }
        for relationship in &self.relationships {
            validate_canonical_endpoints(&relationship.local_endpoints)?;
            validate_canonical_endpoints(&relationship.remote_endpoints)?;
        }
        Ok(())
    }
}

fn migrate_legacy_relationship(
    relationship: LegacyStoredRelationship,
    local_certificate: &DeviceCertificate,
) -> StoredRelationship {
    StoredRelationship {
        id: relationship.id,
        local_certificate: local_certificate.clone(),
        remote_certificate: relationship.remote_certificate,
        local_certificate_history: Vec::new(),
        remote_certificate_history: Vec::new(),
        status: relationship.status,
        privacy_mode: relationship.privacy_mode,
        verification_phrase_hash: relationship.verification_phrase_hash,
        local_endpoints: Vec::new(),
        remote_endpoints: Vec::new(),
        mailbox_secret: None,
        devices: relationship.devices,
        grants: relationship.grants,
        outbound_sequence: relationship.outbound_sequence,
        revoked_reason: relationship.revoked_reason,
    }
}

fn migrate_pre_mailbox_relationship(
    relationship: PreMailboxStoredRelationship,
) -> StoredRelationship {
    StoredRelationship {
        id: relationship.id,
        local_certificate: relationship.local_certificate,
        remote_certificate: relationship.remote_certificate,
        local_certificate_history: Vec::new(),
        remote_certificate_history: Vec::new(),
        status: relationship.status,
        privacy_mode: relationship.privacy_mode,
        verification_phrase_hash: relationship.verification_phrase_hash,
        local_endpoints: relationship.local_endpoints,
        remote_endpoints: relationship.remote_endpoints,
        mailbox_secret: None,
        devices: relationship.devices,
        grants: relationship.grants,
        outbound_sequence: relationship.outbound_sequence,
        revoked_reason: relationship.revoked_reason,
    }
}

fn migrate_identity_boundary_relationship(
    relationship: IdentityBoundaryStoredRelationship,
    local_certificate: &DeviceCertificate,
) -> StoredRelationship {
    StoredRelationship {
        id: relationship.id,
        local_certificate: local_certificate.clone(),
        remote_certificate: relationship.remote_certificate,
        local_certificate_history: Vec::new(),
        remote_certificate_history: Vec::new(),
        status: relationship.status,
        privacy_mode: relationship.privacy_mode,
        verification_phrase_hash: relationship.verification_phrase_hash,
        local_endpoints: relationship.local_endpoints,
        remote_endpoints: relationship.remote_endpoints,
        mailbox_secret: None,
        devices: relationship.devices,
        grants: relationship.grants,
        outbound_sequence: relationship.outbound_sequence,
        revoked_reason: relationship.revoked_reason,
    }
}

impl DurableDaemonState {
    fn from_pre_mailbox(previous: PreMailboxDaemonState) -> Self {
        Self {
            version: DAEMON_STATE_VERSION,
            owner_user_id: previous.owner_user_id,
            high_water_unix_time: previous.high_water_unix_time,
            invitations: previous.invitations,
            pairings: previous.pairings,
            relationships: previous
                .relationships
                .into_iter()
                .map(migrate_pre_mailbox_relationship)
                .collect(),
            query_results: previous.query_results,
            accepted_pending_requests: previous.accepted_pending_requests,
            grant_revocations: previous.grant_revocations,
            mls_states: previous.mls_states,
            mls_checkpoints: previous.mls_checkpoints,
            pending_mls_clients: previous.pending_mls_clients,
            mls_relationships: previous.mls_relationships,
            transport_outbox: previous.transport_outbox,
            pending_applications: previous.pending_applications,
            inbound_receipts: previous.inbound_receipts,
            query_exchanges: previous.query_exchanges,
            inbound_queries: previous.inbound_queries,
            projection_deltas: previous.projection_deltas,
            revocation_events: previous.revocation_events,
            revocation_consumers: previous.revocation_consumers,
            host_credential_rotation: previous.host_credential_rotation,
            command_receipts: previous.command_receipts,
        }
    }

    fn from_pre_query_bridge(previous: PreQueryBridgeDaemonState) -> Self {
        Self {
            version: DAEMON_STATE_VERSION,
            owner_user_id: previous.owner_user_id,
            high_water_unix_time: previous.high_water_unix_time,
            invitations: previous.invitations,
            pairings: previous.pairings,
            relationships: previous
                .relationships
                .into_iter()
                .map(migrate_pre_mailbox_relationship)
                .collect(),
            query_results: previous.query_results,
            accepted_pending_requests: previous.accepted_pending_requests,
            grant_revocations: previous.grant_revocations,
            mls_states: previous.mls_states,
            mls_checkpoints: previous.mls_checkpoints,
            pending_mls_clients: previous.pending_mls_clients,
            mls_relationships: previous.mls_relationships,
            transport_outbox: previous.transport_outbox,
            pending_applications: previous.pending_applications,
            inbound_receipts: previous.inbound_receipts,
            query_exchanges: previous.query_exchanges,
            inbound_queries: previous
                .inbound_queries
                .into_iter()
                .map(StoredInboundQuery::legacy)
                .collect(),
            projection_deltas: previous.projection_deltas,
            revocation_events: Vec::new(),
            revocation_consumers: Vec::new(),
            host_credential_rotation: previous.host_credential_rotation,
            command_receipts: previous.command_receipts,
        }
    }

    fn from_pre_rotation(previous: PreRotationDaemonState) -> Self {
        Self {
            version: DAEMON_STATE_VERSION,
            owner_user_id: previous.owner_user_id,
            high_water_unix_time: previous.high_water_unix_time,
            invitations: previous.invitations,
            pairings: previous.pairings,
            relationships: previous
                .relationships
                .into_iter()
                .map(migrate_pre_mailbox_relationship)
                .collect(),
            query_results: previous.query_results,
            accepted_pending_requests: previous.accepted_pending_requests,
            grant_revocations: previous.grant_revocations,
            mls_states: previous.mls_states,
            mls_checkpoints: previous.mls_checkpoints,
            pending_mls_clients: previous.pending_mls_clients,
            mls_relationships: previous.mls_relationships,
            transport_outbox: previous.transport_outbox,
            pending_applications: previous.pending_applications,
            inbound_receipts: previous.inbound_receipts,
            query_exchanges: previous.query_exchanges,
            inbound_queries: previous
                .inbound_queries
                .into_iter()
                .map(StoredInboundQuery::legacy)
                .collect(),
            projection_deltas: previous.projection_deltas,
            revocation_events: Vec::new(),
            revocation_consumers: Vec::new(),
            host_credential_rotation: None,
            command_receipts: previous.command_receipts,
        }
    }

    fn from_legacy(legacy: LegacyDurableDaemonState, local: &DeviceCertificate) -> Self {
        Self {
            version: DAEMON_STATE_VERSION,
            owner_user_id: legacy.owner_user_id,
            high_water_unix_time: legacy.high_water_unix_time,
            invitations: legacy.invitations,
            pairings: legacy.pairings,
            relationships: legacy
                .relationships
                .into_iter()
                .map(|relationship| migrate_legacy_relationship(relationship, local))
                .collect(),
            query_results: legacy.query_results,
            accepted_pending_requests: Vec::new(),
            grant_revocations: Vec::new(),
            mls_states: Vec::new(),
            mls_checkpoints: Vec::new(),
            pending_mls_clients: Vec::new(),
            mls_relationships: Vec::new(),
            transport_outbox: Vec::new(),
            pending_applications: Vec::new(),
            inbound_receipts: Vec::new(),
            query_exchanges: Vec::new(),
            inbound_queries: Vec::new(),
            projection_deltas: Vec::new(),
            revocation_events: Vec::new(),
            revocation_consumers: Vec::new(),
            host_credential_rotation: None,
            command_receipts: legacy.command_receipts,
        }
    }

    fn from_previous(previous: PreviousDurableDaemonState, local: &DeviceCertificate) -> Self {
        Self {
            version: DAEMON_STATE_VERSION,
            owner_user_id: previous.owner_user_id,
            high_water_unix_time: previous.high_water_unix_time,
            invitations: previous.invitations,
            pairings: previous.pairings,
            relationships: previous
                .relationships
                .into_iter()
                .map(|relationship| migrate_legacy_relationship(relationship, local))
                .collect(),
            query_results: previous.query_results,
            accepted_pending_requests: previous.accepted_pending_requests,
            grant_revocations: previous.grant_revocations,
            mls_states: Vec::new(),
            mls_checkpoints: Vec::new(),
            pending_mls_clients: Vec::new(),
            mls_relationships: Vec::new(),
            transport_outbox: Vec::new(),
            pending_applications: Vec::new(),
            inbound_receipts: Vec::new(),
            query_exchanges: Vec::new(),
            inbound_queries: Vec::new(),
            projection_deltas: Vec::new(),
            revocation_events: Vec::new(),
            revocation_consumers: Vec::new(),
            host_credential_rotation: None,
            command_receipts: previous.command_receipts,
        }
    }

    fn from_endpoint(previous: EndpointDurableDaemonState, local: &DeviceCertificate) -> Self {
        Self {
            version: DAEMON_STATE_VERSION,
            owner_user_id: previous.owner_user_id,
            high_water_unix_time: previous.high_water_unix_time,
            invitations: previous.invitations,
            pairings: previous.pairings,
            relationships: previous
                .relationships
                .into_iter()
                .map(|relationship| migrate_identity_boundary_relationship(relationship, local))
                .collect(),
            query_results: previous.query_results,
            accepted_pending_requests: previous.accepted_pending_requests,
            grant_revocations: previous.grant_revocations,
            mls_states: Vec::new(),
            mls_checkpoints: Vec::new(),
            pending_mls_clients: Vec::new(),
            mls_relationships: Vec::new(),
            transport_outbox: Vec::new(),
            pending_applications: Vec::new(),
            inbound_receipts: Vec::new(),
            query_exchanges: Vec::new(),
            inbound_queries: Vec::new(),
            projection_deltas: Vec::new(),
            revocation_events: Vec::new(),
            revocation_consumers: Vec::new(),
            host_credential_rotation: None,
            command_receipts: previous.command_receipts,
        }
    }

    fn from_identity_boundary(
        previous: IdentityBoundaryDaemonState,
        local: &DeviceCertificate,
    ) -> Self {
        Self {
            version: DAEMON_STATE_VERSION,
            owner_user_id: previous.owner_user_id,
            high_water_unix_time: previous.high_water_unix_time,
            invitations: previous.invitations,
            pairings: previous.pairings,
            relationships: previous
                .relationships
                .into_iter()
                .map(|relationship| migrate_identity_boundary_relationship(relationship, local))
                .collect(),
            query_results: previous.query_results,
            accepted_pending_requests: previous.accepted_pending_requests,
            grant_revocations: previous.grant_revocations,
            mls_states: previous.mls_states,
            mls_checkpoints: previous.mls_checkpoints,
            pending_mls_clients: previous.pending_mls_clients,
            mls_relationships: previous.mls_relationships,
            transport_outbox: previous.transport_outbox,
            pending_applications: previous.pending_applications,
            inbound_receipts: previous.inbound_receipts,
            query_exchanges: previous.query_exchanges,
            inbound_queries: previous
                .inbound_queries
                .into_iter()
                .map(StoredInboundQuery::legacy)
                .collect(),
            projection_deltas: previous.projection_deltas,
            revocation_events: Vec::new(),
            revocation_consumers: Vec::new(),
            host_credential_rotation: None,
            command_receipts: previous.command_receipts,
        }
    }
}

fn validate_operational_identity_binding(
    state: &DurableDaemonState,
    local: &DeviceCertificate,
    now: u64,
) -> Result<()> {
    for invitation in &state.invitations {
        if !invitation.consumed
            && now
                <= invitation
                    .bundle
                    .signed_invite
                    .body
                    .expires_at
                    .saturating_add(MAX_CLOCK_SKEW_SECONDS)
            && invitation.bundle.signed_invite.body.inviter_device != *local
        {
            return Err(PeerError::Authorization(
                "live invitation is bound to a different local certificate".into(),
            ));
        }
    }
    for pairing in &state.pairings {
        if pairing.confirmed_relationship_id.is_none()
            && now
                <= pairing
                    .transcript_body
                    .expires_at
                    .saturating_add(MAX_CLOCK_SKEW_SECONDS)
            && pairing.transcript_body.accepter_device != *local
        {
            return Err(PeerError::Authorization(
                "pending pairing is bound to a different local certificate".into(),
            ));
        }
    }
    let active_identity_mismatch = state.relationships.iter().any(|relationship| {
        relationship.status == RelationshipStatus::Active
            && relationship.local_certificate != *local
    });
    let completing_rotation = state
        .host_credential_rotation
        .as_ref()
        .is_some_and(|rotation| {
            rotation.relationships.iter().all(|item| item.acknowledged)
                && rotation.successor_certificate == *local
                && state.relationships.iter().all(|relationship| {
                    relationship.status != RelationshipStatus::Active
                        || relationship.local_certificate == rotation.predecessor_certificate
                })
        });
    if active_identity_mismatch && !completing_rotation {
        return Err(PeerError::Authorization(
            "active relationships require an authenticated MLS identity rotation before the local certificate can change"
                .into(),
        ));
    }
    Ok(())
}

struct EmbeddedMlsBackend {
    states: Mutex<BTreeMap<StateId, PersistedMlsState>>,
    checkpoints: Mutex<BTreeMap<StateId, CheckpointRecord>>,
}

type EmbeddedMlsSnapshot = (
    Vec<(StateId, PersistedMlsState)>,
    Vec<(StateId, CheckpointRecord)>,
);
type EmbeddedMlsCoordinator =
    PersistedStateCoordinator<Arc<EmbeddedMlsBackend>, Arc<EmbeddedMlsBackend>, XChaChaStateSealer>;

impl EmbeddedMlsBackend {
    fn from_state(state: &DurableDaemonState) -> Result<Self> {
        let states = state.mls_states.iter().cloned().collect::<BTreeMap<_, _>>();
        let checkpoints = state
            .mls_checkpoints
            .iter()
            .cloned()
            .collect::<BTreeMap<_, _>>();
        if states.len() != state.mls_states.len()
            || checkpoints.len() != state.mls_checkpoints.len()
        {
            return Err(PeerError::Rollback(
                "embedded MLS state contains duplicate identifiers".into(),
            ));
        }
        Ok(Self {
            states: Mutex::new(states),
            checkpoints: Mutex::new(checkpoints),
        })
    }

    fn snapshot(&self) -> Result<EmbeddedMlsSnapshot> {
        let states = self
            .states
            .lock()
            .map_err(|_| PeerError::StateConflict("embedded MLS state lock poisoned".into()))?
            .iter()
            .map(|(id, state)| (*id, state.clone()))
            .collect();
        let checkpoints = self
            .checkpoints
            .lock()
            .map_err(|_| PeerError::StateConflict("embedded MLS checkpoint lock poisoned".into()))?
            .iter()
            .map(|(id, checkpoint)| (*id, checkpoint.clone()))
            .collect();
        Ok((states, checkpoints))
    }
}

impl MlsStateStore for Arc<EmbeddedMlsBackend> {
    fn load(&self, state_id: StateId) -> Result<Option<PersistedMlsState>> {
        state_id.validate()?;
        Ok(self
            .states
            .lock()
            .map_err(|_| PeerError::StateConflict("embedded MLS state lock poisoned".into()))?
            .get(&state_id)
            .cloned())
    }

    fn compare_and_swap(
        &self,
        state_id: StateId,
        expected_store_revision: u64,
        mut next: PersistedMlsState,
    ) -> Result<bool> {
        state_id.validate()?;
        next.validate()?;
        let mut states = self
            .states
            .lock()
            .map_err(|_| PeerError::StateConflict("embedded MLS state lock poisoned".into()))?;
        if states
            .get(&state_id)
            .map_or(0, |state| state.store_revision)
            != expected_store_revision
        {
            return Ok(false);
        }
        next.store_revision = expected_store_revision
            .checked_add(1)
            .ok_or_else(|| PeerError::StateConflict("MLS state revision overflow".into()))?;
        states.insert(state_id, next);
        Ok(true)
    }
}

impl AntiRollbackCheckpointStore for Arc<EmbeddedMlsBackend> {
    fn load(&self, state_id: StateId) -> Result<CheckpointRecord> {
        state_id.validate()?;
        Ok(self
            .checkpoints
            .lock()
            .map_err(|_| PeerError::StateConflict("embedded MLS checkpoint lock poisoned".into()))?
            .get(&state_id)
            .cloned()
            .unwrap_or_default())
    }

    fn compare_and_swap(
        &self,
        state_id: StateId,
        expected_secure_revision: u64,
        mut next: CheckpointRecord,
    ) -> Result<bool> {
        state_id.validate()?;
        next.validate()?;
        let mut checkpoints = self.checkpoints.lock().map_err(|_| {
            PeerError::StateConflict("embedded MLS checkpoint lock poisoned".into())
        })?;
        if checkpoints
            .get(&state_id)
            .map_or(0, |checkpoint| checkpoint.secure_revision)
            != expected_secure_revision
        {
            return Ok(false);
        }
        next.secure_revision = expected_secure_revision
            .checked_add(1)
            .ok_or_else(|| PeerError::StateConflict("MLS checkpoint revision overflow".into()))?;
        checkpoints.insert(state_id, next);
        Ok(true)
    }
}

pub struct DaemonConfig {
    pub owner_user_id: String,
    pub endpoints: Vec<EndpointDescriptor>,
    pub allow_loopback_direct: bool,
    pub command_authority: Option<NodeCommandAuthority>,
}

pub struct DurableDaemonHandler {
    identity: ArcSwap<LocalIdentityState>,
    directory: Arc<SecureDirectory>,
    _lock: SecureFileLock,
    endpoints: BoundedVec<EndpointDescriptor, 8>,
    allow_loopback_direct: bool,
    state_key: Zeroizing<[u8; 32]>,
    mls_state_key: Zeroizing<[u8; 32]>,
    mls_lock: Mutex<()>,
    state: Mutex<DurableDaemonState>,
    command_lock: Mutex<()>,
    staged_state: Mutex<Option<StagedDaemonState>>,
    transport_readiness: ProviderReadinessRegistry,
    command_authority: Option<NodeCommandAuthority>,
}

struct StagedDaemonState {
    owner: std::thread::ThreadId,
    state: DurableDaemonState,
}

impl DurableDaemonHandler {
    pub fn ensure_local_identity_rotation_allowed(
        state_directory: impl AsRef<std::path::Path>,
        identity: &LocalIdentityState,
        now: u64,
    ) -> Result<()> {
        let directory = SecureDirectory::open_or_create(state_directory)?;
        let _lock = directory.try_lock_exclusive(DAEMON_LOCK_FILE)?;
        let sealed = match directory.read_secret(DAEMON_STATE_FILE) {
            Ok(bytes) => bytes,
            Err(PeerError::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(());
            }
            Err(error) => return Err(error),
        };
        let requires_upgrade = sealed.get(..DAEMON_STATE_MAGIC.len()) != Some(DAEMON_STATE_MAGIC);
        let state_key = identity.derive_storage_key("durable daemon state")?;
        let state = open_state(&state_key, identity.certificate(), &sealed)?;
        state.validate()?;
        validate_operational_identity_binding(&state, identity.certificate(), now)?;
        if state
            .relationships
            .iter()
            .any(|relationship| relationship.status == RelationshipStatus::Active)
            || state.invitations.iter().any(|invitation| {
                !invitation.consumed
                    && now
                        <= invitation
                            .bundle
                            .signed_invite
                            .body
                            .expires_at
                            .saturating_add(MAX_CLOCK_SKEW_SECONDS)
            })
            || state.pairings.iter().any(|pairing| {
                pairing.confirmed_relationship_id.is_none()
                    && now
                        <= pairing
                            .transcript_body
                            .expires_at
                            .saturating_add(MAX_CLOCK_SKEW_SECONDS)
            })
            || !state.pending_mls_clients.is_empty()
            || state
                .pending_applications
                .iter()
                .any(|pending| pending.expires_at > now)
            || state
                .transport_outbox
                .iter()
                .any(|outbound| outbound.packet.expires_at > now)
        {
            return Err(PeerError::Authorization(
                "identity rotation is blocked while invitations, pairings, or relationships are live; revoke or let them expire before rotating"
                    .into(),
            ));
        }
        if requires_upgrade {
            let encoded = encode_limited::<DAEMON_STATE_LIMIT, _>(&state)?;
            let sealed = seal_state(&state_key, identity.certificate(), &encoded)?;
            directory.atomic_write_secret(DAEMON_STATE_FILE, &sealed)?;
        }
        Ok(())
    }

    pub fn open(
        state_directory: impl AsRef<std::path::Path>,
        identity: LocalIdentityState,
        config: DaemonConfig,
    ) -> Result<Self> {
        validate_text(&config.owner_user_id, 1, MAX_TEXT_BYTES, "owner user id")?;
        let startup_time = unix_time()?;
        identity.ensure_operational(startup_time)?;
        let endpoints = BoundedVec::new(canonicalize_endpoints(config.endpoints)?)?;
        validate_direct_endpoint_policy(endpoints.as_slice(), config.allow_loopback_direct)?;
        if endpoints
            .as_slice()
            .iter()
            .filter(|endpoint| matches!(endpoint, EndpointDescriptor::HttpMailbox(_)))
            .count()
            > 1
        {
            return Err(limit(
                "daemon supports exactly one configured HTTPS mailbox provider",
            ));
        }
        if endpoints.is_empty() {
            return Err(invalid(
                "daemon requires at least one locally configured endpoint",
            ));
        }
        let directory = Arc::new(SecureDirectory::open_or_create(state_directory)?);
        let lock = directory.try_lock_exclusive(DAEMON_LOCK_FILE)?;
        let state_key = identity.derive_storage_key("durable daemon state")?;
        let mls_state_key = identity.derive_storage_key("durable OpenMLS state")?;
        let state = match directory.read_secret(DAEMON_STATE_FILE) {
            Ok(bytes) => open_state(&state_key, identity.certificate(), &bytes)?,
            Err(PeerError::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => {
                DurableDaemonState {
                    version: DAEMON_STATE_VERSION,
                    owner_user_id: config.owner_user_id.clone(),
                    high_water_unix_time: startup_time,
                    invitations: Vec::new(),
                    pairings: Vec::new(),
                    relationships: Vec::new(),
                    query_results: Vec::new(),
                    accepted_pending_requests: Vec::new(),
                    grant_revocations: Vec::new(),
                    mls_states: Vec::new(),
                    mls_checkpoints: Vec::new(),
                    pending_mls_clients: Vec::new(),
                    mls_relationships: Vec::new(),
                    transport_outbox: Vec::new(),
                    pending_applications: Vec::new(),
                    inbound_receipts: Vec::new(),
                    query_exchanges: Vec::new(),
                    inbound_queries: Vec::new(),
                    projection_deltas: Vec::new(),
                    revocation_events: Vec::new(),
                    revocation_consumers: Vec::new(),
                    host_credential_rotation: None,
                    command_receipts: Vec::new(),
                }
            }
            Err(error) => return Err(error),
        };
        state.validate()?;
        if state.owner_user_id != config.owner_user_id {
            return Err(PeerError::Authorization(
                "daemon state is bound to a different Forge owner".into(),
            ));
        }
        validate_operational_identity_binding(&state, identity.certificate(), startup_time)?;
        let transport_readiness = ProviderReadinessRegistry::configured(
            endpoints.as_slice().iter().map(endpoint_provider_kind),
            startup_time,
        );
        let handler = Self {
            identity: ArcSwap::from_pointee(identity),
            directory,
            _lock: lock,
            endpoints,
            allow_loopback_direct: config.allow_loopback_direct,
            state_key,
            mls_state_key,
            mls_lock: Mutex::new(()),
            state: Mutex::new(state),
            command_lock: Mutex::new(()),
            staged_state: Mutex::new(None),
            transport_readiness,
            command_authority: config.command_authority,
        };
        handler.finalize_host_rotation_if_ready()?;
        handler.persist_current()?;
        Ok(handler)
    }

    pub fn health(&self) -> Result<AuthenticatedProvenance> {
        let now = self.checked_now()?;
        self.provenance(None, now)
    }

    pub fn transport_readiness(&self) -> Result<Vec<ProviderReadiness>> {
        self.transport_readiness.snapshot()
    }

    fn mls_identity(&self, now: u64) -> Result<MlsDeviceIdentity> {
        let identity = self.identity.load_full();
        Self::mls_identity_from(&identity, now)
    }

    fn mls_identity_from(identity: &LocalIdentityState, now: u64) -> Result<MlsDeviceIdentity> {
        let signing_secret = identity.device_signer().signing_secret_bytes();
        let agreement_secret = identity.device_signer().key_agreement_secret_bytes();
        let signer = Arc::new(DeviceSigner::from_secret_material(
            identity.device_signer().device_id,
            *signing_secret,
            *agreement_secret,
        ));
        MlsDeviceIdentity::new(identity.certificate().clone(), signer, now)
    }

    fn mls_runtime(
        &self,
        state: &DurableDaemonState,
    ) -> Result<(Arc<EmbeddedMlsBackend>, EmbeddedMlsCoordinator)> {
        let backend = Arc::new(EmbeddedMlsBackend::from_state(state)?);
        let coordinator = PersistedStateCoordinator::new(
            Arc::clone(&backend),
            Arc::clone(&backend),
            XChaChaStateSealer::new(StateEncryptionKey::new(*self.mls_state_key)?),
        );
        Ok((backend, coordinator))
    }

    fn local_identity(&self, input: &LocalIdentityInput) -> Result<LocalIdentityView> {
        self.require_owner(&input.owner_user_id)?;
        let now = self.checked_now()?;
        let public_endpoints = self
            .endpoints
            .as_slice()
            .iter()
            .filter(|endpoint| !matches!(endpoint, EndpointDescriptor::HttpMailbox(_)))
            .cloned()
            .collect::<Vec<_>>();
        Ok(LocalIdentityView {
            principal: principal_view(self.identity.load().certificate())?,
            device: device_view(self.identity.load().certificate(), &public_endpoints)?,
            provenance: self.provenance(None, now)?,
        })
    }

    fn command_receipt(&self, input: &CommandReceiptInput) -> Result<CommandReceiptView> {
        self.require_owner(&input.owner_user_id)?;
        crate::ipc::validate_command_id(&input.command_id)?;
        let now = self.checked_now()?;
        let state = self.state_snapshot()?;
        let receipt = state
            .command_receipts
            .iter()
            .find(|receipt| receipt.command_id == input.command_id)
            .ok_or_else(|| PeerError::StateConflict("command receipt was not found".into()))?;
        let stored = serde_json::from_slice::<StoredCommandResponse<serde_json::Value>>(
            &receipt.response_json,
        )
        .ok()
        .filter(|stored| matches!(stored.receipt_version, 1..=4));
        let (approval_deadline, committed_at, authorization, result) = if let Some(stored) = stored
        {
            (
                Some(if let Some(exact) = stored.approval_deadline_rfc3339 {
                    if parse_timestamp(&exact, "stored approval deadline")?
                        != stored.approval_deadline
                    {
                        return Err(PeerError::Rollback(
                            "stored command approval deadline is inconsistent".into(),
                        ));
                    }
                    exact
                } else {
                    format_timestamp(stored.approval_deadline)?
                }),
                Some(format_timestamp(stored.committed_at)?),
                stored.authorization,
                stored.result,
            )
        } else {
            (
                None,
                None,
                None,
                serde_json::from_slice(&receipt.response_json).map_err(|error| {
                    PeerError::Rollback(format!("legacy stored command result is invalid: {error}"))
                })?,
            )
        };
        let command_id = receipt.command_id.clone();
        let operation = receipt.operation.clone();
        let request_hash = hex::encode(receipt.request_hash);
        let evidence = self.daemon_evidence(
            DaemonEvidenceStatementType::CommandReceipt,
            &CommandReceiptEvidenceStatement {
                command_id: &command_id,
                operation: &operation,
                request_hash: &request_hash,
                approval_deadline: &approval_deadline,
                committed_at: &committed_at,
                authorization: &authorization,
                result: &result,
            },
            now,
        )?;
        Ok(CommandReceiptView {
            command_id,
            operation,
            request_hash,
            approval_deadline,
            committed_at,
            authorization,
            result,
            evidence,
        })
    }

    fn list_revocation_events(
        &self,
        input: &ListRevocationEventsInput,
    ) -> Result<RevocationEventPage> {
        input.validate()?;
        self.require_owner(&input.owner_user_id)?;
        let now = self.checked_now()?;
        let after_cursor = parse_canonical_u64(&input.after_cursor, "revocation afterCursor")?;
        let state = self.state_snapshot()?;
        let event_count = u64::try_from(state.revocation_events.len())
            .map_err(|_| PeerError::Rollback("revocation event count overflows u64".into()))?;
        if after_cursor > event_count {
            return Err(PeerError::Replay(
                "revocation afterCursor is ahead of the durable event log".into(),
            ));
        }
        let after_index = usize::try_from(after_cursor)
            .map_err(|_| limit("revocation afterCursor does not fit this platform"))?;
        let events = state
            .revocation_events
            .iter()
            .skip(after_index)
            .take(usize::from(input.limit))
            .map(revocation_event_view)
            .collect::<Result<Vec<_>>>()?;
        let next_cursor = after_cursor
            .checked_add(u64::try_from(events.len()).map_err(|_| {
                PeerError::Rollback("revocation response length overflows u64".into())
            })?)
            .ok_or_else(|| PeerError::Rollback("revocation response cursor overflow".into()))?;
        let acknowledged_cursor = state
            .revocation_consumers
            .iter()
            .find(|consumer| consumer.consumer_id == input.consumer_id)
            .map_or(0, |consumer| consumer.acknowledged_cursor);
        let acknowledged_cursor = acknowledged_cursor.to_string();
        let next_cursor = next_cursor.to_string();
        let has_more = next_cursor
            .parse::<u64>()
            .is_ok_and(|cursor| cursor < event_count);
        let provenance = self.provenance(None, now)?;
        let evidence = self.daemon_evidence(
            DaemonEvidenceStatementType::RevocationEventPage,
            &RevocationEventPageEvidenceStatement {
                events: &events,
                acknowledged_cursor: &acknowledged_cursor,
                next_cursor: &next_cursor,
                has_more,
                provenance: &provenance,
            },
            now,
        )?;
        Ok(RevocationEventPage {
            events,
            acknowledged_cursor,
            next_cursor,
            has_more,
            provenance,
            evidence,
        })
    }

    fn acknowledge_revocation_events(
        &self,
        input: &AckRevocationEventsInput,
    ) -> Result<RevocationAckResult> {
        input.validate()?;
        self.require_owner(&input.owner_user_id)?;
        let now = self.checked_now()?;
        let through_cursor =
            parse_canonical_u64(&input.through_cursor, "revocation throughCursor")?;
        let supplied_hash = decode_hex_array::<32>(&input.event_hash, "revocation event hash")?;
        let mut acknowledged_at = now;
        self.mutate(|state| {
            let event_index = through_cursor
                .checked_sub(1)
                .and_then(|value| usize::try_from(value).ok())
                .ok_or_else(|| invalid("revocation throughCursor is invalid"))?;
            let event = state.revocation_events.get(event_index).ok_or_else(|| {
                PeerError::Replay(
                    "revocation acknowledgement is ahead of the durable event log".into(),
                )
            })?;
            let expected_hash = revocation_event_hash(event)?;
            if supplied_hash.ct_eq(&expected_hash).unwrap_u8() != 1 {
                return Err(PeerError::Authentication(
                    "revocation acknowledgement hash does not match its cursor".into(),
                ));
            }
            if let Some(consumer) = state
                .revocation_consumers
                .iter_mut()
                .find(|consumer| consumer.consumer_id == input.consumer_id)
            {
                if through_cursor < consumer.acknowledged_cursor {
                    return Err(PeerError::Replay(
                        "revocation acknowledgement cursor cannot move backward".into(),
                    ));
                }
                if through_cursor == consumer.acknowledged_cursor {
                    if supplied_hash.ct_eq(&consumer.event_hash).unwrap_u8() != 1 {
                        return Err(PeerError::Authentication(
                            "revocation acknowledgement forked at an existing cursor".into(),
                        ));
                    }
                    acknowledged_at = consumer.acknowledged_at;
                    return Ok(());
                }
                consumer.acknowledged_cursor = through_cursor;
                consumer.event_hash = supplied_hash;
                consumer.acknowledged_at = now;
            } else {
                if state.revocation_consumers.len() >= MAX_REVOCATION_CONSUMERS {
                    return Err(limit("durable revocation consumer limit reached"));
                }
                state.revocation_consumers.push(StoredRevocationConsumer {
                    consumer_id: input.consumer_id.clone(),
                    acknowledged_cursor: through_cursor,
                    event_hash: supplied_hash,
                    acknowledged_at: now,
                });
            }
            Ok(())
        })?;
        Ok(RevocationAckResult {
            consumer_id: input.consumer_id.clone(),
            acknowledged_cursor: through_cursor.to_string(),
            event_hash: input.event_hash.clone(),
            acknowledged_at: format_timestamp(acknowledged_at)?,
            provenance: self.provenance(None, now)?,
        })
    }

    fn load_command_authority_state(
        &self,
        owner_user_id: &str,
    ) -> Result<VerifiedCommandAuthorityState> {
        let authority = self.command_authority.as_ref().ok_or_else(|| {
            PeerError::Authentication(
                "daemon has no pinned Node command authority; management IPC is read-only".into(),
            )
        })?;
        let bytes = self
            .directory
            .read_secret(COMMAND_AUTHORITY_STATE_FILE)
            .map_err(|_| {
                PeerError::Authentication(
                    "signed Node command authority state is unavailable".into(),
                )
            })?;
        if bytes.len() > MAX_COMMAND_AUTHORITY_STATE_BYTES {
            return Err(limit("signed Node command authority state exceeds 256 KiB"));
        }
        let state: CommandAuthorityState = serde_json::from_slice(&bytes).map_err(|_| {
            PeerError::Authentication("signed Node command authority state is malformed".into())
        })?;
        authority.verify_state(&state, owner_user_id)
    }

    fn validate_command_authority_high_water(
        &self,
        state: &DurableDaemonState,
        candidate: &VerifiedCommandAuthorityState,
    ) -> Result<()> {
        let Some((key_id, epoch, state_hash)) = command_authority_high_water(state)? else {
            return Ok(());
        };
        let authority = self.command_authority.as_ref().ok_or_else(|| {
            PeerError::Rollback(
                "durable commands are bound to a Node authority that is not configured".into(),
            )
        })?;
        if key_id != authority.key_id() {
            return Err(PeerError::Rollback(
                "configured Node command authority does not match durable command receipts".into(),
            ));
        }
        if candidate.epoch < epoch {
            return Err(PeerError::Rollback(
                "signed Node command authority state rolled back its invalidation epoch".into(),
            ));
        }
        if candidate.epoch == epoch && candidate.state_hash.ct_eq(&state_hash).unwrap_u8() != 1 {
            return Err(PeerError::Rollback(
                "signed Node command authority state forked at a durable epoch".into(),
            ));
        }
        Ok(())
    }

    fn sync_command_authority_state(
        &self,
        input: &CommandAuthorityStateInput,
        caller_command_id: Option<&str>,
    ) -> Result<CommandAuthorityStateView> {
        self.require_owner(&input.owner_user_id)?;
        let now = self.checked_now()?;
        let candidate = self.load_command_authority_state(&input.owner_user_id)?;
        let authority = self.command_authority.as_ref().ok_or_else(|| {
            PeerError::Authentication("Node command authority is not configured".into())
        })?;
        let authorization = authority.state_provenance(&candidate, now)?;
        let command_id = command_authority_sync_id(&candidate, caller_command_id)?;
        let result = CommandAuthorityStateView {
            command_id: command_id.clone(),
            authority_key_id: authority.key_id().to_owned(),
            invalidation_epoch: candidate.epoch.to_string(),
            state_hash: hex::encode(candidate.state_hash),
            committed_at: format_timestamp(now)?,
            authorization: authorization.clone(),
            provenance: self.provenance(None, now)?,
        };

        let _command = self
            .command_lock
            .lock()
            .map_err(|_| PeerError::StateConflict("command transaction lock poisoned".into()))?;
        let mut base = self.lock_state()?.clone();
        self.validate_command_authority_high_water(&base, &candidate)?;
        if let Some(receipt) = base
            .command_receipts
            .iter()
            .find(|receipt| receipt.command_id == command_id)
        {
            if receipt.operation != "sync_command_authorization_state"
                || receipt
                    .request_hash
                    .ct_eq(&candidate.state_hash)
                    .unwrap_u8()
                    != 1
            {
                return Err(PeerError::StateConflict(
                    "command authority state receipt conflicts with its durable epoch".into(),
                ));
            }
            let stored =
                serde_json::from_slice::<StoredCommandResponse<CommandAuthorityStateView>>(
                    &receipt.response_json,
                )
                .map_err(|_| {
                    PeerError::Rollback("stored command authority sync receipt is invalid".into())
                })?;
            let stored_authorization = stored.authorization.as_ref().ok_or_else(|| {
                PeerError::Rollback("stored command authority sync provenance is missing".into())
            })?;
            if stored.receipt_version != 2
                || stored_authorization.authority_key_id != authority.key_id()
                || stored_authorization.invalidation_epoch != candidate.epoch.to_string()
                || stored_authorization.authority_state_hash != hex::encode(candidate.state_hash)
            {
                return Err(PeerError::Rollback(
                    "stored command authority sync provenance is invalid".into(),
                ));
            }
            return Ok(stored.result);
        }
        compact_empty_query_claim_receipts(&mut base.command_receipts);
        if base.command_receipts.len() >= MAX_COMMAND_RECEIPTS {
            return Err(limit(
                "durable command receipt limit reached; local-console compaction is required",
            ));
        }
        let response_json = serde_json::to_vec(&StoredCommandResponse {
            receipt_version: 2,
            approval_deadline: now,
            approval_deadline_rfc3339: None,
            committed_at: now,
            authorization: Some(authorization),
            authorization_document_hash: None,
            result: &result,
        })
        .map_err(|error| invalid(format!("serializing command authority receipt: {error}")))?;
        if response_json.len() > crate::codec::MAX_IPC_FRAME_BYTES {
            return Err(limit(
                "command authority receipt exceeds the IPC frame limit",
            ));
        }
        let mut next = base;
        next.high_water_unix_time = next.high_water_unix_time.max(now);
        next.command_receipts.push(CommandReceipt {
            command_id,
            operation: "sync_command_authorization_state".into(),
            request_hash: candidate.state_hash,
            response_json,
        });
        compact_empty_query_claim_receipts(&mut next.command_receipts);
        next.validate()?;
        self.persist(&next)?;
        *self.lock_state()? = next;
        Ok(result)
    }

    fn create_invitation(&self, input: CreateInvitationInput) -> Result<InvitationMaterial> {
        self.require_owner(&input.owner_user_id)?;
        validate_text(&input.label, 1, 160, "invitation label")?;
        validate_transport_kinds(&input.transport_kinds)?;
        let now = self.checked_now()?;
        let expires_at = parse_timestamp(&input.expires_at, "invitation expiresAt")?;
        if expires_at <= now || expires_at - now > 15 * 60 {
            return Err(invalid(
                "invitation expiry must be within the next fifteen minutes",
            ));
        }
        let invite_id = nonzero_invite_id();
        let bootstrap_private_key = nonzero_random_32();
        let bootstrap_public_key =
            X25519PublicKey::from(&StaticSecret::from(bootstrap_private_key)).to_bytes();
        let bootstrap_proof = nonzero_random_32();
        let mailbox_secret = MailboxRelationshipSecret::derive(
            &bootstrap_proof,
            &invite_id.0,
            self.identity.load().certificate().body.principal_id,
        )?;
        let mailbox_credential =
            self.configured_mailbox_credential(&mailbox_secret, MailboxChannelRole::InviterInbox)?;
        let selected_endpoints = self.endpoints_for(
            &input.transport_kinds,
            input.privacy_mode,
            mailbox_credential.as_ref(),
        )?;
        let initial_grant_hash =
            *blake3::hash(&[input.label.as_bytes(), &rand::random::<[u8; 32]>()].concat())
                .as_bytes();
        let body = PairingInviteBody {
            qr_version: 1,
            invite_id,
            inviter_device: self.identity.load().certificate().clone(),
            protocol_range: ProtocolRange::CURRENT,
            endpoints: selected_endpoints,
            bootstrap_public_key,
            bootstrap_secret_commitment: crate::invite::bootstrap_proof_commitment(
                &bootstrap_proof,
            )?,
            inviter_fingerprint: self.identity.load().certificate().fingerprint()?,
            initial_grant_hash,
            created_at: now,
            expires_at,
        };
        let signed_invite = SignedPairingInvite::sign(body, self.identity.load().device_signer())?;
        let bundle = PairingQrBundle::new(signed_invite.clone(), bootstrap_proof)?;
        let qr_bytes = bundle.to_qr_bytes()?;
        let (backup_nonce, backup_ciphertext) = seal_bytes(
            &self.state_key,
            b"forge-peer/1 invitation bootstrap backup",
            &qr_bytes,
        )?;
        self.mutate(|state| {
            if state.invitations.len() >= MAX_INVITATIONS {
                return Err(limit("durable invitation limit reached"));
            }
            state.invitations.push(StoredInvitation {
                bundle,
                bootstrap_private_key,
                label: input.label,
                privacy_mode: input.privacy_mode,
                transport_kinds: input.transport_kinds.clone(),
                consumed: false,
            });
            Ok(())
        })?;
        let invitation = ApiPairingInvitation {
            id: hex::encode(invite_id.0),
            owner_user_id: input.owner_user_id,
            inviter_principal_id: principal_id(self.identity.load().certificate()),
            inviter_device_id: device_id(self.identity.load().certificate()),
            fingerprint: base32_fingerprint(&signed_invite.body.inviter_fingerprint),
            expires_at: format_timestamp(expires_at)?,
            protocol_version: PROTOCOL_NAME.to_owned(),
            transport_kinds: input.transport_kinds,
            bootstrap: URL_SAFE_NO_PAD.encode(qr_bytes),
            signature: URL_SAFE_NO_PAD.encode(signed_invite.inviter_signature.0),
        };
        Ok(InvitationMaterial {
            invitation,
            bootstrap_hash: hex::encode(Sha256::digest(&backup_ciphertext)),
            bootstrap_ciphertext: URL_SAFE_NO_PAD.encode(backup_ciphertext),
            bootstrap_nonce: URL_SAFE_NO_PAD.encode(backup_nonce),
            provenance: self.provenance(None, now)?,
        })
    }

    fn cancel_invitation(&self, input: &CancelInvitationInput) -> Result<InvitationCancellation> {
        self.require_owner(&input.owner_user_id)?;
        let invitation_id = decode_hex_array::<16>(&input.invitation_id, "invitation id")?;
        let now = self.checked_now()?;
        self.mutate(|state| {
            let invitation = state
                .invitations
                .iter_mut()
                .find(|candidate| candidate.bundle.signed_invite.body.invite_id.0 == invitation_id)
                .ok_or_else(|| {
                    PeerError::Authorization(
                        "invitation is not bound to this daemon identity".into(),
                    )
                })?;
            if !invitation.consumed {
                invitation.consumed = true;
                invitation.bootstrap_private_key.zeroize();
                invitation.bundle.bootstrap_proof.zeroize();
            }
            Ok(())
        })?;
        Ok(InvitationCancellation {
            invitation_id: input.invitation_id.clone(),
            provenance: self.provenance(None, now)?,
        })
    }

    #[allow(clippy::too_many_lines)]
    fn accept_invitation(&self, input: AcceptInvitationInput) -> Result<PairingAcceptance> {
        self.require_owner(&input.owner_user_id)?;
        if input.local_device_id != device_id(self.identity.load().certificate()) {
            return Err(PeerError::Authorization(
                "pairing local device does not match the daemon identity".into(),
            ));
        }
        let now = self.checked_now()?;
        let scanned_at = parse_timestamp(&input.scanned_at, "pairing scannedAt")?;
        if scanned_at > now.saturating_add(MAX_CLOCK_SKEW_SECONDS)
            || scanned_at.saturating_add(15 * 60) < now
        {
            return Err(PeerError::Authentication(
                "pairing scan timestamp is stale".into(),
            ));
        }
        let qr = decode_base64(&input.invitation.bootstrap, 32 * 1024, "pairing bootstrap")?;
        let bundle = PairingQrBundle::from_qr_bytes(&qr)?;
        bundle.validate()?;
        bundle.signed_invite.verify(now)?;
        validate_api_invitation(&input.invitation, &bundle)?;
        if bundle.signed_invite.body.inviter_device.body.principal_id
            == self.identity.load().certificate().body.principal_id
        {
            return Err(PeerError::Authorization(
                "peer pairing cannot create a relationship with the local principal".into(),
            ));
        }
        let selected_endpoints = select_remote_endpoints(
            bundle.signed_invite.body.endpoints.as_slice(),
            input.privacy_mode,
            self.allow_loopback_direct,
        )?;
        let selected_protocol =
            ProtocolRange::CURRENT.negotiate(bundle.signed_invite.body.protocol_range)?;
        let verification_phrase = verification_phrase();
        let verification_phrase_hash = phrase_hash(&verification_phrase);
        let expires_at = bundle
            .signed_invite
            .body
            .expires_at
            .min(now.saturating_add(60 * 60));
        let transcript_body = PairingTranscriptBody {
            transcript_version: 1,
            invite_id: bundle.signed_invite.body.invite_id,
            signed_invite_commitment: bundle.signed_invite.commitment()?,
            inviter_device: bundle.signed_invite.body.inviter_device.clone(),
            accepter_device: self.identity.load().certificate().clone(),
            inviter_protocol_range: bundle.signed_invite.body.protocol_range,
            accepter_protocol_range: ProtocolRange::CURRENT,
            selected_protocol,
            selected_endpoints,
            verification_phrase_hash,
            initial_grant_hash: bundle.signed_invite.body.initial_grant_hash,
            created_at: now,
            expires_at,
        };
        transcript_body.validate()?;
        let accepter_signature = SignedPairingTranscript::sign_as_accepter(
            &transcript_body,
            self.identity.load().device_signer(),
        )?;
        let transcript_hash = transcript_body.transcript_hash()?;
        let request_id = nonzero_random_16();
        let state_binding = pairing_state_binding(
            request_id,
            transcript_hash,
            self.identity.load().certificate().fingerprint()?,
        );
        let payload = PairingRequestPayload {
            protocol_version: PROTOCOL_NAME.to_owned(),
            invitation_id: hex::encode(bundle.signed_invite.body.invite_id.0),
            transcript_hash: hex::encode(transcript_hash),
            verification_phrase: verification_phrase.clone(),
            verification_phrase_hash: hex::encode(verification_phrase_hash),
            local_principal_id: principal_id(self.identity.load().certificate()),
            local_device_id: device_id(self.identity.load().certificate()),
            remote_principal_id: principal_id(&bundle.signed_invite.body.inviter_device),
            remote_device_id: device_id(&bundle.signed_invite.body.inviter_device),
            state_binding: hex::encode(state_binding),
        };
        let bootstrap_proof = bundle.bootstrap_proof;
        self.mutate(|state| {
            if state.pairings.len() >= MAX_PAIRINGS {
                return Err(limit("durable pending pairing limit reached"));
            }
            state.pairings.push(StoredPairing {
                request_id,
                state_binding,
                invitation_owner_user_id: input.invitation.owner_user_id,
                signed_invite: bundle.signed_invite,
                transcript_body,
                accepter_signature,
                bootstrap_proof,
                verification_phrase,
                privacy_mode: input.privacy_mode,
                confirmed_relationship_id: None,
                outbound_envelope: None,
            });
            Ok(())
        })?;
        Ok(PairingAcceptance {
            request_id: hex::encode(request_id),
            request_payload: payload,
            expires_at: format_timestamp(expires_at)?,
            provenance: self.provenance(None, now)?,
        })
    }

    #[allow(clippy::too_many_lines)]
    fn accept_pending_request(
        &self,
        input: &AcceptPendingRequestInput,
    ) -> Result<PendingRequestResult> {
        self.require_owner(&input.owner_user_id)?;
        input.validate()?;
        if input.request.owner_user_id != input.owner_user_id {
            return Err(PeerError::Authorization(
                "pending request owner does not match the daemon owner".into(),
            ));
        }
        let now = self.checked_now()?;
        let expires_at = parse_timestamp(&input.request.expires_at, "pending request expiresAt")?;
        if input.request.status != PendingRequestStatus::Pending
            || input.request.decided_at.is_some()
            || !input.request.decision_reason.is_empty()
            || input.request.version != 1
            || now >= expires_at
            || expires_at > now.saturating_add(24 * 60 * 60)
        {
            return Err(PeerError::Authentication(
                "pending request decision metadata is not live and exact".into(),
            ));
        }
        let request_hash = canonical_pending_request_hash(&input.request)?;
        let supplied_payload_hash = pending_payload_hash(&input.request.payload)?;
        if supplied_payload_hash != input.request.payload_hash {
            return Err(PeerError::Authentication(
                "pending request payload hash does not match its canonical payload".into(),
            ));
        }
        let decision_id = pending_decision_id(&input.request.id)?;
        let mut authenticated_pairing = None;
        let mut authenticated_relationship = None;
        self.mutate(|state| {
            match input.request.kind {
                PendingRequestKind::Pairing => {
                    let request_id =
                        decode_hex_array::<16>(&input.request.id, "pending pairing id")?;
                    let payload = pairing_request_from_json(&input.request.payload)?;
                    let pairing = state
                        .pairings
                        .iter()
                        .find(|candidate| candidate.request_id == request_id)
                        .cloned()
                        .ok_or_else(|| {
                            PeerError::Authorization(
                                "pending pairing is not bound to durable daemon state".into(),
                            )
                        })?;
                    if payload != pairing_payload(&pairing, self.identity.load().certificate())?
                        || input.request.relationship_id.is_some()
                        || expires_at != pairing.transcript_body.expires_at
                    {
                        return Err(PeerError::Authentication(
                            "pending request does not match its authenticated pairing transcript"
                                .into(),
                        ));
                    }
                    authenticated_pairing = Some(pairing);
                }
                PendingRequestKind::Grant => {
                    let relationship_id = input
                        .request
                        .relationship_id
                        .as_deref()
                        .ok_or_else(|| invalid("pending grant has no relationship id"))?;
                    let grant: PeerShareGrantVersion = serde_json::from_value(
                        serde_json::Value::Object(input.request.payload.clone()),
                    )
                    .map_err(|error| invalid(format!("invalid pending grant payload: {error}")))?;
                    grant.validate()?;
                    let relationship = active_relationship(state, relationship_id)?;
                    if grant.relationship_id != relationship.id
                        || !matches!(grant.status, GrantStatus::Proposed | GrantStatus::Countered)
                        || !relationship
                            .grants
                            .iter()
                            .any(|stored| stored.grant == grant)
                    {
                        return Err(PeerError::Authorization(
                            "pending grant was not received over the authenticated relationship"
                                .into(),
                        ));
                    }
                    validate_directional_grant_signatures(&grant, relationship, false)?;
                    let trust = grant_trust(
                        relationship,
                        self.identity.load().certificate(),
                        &grant,
                        now,
                        true,
                    )?;
                    for signature in &grant.signatures {
                        verify_grant_consent_signature(&grant, signature, &trust, now)?;
                    }
                    authenticated_relationship = Some(relationship.clone());
                }
                PendingRequestKind::Device => {
                    let relationship_id = input
                        .request
                        .relationship_id
                        .as_deref()
                        .ok_or_else(|| invalid("pending device has no relationship id"))?;
                    let payload: PendingDevicePayload = serde_json::from_value(
                        serde_json::Value::Object(input.request.payload.clone()),
                    )
                    .map_err(|error| invalid(format!("invalid pending device payload: {error}")))?;
                    validate_text(&payload.device_id, 1, MAX_TEXT_BYTES, "pending device id")?;
                    let relationship = active_relationship(state, relationship_id)?;
                    if !relationship.devices.iter().any(|device| {
                        device.external_device_id == payload.device_id
                            && device.status == StoredDeviceStatus::Approved
                            && device.certificate.body.principal_id
                                == relationship.remote_certificate.body.principal_id
                    }) {
                        return Err(PeerError::Authorization(
                            "pending device is not authenticated by the relationship".into(),
                        ));
                    }
                    authenticated_relationship = Some(relationship.clone());
                }
            }
            if let Some(existing) = state
                .accepted_pending_requests
                .iter()
                .find(|accepted| accepted.request_id == decision_id)
            {
                if existing.request_hash.ct_eq(&request_hash).unwrap_u8() != 1 {
                    return Err(PeerError::StateConflict(
                        "pending request was accepted with different durable metadata".into(),
                    ));
                }
            } else {
                if state.accepted_pending_requests.len() >= MAX_PENDING_DECISIONS {
                    return Err(limit("durable pending-request decision limit reached"));
                }
                state
                    .accepted_pending_requests
                    .push(AcceptedPendingRequest {
                        request_id: decision_id,
                        request_hash,
                        accepted_at: now,
                    });
            }
            Ok(())
        })?;
        let provenance = if let Some(pairing) = authenticated_pairing.as_ref() {
            self.pairing_provenance(pairing, now)?
        } else if let Some(relationship) = authenticated_relationship.as_ref() {
            self.provenance(Some(relationship), now)?
        } else {
            return Err(PeerError::StateConflict(
                "pending request acceptance lost authenticated state".into(),
            ));
        };
        Ok(PendingRequestResult {
            request_id: input.request.id.clone(),
            kind: input.request.kind,
            provenance,
        })
    }

    #[allow(clippy::too_many_lines)]
    fn confirm_pairing(&self, input: &ConfirmPairingInput) -> Result<PairingConfirmation> {
        self.require_owner(&input.owner_user_id)?;
        input.request_payload.validate()?;
        let now = self.checked_now()?;
        let request_id = decode_hex_array::<16>(&input.pairing_id, "pairing id")?;
        let supplied_transcript =
            decode_hex_array::<32>(&input.transcript_hash, "transcript hash")?;
        let mut output: Option<(StoredRelationship, StoredPairing)> = None;
        self.mutate(|state| {
            let pairing_index = state
                .pairings
                .iter()
                .position(|candidate| candidate.request_id == request_id)
                .ok_or_else(|| PeerError::StateConflict("pending pairing was not found".into()))?;
            let pairing = state.pairings[pairing_index].clone();
            let expected_hash = pairing.transcript_body.transcript_hash()?;
            let expected_payload = pairing_payload(&pairing, self.identity.load().certificate())?;
            if expected_payload != input.request_payload
                || expected_hash.ct_eq(&supplied_transcript).unwrap_u8() != 1
                || phrase_hash(&input.verification_phrase)
                    .ct_eq(&pairing.transcript_body.verification_phrase_hash)
                    .unwrap_u8()
                    != 1
                || input.verification_phrase != pairing.verification_phrase
            {
                return Err(PeerError::Authentication(
                    "pairing confirmation did not match durable verified state".into(),
                ));
            }
            if now > pairing.transcript_body.expires_at {
                return Err(PeerError::Authentication(
                    "pairing transcript expired".into(),
                ));
            }
            if let Some(existing_id) = &pairing.confirmed_relationship_id {
                if pairing.outbound_envelope.is_none() {
                    return Err(PeerError::Rollback(
                        "confirmed pairing lost its outbound acceptance".into(),
                    ));
                }
                let existing = state
                    .relationships
                    .iter()
                    .find(|candidate| &candidate.id == existing_id)
                    .cloned()
                    .ok_or_else(|| {
                        PeerError::Rollback("confirmed relationship disappeared".into())
                    })?;
                output = Some((existing, pairing));
                return Ok(());
            }
            if state.relationships.len() >= MAX_RELATIONSHIPS {
                return Err(limit("durable relationship limit reached"));
            }
            if state.pending_mls_clients.len() >= MAX_PENDING_MLS_CLIENTS {
                return Err(limit("durable pending MLS client limit reached"));
            }
            let mls_client = MlsClient::new(self.mls_identity(now)?);
            let key_package = mls_client.generate_key_package()?;
            let pending_snapshot = mls_client.export_pending_key_package_state()?;
            if pending_snapshot.is_empty() || pending_snapshot.len() > MAX_MLS_CLIENT_SNAPSHOT_BYTES
            {
                return Err(limit("pending OpenMLS client snapshot is oversized"));
            }
            let transcript_hash = pairing.transcript_body.transcript_hash()?;
            let relationship_id = relationship_id_for_transcript(transcript_hash)?;
            let mailbox_secret = MailboxRelationshipSecret::derive(
                &pairing.bootstrap_proof,
                &pairing.signed_invite.body.invite_id.0,
                pairing.signed_invite.body.inviter_device.body.principal_id,
            )?;
            let remote_mailbox = bound_mailbox_credential(
                &mailbox_secret,
                MailboxChannelRole::InviterInbox,
                pairing.transcript_body.selected_endpoints.as_slice(),
            )?;
            if let Some(remote) = &remote_mailbox
                && Some(remote.endpoint().origin.as_str()) != self.configured_mailbox_origin()?
            {
                return Err(PeerError::Authentication(
                    "signed remote mailbox endpoint is not bound to the configured provider".into(),
                ));
            }
            let local_mailbox = if remote_mailbox.is_some() {
                Some(
                    self.configured_mailbox_credential(
                        &mailbox_secret,
                        MailboxChannelRole::AccepterInbox,
                    )?
                    .ok_or_else(|| {
                        PeerError::Transport(
                            "pairing selected mailbox without a local configured provider".into(),
                        )
                    })?,
                )
            } else {
                None
            };
            let selected_transport_kinds = pairing
                .transcript_body
                .selected_endpoints
                .as_slice()
                .iter()
                .map(transport_kind)
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect::<Vec<_>>();
            let local_endpoints = self.endpoints_for(
                &selected_transport_kinds,
                pairing.privacy_mode,
                local_mailbox.as_ref(),
            )?;
            let relationship = StoredRelationship {
                id: hex::encode(relationship_id),
                local_certificate: self.identity.load().certificate().clone(),
                remote_certificate: pairing.signed_invite.body.inviter_device.clone(),
                local_certificate_history: Vec::new(),
                remote_certificate_history: Vec::new(),
                status: RelationshipStatus::Active,
                privacy_mode: pairing.privacy_mode,
                verification_phrase_hash: pairing.transcript_body.verification_phrase_hash,
                local_endpoints: local_endpoints.as_slice().to_vec(),
                remote_endpoints: pairing
                    .transcript_body
                    .selected_endpoints
                    .as_slice()
                    .to_vec(),
                mailbox_secret: remote_mailbox
                    .is_some()
                    .then(|| mailbox_secret.expose_for_sealed_storage()),
                devices: vec![StoredDevice {
                    external_device_id: device_id(&pairing.signed_invite.body.inviter_device),
                    certificate: pairing.signed_invite.body.inviter_device.clone(),
                    status: StoredDeviceStatus::Approved,
                }],
                grants: Vec::new(),
                outbound_sequence: 0,
                revoked_reason: None,
            };
            let outbound_acceptance = pairing_acceptance_envelope(
                &pairing,
                self.identity.load().as_ref(),
                local_endpoints.as_slice(),
                key_package.as_bytes(),
                now,
            )?;
            let packet = PeerWirePacket::new(
                PeerWirePayload::PairingAcceptance(BoundedBytes::new(outbound_acceptance.clone())?),
                now,
                pairing.transcript_body.expires_at,
            )?;
            enqueue_outbound_packet(
                state,
                Some(relationship.id.clone()),
                packet,
                &relationship.remote_endpoints,
                relationship.remote_certificate.clone(),
                now,
            )?;
            state.pending_mls_clients.push(StoredPendingMlsClient {
                relationship_id: relationship.id.clone(),
                transcript_hash,
                snapshot: pending_snapshot,
            });
            state.pairings[pairing_index].confirmed_relationship_id = Some(relationship.id.clone());
            state.pairings[pairing_index].outbound_envelope = Some(outbound_acceptance);
            state.relationships.push(relationship.clone());
            output = Some((relationship, state.pairings[pairing_index].clone()));
            Ok(())
        })?;
        let (relationship, pairing) = output.ok_or_else(|| {
            PeerError::StateConflict("pairing confirmation produced no state".into())
        })?;
        let outbound = pairing.outbound_envelope.clone().ok_or_else(|| {
            PeerError::Rollback("confirmed pairing has no outbound acceptance".into())
        })?;
        Ok(PairingConfirmation {
            relationship: relationship_view(&relationship)?,
            outbound_envelope: Some(URL_SAFE_NO_PAD.encode(outbound)),
            provenance: self.provenance(Some(&relationship), now)?,
        })
    }

    #[allow(clippy::too_many_lines)]
    fn ingest_pairing_acceptance(
        &self,
        packet: &PeerWirePacket,
        bytes: &[u8],
        acknowledgement: &SignedDeliveryAck,
        now: u64,
    ) -> Result<()> {
        let header: PairingAcceptanceEnvelope = decode_limited::<{ 96 * 1024 }, _>(bytes)?;
        let snapshot = self.state_snapshot()?;
        let invitation = snapshot
            .invitations
            .iter()
            .find(|invitation| {
                invitation.bundle.signed_invite.body.invite_id == header.body.invite_id
            })
            .cloned()
            .ok_or_else(|| {
                PeerError::Authorization(
                    "pairing acceptance does not target a durable local invitation".into(),
                )
            })?;
        let (plaintext, transcript) = open_pairing_acceptance(
            bytes,
            &invitation,
            self.identity.load().as_ref(),
            now,
            self.allow_loopback_direct,
        )?;
        let transcript_hash = transcript.body.transcript_hash()?;
        let relationship_id = relationship_id_for_transcript(transcript_hash)?;
        let relationship_id_hex = hex::encode(relationship_id);
        let mailbox_secret = MailboxRelationshipSecret::derive(
            &invitation.bundle.bootstrap_proof,
            &transcript.body.invite_id.0,
            transcript.body.inviter_device.body.principal_id,
        )?;
        let local_mailbox = bound_mailbox_credential(
            &mailbox_secret,
            MailboxChannelRole::InviterInbox,
            transcript.body.selected_endpoints.as_slice(),
        )?;
        let remote_mailbox = bound_mailbox_credential(
            &mailbox_secret,
            MailboxChannelRole::AccepterInbox,
            plaintext.local_endpoints.as_slice(),
        )?;
        if local_mailbox.is_some() != remote_mailbox.is_some() {
            return Err(PeerError::Authentication(
                "pairing mailbox endpoints are not directional and complete".into(),
            ));
        }
        if let Some(local) = &local_mailbox
            && Some(local.endpoint().origin.as_str()) != self.configured_mailbox_origin()?
        {
            return Err(PeerError::Authentication(
                "signed local mailbox endpoint is not bound to the configured provider".into(),
            ));
        }
        if let Some(remote) = &remote_mailbox
            && Some(remote.endpoint().origin.as_str()) != self.configured_mailbox_origin()?
        {
            return Err(PeerError::Authentication(
                "signed remote mailbox endpoint is not bound to the configured provider".into(),
            ));
        }
        let stored_mailbox_secret = local_mailbox
            .is_some()
            .then(|| mailbox_secret.expose_for_sealed_storage());
        if let Some(existing) = snapshot
            .relationships
            .iter()
            .find(|relationship| relationship.id == relationship_id_hex)
        {
            if existing.remote_certificate != transcript.body.accepter_device
                || existing.local_endpoints != transcript.body.selected_endpoints.as_slice()
                || existing.remote_endpoints != plaintext.local_endpoints.as_slice()
                || existing.mailbox_secret != stored_mailbox_secret
                || !snapshot
                    .mls_relationships
                    .iter()
                    .any(|mls| mls.relationship_id == relationship_id_hex)
            {
                return Err(PeerError::StateConflict(
                    "pairing acceptance conflicts with the existing relationship".into(),
                ));
            }
            return self.mutate(|state| append_inbound_receipt(state, packet, acknowledgement));
        }

        let (backend, coordinator) = self.mls_runtime(&snapshot)?;
        let trust = mls_trust(
            self.identity.load().certificate(),
            &transcript.body.accepter_device,
            now,
        )?;
        let group_id = blake3::derive_key("forge-peer/1 OpenMLS group id", &transcript_hash);
        let client = MlsClient::new(self.mls_identity(now)?);
        let mut session = client.create_group(Some(group_id), &trust, now, &coordinator)?;
        let key_package = CertifiedKeyPackage::from_parts(
            transcript.body.accepter_device.clone(),
            plaintext.openmls_key_package.as_slice().to_vec(),
        )?;
        let add_member = session.add_member(&key_package, &trust, now, &coordinator)?;
        let state_id = session.state_id();
        let (mls_states, mls_checkpoints) = backend.snapshot()?;
        let welcome = SignedMlsWelcome::sign(
            MlsWelcomeBody {
                version: 1,
                relationship_id,
                sender_certificate: self.identity.load().certificate().clone(),
                receiver_device_id: transcript.body.accepter_device.body.device_id,
                transcript_hash,
                welcome: BoundedBytes::new(add_member.welcome)?,
                created_at: now,
                expires_at: transcript.body.expires_at,
            },
            self.identity.load().device_signer(),
        )?;
        let welcome_packet = PeerWirePacket::new(
            PeerWirePayload::MlsWelcome(welcome),
            now,
            transcript.body.expires_at,
        )?;
        let relationship = StoredRelationship {
            id: relationship_id_hex.clone(),
            local_certificate: self.identity.load().certificate().clone(),
            remote_certificate: transcript.body.accepter_device.clone(),
            local_certificate_history: Vec::new(),
            remote_certificate_history: Vec::new(),
            status: RelationshipStatus::Active,
            privacy_mode: invitation.privacy_mode,
            verification_phrase_hash: transcript.body.verification_phrase_hash,
            local_endpoints: transcript.body.selected_endpoints.as_slice().to_vec(),
            remote_endpoints: plaintext.local_endpoints.as_slice().to_vec(),
            mailbox_secret: stored_mailbox_secret,
            devices: vec![StoredDevice {
                external_device_id: device_id(&transcript.body.accepter_device),
                certificate: transcript.body.accepter_device.clone(),
                status: StoredDeviceStatus::Approved,
            }],
            grants: Vec::new(),
            outbound_sequence: 0,
            revoked_reason: None,
        };
        self.mutate(|state| {
            let durable_invitation = state
                .invitations
                .iter_mut()
                .find(|candidate| {
                    candidate.bundle.signed_invite.body.invite_id == header.body.invite_id
                })
                .ok_or_else(|| {
                    PeerError::Rollback("pairing invitation disappeared during acceptance".into())
                })?;
            if durable_invitation.consumed {
                return Err(PeerError::StateConflict(
                    "pairing invitation was consumed concurrently".into(),
                ));
            }
            durable_invitation.consumed = true;
            durable_invitation.bootstrap_private_key.zeroize();
            durable_invitation.bundle.bootstrap_proof.zeroize();
            state.mls_states = mls_states;
            state.mls_checkpoints = mls_checkpoints;
            state.relationships.push(relationship.clone());
            state.mls_relationships.push(StoredMlsRelationship {
                relationship_id: relationship_id_hex.clone(),
                state_id,
                inbound_replay: ReplayState::default(),
            });
            enqueue_outbound_packet(
                state,
                Some(relationship_id_hex.clone()),
                welcome_packet,
                &relationship.remote_endpoints,
                relationship.remote_certificate.clone(),
                now,
            )?;
            append_inbound_receipt(state, packet, acknowledgement)
        })
    }

    fn ingest_mls_welcome(
        &self,
        packet: &PeerWirePacket,
        welcome: &SignedMlsWelcome,
        acknowledgement: &SignedDeliveryAck,
        now: u64,
    ) -> Result<()> {
        welcome.verify(now)?;
        if welcome.body.receiver_device_id != self.identity.load().certificate().body.device_id {
            return Err(PeerError::Authorization(
                "MLS Welcome targets a different local device".into(),
            ));
        }
        let relationship_id = hex::encode(welcome.body.relationship_id);
        let snapshot = self.state_snapshot()?;
        let relationship = active_relationship(&snapshot, &relationship_id)?;
        if relationship.remote_certificate != welcome.body.sender_certificate {
            return Err(PeerError::Authentication(
                "MLS Welcome sender is not the relationship peer".into(),
            ));
        }
        if let Some(existing) = snapshot
            .mls_relationships
            .iter()
            .find(|mls| mls.relationship_id == relationship_id)
        {
            let expected_group_id = blake3::derive_key(
                "forge-peer/1 OpenMLS group id",
                &welcome.body.transcript_hash,
            );
            if existing.state_id != state_id_for_group(&expected_group_id) {
                return Err(PeerError::StateConflict(
                    "existing MLS state is not bound to the Welcome transcript".into(),
                ));
            }
            return self.mutate(|state| append_inbound_receipt(state, packet, acknowledgement));
        }
        let pending = snapshot
            .pending_mls_clients
            .iter()
            .find(|pending| pending.relationship_id == relationship_id)
            .cloned()
            .ok_or_else(|| {
                PeerError::Authorization("MLS Welcome has no pending local key package".into())
            })?;
        if pending.transcript_hash != welcome.body.transcript_hash {
            return Err(PeerError::Authentication(
                "MLS Welcome transcript does not match the pending pairing".into(),
            ));
        }
        let (backend, coordinator) = self.mls_runtime(&snapshot)?;
        let trust = mls_trust(
            self.identity.load().certificate(),
            &relationship.remote_certificate,
            now,
        )?;
        let client = MlsClient::restore_pending_key_package_state(
            self.mls_identity(now)?,
            &pending.snapshot,
        )?;
        let session =
            client.join_group(welcome.body.welcome.as_slice(), &trust, now, &coordinator)?;
        let expected_group_id =
            blake3::derive_key("forge-peer/1 OpenMLS group id", &pending.transcript_hash);
        let expected_state_id = state_id_for_group(&expected_group_id);
        if session.state_id() != expected_state_id {
            return Err(PeerError::Authentication(
                "MLS Welcome group is not deterministically bound to the pairing transcript".into(),
            ));
        }
        let (mls_states, mls_checkpoints) = backend.snapshot()?;
        self.mutate(|state| {
            state.mls_states = mls_states;
            state.mls_checkpoints = mls_checkpoints;
            state
                .pending_mls_clients
                .retain(|pending| pending.relationship_id != relationship_id);
            state.mls_relationships.push(StoredMlsRelationship {
                relationship_id,
                state_id: expected_state_id,
                inbound_replay: ReplayState::default(),
            });
            append_inbound_receipt(state, packet, acknowledgement)
        })
    }

    #[allow(clippy::too_many_lines)]
    fn ingest_host_credential_rotation(
        &self,
        packet: &PeerWirePacket,
        rotation: &SignedHostCredentialRotation,
        acknowledgement: &SignedDeliveryAck,
        now: u64,
    ) -> Result<()> {
        rotation.verify(now)?;
        if packet.created_at != rotation.body.created_at
            || packet.expires_at != rotation.body.expires_at
        {
            return Err(PeerError::Authentication(
                "host rotation packet lifetime is not bound to its predecessor signature".into(),
            ));
        }
        let relationship_id = hex::encode(rotation.body.relationship_id);
        let local_identity = self.identity.load_full();
        let snapshot = self.state_snapshot()?;
        if snapshot.host_credential_rotation.is_some() {
            return Err(PeerError::StateConflict(
                "simultaneous local and remote host credential rotations are not accepted".into(),
            ));
        }
        let relationship = active_relationship(&snapshot, &relationship_id)?.clone();
        if relationship.remote_certificate_history.len() >= MAX_RELATIONSHIP_CERTIFICATE_HISTORY {
            return Err(limit(
                "remote credential rotation exceeds relationship certificate history",
            ));
        }
        if relationship.local_certificate != *local_identity.certificate()
            || relationship.remote_certificate != rotation.body.predecessor_certificate
        {
            return Err(PeerError::Authentication(
                "host rotation predecessor is not current for this relationship".into(),
            ));
        }
        validate_certificate_successor(
            &relationship.remote_certificate,
            &rotation.body.successor_certificate,
            now,
        )?;
        let binding = snapshot
            .mls_relationships
            .iter()
            .find(|binding| binding.relationship_id == relationship_id)
            .cloned()
            .ok_or_else(|| {
                PeerError::StateConflict("host rotation relationship has no MLS binding".into())
            })?;
        let (backend, coordinator) = self.mls_runtime(&snapshot)?;
        let trust = mls_trust(
            local_identity.certificate(),
            &rotation.body.predecessor_certificate,
            now,
        )?;
        let mut session = MlsSession::load(
            binding.state_id,
            Self::mls_identity_from(&local_identity, now)?,
            &trust,
            now,
            &coordinator,
        )?;
        trust.admit_certificate(&rotation.body.successor_certificate, now)?;
        if !matches!(
            session.process_message(
                rotation.body.mls_commit.as_slice(),
                &trust,
                now,
                &coordinator,
            )?,
            ProcessedMlsMessage::Commit { .. }
        ) {
            return Err(PeerError::Authentication(
                "host credential rotation did not contain an MLS commit".into(),
            ));
        }
        let (mls_states, mls_checkpoints) = backend.snapshot()?;
        self.mutate(|state| {
            if state.host_credential_rotation.is_some() {
                return Err(PeerError::StateConflict(
                    "local host rotation started during remote rotation processing".into(),
                ));
            }
            let durable_binding = state
                .mls_relationships
                .iter()
                .find(|candidate| candidate.relationship_id == relationship_id)
                .ok_or_else(|| {
                    PeerError::StateConflict(
                        "host rotation MLS binding disappeared before commit".into(),
                    )
                })?;
            if durable_binding.state_id != binding.state_id {
                return Err(PeerError::StateConflict(
                    "host rotation MLS binding changed before commit".into(),
                ));
            }
            let current = active_relationship_mut(state, &relationship_id)?;
            if current.local_certificate != *local_identity.certificate()
                || current.remote_certificate != rotation.body.predecessor_certificate
            {
                return Err(PeerError::StateConflict(
                    "relationship identity changed before remote rotation commit".into(),
                ));
            }
            let expected_device_id = device_id(&rotation.body.predecessor_certificate);
            let matching_devices = current
                .devices
                .iter()
                .enumerate()
                .filter_map(|(index, device)| {
                    (device.external_device_id == expected_device_id
                        && device.certificate == rotation.body.predecessor_certificate
                        && device.status == StoredDeviceStatus::Approved)
                        .then_some(index)
                })
                .collect::<Vec<_>>();
            let [device_index] = matching_devices.as_slice() else {
                return Err(PeerError::Authentication(
                    "host rotation predecessor is not the unique approved relationship device"
                        .into(),
                ));
            };
            current
                .remote_certificate_history
                .push(rotation.body.predecessor_certificate.clone());
            current.devices[*device_index].certificate =
                rotation.body.successor_certificate.clone();
            current.remote_certificate = rotation.body.successor_certificate.clone();
            state.mls_states = mls_states;
            state.mls_checkpoints = mls_checkpoints;
            append_revocation_event(
                state,
                RevocationEventDraft {
                    kind: RevocationEventKind::CredentialRetirement,
                    source: RevocationEventSource::AuthenticatedPeer,
                    relationship_id: relationship_id.clone(),
                    grant_id: None,
                    device_id: Some(device_id(&rotation.body.predecessor_certificate)),
                    target_certificate: Some(rotation.body.predecessor_certificate.clone()),
                    reason: "authenticated certified credential successor committed".into(),
                    occurred_at: now,
                    authenticated_remote_principal_id: Some(principal_id(
                        &rotation.body.predecessor_certificate,
                    )),
                    authenticated_remote_device_id: Some(device_id(
                        &rotation.body.predecessor_certificate,
                    )),
                },
                local_identity.certificate(),
                local_identity.device_signer(),
            )?;
            append_inbound_receipt(state, packet, acknowledgement)
        })
    }

    fn queue_application_message(
        &self,
        relationship_id: &str,
        message: &ApplicationMessage,
        now: u64,
        expires_at: u64,
    ) -> Result<String> {
        message.validate()?;
        if now >= expires_at || expires_at - now > 24 * 60 * 60 {
            return Err(invalid("application transport lifetime is invalid"));
        }
        let message_id = EnvelopeMessageId::random();
        self.mutate(|state| {
            active_relationship(state, relationship_id)?;
            enqueue_pending_application(
                state,
                message_id,
                relationship_id,
                message.clone(),
                now,
                expires_at,
            )
        })?;
        Ok(hex::encode(message_id.0))
    }

    #[allow(clippy::too_many_lines)]
    fn materialize_application_message(
        &self,
        pending: &StoredPendingApplication,
        now: u64,
    ) -> Result<()> {
        let _mls = self
            .mls_lock
            .lock()
            .map_err(|_| PeerError::StateConflict("daemon MLS lock poisoned".into()))?;
        if now >= pending.expires_at {
            return Err(PeerError::Timeout("materializing expired peer application"));
        }
        let snapshot = self.state_snapshot()?;
        let relationship = snapshot
            .relationships
            .iter()
            .find(|relationship| relationship.id == pending.relationship_id)
            .cloned()
            .ok_or_else(|| {
                PeerError::Authorization("relationship is not bound to this daemon".into())
            })?;
        if relationship.status != RelationshipStatus::Active
            && !matches!(
                &pending.message,
                ApplicationMessage::RelationshipRevocation(_)
            )
        {
            return Err(PeerError::Authorization(
                "only a queued relationship revocation may use a revoked channel".into(),
            ));
        }
        let binding = snapshot
            .mls_relationships
            .iter()
            .find(|binding| binding.relationship_id == pending.relationship_id)
            .cloned()
            .ok_or_else(|| {
                PeerError::Transport("relationship has not completed its OpenMLS handshake".into())
            })?;
        let sequence = relationship
            .outbound_sequence
            .checked_add(1)
            .ok_or_else(|| PeerError::StateConflict("relationship sequence overflow".into()))?;
        let (backend, coordinator) = self.mls_runtime(&snapshot)?;
        let trust = mls_trust(
            self.identity.load().certificate(),
            &relationship.remote_certificate,
            now,
        )?;
        let mut session = MlsSession::load(
            binding.state_id,
            self.mls_identity(now)?,
            &trust,
            now,
            &coordinator,
        )?;
        let plaintext = encode_application(&pending.message)?;
        let ciphertext = session.encrypt_application(&plaintext, &trust, now, &coordinator)?;
        let envelope = SignedEnvelope::sign(
            EnvelopeBody {
                protocol: ProtocolVersion::CURRENT,
                channel_id: channel_id_for_relationship(&pending.relationship_id)?,
                message_id: pending.message_id,
                sender_device_id: self.identity.load().certificate().body.device_id,
                sequence,
                previous_acknowledgement: PreviousAcknowledgement {
                    highest_contiguous_sequence: binding.inbound_replay.highest_sequence,
                    received_bitmap: binding.inbound_replay.received_bitmap,
                },
                message_kind: pending.message.kind(),
                created_at: pending.created_at,
                expires_at: pending.expires_at,
                mls_group_epoch: session.epoch(),
                mls_ciphertext: BoundedBytes::new(ciphertext)?,
            },
            self.identity.load().device_signer(),
        )?;
        let packet = PeerWirePacket::new(
            PeerWirePayload::Envelope(Box::new(envelope)),
            now,
            pending.expires_at,
        )?;
        let (mls_states, mls_checkpoints) = backend.snapshot()?;
        self.mutate(|state| {
            let current = relationship_mut(state, &pending.relationship_id)?;
            if current.status != RelationshipStatus::Active
                && !matches!(
                    &pending.message,
                    ApplicationMessage::RelationshipRevocation(_)
                )
            {
                return Err(PeerError::Authorization(
                    "only a queued relationship revocation may use a revoked channel".into(),
                ));
            }
            if current.outbound_sequence != relationship.outbound_sequence {
                return Err(PeerError::StateConflict(
                    "relationship sequence changed during MLS encryption".into(),
                ));
            }
            current.outbound_sequence = sequence;
            state.mls_states = mls_states;
            state.mls_checkpoints = mls_checkpoints;
            let pending_index = state
                .pending_applications
                .iter()
                .position(|candidate| candidate.message_id == pending.message_id)
                .ok_or_else(|| {
                    PeerError::StateConflict(
                        "pending application disappeared during MLS encryption".into(),
                    )
                })?;
            state.pending_applications.remove(pending_index);
            enqueue_outbound_packet(
                state,
                Some(pending.relationship_id.clone()),
                packet,
                &relationship.remote_endpoints,
                relationship.remote_certificate,
                now,
            )
        })
    }

    fn materialize_pending_applications(&self, now: u64) -> Result<()> {
        let snapshot = self.state_snapshot()?;
        let ready = snapshot
            .pending_applications
            .iter()
            .filter(|pending| pending.expires_at > now)
            .filter(|pending| {
                snapshot
                    .mls_relationships
                    .iter()
                    .any(|binding| binding.relationship_id == pending.relationship_id)
            })
            .take(16)
            .cloned()
            .collect::<Vec<_>>();
        if snapshot
            .pending_applications
            .iter()
            .any(|pending| pending.expires_at <= now)
        {
            self.mutate(|state| {
                state
                    .pending_applications
                    .retain(|pending| pending.expires_at > now);
                Ok(())
            })?;
        }
        for pending in ready {
            self.materialize_application_message(&pending, now)?;
        }
        Ok(())
    }

    #[allow(clippy::too_many_lines)]
    fn ingest_application_envelope(
        &self,
        packet: &PeerWirePacket,
        envelope: &SignedEnvelope,
        acknowledgement: &SignedDeliveryAck,
        now: u64,
    ) -> Result<()> {
        let snapshot = self.state_snapshot()?;
        let local_identity = self.identity.load_full();
        if snapshot.host_credential_rotation.is_some() {
            return Err(PeerError::StateConflict(
                "application traffic is paused during host credential rotation".into(),
            ));
        }
        let relationship = snapshot
            .relationships
            .iter()
            .find(|relationship| {
                relationship.status == RelationshipStatus::Active
                    && relationship.remote_certificate.body.device_id
                        == envelope.body.sender_device_id
                    && channel_id_for_relationship(&relationship.id)
                        .is_ok_and(|channel| channel == envelope.body.channel_id)
            })
            .cloned()
            .ok_or_else(|| {
                PeerError::Authorization(
                    "peer envelope is not bound to an active relationship channel".into(),
                )
            })?;
        let trust = mls_trust(
            self.identity.load().certificate(),
            &relationship.remote_certificate,
            now,
        )?;
        envelope.verify_trusted(&relationship.remote_certificate, &trust, now)?;
        if envelope.body.protocol != ProtocolVersion::CURRENT {
            return Err(PeerError::Version(
                "peer envelope does not use the pinned protocol version".into(),
            ));
        }
        let binding = snapshot
            .mls_relationships
            .iter()
            .find(|binding| binding.relationship_id == relationship.id)
            .cloned()
            .ok_or_else(|| PeerError::Transport("relationship has no OpenMLS state".into()))?;
        let mut next_replay = binding.inbound_replay.clone();
        next_replay.admit(
            envelope.body.sequence,
            envelope.body.message_id,
            envelope.body.mls_group_epoch,
        )?;
        let (backend, coordinator) = self.mls_runtime(&snapshot)?;
        let mut session = MlsSession::load(
            binding.state_id,
            self.mls_identity(now)?,
            &trust,
            now,
            &coordinator,
        )?;
        if envelope.body.mls_group_epoch != session.epoch() {
            return Err(PeerError::Replay(
                "peer envelope MLS epoch does not match durable group state".into(),
            ));
        }
        let processed = session.process_message(
            envelope.body.mls_ciphertext.as_slice(),
            &trust,
            now,
            &coordinator,
        )?;
        let ProcessedMlsMessage::Application(plaintext) = processed else {
            return Err(PeerError::Authentication(
                "application envelope contained an MLS commit".into(),
            ));
        };
        let application = decode_application(&plaintext)?;
        envelope.verify_application_kind(&application)?;

        let mut inbound_query = None;
        let mut query_response = None;
        let mut resync_response = None;
        match &application {
            ApplicationMessage::GrantProposal(grant) => {
                if grant.relationship_id != relationship.id
                    || grant.signatures.is_empty()
                    || grant.signatures.iter().any(|signature| {
                        signature.device_id != device_id(&relationship.remote_certificate)
                    })
                {
                    return Err(PeerError::Authorization(
                        "grant proposal is not signed by the relationship peer".into(),
                    ));
                }
                validate_directional_grant_signatures(grant, &relationship, false)?;
                let grant_trust = grant_trust(
                    &relationship,
                    self.identity.load().certificate(),
                    grant,
                    now,
                    false,
                )?;
                for signature in &grant.signatures {
                    verify_grant_consent_signature(grant, signature, &grant_trust, now)?;
                }
            }
            ApplicationMessage::GrantAcceptance(grant) => {
                if grant.relationship_id != relationship.id {
                    return Err(PeerError::Authorization(
                        "grant acceptance targets a different relationship".into(),
                    ));
                }
                validate_directional_grant_signatures(grant, &relationship, true)?;
                let grant_trust = grant_trust(
                    &relationship,
                    self.identity.load().certificate(),
                    grant,
                    now,
                    false,
                )?;
                verify_active_grant(grant, &grant_trust, now)?;
            }
            ApplicationMessage::GrantRevocation(grant) => {
                if grant.relationship_id != relationship.id
                    || grant.signatures.is_empty()
                    || grant.signatures.iter().any(|signature| {
                        signature.device_id != device_id(&relationship.remote_certificate)
                    })
                {
                    return Err(PeerError::Authorization(
                        "grant revocation is not signed by the relationship peer".into(),
                    ));
                }
                validate_directional_grant_signatures(grant, &relationship, false)?;
                let grant_trust = grant_trust(
                    &relationship,
                    self.identity.load().certificate(),
                    grant,
                    now,
                    false,
                )?;
                for signature in &grant.signatures {
                    verify_grant_consent_signature(grant, signature, &grant_trust, now)?;
                }
                let predecessor = relationship
                    .grants
                    .iter()
                    .filter(|stored| stored.grant.id == grant.id)
                    .max_by_key(|stored| stored.grant.sequence)
                    .ok_or_else(|| {
                        PeerError::Authorization("grant revocation has no local predecessor".into())
                    })?;
                if grant.sequence != predecessor.grant.sequence.saturating_add(1)
                    || grant.previous_version_hash.as_deref()
                        != Some(predecessor.grant.version_hash_hex()?.as_str())
                {
                    return Err(PeerError::Replay(
                        "grant revocation does not continue the durable hash chain".into(),
                    ));
                }
            }
            ApplicationMessage::QueryRequest(request) => {
                let encoded = encode_limited::<{ 256 * 1024 }, _>(request)?;
                let request_hash = *blake3::hash(&encoded).as_bytes();
                if let Some(existing) = snapshot
                    .inbound_queries
                    .iter()
                    .find(|existing| existing.query_id == request.query_id)
                {
                    if existing.request_hash != request_hash {
                        return Err(PeerError::Replay(
                            "query id was reused with a different request".into(),
                        ));
                    }
                } else {
                    let grant = authorize_legacy_inbound_wire_query(
                        &snapshot.owner_user_id,
                        &relationship,
                        request,
                        self.identity.load().certificate(),
                        now,
                    )?;
                    inbound_query = Some(StoredInboundQuery::legacy(LegacyStoredInboundQuery {
                        query_id: request.query_id,
                        request_hash,
                    }));
                    query_response = Some(unavailable_query_response(
                        request,
                        grant,
                        self.identity.load().certificate(),
                        now,
                    )?);
                }
            }
            ApplicationMessage::QueryRequestV2(request) => {
                let encoded = encode_limited::<{ 256 * 1024 }, _>(request)?;
                let request_hash = *blake3::hash(&encoded).as_bytes();
                if let Some(existing) = snapshot
                    .inbound_queries
                    .iter()
                    .find(|existing| existing.query_id == request.request.query_id)
                {
                    if existing.request_hash != request_hash {
                        return Err(PeerError::Replay(
                            "query id was reused with a different request".into(),
                        ));
                    }
                } else {
                    let authorization = authorize_inbound_wire_query(
                        &snapshot.owner_user_id,
                        &relationship,
                        request,
                        self.identity.load().certificate(),
                        &snapshot.inbound_queries,
                        now,
                    )?;
                    inbound_query = Some(StoredInboundQuery {
                        query_id: request.request.query_id,
                        request_hash,
                        relationship_id: Some(relationship.id.clone()),
                        wire_query: Some(StoredInboundWireQuery::V2(request.clone())),
                        grant_id: Some(authorization.grant_id),
                        rule_id: Some(authorization.rule_id),
                        grant_verification_id: Some(authorization.grant_verification_id),
                        verified_grant_hash: Some(authorization.verified_grant_hash),
                        effective_fields: authorization.effective_fields,
                        redacted_fields: authorization.redacted_fields,
                        maximum_result_count: authorization.maximum_result_count,
                        maximum_payload_bytes: authorization.maximum_payload_bytes,
                        requester_device_id: Some(relationship.remote_certificate.body.device_id),
                        requester_certificate_hash: Some(
                            relationship.remote_certificate.fingerprint()?,
                        ),
                        received_at: now,
                        expires_at: request.request.expires_at,
                        claim: None,
                        response_message_id: None,
                    });
                }
            }
            ApplicationMessage::QueryResponse(response) => {
                response.validate()?;
                let exchange = snapshot
                    .query_exchanges
                    .iter()
                    .find(|exchange| exchange.query_id == response.query_id)
                    .ok_or_else(|| {
                        PeerError::Authorization(
                            "query response has no durable local request".into(),
                        )
                    })?;
                if exchange.relationship_id != relationship.id
                    || exchange.grant_id != response.metadata.grant_id
                    || exchange.grant_sequence != response.metadata.grant_sequence
                    || exchange.projection != response.metadata.projection
                    || response.metadata.source_principal
                        != relationship.remote_certificate.body.principal_id
                    || response.metadata.source_device
                        != relationship.remote_certificate.body.device_id
                    || now > exchange.expires_at.saturating_add(MAX_CLOCK_SKEW_SECONDS)
                {
                    return Err(PeerError::Authentication(
                        "query response provenance does not match its durable request".into(),
                    ));
                }
            }
            ApplicationMessage::ProjectionDelta(delta) => {
                if delta.relationship_id.0
                    != decode_hex_array::<16>(&relationship.id, "relationship id")?
                {
                    return Err(PeerError::Authorization(
                        "projection delta targets a different relationship".into(),
                    ));
                }
            }
            ApplicationMessage::DeviceRemoval(removal) => {
                if removal.device_id != self.identity.load().certificate().body.device_id
                    || removal.removal_sequence != self.identity.load().certificate().body.serial
                    || removal.previous_update_hash
                        != self.identity.load().certificate().fingerprint()?
                    || removal.removed_at > now.saturating_add(MAX_CLOCK_SKEW_SECONDS)
                {
                    return Err(PeerError::Authentication(
                        "device removal is not bound to the authenticated remote certificate"
                            .into(),
                    ));
                }
            }
            ApplicationMessage::RelationshipRevocation(revocation) => {
                if revocation.relationship_id.0
                    != decode_hex_array::<16>(&relationship.id, "relationship id")?
                    || revocation.revoked_at > now.saturating_add(MAX_CLOCK_SKEW_SECONDS)
                {
                    return Err(PeerError::Authentication(
                        "relationship revocation is not bound to this authenticated channel".into(),
                    ));
                }
            }
            ApplicationMessage::ResyncRequest(request) => {
                if request.relationship_id.0
                    != decode_hex_array::<16>(&relationship.id, "relationship id")?
                {
                    return Err(PeerError::Authorization(
                        "resync request targets a different relationship".into(),
                    ));
                }
                if request.last_good_epoch > session.epoch()
                    || request.last_good_sequence > relationship.outbound_sequence
                {
                    return Err(PeerError::Replay(
                        "resync request claims state ahead of the authenticated sender".into(),
                    ));
                }
                resync_response = Some(ProtocolErrorMessage {
                    code: ProtocolErrorCode::TemporarilyUnavailable,
                    retryable: true,
                    related_id: Some(envelope.body.message_id.0),
                    detail: BoundedString::new(
                        "Forge content source is unavailable for projection resync",
                    )?,
                });
            }
            ApplicationMessage::Acknowledgement(_) | ApplicationMessage::Error(_) => {}
            _ => {
                return Err(PeerError::Transport(
                    "authenticated application kind is not operationally supported".into(),
                ));
            }
        }

        let mut response_packet = None;
        let mut response_sequence = None;
        let immediate_response = query_response
            .as_ref()
            .map(|response| {
                (
                    ApplicationMessage::QueryResponse(response.clone()),
                    response
                        .metadata
                        .valid_until
                        .min(now.saturating_add(5 * 60)),
                )
            })
            .or_else(|| {
                resync_response.map(|response| {
                    (
                        ApplicationMessage::Error(response),
                        envelope.body.expires_at.min(now.saturating_add(5 * 60)),
                    )
                })
            });
        if let Some((response_message, response_expires_at)) = immediate_response {
            let sequence = relationship
                .outbound_sequence
                .checked_add(1)
                .ok_or_else(|| PeerError::StateConflict("relationship sequence overflow".into()))?;
            let response_plaintext = encode_application(&response_message)?;
            let response_ciphertext =
                session.encrypt_application(&response_plaintext, &trust, now, &coordinator)?;
            let response_envelope = SignedEnvelope::sign(
                EnvelopeBody {
                    protocol: ProtocolVersion::CURRENT,
                    channel_id: channel_id_for_relationship(&relationship.id)?,
                    message_id: EnvelopeMessageId::random(),
                    sender_device_id: self.identity.load().certificate().body.device_id,
                    sequence,
                    previous_acknowledgement: PreviousAcknowledgement {
                        highest_contiguous_sequence: next_replay.highest_sequence,
                        received_bitmap: next_replay.received_bitmap,
                    },
                    message_kind: response_message.kind(),
                    created_at: now,
                    expires_at: response_expires_at,
                    mls_group_epoch: session.epoch(),
                    mls_ciphertext: BoundedBytes::new(response_ciphertext)?,
                },
                self.identity.load().device_signer(),
            )?;
            response_packet = Some(PeerWirePacket::new(
                PeerWirePayload::Envelope(Box::new(response_envelope)),
                now,
                response_expires_at,
            )?);
            response_sequence = Some(sequence);
        }
        let (mls_states, mls_checkpoints) = backend.snapshot()?;
        self.mutate(|state| {
            state.mls_states = mls_states;
            state.mls_checkpoints = mls_checkpoints;
            let mls_binding = state
                .mls_relationships
                .iter_mut()
                .find(|binding| binding.relationship_id == relationship.id)
                .ok_or_else(|| {
                    PeerError::Rollback("MLS relationship binding disappeared".into())
                })?;
            if mls_binding.inbound_replay != binding.inbound_replay {
                return Err(PeerError::StateConflict(
                    "inbound replay state changed during MLS processing".into(),
                ));
            }
            mls_binding.inbound_replay = next_replay;

            match application {
                ApplicationMessage::GrantProposal(grant) => {
                    let current = active_relationship_mut(state, &relationship.id)?;
                    validate_directional_grant_signatures(&grant, current, false)?;
                    append_grant(current, *grant, None, None)?;
                }
                ApplicationMessage::GrantAcceptance(grant) => {
                    let current = active_relationship_mut(state, &relationship.id)?;
                    validate_directional_grant_signatures(&grant, current, true)?;
                    let trust = grant_trust(
                        current,
                        self.identity.load().certificate(),
                        &grant,
                        now,
                        false,
                    )?;
                    let evidence = verify_active_grant(&grant, &trust, now)?;
                    let verified_hash = evidence.verified_grant_hash().to_owned();
                    let verification_id = format!("fpv_{}", &verified_hash[..32]);
                    store_active_grant(current, *grant, verification_id, verified_hash)?;
                }
                ApplicationMessage::GrantRevocation(grant) => {
                    let revoked_at = grant
                        .revoked_at
                        .as_deref()
                        .map(|value| parse_timestamp(value, "grant revokedAt"))
                        .transpose()?
                        .unwrap_or(now);
                    let grant_id = grant.id.clone();
                    let current = active_relationship_mut(state, &relationship.id)?;
                    validate_directional_grant_signatures(&grant, current, false)?;
                    append_grant(current, (*grant).clone(), None, None)?;
                    state
                        .query_results
                        .retain(|result| result.relationship_id != relationship.id);
                    state.grant_revocations.push(StoredGrantRevocation {
                        relationship_id: relationship.id.clone(),
                        grant_id: grant_id.clone(),
                        sequence: grant.sequence,
                        reason: "authenticated remote revocation".into(),
                        revoked_at,
                    });
                    append_revocation_event(
                        state,
                        RevocationEventDraft {
                            kind: RevocationEventKind::Grant,
                            source: RevocationEventSource::AuthenticatedPeer,
                            relationship_id: relationship.id.clone(),
                            grant_id: Some(grant_id),
                            device_id: None,
                            target_certificate: None,
                            reason: "authenticated remote revocation".into(),
                            occurred_at: revoked_at,
                            authenticated_remote_principal_id: Some(principal_id(
                                &relationship.remote_certificate,
                            )),
                            authenticated_remote_device_id: Some(device_id(
                                &relationship.remote_certificate,
                            )),
                        },
                        local_identity.certificate(),
                        local_identity.device_signer(),
                    )?;
                }
                ApplicationMessage::QueryResponse(response) => {
                    let exchange = state
                        .query_exchanges
                        .iter_mut()
                        .find(|exchange| exchange.query_id == response.query_id)
                        .ok_or_else(|| PeerError::Rollback("query exchange disappeared".into()))?;
                    if exchange
                        .response
                        .as_ref()
                        .is_some_and(|prior| prior != &response)
                    {
                        return Err(PeerError::StateConflict(
                            "query response conflicts with prior authenticated result".into(),
                        ));
                    }
                    exchange.response = Some(response);
                }
                ApplicationMessage::ProjectionDelta(delta) => {
                    if state.projection_deltas.len() >= MAX_QUERY_RESULTS {
                        state.projection_deltas.remove(0);
                    }
                    state.projection_deltas.push(delta);
                }
                ApplicationMessage::DeviceRemoval(removal) => {
                    let current = relationship_mut(state, &relationship.id)?;
                    let device = current
                        .devices
                        .iter_mut()
                        .find(|device| {
                            device.certificate.body.device_id
                                == relationship.remote_certificate.body.device_id
                        })
                        .ok_or_else(|| {
                            PeerError::Rollback("authenticated removed device disappeared".into())
                        })?;
                    device.status = StoredDeviceStatus::Removed;
                    state
                        .query_results
                        .retain(|result| result.relationship_id != relationship.id);
                    append_revocation_event(
                        state,
                        RevocationEventDraft {
                            kind: RevocationEventKind::Device,
                            source: RevocationEventSource::AuthenticatedPeer,
                            relationship_id: relationship.id.clone(),
                            grant_id: None,
                            device_id: Some(hex::encode(removal.device_id.0)),
                            target_certificate: Some(local_identity.certificate().clone()),
                            reason: "authenticated peer removed local device".into(),
                            occurred_at: removal.removed_at,
                            authenticated_remote_principal_id: Some(principal_id(
                                &relationship.remote_certificate,
                            )),
                            authenticated_remote_device_id: Some(device_id(
                                &relationship.remote_certificate,
                            )),
                        },
                        local_identity.certificate(),
                        local_identity.device_signer(),
                    )?;
                }
                ApplicationMessage::RelationshipRevocation(revocation) => {
                    let revoked_at = revocation.revoked_at;
                    let reason = revocation.reason.into_string();
                    let current = relationship_mut(state, &relationship.id)?;
                    current.status = RelationshipStatus::Revoked;
                    current.revoked_reason = Some(reason.clone());
                    state
                        .query_results
                        .retain(|result| result.relationship_id != relationship.id);
                    state
                        .pending_applications
                        .retain(|pending| pending.relationship_id != relationship.id);
                    state.transport_outbox.retain(|outbound| {
                        outbound.relationship_id.as_deref() != Some(relationship.id.as_str())
                    });
                    append_revocation_event(
                        state,
                        RevocationEventDraft {
                            kind: RevocationEventKind::Relationship,
                            source: RevocationEventSource::AuthenticatedPeer,
                            relationship_id: relationship.id.clone(),
                            grant_id: None,
                            device_id: None,
                            target_certificate: None,
                            reason,
                            occurred_at: revoked_at,
                            authenticated_remote_principal_id: Some(principal_id(
                                &relationship.remote_certificate,
                            )),
                            authenticated_remote_device_id: Some(device_id(
                                &relationship.remote_certificate,
                            )),
                        },
                        local_identity.certificate(),
                        local_identity.device_signer(),
                    )?;
                }
                _ => {}
            }
            if let Some(inbound_query) = inbound_query {
                if state.inbound_queries.len() >= MAX_QUERY_EXCHANGES {
                    return Err(limit("durable inbound query bridge limit reached"));
                }
                state.inbound_queries.push(inbound_query);
            }
            if let Some(sequence) = response_sequence {
                active_relationship_mut(state, &relationship.id)?.outbound_sequence = sequence;
            }
            if let Some(packet) = response_packet {
                enqueue_outbound_packet(
                    state,
                    Some(relationship.id.clone()),
                    packet,
                    &relationship.remote_endpoints,
                    relationship.remote_certificate.clone(),
                    now,
                )?;
            }
            append_inbound_receipt(state, packet, acknowledgement)
        })
    }

    #[allow(clippy::too_many_lines)]
    fn sign_grant(&self, input: SignGrantInput) -> Result<GrantOperationResult> {
        self.require_owner(&input.owner_user_id)?;
        input.grant.validate()?;
        let now = self.checked_now()?;
        let mut signed = input.grant;
        let mut provenance = None;
        self.mutate(|state| {
            let owner_user_id = state.owner_user_id.clone();
            let relationship = active_relationship_mut(state, &input.relationship_id)?;
            if signed.relationship_id != relationship.id {
                return Err(PeerError::Authorization(
                    "grant relationship is not bound to durable daemon state".into(),
                ));
            }
            if !matches!(
                signed.status,
                GrantStatus::Proposed | GrantStatus::Countered
            ) {
                return Err(PeerError::Authorization(
                    "sign_grant accepts only proposed or countered consent versions".into(),
                ));
            }
            let local_device_id = device_id(self.identity.load().certificate());
            if signed
                .signatures
                .iter()
                .any(|signature| signature.device_id == local_device_id)
            {
                return Err(PeerError::StateConflict(
                    "local device already signed this grant version".into(),
                ));
            }
            let has_remote_signatures = !signed.signatures.is_empty();
            if !has_remote_signatures && signed.owner_user_id != owner_user_id {
                return Err(PeerError::Authorization(
                    "locally initiated grant owner is not bound to the daemon owner".into(),
                ));
            }
            let local_party = if has_remote_signatures {
                validate_directional_grant_signatures(&signed, relationship, false)?;
                remote_grant_party(signed.direction)
            } else {
                local_grant_party(signed.direction)
            };
            let pending_index = if has_remote_signatures {
                Some(
                    relationship
                        .grants
                        .iter()
                        .position(|stored| stored.grant == signed)
                        .ok_or_else(|| {
                            PeerError::Authorization(
                                "remotely signed grant was not received over the authenticated relationship"
                                    .into(),
                            )
                        })?,
                )
            } else {
                None
            };
            let metadata = GrantSignerMetadata {
                device_id: local_device_id,
                party: local_party,
                algorithm: GrantSignatureAlgorithm::Ed25519,
                signed_at: format_timestamp(now)?,
            };
            let signature = sign_grant_consent(
                &signed,
                metadata,
                self.identity.load().device_signer(),
                self.identity.load().certificate(),
            )?;
            signed.signatures.push(signature);
            if has_remote_signatures {
                signed.status = GrantStatus::Active;
            }
            signed.validate()?;
            validate_directional_grant_signatures(
                &signed,
                relationship,
                !has_remote_signatures,
            )?;
            if has_remote_signatures {
                let trust = grant_trust(
                    relationship,
                    self.identity.load().certificate(),
                    &signed,
                    now,
                    true,
                )?;
                let evidence = verify_active_grant(&signed, &trust, now)?;
                let verified_hash = evidence.verified_grant_hash().to_owned();
                let verification_id = format!("fpv_{}", &verified_hash[..32]);
                let _index = pending_index.ok_or_else(|| {
                    PeerError::StateConflict("pending grant index disappeared".into())
                })?;
                store_active_grant(
                    relationship,
                    signed.clone(),
                    verification_id,
                    verified_hash,
                )?;
            } else {
                append_grant(relationship, signed.clone(), None, None)?;
            }
            provenance = Some(relationship.clone());
            Ok(())
        })?;
        let relationship = provenance.ok_or_else(|| {
            PeerError::StateConflict("grant signing lost relationship state".into())
        })?;
        let message = if signed.status == GrantStatus::Active {
            ApplicationMessage::GrantAcceptance(Box::new(signed.clone()))
        } else {
            ApplicationMessage::GrantProposal(Box::new(signed.clone()))
        };
        self.queue_application_message(
            &relationship.id,
            &message,
            now,
            now.saturating_add(5 * 60),
        )?;
        Ok(GrantOperationResult {
            grant: signed,
            provenance: self.provenance(Some(&relationship), now)?,
        })
    }

    fn accept_grant(&self, input: AcceptGrantInput) -> Result<GrantOperationResult> {
        self.require_owner(&input.owner_user_id)?;
        input.grant.validate()?;
        let now = self.checked_now()?;
        let accepted = input.grant;
        let mut stored_relationship = None;
        self.mutate(|state| {
            let relationship = active_relationship_mut(state, &accepted.relationship_id)?;
            if accepted.relationship_id != relationship.id {
                return Err(PeerError::Authorization(
                    "grant relationship is not bound to durable daemon state".into(),
                ));
            }
            if accepted.status != GrantStatus::Active {
                return Err(PeerError::StateConflict(
                    "grant acceptance requires the remotely countersigned active version".into(),
                ));
            }
            if !relationship
                .grants
                .iter()
                .any(|stored| stored.grant == accepted)
            {
                return Err(PeerError::Authorization(
                    "active grant was not received over the authenticated relationship".into(),
                ));
            }
            validate_directional_grant_signatures(&accepted, relationship, true)?;
            let trust = grant_trust(
                relationship,
                self.identity.load().certificate(),
                &accepted,
                now,
                true,
            )?;
            let evidence = verify_active_grant(&accepted, &trust, now)?;
            let verified_hash = evidence.verified_grant_hash().to_owned();
            let verification_id = format!("fpv_{}", &verified_hash[..32]);
            store_active_grant(
                relationship,
                accepted.clone(),
                verification_id,
                verified_hash,
            )?;
            stored_relationship = Some(relationship.clone());
            Ok(())
        })?;
        let relationship = stored_relationship.ok_or_else(|| {
            PeerError::StateConflict("grant acceptance lost relationship state".into())
        })?;
        Ok(GrantOperationResult {
            grant: accepted,
            provenance: self.provenance(Some(&relationship), now)?,
        })
    }

    #[allow(clippy::too_many_lines)]
    fn revoke_grant(&self, input: RevokeGrantInput) -> Result<GrantOperationResult> {
        self.require_owner(&input.owner_user_id)?;
        input.grant.validate()?;
        validate_text(
            &input.reason,
            1,
            MAX_REASON_BYTES,
            "grant revocation reason",
        )?;
        if input.grant.status != GrantStatus::Revoked || !input.grant.signatures.is_empty() {
            return Err(PeerError::Authorization(
                "grant revocation requires an unsigned revoked successor version".into(),
            ));
        }
        let now = self.checked_now()?;
        let issued_at = parse_timestamp(&input.grant.issued_at, "grant issuedAt")?;
        let revoked_at = input
            .grant
            .revoked_at
            .as_deref()
            .map(|value| parse_timestamp(value, "grant revokedAt"))
            .transpose()?
            .ok_or_else(|| invalid("revoked grant has no revokedAt timestamp"))?;
        if issued_at != revoked_at
            || issued_at > now.saturating_add(MAX_CLOCK_SKEW_SECONDS)
            || issued_at.saturating_add(MAX_CLOCK_SKEW_SECONDS) < now
        {
            return Err(PeerError::Authentication(
                "grant revocation timestamp is outside the accepted command window".into(),
            ));
        }
        let mut revoked = input.grant;
        let mut stored_relationship = None;
        let local_identity = self.identity.load_full();
        self.mutate(|state| {
            let owner_user_id = state.owner_user_id.clone();
            let relationship = active_relationship_mut(state, &revoked.relationship_id)?;
            validate_grant_binding(&revoked, &owner_user_id, relationship)?;
            let previous = relationship
                .grants
                .iter()
                .filter(|stored| stored.grant.id == revoked.id)
                .max_by_key(|stored| stored.grant.sequence)
                .cloned()
                .ok_or_else(|| {
                    PeerError::Authorization("grant revocation has no durable predecessor".into())
                })?;
            if matches!(
                previous.grant.status,
                GrantStatus::Revoked | GrantStatus::Superseded | GrantStatus::Expired
            ) {
                return Err(PeerError::StateConflict(
                    "grant head is already terminal".into(),
                ));
            }
            let mut expected = previous.grant.clone();
            expected.sequence = previous
                .grant
                .sequence
                .checked_add(1)
                .ok_or_else(|| PeerError::StateConflict("grant sequence overflow".into()))?;
            expected.previous_version_hash = Some(previous.grant.version_hash_hex()?);
            expected.status = GrantStatus::Revoked;
            expected.issued_at.clone_from(&revoked.issued_at);
            expected.revoked_at.clone_from(&revoked.revoked_at);
            expected.signatures.clear();
            if expected != revoked {
                return Err(PeerError::Authentication(
                    "grant revocation changes fields outside the signed hash-chain transition"
                        .into(),
                ));
            }
            let metadata = GrantSignerMetadata {
                device_id: device_id(self.identity.load().certificate()),
                party: local_grant_party(revoked.direction),
                algorithm: GrantSignatureAlgorithm::Ed25519,
                signed_at: format_timestamp(now)?,
            };
            revoked.signatures.push(sign_grant_consent(
                &revoked,
                metadata,
                self.identity.load().device_signer(),
                self.identity.load().certificate(),
            )?);
            revoked.validate()?;
            validate_directional_grant_signatures(&revoked, relationship, true)?;
            append_grant(relationship, revoked.clone(), None, None)?;
            stored_relationship = Some(relationship.clone());
            state
                .query_results
                .retain(|result| result.relationship_id != revoked.relationship_id);
            if state.grant_revocations.len() >= MAX_GRANT_REVOCATIONS {
                return Err(limit("durable grant revocation history reached its limit"));
            }
            state.grant_revocations.push(StoredGrantRevocation {
                relationship_id: revoked.relationship_id.clone(),
                grant_id: revoked.id.clone(),
                sequence: revoked.sequence,
                reason: input.reason.clone(),
                revoked_at,
            });
            append_revocation_event(
                state,
                RevocationEventDraft {
                    kind: RevocationEventKind::Grant,
                    source: RevocationEventSource::LocalOperator,
                    relationship_id: revoked.relationship_id.clone(),
                    grant_id: Some(revoked.id.clone()),
                    device_id: None,
                    target_certificate: None,
                    reason: input.reason,
                    occurred_at: revoked_at,
                    authenticated_remote_principal_id: None,
                    authenticated_remote_device_id: None,
                },
                local_identity.certificate(),
                local_identity.device_signer(),
            )?;
            Ok(())
        })?;
        let relationship = stored_relationship.ok_or_else(|| {
            PeerError::StateConflict("grant revocation lost relationship state".into())
        })?;
        self.queue_application_message(
            &relationship.id,
            &ApplicationMessage::GrantRevocation(Box::new(revoked.clone())),
            now,
            now.saturating_add(5 * 60),
        )?;
        Ok(GrantOperationResult {
            grant: revoked,
            provenance: self.provenance(Some(&relationship), now)?,
        })
    }

    fn update_device(&self, input: &UpdateDeviceInput) -> Result<MutationResult> {
        self.require_owner(&input.owner_user_id)?;
        validate_text(&input.device_id, 1, MAX_TEXT_BYTES, "device id")?;
        let now = self.checked_now()?;
        let message_id = EnvelopeMessageId::random();
        let mut stored = None;
        let local_identity = self.identity.load_full();
        self.mutate(|state| {
            let relationship_index = state
                .relationships
                .iter()
                .position(|relationship| {
                    relationship.id == input.relationship_id
                        && relationship.status == RelationshipStatus::Active
                })
                .ok_or_else(|| PeerError::Authorization("relationship is not active".into()))?;
            let device_index = state.relationships[relationship_index]
                .devices
                .iter()
                .position(|candidate| candidate.external_device_id == input.device_id)
                .ok_or_else(|| {
                    PeerError::Authorization("device is not bound to the relationship".into())
                })?;
            let current_status =
                state.relationships[relationship_index].devices[device_index].status;
            let next_status = match input.action {
                DeviceAction::Approve => {
                    if current_status == StoredDeviceStatus::Removed {
                        return Err(PeerError::Authorization(
                            "removed device cannot be re-approved without a new certificate event"
                                .into(),
                        ));
                    }
                    StoredDeviceStatus::Approved
                }
                DeviceAction::Remove => StoredDeviceStatus::Removed,
            };
            if next_status == StoredDeviceStatus::Removed
                && current_status != StoredDeviceStatus::Removed
            {
                let relationship_id = state.relationships[relationship_index].id.clone();
                let certificate = state.relationships[relationship_index].devices[device_index]
                    .certificate
                    .clone();
                let removal = ApplicationMessage::DeviceRemoval(DeviceRemoval {
                    device_id: certificate.body.device_id,
                    removal_sequence: certificate.body.serial,
                    previous_update_hash: certificate.fingerprint()?,
                    removed_at: now,
                });
                enqueue_pending_application(
                    state,
                    message_id,
                    &relationship_id,
                    removal,
                    now,
                    now.saturating_add(5 * 60),
                )?;
                state
                    .query_results
                    .retain(|result| result.relationship_id != relationship_id);
                append_revocation_event(
                    state,
                    RevocationEventDraft {
                        kind: RevocationEventKind::Device,
                        source: RevocationEventSource::LocalOperator,
                        relationship_id,
                        grant_id: None,
                        device_id: Some(input.device_id.clone()),
                        target_certificate: Some(certificate),
                        reason: "device removed by local operator".into(),
                        occurred_at: now,
                        authenticated_remote_principal_id: None,
                        authenticated_remote_device_id: None,
                    },
                    local_identity.certificate(),
                    local_identity.device_signer(),
                )?;
            }
            state.relationships[relationship_index].devices[device_index].status = next_status;
            stored = Some(state.relationships[relationship_index].clone());
            Ok(())
        })?;
        Ok(MutationResult {
            provenance: self.provenance(stored.as_ref(), now)?,
        })
    }

    #[allow(clippy::too_many_lines)]
    fn rotate_host_credential(
        &self,
        input: &RotateHostCredentialInput,
    ) -> Result<HostCredentialRotationResult> {
        self.require_owner(&input.owner_user_id)?;
        let now = self.checked_now()?;
        let not_after = parse_timestamp(&input.not_after, "host credential notAfter")?;
        if not_after <= now.saturating_add(24 * 60 * 60)
            || not_after.saturating_sub(now) > 5 * 366 * 24 * 60 * 60
        {
            return Err(limit(
                "host credential lifetime must be more than one day and at most five years",
            ));
        }

        let predecessor = self.identity.load_full();
        predecessor.ensure_operational(now)?;
        let predecessor_copy = LocalIdentityState::decode_secret(&predecessor.encode_secret()?)?;
        let successor = predecessor_copy.rotate(now, not_after - now)?;
        validate_certificate_successor(predecessor.certificate(), successor.certificate(), now)?;
        let packet_expires_at = now
            .saturating_add(24 * 60 * 60)
            .min(predecessor.certificate().body.not_after)
            .min(successor.certificate().body.not_after);
        if packet_expires_at <= now.saturating_add(60) {
            return Err(PeerError::Authorization(
                "predecessor certificate expires too soon to complete authenticated rotation"
                    .into(),
            ));
        }

        let snapshot = self.state_snapshot()?;
        if snapshot.host_credential_rotation.is_some() {
            return Err(PeerError::StateConflict(
                "a host credential rotation is already pending".into(),
            ));
        }
        let open_queries = snapshot
            .query_exchanges
            .iter()
            .filter(|exchange| exchange.response.is_none() && exchange.expires_at > now)
            .count();
        let live_invitations = snapshot
            .invitations
            .iter()
            .filter(|invitation| {
                !invitation.consumed && invitation.bundle.signed_invite.body.expires_at > now
            })
            .count();
        let open_pairings = snapshot
            .pairings
            .iter()
            .filter(|pairing| {
                pairing.confirmed_relationship_id.is_none()
                    && pairing.transcript_body.expires_at > now
            })
            .count();
        let outbox_summary = snapshot
            .transport_outbox
            .iter()
            .take(8)
            .map(|outbound| {
                let kind = match &outbound.packet.payload {
                    PeerWirePayload::PairingAcceptance(_) => "pairing_acceptance".into(),
                    PeerWirePayload::MlsWelcome(_) => "mls_welcome".into(),
                    PeerWirePayload::HostCredentialRotation(_) => "host_rotation".into(),
                    PeerWirePayload::Envelope(envelope) => {
                        format!("envelope_{:?}", envelope.body.message_kind).to_ascii_lowercase()
                    }
                };
                format!("{kind}:attempts={}", outbound.attempts)
            })
            .collect::<Vec<_>>()
            .join(",");
        let readiness_summary = self
            .transport_readiness()?
            .into_iter()
            .take(8)
            .map(|readiness| format!("{:?}:{}", readiness.kind, readiness.detail_code))
            .collect::<Vec<_>>()
            .join(",");
        if !snapshot.transport_outbox.is_empty()
            || !snapshot.pending_applications.is_empty()
            || !snapshot.pending_mls_clients.is_empty()
            || open_queries != 0
            || live_invitations != 0
            || open_pairings != 0
        {
            return Err(PeerError::StateConflict(format!(
                "host credential rotation requires drained work (outbox={}, outboxSummary=[{outbox_summary}], transportReadiness=[{readiness_summary}], pendingApplications={}, pendingMlsClients={}, openQueries={open_queries}, liveInvitations={live_invitations}, openPairings={open_pairings})",
                snapshot.transport_outbox.len(),
                snapshot.pending_applications.len(),
                snapshot.pending_mls_clients.len(),
            )));
        }
        let mut relationships = snapshot
            .relationships
            .iter()
            .filter(|relationship| relationship.status == RelationshipStatus::Active)
            .cloned()
            .collect::<Vec<_>>();
        relationships.sort_by(|left, right| left.id.cmp(&right.id));
        if relationships.is_empty() {
            return Err(PeerError::StateConflict(
                "active host credential rotation requires at least one relationship; use the offline identity command when none are active"
                    .into(),
            ));
        }
        if relationships.iter().any(|relationship| {
            relationship.local_certificate_history.len() >= MAX_RELATIONSHIP_CERTIFICATE_HISTORY
        }) {
            return Err(limit(
                "local credential rotation exceeds relationship certificate history",
            ));
        }

        let (backend, coordinator) = self.mls_runtime(&snapshot)?;
        let predecessor_mls = Self::mls_identity_from(&predecessor, now)?;
        let successor_mls = Self::mls_identity_from(&successor, now)?;
        let mut packets = Vec::with_capacity(relationships.len());
        for relationship in &relationships {
            if relationship.local_certificate != *predecessor.certificate() {
                return Err(PeerError::Authentication(
                    "active relationship is not bound to the current host predecessor".into(),
                ));
            }
            let binding = snapshot
                .mls_relationships
                .iter()
                .find(|binding| binding.relationship_id == relationship.id)
                .ok_or_else(|| {
                    PeerError::StateConflict(
                        "active relationship has no durable MLS binding".into(),
                    )
                })?;
            let trust = mls_trust(
                predecessor.certificate(),
                &relationship.remote_certificate,
                now,
            )?;
            let mut session = MlsSession::load(
                binding.state_id,
                predecessor_mls.clone(),
                &trust,
                now,
                &coordinator,
            )?;
            trust.admit_certificate(successor.certificate(), now)?;
            let commit =
                session.rotate_identity(successor_mls.clone(), &trust, now, &coordinator)?;
            let rotation = SignedHostCredentialRotation::sign(
                HostCredentialRotationBody {
                    version: 1,
                    relationship_id: decode_hex_array::<16>(&relationship.id, "relationship id")?,
                    predecessor_certificate: predecessor.certificate().clone(),
                    successor_certificate: successor.certificate().clone(),
                    mls_commit: BoundedBytes::new(commit)?,
                    created_at: now,
                    expires_at: packet_expires_at,
                },
                predecessor.device_signer(),
            )?;
            let packet = PeerWirePacket::new(
                PeerWirePayload::HostCredentialRotation(rotation),
                now,
                packet_expires_at,
            )?;
            let packet_hash = packet.hash()?;
            packets.push((relationship.clone(), packet, packet_hash));
        }
        let (mls_states, mls_checkpoints) = backend.snapshot()?;
        let successor_identity = successor.encode_secret()?.to_vec();
        self.mutate(|state| {
            if state.host_credential_rotation.is_some()
                || !state.transport_outbox.is_empty()
                || !state.pending_applications.is_empty()
            {
                return Err(PeerError::StateConflict(
                    "daemon work changed while host rotation was being prepared".into(),
                ));
            }
            state.mls_states = mls_states;
            state.mls_checkpoints = mls_checkpoints;
            let mut stored_relationships = Vec::with_capacity(packets.len());
            for (relationship, packet, packet_hash) in &packets {
                let current = active_relationship(state, &relationship.id)?;
                if current.local_certificate != *predecessor.certificate()
                    || current.remote_certificate != relationship.remote_certificate
                    || current.remote_endpoints != relationship.remote_endpoints
                {
                    return Err(PeerError::StateConflict(
                        "relationship changed while host rotation was being prepared".into(),
                    ));
                }
                enqueue_outbound_packet(
                    state,
                    Some(relationship.id.clone()),
                    packet.clone(),
                    &relationship.remote_endpoints,
                    relationship.remote_certificate.clone(),
                    now,
                )?;
                stored_relationships.push(StoredRelationshipRotation {
                    relationship_id: relationship.id.clone(),
                    packet_id: packet.packet_id,
                    packet_hash: *packet_hash,
                    acknowledged: false,
                });
            }
            state.host_credential_rotation = Some(StoredHostCredentialRotation {
                predecessor_certificate: predecessor.certificate().clone(),
                successor_certificate: successor.certificate().clone(),
                successor_identity,
                relationships: stored_relationships,
                started_at: now,
            });
            Ok(())
        })?;

        Ok(HostCredentialRotationResult {
            predecessor_certificate_hash: hex::encode(predecessor.certificate().fingerprint()?),
            successor: device_view(successor.certificate(), self.endpoints.as_slice())?,
            relationship_ids: relationships
                .into_iter()
                .map(|relationship| relationship.id)
                .collect(),
            state: HostCredentialRotationState::AwaitingPeerAcknowledgements,
            provenance: self.provenance(None, now)?,
        })
    }

    fn revoke_relationship(&self, input: RevokeRelationshipInput) -> Result<MutationResult> {
        self.require_owner(&input.owner_user_id)?;
        validate_text(&input.reason, 1, MAX_REASON_BYTES, "revocation reason")?;
        let now = self.checked_now()?;
        let message_id = EnvelopeMessageId::random();
        let mut stored = None;
        let local_identity = self.identity.load_full();
        self.mutate(|state| {
            let relationship_index = state
                .relationships
                .iter()
                .position(|relationship| relationship.id == input.relationship_id)
                .ok_or_else(|| {
                    PeerError::Authorization("relationship is not bound to this daemon".into())
                })?;
            if state.relationships[relationship_index].status == RelationshipStatus::Revoked {
                if state.relationships[relationship_index]
                    .revoked_reason
                    .as_deref()
                    != Some(input.reason.as_str())
                {
                    return Err(PeerError::StateConflict(
                        "relationship was revoked with a different reason".into(),
                    ));
                }
            } else {
                let relationship_id = state.relationships[relationship_index].id.clone();
                let message = ApplicationMessage::RelationshipRevocation(RelationshipRevocation {
                    relationship_id: RelationshipId(decode_hex_array::<16>(
                        &relationship_id,
                        "relationship id",
                    )?),
                    revoked_at: now,
                    reason: BoundedString::new(input.reason.clone())?,
                });
                state
                    .pending_applications
                    .retain(|pending| pending.relationship_id != relationship_id);
                state.transport_outbox.retain(|outbound| {
                    outbound.relationship_id.as_deref() != Some(relationship_id.as_str())
                });
                state
                    .query_results
                    .retain(|result| result.relationship_id != relationship_id);
                enqueue_pending_application(
                    state,
                    message_id,
                    &relationship_id,
                    message,
                    now,
                    now.saturating_add(5 * 60),
                )?;
                state.relationships[relationship_index].status = RelationshipStatus::Revoked;
                state.relationships[relationship_index].revoked_reason = Some(input.reason.clone());
                append_revocation_event(
                    state,
                    RevocationEventDraft {
                        kind: RevocationEventKind::Relationship,
                        source: RevocationEventSource::LocalOperator,
                        relationship_id,
                        grant_id: None,
                        device_id: None,
                        target_certificate: None,
                        reason: input.reason,
                        occurred_at: now,
                        authenticated_remote_principal_id: None,
                        authenticated_remote_device_id: None,
                    },
                    local_identity.certificate(),
                    local_identity.device_signer(),
                )?;
            }
            stored = Some(state.relationships[relationship_index].clone());
            Ok(())
        })?;
        Ok(MutationResult {
            provenance: self.provenance(stored.as_ref(), now)?,
        })
    }

    fn request_resync(&self, input: &RequestResyncInput) -> Result<ResyncResult> {
        self.require_owner(&input.owner_user_id)?;
        validate_projection_ids(&input.projection_ids)?;
        let now = self.checked_now()?;
        let snapshot = self.state_snapshot()?;
        if snapshot.host_credential_rotation.is_some() {
            return Err(PeerError::StateConflict(
                "resync is paused during host credential rotation".into(),
            ));
        }
        let relationship = active_relationship(&snapshot, &input.relationship_id)?.clone();
        let binding = snapshot
            .mls_relationships
            .iter()
            .find(|binding| binding.relationship_id == relationship.id)
            .ok_or_else(|| PeerError::Transport("relationship has no OpenMLS state".into()))?;
        let wire_relationship_id =
            RelationshipId(decode_hex_array::<16>(&relationship.id, "relationship id")?);
        let mut envelope_ids = Vec::with_capacity(input.projection_ids.len());
        for projection_id in &input.projection_ids {
            let projection = wire_projection_id(projection_id)?;
            let mut hasher =
                blake3::Hasher::new_derive_key("forge-peer/1 resync state authenticator");
            hasher.update(&wire_relationship_id.0);
            hasher.update(wire_projection_name(projection).as_bytes());
            hasher.update(&binding.state_id.0);
            hasher.update(&binding.inbound_replay.highest_mls_epoch.to_be_bytes());
            hasher.update(&binding.inbound_replay.highest_sequence.to_be_bytes());
            hasher.update(&binding.inbound_replay.received_bitmap.to_be_bytes());
            let request = ApplicationMessage::ResyncRequest(ResyncRequest {
                relationship_id: wire_relationship_id,
                projection,
                last_good_epoch: binding.inbound_replay.highest_mls_epoch,
                last_good_sequence: binding.inbound_replay.highest_sequence,
                state_authenticator: *hasher.finalize().as_bytes(),
            });
            envelope_ids.push(self.queue_application_message(
                &relationship.id,
                &request,
                now,
                now.saturating_add(5 * 60),
            )?);
        }
        Ok(ResyncResult {
            envelope_ids,
            provenance: self.provenance(Some(&relationship), now)?,
        })
    }

    fn cached_query_result(
        &self,
        input: &ExecuteQueryInput,
        now: u64,
    ) -> Result<Option<QueryGatewayResult>> {
        self.require_owner(&input.owner_user_id)?;
        input.validate()?;
        let state = self.state_snapshot()?;
        let relationship = active_relationship(&state, &input.relationship_id)?;
        let local_identity = self.identity.load();
        let (grant, verification_id, verified_hash, rule) = authorize_query(
            &state.owner_user_id,
            relationship,
            &input.query,
            local_identity.certificate(),
            now,
        )?;
        let query_hash = query_hash(&input.query)?;
        let Some(result) = state.query_results.iter().find(|candidate| {
            candidate.relationship_id == relationship.id && candidate.query_hash == query_hash
        }) else {
            return Ok(None);
        };
        if result.valid_until.is_some_and(|expiry| expiry <= now) {
            return Ok(None);
        }
        let payload: ApiQueryPayload = decode_query_payload(&result.payload_json)?;
        validate_authenticated_query_payload(&payload, &input.query, rule)?;
        validate_unique_texts(
            &result.redacted_fields,
            MAX_QUERY_FIELDS,
            120,
            "query redacted fields",
        )?;
        let grant_expiry = grant
            .expires_at
            .as_deref()
            .map(|value| parse_timestamp(value, "grant expiresAt"))
            .transpose()?;
        if result.payload_json.len()
            > usize::try_from(rule.maximum_payload_bytes)
                .map_err(|_| limit("grant payload byte limit does not fit memory size"))?
            || result.payload_json.len() > MAX_QUERY_JSON_BYTES
            || result.as_of > now.saturating_add(MAX_CLOCK_SKEW_SECONDS)
            || result
                .valid_until
                .is_some_and(|expiry| expiry < result.as_of)
            || result
                .valid_until
                .zip(grant_expiry)
                .is_some_and(|(result_expiry, grant_expiry)| result_expiry > grant_expiry)
        {
            return Err(PeerError::Authentication(
                "authenticated query result violates its grant or time bounds".into(),
            ));
        }
        let metadata = QueryMetadata {
            source: QuerySource {
                principal_id: principal_id(&relationship.remote_certificate),
                device_id: device_id(&relationship.remote_certificate),
                relationship_id: relationship.id.clone(),
            },
            projection_id: input.query.projection_id.clone(),
            projection_version: 1,
            grant_id: grant.id.clone(),
            grant_sequence: grant.sequence,
            grant_verification_id: verification_id.to_owned(),
            verified_grant_hash: verified_hash.to_owned(),
            as_of: format_timestamp(result.as_of)?,
            received_at: format_timestamp(now)?,
            valid_until: result.valid_until.map(format_timestamp).transpose()?,
            completeness: f64::from(result.completeness_millionths) / 1_000_000.0,
            precision: input.query.precision.clone(),
            redacted_fields: result.redacted_fields.clone(),
            state: QueryResultState::Live,
        };
        Ok(Some(QueryGatewayResult {
            state: QueryResultState::Live,
            payload,
            metadata,
            provenance: self.provenance(Some(relationship), now)?,
        }))
    }

    #[allow(clippy::too_many_lines)]
    fn claim_inbound_query(
        &self,
        input: &ClaimInboundQueryInput,
    ) -> Result<InboundQueryClaimResult> {
        self.require_owner(&input.owner_user_id)?;
        input.validate()?;
        let now = self.checked_now()?;
        let snapshot = self.state_snapshot()?;
        let mut candidates = snapshot
            .inbound_queries
            .iter()
            .filter(|query| {
                query.wire_query.is_some()
                    && query.response_message_id.is_none()
                    && query.expires_at > now
                    && query
                        .claim
                        .as_ref()
                        .is_none_or(|claim| claim.lease_expires_at <= now)
            })
            .collect::<Vec<_>>();
        candidates.sort_by_key(|query| (query.received_at, query.query_id.0));
        let Some(query) = candidates.first().copied() else {
            return Ok(InboundQueryClaimResult {
                claim: None,
                provenance: self.provenance(None, now)?,
            });
        };
        let relationship_id = query.relationship_id.as_deref().ok_or_else(|| {
            PeerError::Rollback("inbound query has no durable relationship binding".into())
        })?;
        let relationship = active_relationship(&snapshot, relationship_id)?;
        verify_inbound_query_requester(query, relationship)?;
        let request = match query.wire_query.as_ref() {
            Some(StoredInboundWireQuery::V2(request)) => request,
            Some(StoredInboundWireQuery::V1(_)) | None => {
                return Err(PeerError::Version(
                    "legacy inbound query cannot enter the durable evaluation bridge".into(),
                ));
            }
        };
        let authorization = authorize_inbound_wire_query(
            &snapshot.owner_user_id,
            relationship,
            request,
            self.identity.load().certificate(),
            &snapshot.inbound_queries,
            now,
        )?;
        verify_stored_inbound_authorization(query, &authorization)?;
        let (api_query, entity_ids_are_opaque, interval_time_zone_authenticated) =
            inbound_api_query(query, relationship)?;
        let lease_seconds = u64::from(input.lease_ms).div_ceil(1_000).max(1);
        let lease_expires_at = now.saturating_add(lease_seconds).min(query.expires_at);
        if lease_expires_at <= now {
            return Err(PeerError::Timeout(
                "inbound query expired before it could be claimed",
            ));
        }
        let claim_id = nonzero_random_16();
        let durable_claim = StoredInboundQueryClaim {
            claim_id,
            worker_id: input.worker_id.clone(),
            claimed_at: now,
            lease_expires_at,
        };
        self.mutate(|state| {
            let current = state
                .inbound_queries
                .iter_mut()
                .find(|candidate| candidate.query_id == query.query_id)
                .ok_or_else(|| PeerError::StateConflict("inbound query disappeared".into()))?;
            if current.request_hash != query.request_hash
                || current.response_message_id.is_some()
                || current.expires_at <= now
                || current
                    .claim
                    .as_ref()
                    .is_some_and(|claim| claim.lease_expires_at > now)
            {
                return Err(PeerError::StateConflict(
                    "inbound query claim state changed before durable commit".into(),
                ));
            }
            current.claim = Some(durable_claim.clone());
            Ok(())
        })?;
        Ok(InboundQueryClaimResult {
            claim: Some(InboundQueryClaim {
                claim_id: hex::encode(claim_id),
                query_id: hex::encode(query.query_id.0),
                relationship_id: relationship.id.clone(),
                requester: QuerySource {
                    principal_id: principal_id(&relationship.remote_certificate),
                    device_id: device_id(&relationship.remote_certificate),
                    relationship_id: relationship.id.clone(),
                },
                query: api_query,
                entity_ids_are_opaque,
                interval_time_zone_authenticated,
                grant_id: authorization.grant_id,
                grant_sequence: authorization.grant_sequence.to_string(),
                grant_verification_id: authorization.grant_verification_id,
                verified_grant_hash: authorization.verified_grant_hash,
                rule_id: authorization.rule_id,
                maximum_payload_bytes: authorization.maximum_payload_bytes,
                redacted_fields: authorization
                    .redacted_fields
                    .iter()
                    .copied()
                    .map(projection_field_name)
                    .map(str::to_owned)
                    .collect(),
                received_at: format_timestamp(query.received_at)?,
                expires_at: format_timestamp(query.expires_at)?,
                lease_expires_at: format_timestamp(lease_expires_at)?,
            }),
            provenance: self.provenance(Some(relationship), now)?,
        })
    }

    #[allow(clippy::too_many_lines)]
    fn respond_inbound_query(
        &self,
        input: &RespondInboundQueryInput,
    ) -> Result<InboundQueryResponseResult> {
        self.require_owner(&input.owner_user_id)?;
        input.validate()?;
        let now = self.checked_now()?;
        let query_id = QueryId(decode_hex_array::<16>(&input.query_id, "query id")?);
        let claim_id = decode_hex_array::<16>(&input.claim_id, "query claim id")?;
        let snapshot = self.state_snapshot()?;
        let query = snapshot
            .inbound_queries
            .iter()
            .find(|candidate| candidate.query_id == query_id)
            .ok_or_else(|| PeerError::Authorization("inbound query is not pending".into()))?;
        if query.response_message_id.is_some() {
            return Err(PeerError::StateConflict(
                "inbound query already has a durable response".into(),
            ));
        }
        if query.expires_at <= now {
            return Err(PeerError::Timeout(
                "inbound query expired before response commit",
            ));
        }
        let claim = query
            .claim
            .as_ref()
            .ok_or_else(|| PeerError::Authorization("inbound query has not been claimed".into()))?;
        if claim.claim_id != claim_id
            || claim.worker_id != input.worker_id
            || claim.lease_expires_at <= now
        {
            return Err(PeerError::Authorization(
                "query response is not bound to the live durable worker claim".into(),
            ));
        }
        let relationship_id = query.relationship_id.as_deref().ok_or_else(|| {
            PeerError::Rollback("inbound query has no durable relationship binding".into())
        })?;
        let relationship = active_relationship(&snapshot, relationship_id)?;
        verify_inbound_query_requester(query, relationship)?;
        let request = match query.wire_query.as_ref() {
            Some(StoredInboundWireQuery::V2(request)) => request,
            Some(StoredInboundWireQuery::V1(_)) | None => {
                return Err(PeerError::Version(
                    "legacy inbound query cannot receive a bridged response".into(),
                ));
            }
        };
        let authorization = authorize_inbound_wire_query(
            &snapshot.owner_user_id,
            relationship,
            request,
            self.identity.load().certificate(),
            &snapshot.inbound_queries,
            now,
        )?;
        verify_stored_inbound_authorization(query, &authorization)?;
        validate_inbound_response_payload(query, input)?;
        let as_of = parse_timestamp(&input.as_of, "query response asOf")?;
        if as_of > now {
            return Err(PeerError::Authentication(
                "query response asOf is later than durable commit time".into(),
            ));
        }
        let valid_until = inbound_response_valid_until(
            relationship,
            authorization.grant_id.as_str(),
            authorization.grant_sequence,
            now,
        )?;
        let records = input
            .payload
            .records
            .iter()
            .map(|record| {
                let payload =
                    serde_json_canonicalizer::to_vec(&record.fields).map_err(|error| {
                        invalid(format!("canonicalizing query response record: {error}"))
                    })?;
                let version_hash = blake3::hash(&payload);
                let mut version = u64::from_be_bytes(
                    version_hash.as_bytes()[..8]
                        .try_into()
                        .map_err(|_| invalid("query response version hash has wrong size"))?,
                );
                if version == 0 {
                    version = 1;
                }
                Ok(crate::message::ProjectionRecord {
                    record_id: scoped_projection_record_id(
                        relationship,
                        &authorization.verified_grant_hash,
                        &record.record_id,
                    )?,
                    version,
                    operation: RecordOperation::Upsert,
                    source_timestamp: as_of,
                    valid_until,
                    payload: BoundedBytes::new(payload)?,
                })
            })
            .collect::<Result<Vec<_>>>()?;
        enforce_aggregation_response_minimum(
            relationship,
            &authorization.grant_id,
            authorization.grant_sequence,
            &authorization.rule_id,
            records.len(),
        )?;
        let response = QueryResponse {
            query_id,
            metadata: ResponseMetadata {
                source_principal: self.identity.load().certificate().body.principal_id,
                source_device: self.identity.load().certificate().body.device_id,
                as_of,
                received_at: now,
                valid_until,
                grant_id: request.request.grant_id,
                grant_sequence: request.request.grant_sequence,
                projection: request.request.query.projection(),
                completeness: match input.completeness {
                    InboundQueryCompleteness::Complete => Completeness::Complete,
                    InboundQueryCompleteness::Partial => Completeness::Partial,
                    InboundQueryCompleteness::Unknown => Completeness::Unknown,
                },
                precision: query_precision(&request.request.query),
                freshness: FreshnessState::Live,
                redactions: BoundedVec::new(query.redacted_fields.clone())?,
            },
            outcome: QueryOutcome::Records(BoundedVec::new(records)?),
        };
        response.validate()?;
        let encoded = encode_application(&ApplicationMessage::QueryResponse(response.clone()))?;
        if encoded.len() > usize::try_from(query.maximum_payload_bytes).unwrap_or(usize::MAX)
            || encoded.len() > usize::try_from(MAX_WIRE_QUERY_RESPONSE_BYTES).unwrap_or(usize::MAX)
        {
            return Err(limit(
                "authenticated query response exceeds its negotiated wire payload ceiling",
            ));
        }
        let message_id = EnvelopeMessageId::random();
        self.mutate(|state| {
            let current_index = state
                .inbound_queries
                .iter()
                .position(|candidate| candidate.query_id == query_id)
                .ok_or_else(|| PeerError::StateConflict("inbound query disappeared".into()))?;
            let current = &state.inbound_queries[current_index];
            if current.request_hash != query.request_hash
                || current.response_message_id.is_some()
                || current.claim.as_ref().is_none_or(|current_claim| {
                    current_claim.claim_id != claim_id
                        || current_claim.worker_id != input.worker_id
                        || current_claim.lease_expires_at <= now
                })
            {
                return Err(PeerError::StateConflict(
                    "inbound query response state changed before durable commit".into(),
                ));
            }
            enqueue_pending_application(
                state,
                message_id,
                relationship_id,
                ApplicationMessage::QueryResponse(response.clone()),
                now,
                request.request.expires_at,
            )?;
            state.inbound_queries[current_index].response_message_id = Some(message_id);
            Ok(())
        })?;
        Ok(InboundQueryResponseResult {
            query_id: input.query_id.clone(),
            envelope_id: hex::encode(message_id.0),
            provenance: self.provenance(Some(relationship), now)?,
        })
    }

    #[allow(clippy::too_many_lines)]
    async fn execute_query(&self, input: ExecuteQueryInput) -> Result<QueryGatewayResult> {
        self.require_owner(&input.owner_user_id)?;
        input.validate()?;
        let query = to_wire_query(&input.query)?;
        let now = self.checked_now()?;
        if let Some(cached) = self.cached_query_result(&input, now)? {
            return Ok(cached);
        }
        let snapshot = self.state_snapshot()?;
        if snapshot.host_credential_rotation.is_some() {
            return Err(PeerError::StateConflict(
                "live queries are paused during host credential rotation".into(),
            ));
        }
        let relationship = active_relationship(&snapshot, &input.relationship_id)?.clone();
        let local_identity = self.identity.load();
        let (grant, verification_id, verified_hash, rule) = authorize_query(
            &snapshot.owner_user_id,
            &relationship,
            &input.query,
            local_identity.certificate(),
            now,
        )?;
        drop(local_identity);
        let grant = grant.clone();
        let verification_id = verification_id.to_owned();
        let verified_hash = verified_hash.to_owned();
        let rule = rule.clone();
        let query_id = loop {
            let candidate = QueryId::random();
            if candidate.validate().is_ok()
                && !snapshot
                    .query_exchanges
                    .iter()
                    .any(|exchange| exchange.query_id == candidate)
            {
                break candidate;
            }
        };
        let timeout_seconds = u64::from(input.timeout_ms).div_ceil(1_000).max(1);
        let expires_at = now.saturating_add(timeout_seconds.min(5 * 60));
        let request = QueryRequest {
            query_id,
            relationship_id: RelationshipId(decode_hex_array::<16>(
                &relationship.id,
                "relationship id",
            )?),
            grant_id: wire_grant_id(&grant.id)?,
            grant_sequence: grant.sequence,
            requested_at: now,
            expires_at,
            query,
        };
        request.validate()?;
        let requested_fields = wire_fields(&input.query.fields)?;
        let request = QueryRequestV2 {
            request,
            requested_fields,
            maximum_result_count: input
                .query
                .maximum_result_count
                .min(rule.maximum_result_count)
                .min(64),
            maximum_payload_bytes: rule
                .maximum_payload_bytes
                .min(MAX_WIRE_QUERY_RESPONSE_BYTES),
        };
        request.validate()?;
        self.mutate(|state| {
            state
                .query_exchanges
                .retain(|exchange| exchange.response.is_some() || exchange.expires_at > now);
            if state.query_exchanges.len() >= MAX_QUERY_EXCHANGES {
                if let Some(index) = state
                    .query_exchanges
                    .iter()
                    .position(|exchange| exchange.response.is_some())
                {
                    state.query_exchanges.remove(index);
                } else {
                    return Err(limit("durable query exchange limit reached"));
                }
            }
            state.query_exchanges.push(StoredQueryExchange {
                query_id,
                relationship_id: relationship.id.clone(),
                grant_id: request.request.grant_id,
                grant_sequence: request.request.grant_sequence,
                projection: request.request.query.projection(),
                requested_at: now,
                expires_at,
                response: None,
            });
            Ok(())
        })?;
        if let Err(error) = self.queue_application_message(
            &relationship.id,
            &ApplicationMessage::QueryRequestV2(request),
            now,
            expires_at,
        ) {
            let _ = self.mutate(|state| {
                state
                    .query_exchanges
                    .retain(|exchange| exchange.query_id != query_id);
                Ok(())
            });
            return Err(error);
        }

        let deadline = tokio::time::Instant::now()
            .checked_add(std::time::Duration::from_millis(u64::from(
                input.timeout_ms,
            )))
            .ok_or_else(|| PeerError::StateConflict("query deadline overflow".into()))?;
        let response = loop {
            if let Some(response) = self
                .state_snapshot()?
                .query_exchanges
                .iter()
                .find(|exchange| exchange.query_id == query_id)
                .and_then(|exchange| exchange.response.clone())
            {
                break response;
            }
            if tokio::time::Instant::now() >= deadline {
                return self.unavailable_query_result(
                    &input,
                    &relationship,
                    &grant,
                    &verification_id,
                    &verified_hash,
                    self.checked_now()?,
                );
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        };
        self.remote_query_result(
            &input,
            &relationship,
            &grant,
            &verification_id,
            &verified_hash,
            &rule,
            &response,
            unix_time()?,
        )
    }

    fn unavailable_query_result(
        &self,
        input: &ExecuteQueryInput,
        relationship: &StoredRelationship,
        grant: &PeerShareGrantVersion,
        verification_id: &str,
        verified_hash: &str,
        received_at: u64,
    ) -> Result<QueryGatewayResult> {
        let timestamp = format_timestamp(received_at)?;
        let result = QueryGatewayResult {
            state: QueryResultState::Unavailable,
            payload: ApiQueryPayload {
                records: Vec::new(),
            },
            metadata: QueryMetadata {
                source: QuerySource {
                    principal_id: principal_id(&relationship.remote_certificate),
                    device_id: device_id(&relationship.remote_certificate),
                    relationship_id: relationship.id.clone(),
                },
                projection_id: input.query.projection_id.clone(),
                projection_version: 1,
                grant_id: grant.id.clone(),
                grant_sequence: grant.sequence,
                grant_verification_id: verification_id.to_owned(),
                verified_grant_hash: verified_hash.to_owned(),
                as_of: timestamp.clone(),
                received_at: timestamp,
                valid_until: None,
                completeness: 0.0,
                precision: input.query.precision.clone(),
                redacted_fields: Vec::new(),
                state: QueryResultState::Unavailable,
            },
            provenance: self.provenance(Some(relationship), received_at)?,
        };
        ensure_query_response_frameable(&result)?;
        Ok(result)
    }

    #[allow(clippy::too_many_arguments)]
    fn remote_query_result(
        &self,
        input: &ExecuteQueryInput,
        relationship: &StoredRelationship,
        grant: &PeerShareGrantVersion,
        verification_id: &str,
        verified_hash: &str,
        rule: &crate::grant::ShareRule,
        response: &QueryResponse,
        received_at: u64,
    ) -> Result<QueryGatewayResult> {
        response.validate()?;
        let (state, payload) = match &response.outcome {
            QueryOutcome::Unavailable(_) => (
                QueryResultState::Unavailable,
                ApiQueryPayload {
                    records: Vec::new(),
                },
            ),
            QueryOutcome::Records(records) => {
                let mut payload = ApiQueryPayload {
                    records: Vec::with_capacity(records.len()),
                };
                for record in records.as_slice() {
                    if record.operation != RecordOperation::Upsert {
                        continue;
                    }
                    let fields: serde_json::Map<String, serde_json::Value> =
                        serde_json::from_slice(record.payload.as_slice()).map_err(|error| {
                            invalid(format!("decoding authenticated projection fields: {error}"))
                        })?;
                    payload.records.push(ApiQueryRecord {
                        record_id: hex::encode(record.record_id.0),
                        fields,
                    });
                }
                validate_query_payload(&payload)?;
                validate_authenticated_query_payload(&payload, &input.query, rule)?;
                (QueryResultState::Live, payload)
            }
        };
        if (state == QueryResultState::Unavailable)
            != (response.metadata.freshness == FreshnessState::Unavailable)
        {
            return Err(PeerError::Authentication(
                "query outcome conflicts with authenticated freshness metadata".into(),
            ));
        }
        let completeness = match response.metadata.completeness {
            Completeness::Complete => 1.0,
            Completeness::Partial => 0.5,
            Completeness::Unknown => 0.0,
        };
        let redacted_fields = response
            .metadata
            .redactions
            .as_slice()
            .iter()
            .copied()
            .map(projection_field_name)
            .map(str::to_owned)
            .collect();
        let result = QueryGatewayResult {
            state,
            payload,
            metadata: QueryMetadata {
                source: QuerySource {
                    principal_id: principal_id(&relationship.remote_certificate),
                    device_id: device_id(&relationship.remote_certificate),
                    relationship_id: relationship.id.clone(),
                },
                projection_id: input.query.projection_id.clone(),
                projection_version: 1,
                grant_id: grant.id.clone(),
                grant_sequence: grant.sequence,
                grant_verification_id: verification_id.to_owned(),
                verified_grant_hash: verified_hash.to_owned(),
                as_of: format_timestamp(response.metadata.as_of)?,
                received_at: format_timestamp(received_at)?,
                valid_until: Some(format_timestamp(response.metadata.valid_until)?),
                completeness,
                precision: input.query.precision.clone(),
                redacted_fields,
                state,
            },
            provenance: self.provenance(Some(relationship), received_at)?,
        };
        ensure_query_response_frameable(&result)?;
        Ok(result)
    }

    #[cfg(test)]
    fn store_authenticated_query_result(
        &self,
        relationship_id: &str,
        query: &ApiTypedQuery,
        payload: &ApiQueryPayload,
        as_of: u64,
        valid_until: Option<u64>,
    ) -> Result<()> {
        validate_query_payload(payload)?;
        let payload_json = serde_json::to_vec(payload)
            .map_err(|error| invalid(format!("encoding query result: {error}")))?;
        if payload_json.len() > MAX_QUERY_JSON_BYTES {
            return Err(limit(format!(
                "query result exceeds the {MAX_QUERY_JSON_BYTES}-byte IPC payload ceiling"
            )));
        }
        let query_hash = query_hash(query)?;
        self.mutate(|state| {
            active_relationship(state, relationship_id)?;
            let stored = StoredQueryResult {
                relationship_id: relationship_id.to_owned(),
                query_hash,
                payload_json,
                as_of,
                valid_until,
                completeness_millionths: 1_000_000,
                redacted_fields: Vec::new(),
            };
            if let Some(existing) = state.query_results.iter_mut().find(|candidate| {
                candidate.relationship_id == relationship_id && candidate.query_hash == query_hash
            }) {
                *existing = stored;
            } else {
                if state.query_results.len() >= MAX_QUERY_RESULTS {
                    state.query_results.remove(0);
                }
                state.query_results.push(stored);
            }
            Ok(())
        })
    }

    fn require_owner(&self, owner_user_id: &str) -> Result<()> {
        let state = self.lock_state()?;
        if state
            .owner_user_id
            .as_bytes()
            .ct_eq(owner_user_id.as_bytes())
            .unwrap_u8()
            != 1
        {
            return Err(PeerError::Authorization(
                "IPC owner does not match the daemon state owner".into(),
            ));
        }
        Ok(())
    }

    fn checked_now(&self) -> Result<u64> {
        let now = unix_time()?;
        self.mutate(|state| {
            if now.saturating_add(MAX_CLOCK_SKEW_SECONDS) < state.high_water_unix_time {
                return Err(PeerError::Rollback(
                    "wall clock moved behind durable daemon high-water mark".into(),
                ));
            }
            state.high_water_unix_time = state.high_water_unix_time.max(now);
            Ok(())
        })?;
        Ok(now)
    }

    fn endpoints_for(
        &self,
        kinds: &[TransportKind],
        privacy: PrivacyMode,
        mailbox_credential: Option<&MailboxChannelCredential>,
    ) -> Result<BoundedVec<EndpointDescriptor, 8>> {
        if kinds.contains(&TransportKind::HttpMailbox) && mailbox_credential.is_none() {
            return Err(PeerError::Transport(
                "HTTPS mailbox was requested without a relationship-scoped channel capability"
                    .into(),
            ));
        }
        let mailbox_endpoint = mailbox_credential.map(|credential| credential.endpoint().clone());
        let selected: Vec<_> = self
            .endpoints
            .as_slice()
            .iter()
            .filter(|endpoint| kinds.contains(&transport_kind(endpoint)))
            .filter(|endpoint| {
                privacy != PrivacyMode::HideNetworkAddress || hides_address(endpoint)
            })
            .filter_map(|endpoint| match endpoint {
                EndpointDescriptor::HttpMailbox(_) => mailbox_endpoint
                    .as_ref()
                    .map(|endpoint| EndpointDescriptor::HttpMailbox(endpoint.clone())),
                _ => Some(endpoint.clone()),
            })
            .collect();
        if selected.is_empty() {
            return Err(PeerError::Transport(
                "requested privacy/transports have no locally configured endpoint".into(),
            ));
        }
        let selected_kinds = selected.iter().map(transport_kind).collect::<BTreeSet<_>>();
        if kinds.iter().any(|kind| !selected_kinds.contains(kind)) {
            return Err(PeerError::Transport(
                "one or more requested transports are not locally operational".into(),
            ));
        }
        BoundedVec::new(selected)
    }

    fn configured_mailbox_origin(&self) -> Result<Option<&str>> {
        let mut origins = self.endpoints.as_slice().iter().filter_map(|endpoint| {
            if let EndpointDescriptor::HttpMailbox(endpoint) = endpoint {
                Some(endpoint.origin.as_str())
            } else {
                None
            }
        });
        let origin = origins.next();
        if origins.next().is_some() {
            return Err(PeerError::StateConflict(
                "daemon has more than one configured mailbox provider".into(),
            ));
        }
        Ok(origin)
    }

    fn configured_mailbox_credential(
        &self,
        secret: &MailboxRelationshipSecret,
        role: MailboxChannelRole,
    ) -> Result<Option<MailboxChannelCredential>> {
        self.configured_mailbox_origin()?
            .map(|origin| secret.credential(role, origin))
            .transpose()
    }

    fn daemon_evidence<T: Serialize>(
        &self,
        statement_type: DaemonEvidenceStatementType,
        statement: &T,
        now: u64,
    ) -> Result<DaemonEvidence> {
        let canonical_statement = serde_json_canonicalizer::to_vec(statement)
            .map_err(|error| invalid(format!("canonicalizing daemon statement: {error}")))?;
        if canonical_statement.len() > MAX_IPC_FRAME_BYTES {
            return Err(limit(
                "daemon evidence statement exceeds the IPC frame limit",
            ));
        }
        let mut statement_hasher = Sha256::new();
        statement_hasher.update(DAEMON_STATEMENT_HASH_DOMAIN);
        statement_hasher.update(statement_type.as_str().as_bytes());
        statement_hasher.update(b"\0");
        statement_hasher.update(&canonical_statement);

        let identity = self.identity.load();
        let certificate = identity.certificate();
        let mut evidence = DaemonEvidence {
            protocol: DAEMON_EVIDENCE_PROTOCOL.to_owned(),
            statement_type,
            statement_hash: hex::encode(statement_hasher.finalize()),
            owner_user_id: self.state_snapshot()?.owner_user_id,
            local_principal_id: principal_id(certificate),
            local_device_id: device_id(certificate),
            signing_certificate_hash: hex::encode(certificate.fingerprint()?),
            issued_at: format_timestamp(now)?,
            signature: String::new(),
        };
        let mut unsigned = serde_json::to_value(&evidence)
            .map_err(|error| invalid(format!("serializing daemon evidence: {error}")))?;
        unsigned
            .as_object_mut()
            .ok_or_else(|| invalid("daemon evidence is not a JSON object"))?
            .remove("signature")
            .ok_or_else(|| invalid("daemon evidence signature field is missing"))?;
        let canonical_evidence = serde_json_canonicalizer::to_vec(&unsigned)
            .map_err(|error| invalid(format!("canonicalizing daemon evidence: {error}")))?;
        let mut signed =
            Vec::with_capacity(DAEMON_EVIDENCE_SIGNATURE_DOMAIN.len() + canonical_evidence.len());
        signed.extend_from_slice(DAEMON_EVIDENCE_SIGNATURE_DOMAIN);
        signed.extend_from_slice(&canonical_evidence);
        evidence.signature = URL_SAFE_NO_PAD.encode(identity.device_signer().sign_raw(&signed).0);
        Ok(evidence)
    }

    fn provenance(
        &self,
        relationship: Option<&StoredRelationship>,
        now: u64,
    ) -> Result<AuthenticatedProvenance> {
        let owner = self.state_snapshot()?.owner_user_id;
        let mut hasher =
            blake3::Hasher::new_derive_key("forge-peer/1 IPC authenticated provenance");
        hasher.update(owner.as_bytes());
        hasher.update(&self.identity.load().certificate().fingerprint()?);
        if let Some(relationship) = relationship {
            hasher.update(relationship.id.as_bytes());
            hasher.update(&relationship.remote_certificate.fingerprint()?);
            hasher.update(&relationship.outbound_sequence.to_be_bytes());
        }
        Ok(AuthenticatedProvenance {
            protocol_version: PROTOCOL_NAME.to_owned(),
            owner_user_id: owner,
            relationship_id: relationship.map(|value| value.id.clone()),
            local_principal_id: principal_id(self.identity.load().certificate()),
            local_device_id: device_id(self.identity.load().certificate()),
            remote_principal_id: relationship.map(|value| principal_id(&value.remote_certificate)),
            remote_device_id: relationship.map(|value| device_id(&value.remote_certificate)),
            evidence_hash: hex::encode(hasher.finalize().as_bytes()),
            authenticated_at: format_timestamp(now)?,
        })
    }

    fn pairing_provenance(
        &self,
        pairing: &StoredPairing,
        now: u64,
    ) -> Result<AuthenticatedProvenance> {
        let owner = self.state_snapshot()?.owner_user_id;
        let remote = &pairing.signed_invite.body.inviter_device;
        let mut hasher = blake3::Hasher::new_derive_key("forge-peer/1 IPC pairing provenance");
        hasher.update(owner.as_bytes());
        hasher.update(&self.identity.load().certificate().fingerprint()?);
        hasher.update(&remote.fingerprint()?);
        hasher.update(&pairing.request_id);
        hasher.update(&pairing.transcript_body.transcript_hash()?);
        Ok(AuthenticatedProvenance {
            protocol_version: PROTOCOL_NAME.to_owned(),
            owner_user_id: owner,
            relationship_id: None,
            local_principal_id: principal_id(self.identity.load().certificate()),
            local_device_id: device_id(self.identity.load().certificate()),
            remote_principal_id: Some(principal_id(remote)),
            remote_device_id: Some(device_id(remote)),
            evidence_hash: hex::encode(hasher.finalize().as_bytes()),
            authenticated_at: format_timestamp(now)?,
        })
    }

    fn mutate<T>(&self, operation: impl FnOnce(&mut DurableDaemonState) -> Result<T>) -> Result<T> {
        let transaction_owner = std::thread::current().id();
        {
            let mut staged = self
                .staged_state
                .lock()
                .map_err(|_| PeerError::StateConflict("staged state lock poisoned".into()))?;
            if let Some(staged) = staged
                .as_mut()
                .filter(|staged| staged.owner == transaction_owner)
            {
                let output = operation(&mut staged.state)?;
                staged.state.validate()?;
                return Ok(output);
            }
        }
        let _command = self
            .command_lock
            .lock()
            .map_err(|_| PeerError::StateConflict("command transaction lock poisoned".into()))?;
        if self
            .staged_state
            .lock()
            .map_err(|_| PeerError::StateConflict("staged state lock poisoned".into()))?
            .is_some()
        {
            return Err(PeerError::StateConflict(
                "command transaction remained staged after acquiring its lock".into(),
            ));
        }
        let mut current = self.lock_state()?;
        let mut next = current.clone();
        let output = operation(&mut next)?;
        next.validate()?;
        self.persist(&next)?;
        *current = next;
        Ok(output)
    }

    fn persist_current(&self) -> Result<()> {
        let state = self.state_snapshot()?;
        self.persist(&state)
    }

    fn persist(&self, state: &DurableDaemonState) -> Result<()> {
        let encoded = Zeroizing::new(encode_limited::<DAEMON_STATE_LIMIT, _>(state)?);
        let sealed = seal_state(
            &self.state_key,
            self.identity.load().certificate(),
            &encoded,
        )?;
        self.directory
            .atomic_write_secret(DAEMON_STATE_FILE, &sealed)
    }

    #[allow(clippy::too_many_lines)]
    fn finalize_host_rotation_if_ready(&self) -> Result<()> {
        let snapshot = self.state_snapshot()?;
        let Some(rotation) = snapshot.host_credential_rotation.as_ref() else {
            return Ok(());
        };
        if !rotation
            .relationships
            .iter()
            .all(|relationship| relationship.acknowledged)
        {
            return Ok(());
        }
        let rotation_event_count = snapshot
            .relationships
            .iter()
            .filter(|relationship| {
                relationship.status == RelationshipStatus::Active
                    && relationship.local_certificate == rotation.predecessor_certificate
            })
            .count();
        if snapshot
            .revocation_events
            .len()
            .checked_add(rotation_event_count)
            .is_none_or(|count| count > MAX_REVOCATION_EVENTS)
        {
            return Err(limit(
                "host credential finalization would exceed the revocation event log limit",
            ));
        }
        let now = self.checked_now()?;
        let successor = Arc::new(LocalIdentityState::decode_secret(
            &rotation.successor_identity,
        )?);
        if successor.certificate() != &rotation.successor_certificate {
            return Err(PeerError::Rollback(
                "pending host rotation secret does not match its successor certificate".into(),
            ));
        }
        let current = self.identity.load_full();
        if current.certificate() != &rotation.predecessor_certificate
            && current.certificate() != &rotation.successor_certificate
        {
            return Err(PeerError::Authentication(
                "local identity is neither the durable rotation predecessor nor successor".into(),
            ));
        }
        if current.certificate() == &rotation.predecessor_certificate {
            self.directory
                .atomic_write_secret(IDENTITY_STATE_FILE, &successor.encode_secret()?)?;
        }
        self.identity.store(Arc::clone(&successor));
        self.mutate(|state| {
            let pending = state.host_credential_rotation.as_ref().ok_or_else(|| {
                PeerError::StateConflict(
                    "host rotation disappeared before identity finalization".into(),
                )
            })?;
            if pending.predecessor_certificate != rotation.predecessor_certificate
                || pending.successor_certificate != rotation.successor_certificate
                || !pending
                    .relationships
                    .iter()
                    .all(|relationship| relationship.acknowledged)
            {
                return Err(PeerError::StateConflict(
                    "host rotation changed before identity finalization".into(),
                ));
            }
            let mut retired_relationships = Vec::new();
            for relationship in &mut state.relationships {
                if relationship.local_certificate == rotation.predecessor_certificate {
                    relationship
                        .local_certificate_history
                        .push(rotation.predecessor_certificate.clone());
                    relationship.local_certificate = rotation.successor_certificate.clone();
                    if relationship.status == RelationshipStatus::Active {
                        retired_relationships.push(relationship.id.clone());
                    }
                } else if relationship.status == RelationshipStatus::Active
                    && relationship.local_certificate != rotation.successor_certificate
                {
                    return Err(PeerError::Authentication(
                        "active relationship has an unexpected local certificate during finalization"
                            .into(),
                    ));
                }
            }
            for relationship_id in retired_relationships {
                append_revocation_event(
                    state,
                    RevocationEventDraft {
                        kind: RevocationEventKind::CredentialRetirement,
                        source: RevocationEventSource::CertifiedRotation,
                        relationship_id,
                        grant_id: None,
                        device_id: Some(device_id(&rotation.predecessor_certificate)),
                        target_certificate: Some(rotation.predecessor_certificate.clone()),
                        reason: "certified host credential successor acknowledged".into(),
                        occurred_at: now,
                        authenticated_remote_principal_id: None,
                        authenticated_remote_device_id: None,
                    },
                    successor.certificate(),
                    successor.device_signer(),
                )?;
            }
            state.host_credential_rotation = None;
            Ok(())
        })
    }

    fn commit_verified_outbound_acknowledgement(
        &self,
        packet: &PeerWirePacket,
        expected_receiver: &DeviceCertificate,
        acknowledgement: &SignedDeliveryAck,
        now: u64,
    ) -> Result<bool> {
        acknowledgement.verify(packet, expected_receiver, now)?;
        let packet_hash = packet.hash()?;
        let is_host_rotation =
            matches!(&packet.payload, PeerWirePayload::HostCredentialRotation(_));
        self.mutate(|state| {
            let Some(index) = state
                .transport_outbox
                .iter()
                .position(|outbound| outbound.packet.packet_id == packet.packet_id)
            else {
                return Ok(());
            };
            let outbound = &state.transport_outbox[index];
            if outbound.packet.hash()? != packet_hash
                || outbound.expected_receiver != *expected_receiver
            {
                return Err(PeerError::Authentication(
                    "transport acknowledgement does not match the durable outbox".into(),
                ));
            }
            state.transport_outbox.remove(index);
            if let PeerWirePayload::HostCredentialRotation(rotation) = &packet.payload {
                let pending = state.host_credential_rotation.as_mut().ok_or_else(|| {
                    PeerError::Rollback(
                        "host rotation packet exists without durable rotation state".into(),
                    )
                })?;
                if pending.predecessor_certificate != rotation.body.predecessor_certificate
                    || pending.successor_certificate != rotation.body.successor_certificate
                {
                    return Err(PeerError::Authentication(
                        "host rotation acknowledgement targets different credentials".into(),
                    ));
                }
                let relationship = pending
                    .relationships
                    .iter_mut()
                    .find(|relationship| {
                        relationship.packet_id == packet.packet_id
                            && relationship.packet_hash == packet_hash
                    })
                    .ok_or_else(|| {
                        PeerError::Authentication(
                            "host rotation acknowledgement is not bound to a pending relationship"
                                .into(),
                        )
                    })?;
                relationship.acknowledged = true;
            }
            Ok(())
        })?;
        Ok(is_host_rotation)
    }

    fn lock_state(&self) -> Result<MutexGuard<'_, DurableDaemonState>> {
        self.state
            .lock()
            .map_err(|_| PeerError::StateConflict("daemon state lock poisoned".into()))
    }

    fn state_snapshot(&self) -> Result<DurableDaemonState> {
        let transaction_owner = std::thread::current().id();
        {
            let staged = self
                .staged_state
                .lock()
                .map_err(|_| PeerError::StateConflict("staged state lock poisoned".into()))?;
            if let Some(staged) = staged
                .as_ref()
                .filter(|staged| staged.owner == transaction_owner)
            {
                return Ok(staged.state.clone());
            }
        }
        let _command = self
            .command_lock
            .lock()
            .map_err(|_| PeerError::StateConflict("command transaction lock poisoned".into()))?;
        Ok(self.lock_state()?.clone())
    }

    #[allow(clippy::too_many_arguments)]
    fn idempotent<T>(
        &self,
        command_id: &str,
        operation: &str,
        request_hash: [u8; 32],
        command_digest: &str,
        approval_deadline: &str,
        authorization: Option<&CommandAuthorization>,
        allow_unsigned_test_command: bool,
        execute: impl FnOnce() -> Result<T>,
    ) -> Result<T>
    where
        T: Serialize + DeserializeOwned,
    {
        self.idempotent_capability(
            command_id,
            operation,
            request_hash,
            command_digest,
            approval_deadline,
            authorization,
            allow_unsigned_test_command,
            CommandCapabilityKind::HumanApproval,
            CommandCapabilityState::Consumed,
            execute,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn idempotent_capability<T>(
        &self,
        command_id: &str,
        operation: &str,
        request_hash: [u8; 32],
        command_digest: &str,
        approval_deadline: &str,
        authorization: Option<&CommandAuthorization>,
        allow_unsigned_test_command: bool,
        capability_kind: CommandCapabilityKind,
        capability_state: CommandCapabilityState,
        execute: impl FnOnce() -> Result<T>,
    ) -> Result<T>
    where
        T: Serialize + DeserializeOwned,
    {
        self.idempotent_with_clock_capability(
            command_id,
            operation,
            request_hash,
            command_digest,
            approval_deadline,
            authorization,
            allow_unsigned_test_command,
            capability_kind,
            capability_state,
            unix_time,
            execute,
        )
    }

    #[cfg(test)]
    #[allow(clippy::too_many_arguments)]
    fn idempotent_with_clock<T>(
        &self,
        command_id: &str,
        operation: &str,
        request_hash: [u8; 32],
        command_digest: &str,
        approval_deadline: &str,
        authorization: Option<&CommandAuthorization>,
        allow_unsigned_test_command: bool,
        clock: impl FnMut() -> Result<u64>,
        execute: impl FnOnce() -> Result<T>,
    ) -> Result<T>
    where
        T: Serialize + DeserializeOwned,
    {
        self.idempotent_with_clock_capability(
            command_id,
            operation,
            request_hash,
            command_digest,
            approval_deadline,
            authorization,
            allow_unsigned_test_command,
            CommandCapabilityKind::HumanApproval,
            CommandCapabilityState::Consumed,
            clock,
            execute,
        )
    }

    #[allow(clippy::too_many_arguments, clippy::too_many_lines)]
    fn idempotent_with_clock_capability<T>(
        &self,
        command_id: &str,
        operation: &str,
        request_hash: [u8; 32],
        command_digest: &str,
        approval_deadline: &str,
        authorization: Option<&CommandAuthorization>,
        allow_unsigned_test_command: bool,
        capability_kind: CommandCapabilityKind,
        capability_state: CommandCapabilityState,
        mut clock: impl FnMut() -> Result<u64>,
        execute: impl FnOnce() -> Result<T>,
    ) -> Result<T>
    where
        T: Serialize + DeserializeOwned,
    {
        crate::ipc::validate_command_id(command_id)?;
        let _command = self
            .command_lock
            .lock()
            .map_err(|_| PeerError::StateConflict("command transaction lock poisoned".into()))?;
        let mut base = self.lock_state()?.clone();
        if let Some(receipt) = base
            .command_receipts
            .iter()
            .find(|receipt| receipt.command_id == command_id)
        {
            if receipt.operation != operation {
                return Err(PeerError::StateConflict(
                    "commandId was already committed with a different method or body".into(),
                ));
            }
            let request_hash_matches = receipt.request_hash.ct_eq(&request_hash).unwrap_u8() == 1;
            if let Ok(stored) =
                serde_json::from_slice::<StoredCommandResponse<T>>(&receipt.response_json)
            {
                if !matches!(stored.receipt_version, 1..=4) {
                    return Err(PeerError::Rollback(
                        "stored command receipt version is invalid".into(),
                    ));
                }
                if stored.receipt_version == 4
                    && stored.approval_deadline_rfc3339.as_deref() != Some(approval_deadline)
                {
                    return Err(PeerError::Authentication(
                        "command replay approval deadline differs from its durable receipt".into(),
                    ));
                }
                if !(allow_unsigned_test_command
                    && authorization.is_none()
                    && stored.authorization.is_none())
                {
                    let authorization = authorization.ok_or_else(|| {
                        PeerError::Authentication(
                            "exact command replay requires its original Node authorization".into(),
                        )
                    })?;
                    let authority = self.command_authority.as_ref().ok_or_else(|| {
                        PeerError::Authentication("Node command authority is not configured".into())
                    })?;
                    authority.authenticate_authorization_document(authorization)?;
                    if stored.receipt_version >= 3 {
                        let expected_hash = stored
                            .authorization_document_hash
                            .as_deref()
                            .ok_or_else(|| {
                                PeerError::Rollback(
                                    "stored command receipt lacks its authorization document hash"
                                        .into(),
                                )
                            })?;
                        let actual_hash = hex::encode(command_authorization_hash(authorization)?);
                        if actual_hash
                            .as_bytes()
                            .ct_eq(expected_hash.as_bytes())
                            .unwrap_u8()
                            != 1
                        {
                            return Err(PeerError::Authentication(
                                "command replay does not carry the original authorization document"
                                    .into(),
                            ));
                        }
                    } else if let Some(provenance) = &stored.authorization
                        && (provenance.authority_key_id != authorization.authority_key_id
                            || provenance.authorization_id.as_deref()
                                != Some(authorization.authorization_id.as_str())
                            || provenance.session_id.as_deref()
                                != Some(authorization.actor.session_id.as_str())
                            || provenance.capability_id.as_deref()
                                != Some(authorization.capability.capability_id.as_str())
                            || provenance.invalidation_epoch != authorization.invalidation_epoch)
                    {
                        return Err(PeerError::Authentication(
                            "command replay authorization differs from durable provenance".into(),
                        ));
                    }
                    if !request_hash_matches {
                        return Err(PeerError::StateConflict(
                            "commandId was already committed with a different method or body"
                                .into(),
                        ));
                    }
                    authority.verify_authorization_for_replay(
                        authorization,
                        &CommandAuthorizationExpectation {
                            owner_user_id: &base.owner_user_id,
                            action: operation,
                            command_id,
                            command_digest,
                            approval_deadline,
                            capability_kind,
                            capability_state,
                            now: stored.committed_at,
                        },
                    )?;
                }
                if !request_hash_matches {
                    return Err(PeerError::StateConflict(
                        "commandId was already committed with a different method or body".into(),
                    ));
                }
                return Ok(stored.result);
            }
            if !request_hash_matches {
                return Err(PeerError::StateConflict(
                    "commandId was already committed with a different method or body".into(),
                ));
            }
            return serde_json::from_slice(&receipt.response_json).map_err(|error| {
                PeerError::Rollback(format!("stored command result is invalid: {error}"))
            });
        }
        compact_empty_query_claim_receipts(&mut base.command_receipts);
        if base.host_credential_rotation.is_some() {
            return Err(PeerError::StateConflict(
                "a host credential rotation is awaiting authenticated peer acknowledgements".into(),
            ));
        }
        if base.command_receipts.len() >= MAX_COMMAND_RECEIPTS {
            return Err(limit(
                "durable command receipt limit reached; local-console compaction is required",
            ));
        }
        let deadline = parse_timestamp(approval_deadline, "approvalDeadline")?;
        let started_at = clock()?;
        if started_at > deadline {
            return Err(PeerError::Authorization(
                "human approval deadline expired before command execution".into(),
            ));
        }
        if deadline.saturating_sub(started_at) > MAX_APPROVAL_WINDOW_SECONDS {
            return Err(limit(
                "human approval deadline is more than 24 hours in the future",
            ));
        }
        let verified_authorization = if allow_unsigned_test_command && authorization.is_none() {
            None
        } else {
            let authorization = authorization.ok_or_else(|| {
                PeerError::Authentication(
                    "mutating IPC command is missing its Node authorization".into(),
                )
            })?;
            let authority_state = self.load_command_authority_state(&base.owner_user_id)?;
            self.validate_command_authority_high_water(&base, &authority_state)?;
            let authority = self.command_authority.as_ref().ok_or_else(|| {
                PeerError::Authentication("Node command authority is not configured".into())
            })?;
            Some(authority.verify_authorization(
                authorization,
                &authority_state,
                &CommandAuthorizationExpectation {
                    owner_user_id: &base.owner_user_id,
                    action: operation,
                    command_id,
                    command_digest,
                    approval_deadline,
                    capability_kind,
                    capability_state,
                    now: started_at,
                },
            )?)
        };
        {
            let mut staged = self
                .staged_state
                .lock()
                .map_err(|_| PeerError::StateConflict("staged state lock poisoned".into()))?;
            if staged.is_some() {
                return Err(PeerError::StateConflict(
                    "nested command transaction is not allowed".into(),
                ));
            }
            *staged = Some(StagedDaemonState {
                owner: std::thread::current().id(),
                state: base,
            });
        }
        let output = match execute() {
            Ok(output) => output,
            Err(error) => {
                self.clear_staged_state()?;
                return Err(error);
            }
        };
        let committed_at = clock()?;
        if committed_at > deadline {
            self.clear_staged_state()?;
            return Err(PeerError::Authorization(
                "human approval deadline expired before durable command commit".into(),
            ));
        }
        let authorization_document_hash = if verified_authorization.is_some() {
            Some(hex::encode(command_authorization_hash(
                authorization.ok_or_else(|| {
                    PeerError::Rollback(
                        "verified command authorization document disappeared before commit".into(),
                    )
                })?,
            )?))
        } else {
            None
        };
        let response_json = serde_json::to_vec(&StoredCommandResponse {
            receipt_version: if verified_authorization.is_some() {
                4
            } else {
                1
            },
            approval_deadline: deadline,
            approval_deadline_rfc3339: verified_authorization
                .as_ref()
                .map(|_| approval_deadline.to_owned()),
            committed_at,
            authorization: verified_authorization,
            authorization_document_hash,
            result: &output,
        })
        .map_err(|error| invalid(format!("serializing command receipt: {error}")))?;
        if response_json.len() > crate::codec::MAX_IPC_FRAME_BYTES {
            self.clear_staged_state()?;
            return Err(limit("durable command receipt exceeds the IPC frame limit"));
        }
        let staged = self
            .staged_state
            .lock()
            .map_err(|_| PeerError::StateConflict("staged state lock poisoned".into()))?
            .take()
            .ok_or_else(|| {
                PeerError::StateConflict("command transaction state disappeared".into())
            })?;
        if staged.owner != std::thread::current().id() {
            return Err(PeerError::StateConflict(
                "command transaction ownership changed before commit".into(),
            ));
        }
        let mut next = staged.state;
        if committed_at.saturating_add(MAX_CLOCK_SKEW_SECONDS) < next.high_water_unix_time {
            return Err(PeerError::Rollback(
                "wall clock moved behind durable daemon high-water mark before command commit"
                    .into(),
            ));
        }
        next.high_water_unix_time = next.high_water_unix_time.max(committed_at);
        next.command_receipts.push(CommandReceipt {
            command_id: command_id.to_owned(),
            operation: operation.to_owned(),
            request_hash,
            response_json,
        });
        compact_empty_query_claim_receipts(&mut next.command_receipts);
        next.validate()?;
        self.persist(&next)?;
        *self.lock_state()? = next;
        Ok(output)
    }

    fn clear_staged_state(&self) -> Result<()> {
        let mut staged = self
            .staged_state
            .lock()
            .map_err(|_| PeerError::StateConflict("staged state lock poisoned".into()))?;
        if staged
            .as_ref()
            .is_some_and(|staged| staged.owner != std::thread::current().id())
        {
            return Err(PeerError::StateConflict(
                "cannot clear another thread's command transaction".into(),
            ));
        }
        *staged = None;
        Ok(())
    }
}

impl DurableDaemonHandler {
    #[allow(clippy::too_many_lines)]
    async fn handle_ipc_request(
        &self,
        request: IpcRequest,
        authorization: Option<CommandAuthorization>,
        allow_unsigned_test_command: bool,
    ) -> IpcResponse {
        let request_id = request.request_id().to_owned();
        let request_hash = match request.command_id() {
            Some(_) => match canonical_command_request_hash(&request, authorization.as_ref()) {
                Ok(hash) => Some(hash),
                Err(error) => return rejected(request_id, &error),
            },
            None => None,
        };
        let command_digest = match request.command_id() {
            Some(_) => match command_action_digest(&request) {
                Ok(digest) => Some(digest),
                Err(error) => return rejected(request_id, &error),
            },
            None => None,
        };
        let result = match request {
            IpcRequest::ProtocolInfo { .. } => Ok(IpcResponse::ProtocolInfo {
                request_id: request_id.clone(),
                protocol: PROTOCOL_NAME.to_owned(),
            }),
            IpcRequest::Health { .. } => self.health().map(|provenance| IpcResponse::Health {
                    request_id: request_id.clone(),
                    enabled: true,
                    healthy: true,
                    protocol_version: PROTOCOL_NAME.to_owned(),
                    reason: None,
                    provenance,
            }),
            IpcRequest::TransportReadiness { input, .. } => self
                .require_owner(&input.owner_user_id)
                .and_then(|()| self.health())
                .and_then(|provenance| {
                    Ok(IpcResponse::TransportReadiness {
                        request_id: request_id.clone(),
                        transports: self.transport_readiness()?,
                        provenance,
                    })
                }),
            IpcRequest::LocalIdentity { input, .. } => {
                self.local_identity(&input)
                    .map(|identity| IpcResponse::LocalIdentity {
                        request_id: request_id.clone(),
                        identity,
                    })
            }
            IpcRequest::CommandReceipt { input, .. } => {
                self.command_receipt(&input)
                    .map(|receipt| IpcResponse::CommandReceipt {
                        request_id: request_id.clone(),
                        receipt,
                    })
            }
            IpcRequest::SyncCommandAuthorizationState {
                command_id, input, ..
            } => self
                .sync_command_authority_state(&input, command_id.as_deref())
                .map(|state| IpcResponse::CommandAuthorizationStateSynchronized {
                    request_id: request_id.clone(),
                    state,
                }),
            IpcRequest::CreateInvitation {
                command_id,
                approval_deadline,
                input,
                ..
            } => self
                .idempotent(
                    &command_id,
                    "create_invitation",
                    request_hash.unwrap_or([0; 32]),
                    command_digest.as_deref().unwrap_or_default(),
                    &approval_deadline,
                    authorization.as_ref(),
                    allow_unsigned_test_command,
                    || self.create_invitation(input),
                )
                .map(|material| IpcResponse::InvitationCreated {
                    request_id: request_id.clone(),
                    material,
                }),
            IpcRequest::CancelInvitation {
                command_id,
                approval_deadline,
                input,
                ..
            } => self
                .idempotent(
                    &command_id,
                    "cancel_invitation",
                    request_hash.unwrap_or([0; 32]),
                    command_digest.as_deref().unwrap_or_default(),
                    &approval_deadline,
                    authorization.as_ref(),
                    allow_unsigned_test_command,
                    || self.cancel_invitation(&input),
                )
                .map(|result| IpcResponse::InvitationCanceled {
                    request_id: request_id.clone(),
                    result,
                }),
            IpcRequest::AcceptInvitation {
                command_id,
                approval_deadline,
                input,
                ..
            } => self
                .idempotent(
                    &command_id,
                    "accept_invitation",
                    request_hash.unwrap_or([0; 32]),
                    command_digest.as_deref().unwrap_or_default(),
                    &approval_deadline,
                    authorization.as_ref(),
                    allow_unsigned_test_command,
                    || self.accept_invitation(input),
                )
                .map(|acceptance| IpcResponse::InvitationAccepted {
                    request_id: request_id.clone(),
                    acceptance,
                }),
            IpcRequest::AcceptPendingRequest {
                command_id,
                approval_deadline,
                input,
                ..
            } => self
                .idempotent(
                    &command_id,
                    "accept_pending_request",
                    request_hash.unwrap_or([0; 32]),
                    command_digest.as_deref().unwrap_or_default(),
                    &approval_deadline,
                    authorization.as_ref(),
                    allow_unsigned_test_command,
                    || self.accept_pending_request(&input),
                )
                .map(|result| IpcResponse::PendingRequestAccepted {
                    request_id: request_id.clone(),
                    result,
                }),
            IpcRequest::ConfirmPairing {
                command_id,
                approval_deadline,
                input,
                ..
            } => self
                .idempotent(
                    &command_id,
                    "confirm_pairing",
                    request_hash.unwrap_or([0; 32]),
                    command_digest.as_deref().unwrap_or_default(),
                    &approval_deadline,
                    authorization.as_ref(),
                    allow_unsigned_test_command,
                    || self.confirm_pairing(&input),
                )
                .map(|confirmation| IpcResponse::PairingConfirmed {
                    request_id: request_id.clone(),
                    confirmation,
                }),
            IpcRequest::SignGrant {
                command_id,
                approval_deadline,
                input,
                ..
            } => self
                .idempotent(
                    &command_id,
                    "sign_grant",
                    request_hash.unwrap_or([0; 32]),
                    command_digest.as_deref().unwrap_or_default(),
                    &approval_deadline,
                    authorization.as_ref(),
                    allow_unsigned_test_command,
                    || self.sign_grant(input),
                )
                .map(|result| IpcResponse::GrantSigned {
                    request_id: request_id.clone(),
                    result,
                }),
            IpcRequest::AcceptGrant {
                command_id,
                approval_deadline,
                input,
                ..
            } => self
                .idempotent(
                    &command_id,
                    "accept_grant",
                    request_hash.unwrap_or([0; 32]),
                    command_digest.as_deref().unwrap_or_default(),
                    &approval_deadline,
                    authorization.as_ref(),
                    allow_unsigned_test_command,
                    || self.accept_grant(input),
                )
                .map(|result| IpcResponse::GrantAccepted {
                    request_id: request_id.clone(),
                    result,
                }),
            IpcRequest::RevokeGrant {
                command_id,
                approval_deadline,
                input,
                ..
            } => self
                .idempotent(
                    &command_id,
                    "revoke_grant",
                    request_hash.unwrap_or([0; 32]),
                    command_digest.as_deref().unwrap_or_default(),
                    &approval_deadline,
                    authorization.as_ref(),
                    allow_unsigned_test_command,
                    || self.revoke_grant(input),
                )
                .map(|result| IpcResponse::GrantRevoked {
                    request_id: request_id.clone(),
                    result,
                }),
            IpcRequest::UpdateDevice {
                command_id,
                approval_deadline,
                input,
                ..
            } => self
                .idempotent(
                    &command_id,
                    "update_device",
                    request_hash.unwrap_or([0; 32]),
                    command_digest.as_deref().unwrap_or_default(),
                    &approval_deadline,
                    authorization.as_ref(),
                    allow_unsigned_test_command,
                    || self.update_device(&input),
                )
                .map(|result| IpcResponse::DeviceUpdated {
                    request_id: request_id.clone(),
                    result,
                }),
            IpcRequest::RotateHostCredential {
                command_id,
                approval_deadline,
                input,
                ..
            } => self
                .mls_lock
                .lock()
                .map_err(|_| PeerError::StateConflict("daemon MLS lock poisoned".into()))
                .and_then(|_mls| {
                    self.idempotent(
                        &command_id,
                        "rotate_host_credential",
                        request_hash.unwrap_or([0; 32]),
                        command_digest.as_deref().unwrap_or_default(),
                        &approval_deadline,
                        authorization.as_ref(),
                        allow_unsigned_test_command,
                        || self.rotate_host_credential(&input),
                    )
                })
                .map(|result| IpcResponse::HostCredentialRotationStarted {
                    request_id: request_id.clone(),
                    result,
                }),
            IpcRequest::RevokeRelationship {
                command_id,
                approval_deadline,
                input,
                ..
            } => self
                .idempotent(
                    &command_id,
                    "revoke_relationship",
                    request_hash.unwrap_or([0; 32]),
                    command_digest.as_deref().unwrap_or_default(),
                    &approval_deadline,
                    authorization.as_ref(),
                    allow_unsigned_test_command,
                    || self.revoke_relationship(input),
                )
                .map(|result| IpcResponse::RelationshipRevoked {
                    request_id: request_id.clone(),
                    result,
                }),
            IpcRequest::RequestResync {
                command_id,
                approval_deadline,
                input,
                ..
            } => self
                .idempotent(
                    &command_id,
                    "request_resync",
                    request_hash.unwrap_or([0; 32]),
                    command_digest.as_deref().unwrap_or_default(),
                    &approval_deadline,
                    authorization.as_ref(),
                    allow_unsigned_test_command,
                    || self.request_resync(&input),
                )
                .map(|result| IpcResponse::ResyncRequested {
                    request_id: request_id.clone(),
                    result,
                }),
            IpcRequest::ClaimInboundQuery {
                command_id,
                approval_deadline,
                input,
                ..
            } => self
                .idempotent_capability(
                    &command_id,
                    "claim_inbound_query",
                    request_hash.unwrap_or([0; 32]),
                    command_digest.as_deref().unwrap_or_default(),
                    &approval_deadline,
                    authorization.as_ref(),
                    allow_unsigned_test_command,
                    CommandCapabilityKind::QueryWorker,
                    CommandCapabilityState::Active,
                    || self.claim_inbound_query(&input),
                )
                .map(|result| IpcResponse::InboundQueryClaimed {
                    request_id: request_id.clone(),
                    result,
                }),
            IpcRequest::RespondInboundQuery {
                command_id,
                approval_deadline,
                input,
                ..
            } => self
                .idempotent_capability(
                    &command_id,
                    "respond_inbound_query",
                    request_hash.unwrap_or([0; 32]),
                    command_digest.as_deref().unwrap_or_default(),
                    &approval_deadline,
                    authorization.as_ref(),
                    allow_unsigned_test_command,
                    CommandCapabilityKind::QueryWorker,
                    CommandCapabilityState::Active,
                    || self.respond_inbound_query(&input),
                )
                .map(|result| IpcResponse::InboundQueryResponded {
                    request_id: request_id.clone(),
                    result,
                }),
            IpcRequest::ListRevocationEvents { input, .. } => self
                .list_revocation_events(&input)
                .map(|page| IpcResponse::RevocationEventsListed {
                    request_id: request_id.clone(),
                    page,
                }),
            IpcRequest::AckRevocationEvents {
                command_id,
                approval_deadline,
                input,
                ..
            } => self
                .idempotent_capability(
                    &command_id,
                    "ack_revocation_events",
                    request_hash.unwrap_or([0; 32]),
                    command_digest.as_deref().unwrap_or_default(),
                    &approval_deadline,
                    authorization.as_ref(),
                    allow_unsigned_test_command,
                    CommandCapabilityKind::RevocationConsumer,
                    CommandCapabilityState::Active,
                    || self.acknowledge_revocation_events(&input),
                )
                .map(|result| IpcResponse::RevocationEventsAcknowledged {
                    request_id: request_id.clone(),
                    result,
                }),
            IpcRequest::ExecuteQuery { input, .. } => {
                self.execute_query(input).await.and_then(|result| {
                    ensure_query_response_frameable(&result)?;
                    Ok(IpcResponse::QueryExecuted {
                        request_id: request_id.clone(),
                        result,
                    })
                })
            }
            IpcRequest::VerifyGrant { .. } => Err(PeerError::Authorization(
                "standalone grant verification is disabled on the durable daemon; use a bound relationship operation"
                    .into(),
            )),
        };
        result.unwrap_or_else(|error| rejected(request_id, &error))
    }
}

#[async_trait::async_trait]
impl IpcHandler for DurableDaemonHandler {
    async fn handle(&self, request: IpcRequest) -> IpcResponse {
        self.handle_ipc_request(request, None, cfg!(test)).await
    }

    async fn handle_authorized(
        &self,
        request: IpcRequest,
        authorization: Option<CommandAuthorization>,
    ) -> IpcResponse {
        let allow_unsigned_test_command = cfg!(test) && self.command_authority.is_none();
        self.handle_ipc_request(request, authorization, allow_unsigned_test_command)
            .await
    }
}

#[async_trait::async_trait]
impl PeerWireHandler for DurableDaemonHandler {
    async fn ingest_and_ack(&self, packet: PeerWirePacket) -> Result<SignedDeliveryAck> {
        let now = self.checked_now()?;
        packet.validate_at(now)?;
        let packet_hash = packet.hash()?;
        if let Some(receipt) = self
            .state_snapshot()?
            .inbound_receipts
            .iter()
            .find(|receipt| receipt.packet_id == packet.packet_id)
            .cloned()
        {
            if receipt.packet_hash != packet_hash {
                return Err(PeerError::Replay(
                    "transport packet id was reused with different bytes".into(),
                ));
            }
            return Ok(receipt.acknowledgement);
        }
        let local_identity = self.identity.load_full();
        let acknowledgement = SignedDeliveryAck::sign(
            &packet,
            local_identity.certificate().clone(),
            local_identity.device_signer(),
            now,
        )?;
        let _mls = self
            .mls_lock
            .lock()
            .map_err(|_| PeerError::StateConflict("daemon MLS lock poisoned".into()))?;
        match &packet.payload {
            PeerWirePayload::PairingAcceptance(bytes) => {
                self.ingest_pairing_acceptance(&packet, bytes.as_slice(), &acknowledgement, now)?;
            }
            PeerWirePayload::MlsWelcome(welcome) => {
                self.ingest_mls_welcome(&packet, welcome, &acknowledgement, now)?;
            }
            PeerWirePayload::HostCredentialRotation(rotation) => {
                self.ingest_host_credential_rotation(&packet, rotation, &acknowledgement, now)?;
            }
            PeerWirePayload::Envelope(envelope) => {
                self.ingest_application_envelope(&packet, envelope, &acknowledgement, now)?;
            }
        }
        Ok(acknowledgement)
    }

    async fn ingest_mailbox_and_ack(
        &self,
        packet: PeerWirePacket,
        authenticated_sender: DeviceCertificate,
    ) -> Result<SignedDeliveryAck> {
        let now = self.checked_now()?;
        authenticated_sender.verify(now)?;
        match &packet.payload {
            PeerWirePayload::PairingAcceptance(bytes) => {
                let envelope: PairingAcceptanceEnvelope =
                    decode_limited::<{ 96 * 1024 }, _>(bytes.as_slice())?;
                if envelope.body.sender_certificate != authenticated_sender {
                    return Err(PeerError::Authentication(
                        "mailbox sender is not the signed pairing accepter".into(),
                    ));
                }
            }
            PeerWirePayload::MlsWelcome(welcome) => {
                if welcome.body.sender_certificate != authenticated_sender {
                    return Err(PeerError::Authentication(
                        "mailbox sender is not the signed MLS Welcome sender".into(),
                    ));
                }
            }
            PeerWirePayload::HostCredentialRotation(rotation) => {
                if rotation.body.predecessor_certificate != authenticated_sender {
                    return Err(PeerError::Authentication(
                        "mailbox sender is not the signed host rotation predecessor".into(),
                    ));
                }
            }
            PeerWirePayload::Envelope(envelope) => {
                if envelope.body.sender_device_id != authenticated_sender.body.device_id {
                    return Err(PeerError::Authentication(
                        "mailbox sender does not match the envelope device".into(),
                    ));
                }
                let state = self.state_snapshot()?;
                let bound = state.relationships.iter().any(|relationship| {
                    relationship.status == RelationshipStatus::Active
                        && relationship.remote_certificate == authenticated_sender
                        && channel_id_for_relationship(&relationship.id)
                            .is_ok_and(|channel| channel == envelope.body.channel_id)
                });
                if !bound {
                    return Err(PeerError::Authentication(
                        "mailbox sender certificate is not current for the envelope relationship"
                            .into(),
                    ));
                }
            }
        }
        self.ingest_and_ack(packet).await
    }

    async fn sign_mailbox_packet(
        &self,
        packet: PeerWirePacket,
        reply_to: MailboxEndpointDescriptor,
    ) -> Result<SignedMailboxPacket> {
        let identity = self.identity.load_full();
        SignedMailboxPacket::sign(
            packet,
            reply_to,
            identity.certificate().clone(),
            identity.device_signer(),
        )
    }

    async fn mailbox_poll_credentials(&self, now: u64) -> Result<Vec<MailboxChannelCredential>> {
        let configured_origin = self.configured_mailbox_origin()?.ok_or_else(|| {
            PeerError::Transport("mailbox runtime has no configured provider origin".into())
        })?;
        let state = self.state_snapshot()?;
        let mut bindings = Vec::new();
        let mut channels = BTreeSet::new();
        for invitation in state.invitations.iter().filter(|invitation| {
            !invitation.consumed && now <= invitation.bundle.signed_invite.body.expires_at
        }) {
            let secret = MailboxRelationshipSecret::derive(
                &invitation.bundle.bootstrap_proof,
                &invitation.bundle.signed_invite.body.invite_id.0,
                invitation
                    .bundle
                    .signed_invite
                    .body
                    .inviter_device
                    .body
                    .principal_id,
            )?;
            let Some(credential) = bound_mailbox_credential(
                &secret,
                MailboxChannelRole::InviterInbox,
                invitation.bundle.signed_invite.body.endpoints.as_slice(),
            )?
            else {
                continue;
            };
            if credential.endpoint().origin.as_str() != configured_origin {
                return Err(PeerError::Authentication(
                    "live invitation mailbox endpoint is bound to another provider".into(),
                ));
            }
            if !channels.insert(credential.endpoint().opaque_channel) {
                return Err(PeerError::Rollback(
                    "durable mailbox poll channels are not unique".into(),
                ));
            }
            bindings.push(credential);
        }
        for relationship in state.relationships.iter().filter(|relationship| {
            relationship.status == RelationshipStatus::Active
                && relationship.mailbox_secret.is_some()
        }) {
            let stored_secret = relationship.mailbox_secret.as_ref().ok_or_else(|| {
                PeerError::Rollback("mailbox relationship lost its sealed capability".into())
            })?;
            let secret = MailboxRelationshipSecret::from_stored(stored_secret)?;
            let endpoint = relationship
                .local_endpoints
                .iter()
                .find_map(|endpoint| {
                    if let EndpointDescriptor::HttpMailbox(endpoint) = endpoint {
                        Some(endpoint)
                    } else {
                        None
                    }
                })
                .ok_or_else(|| {
                    PeerError::Rollback("mailbox relationship lost its local endpoint".into())
                })?;
            if endpoint.origin.as_str() != configured_origin {
                return Err(PeerError::Authentication(
                    "active relationship mailbox endpoint is bound to another provider".into(),
                ));
            }
            let role = mailbox_role_for_endpoint(&secret, endpoint)?;
            let credential = secret.credential(role, endpoint.origin.as_str())?;
            credential.require_endpoint(endpoint)?;
            if !channels.insert(credential.endpoint().opaque_channel) {
                return Err(PeerError::Rollback(
                    "durable mailbox poll channels are not unique".into(),
                ));
            }
            bindings.push(credential);
        }
        Ok(bindings)
    }

    async fn mailbox_dispatch_binding(
        &self,
        relationship_id: Option<&str>,
        target: &MailboxEndpointDescriptor,
    ) -> Result<MailboxDispatchBinding> {
        target.validate()?;
        let configured_origin = self.configured_mailbox_origin()?.ok_or_else(|| {
            PeerError::Transport(
                "mailbox endpoint is authenticated but no provider is configured".into(),
            )
        })?;
        if target.origin.as_str() != configured_origin {
            return Err(PeerError::Authentication(
                "mailbox target is bound to a different configured provider".into(),
            ));
        }
        let state = self.state_snapshot()?;
        let mut candidates = state.relationships.iter().filter(|relationship| {
            relationship.status == RelationshipStatus::Active
                && relationship
                    .remote_endpoints
                    .iter()
                    .any(|endpoint| {
                        matches!(endpoint, EndpointDescriptor::HttpMailbox(endpoint) if endpoint == target)
                    })
                && relationship_id.is_none_or(|id| relationship.id == id)
        });
        let relationship = candidates.next().ok_or_else(|| {
            PeerError::Authorization(
                "mailbox target has no active authenticated relationship capability".into(),
            )
        })?;
        if candidates.next().is_some() {
            return Err(PeerError::StateConflict(
                "mailbox target is ambiguously bound to multiple relationships".into(),
            ));
        }
        let stored_secret = relationship.mailbox_secret.as_ref().ok_or_else(|| {
            PeerError::Authorization(
                "legacy mailbox relationship has no non-derivable channel capability".into(),
            )
        })?;
        let secret = MailboxRelationshipSecret::from_stored(stored_secret)?;
        let target_role = mailbox_role_for_endpoint(&secret, target)?;
        let target_credential = secret.credential(target_role, target.origin.as_str())?;
        target_credential.require_endpoint(target)?;
        let reply_to = relationship
            .local_endpoints
            .iter()
            .find_map(|endpoint| {
                if let EndpointDescriptor::HttpMailbox(endpoint) = endpoint {
                    Some(endpoint.clone())
                } else {
                    None
                }
            })
            .ok_or_else(|| {
                PeerError::Rollback("mailbox relationship lost its reply endpoint".into())
            })?;
        if mailbox_role_for_endpoint(&secret, &reply_to)? != target_role.opposite() {
            return Err(PeerError::Authentication(
                "mailbox reply endpoint is not the opposite relationship channel".into(),
            ));
        }
        Ok(MailboxDispatchBinding {
            target_credential,
            reply_to,
        })
    }

    async fn due_outbound(&self, now: u64, max_items: usize) -> Result<Vec<OutboundWireDispatch>> {
        if max_items == 0 || max_items > 64 {
            return Err(limit("outbound dispatch batch limit is invalid"));
        }
        self.materialize_pending_applications(now)?;
        self.mutate(|state| {
            state
                .transport_outbox
                .retain(|outbound| outbound.packet.expires_at > now);
            Ok(())
        })?;
        let state = self.state_snapshot()?;
        state
            .transport_outbox
            .iter()
            .filter(|outbound| {
                outbound.next_attempt_at <= now && outbound.attempts < MAX_TRANSPORT_ATTEMPTS
            })
            .take(max_items)
            .map(|outbound| {
                let endpoint_index = usize::from(outbound.attempts) % outbound.endpoints.len();
                Ok(OutboundWireDispatch {
                    relationship_id: outbound.relationship_id.clone(),
                    endpoint: outbound.endpoints[endpoint_index].clone(),
                    expected_receiver: outbound.expected_receiver.clone(),
                    packet: outbound.packet.clone(),
                })
            })
            .collect()
    }

    async fn acknowledge_outbound(
        &self,
        packet: &PeerWirePacket,
        expected_receiver: &DeviceCertificate,
        acknowledgement: SignedDeliveryAck,
        now: u64,
    ) -> Result<()> {
        let _mls = self
            .mls_lock
            .lock()
            .map_err(|_| PeerError::StateConflict("daemon MLS lock poisoned".into()))?;
        if self.commit_verified_outbound_acknowledgement(
            packet,
            expected_receiver,
            &acknowledgement,
            now,
        )? {
            self.finalize_host_rotation_if_ready()?;
        }
        Ok(())
    }

    async fn record_outbound_failure(
        &self,
        packet_id: [u8; 16],
        packet_hash: [u8; 32],
        now: u64,
    ) -> Result<()> {
        self.mutate(|state| {
            let Some(outbound) = state
                .transport_outbox
                .iter_mut()
                .find(|outbound| outbound.packet.packet_id == packet_id)
            else {
                return Ok(());
            };
            if outbound.packet.hash()? != packet_hash {
                return Err(PeerError::Authentication(
                    "failed transport packet hash does not match the outbox".into(),
                ));
            }
            outbound.attempts = outbound.attempts.saturating_add(1);
            let exponent = u32::from(outbound.attempts.min(6));
            let delay = 1_u64.checked_shl(exponent).unwrap_or(60).min(60);
            outbound.next_attempt_at = now.saturating_add(delay);
            Ok(())
        })
    }

    async fn defer_outbound(
        &self,
        packet_id: [u8; 16],
        packet_hash: [u8; 32],
        now: u64,
    ) -> Result<()> {
        self.mutate(|state| {
            let Some(outbound) = state
                .transport_outbox
                .iter_mut()
                .find(|outbound| outbound.packet.packet_id == packet_id)
            else {
                return Ok(());
            };
            if outbound.packet.hash()? != packet_hash {
                return Err(PeerError::Authentication(
                    "deferred transport packet hash does not match the outbox".into(),
                ));
            }
            outbound.next_attempt_at = now.saturating_add(30);
            Ok(())
        })
    }

    async fn acknowledge_mailbox(
        &self,
        acknowledgement: SignedDeliveryAck,
        now: u64,
    ) -> Result<()> {
        acknowledgement.verify_signature(now)?;
        let dispatch = self
            .state_snapshot()?
            .transport_outbox
            .iter()
            .find(|outbound| outbound.packet.packet_id == acknowledgement.body.packet_id)
            .map(|outbound| (outbound.packet.clone(), outbound.expected_receiver.clone()));
        let Some((packet, expected_receiver)) = dispatch else {
            return Ok(());
        };
        self.acknowledge_outbound(&packet, &expected_receiver, acknowledgement, now)
            .await
    }

    fn readiness_registry(&self) -> ProviderReadinessRegistry {
        self.transport_readiness.clone()
    }
}

impl Validate for CreateInvitationInput {
    fn validate(&self) -> Result<()> {
        validate_text(&self.owner_user_id, 1, MAX_TEXT_BYTES, "owner user id")?;
        validate_text(&self.label, 1, 160, "invitation label")?;
        parse_timestamp(&self.expires_at, "invitation expiresAt")?;
        validate_transport_kinds(&self.transport_kinds)
    }
}

impl Validate for CancelInvitationInput {
    fn validate(&self) -> Result<()> {
        validate_text(&self.owner_user_id, 1, MAX_TEXT_BYTES, "owner user id")?;
        decode_hex_array::<16>(&self.invitation_id, "invitation id").map(|_| ())
    }
}

impl Validate for ApiPairingInvitation {
    fn validate(&self) -> Result<()> {
        validate_text(&self.id, 1, MAX_TEXT_BYTES, "invitation id")?;
        validate_text(&self.owner_user_id, 1, MAX_TEXT_BYTES, "invitation owner")?;
        decode_hex_array::<32>(&self.inviter_principal_id, "inviter principal id")?;
        decode_hex_array::<16>(&self.inviter_device_id, "inviter device id")?;
        if self.protocol_version != PROTOCOL_NAME {
            return Err(PeerError::Version(
                "invitation protocol is unsupported".into(),
            ));
        }
        parse_timestamp(&self.expires_at, "invitation expiresAt")?;
        validate_transport_kinds(&self.transport_kinds)?;
        decode_base64(&self.bootstrap, 32 * 1024, "pairing bootstrap")?;
        let signature = decode_base64(&self.signature, 64, "pairing signature")?;
        if signature.len() != 64 {
            return Err(invalid("pairing signature must contain 64 bytes"));
        }
        if self.fingerprint.len() < 19 || self.fingerprint.len() > 39 {
            return Err(invalid("pairing fingerprint has an invalid length"));
        }
        Ok(())
    }
}

impl Validate for AcceptInvitationInput {
    fn validate(&self) -> Result<()> {
        validate_text(&self.owner_user_id, 1, MAX_TEXT_BYTES, "owner user id")?;
        self.invitation.validate()?;
        validate_text(&self.local_device_id, 1, MAX_TEXT_BYTES, "local device id")?;
        parse_timestamp(&self.scanned_at, "pairing scannedAt").map(|_| ())
    }
}

impl Validate for PairingRequestPayload {
    fn validate(&self) -> Result<()> {
        if self.protocol_version != PROTOCOL_NAME {
            return Err(PeerError::Version(
                "pairing payload protocol is unsupported".into(),
            ));
        }
        decode_hex_array::<16>(&self.invitation_id, "invitation id")?;
        decode_hex_array::<32>(&self.transcript_hash, "transcript hash")?;
        decode_hex_array::<32>(&self.verification_phrase_hash, "phrase hash")?;
        decode_hex_array::<32>(&self.local_principal_id, "local principal id")?;
        decode_hex_array::<16>(&self.local_device_id, "local device id")?;
        decode_hex_array::<32>(&self.remote_principal_id, "remote principal id")?;
        decode_hex_array::<16>(&self.remote_device_id, "remote device id")?;
        decode_hex_array::<32>(&self.state_binding, "pairing state binding")?;
        validate_text(
            &self.verification_phrase,
            7,
            MAX_TEXT_BYTES,
            "verification phrase",
        )
    }
}

impl Validate for ConfirmPairingInput {
    fn validate(&self) -> Result<()> {
        validate_text(&self.owner_user_id, 1, MAX_TEXT_BYTES, "owner user id")?;
        decode_hex_array::<16>(&self.pairing_id, "pairing id")?;
        self.request_payload.validate()?;
        decode_hex_array::<32>(&self.transcript_hash, "transcript hash")?;
        validate_text(
            &self.verification_phrase,
            7,
            MAX_TEXT_BYTES,
            "verification phrase",
        )
    }
}

impl Validate for LocalIdentityInput {
    fn validate(&self) -> Result<()> {
        validate_text(&self.owner_user_id, 1, MAX_TEXT_BYTES, "owner user id")
    }
}

impl Validate for CommandReceiptInput {
    fn validate(&self) -> Result<()> {
        validate_text(&self.owner_user_id, 1, MAX_TEXT_BYTES, "owner user id")?;
        crate::ipc::validate_command_id(&self.command_id)
    }
}

impl Validate for CommandAuthorityStateInput {
    fn validate(&self) -> Result<()> {
        validate_text(&self.owner_user_id, 1, MAX_TEXT_BYTES, "owner user id")
    }
}

impl Validate for RotateHostCredentialInput {
    fn validate(&self) -> Result<()> {
        validate_text(&self.owner_user_id, 1, MAX_TEXT_BYTES, "owner user id")?;
        parse_timestamp(&self.not_after, "host credential notAfter").map(|_| ())
    }
}

impl Validate for PairingDevice {
    fn validate(&self) -> Result<()> {
        decode_pairing_device_certificate(self).map(|_| ())
    }
}

impl Validate for ApiPendingRequest {
    fn validate(&self) -> Result<()> {
        validate_text(&self.id, 1, MAX_TEXT_BYTES, "pending request id")?;
        validate_text(
            &self.owner_user_id,
            1,
            MAX_TEXT_BYTES,
            "pending request owner",
        )?;
        if let Some(relationship_id) = &self.relationship_id {
            validate_text(
                relationship_id,
                1,
                MAX_TEXT_BYTES,
                "pending request relationship id",
            )?;
        }
        if self.version == 0 || self.version > u64::from(u32::MAX) {
            return Err(limit(
                "pending request version is outside the supported range",
            ));
        }
        validate_json_object(&self.payload)?;
        let payload_bytes = serde_json_canonicalizer::to_vec(&self.payload)
            .map_err(|error| invalid(format!("canonicalizing pending request payload: {error}")))?;
        if payload_bytes.len() > MAX_IPC_FRAME_BYTES / 2 {
            return Err(limit("pending request payload exceeds 32 KiB"));
        }
        validate_sha256_hex(&self.payload_hash, "pending request payload hash")?;
        let expires_at = parse_timestamp(&self.expires_at, "pending request expiresAt")?;
        let created_at = parse_timestamp(&self.created_at, "pending request createdAt")?;
        let updated_at = parse_timestamp(&self.updated_at, "pending request updatedAt")?;
        if created_at > updated_at || updated_at >= expires_at {
            return Err(invalid("pending request timestamps are not ordered"));
        }
        if let Some(decided_at) = &self.decided_at {
            let decided_at = parse_timestamp(decided_at, "pending request decidedAt")?;
            if decided_at < created_at {
                return Err(invalid("pending request decision predates creation"));
            }
        }
        validate_text(
            &self.decision_reason,
            0,
            MAX_REASON_BYTES,
            "pending request decision reason",
        )
    }
}

impl Validate for AcceptPendingRequestInput {
    fn validate(&self) -> Result<()> {
        validate_text(&self.owner_user_id, 1, MAX_TEXT_BYTES, "owner user id")?;
        self.request.validate()
    }
}

impl Validate for SignGrantInput {
    fn validate(&self) -> Result<()> {
        validate_text(&self.owner_user_id, 1, MAX_TEXT_BYTES, "owner user id")?;
        validate_text(&self.relationship_id, 1, MAX_TEXT_BYTES, "relationship id")?;
        self.grant.validate()
    }
}

impl Validate for AcceptGrantInput {
    fn validate(&self) -> Result<()> {
        validate_text(&self.owner_user_id, 1, MAX_TEXT_BYTES, "owner user id")?;
        self.grant.validate()
    }
}

impl Validate for RevokeGrantInput {
    fn validate(&self) -> Result<()> {
        validate_text(&self.owner_user_id, 1, MAX_TEXT_BYTES, "owner user id")?;
        validate_text(&self.reason, 1, MAX_REASON_BYTES, "grant revocation reason")?;
        if self.reason.trim() != self.reason {
            return Err(invalid("grant revocation reason is untrimmed"));
        }
        self.grant.validate()
    }
}

impl Validate for UpdateDeviceInput {
    fn validate(&self) -> Result<()> {
        validate_text(&self.owner_user_id, 1, MAX_TEXT_BYTES, "owner user id")?;
        validate_text(&self.relationship_id, 1, MAX_TEXT_BYTES, "relationship id")?;
        validate_text(&self.device_id, 1, MAX_TEXT_BYTES, "device id")
    }
}

impl Validate for RevokeRelationshipInput {
    fn validate(&self) -> Result<()> {
        validate_text(&self.owner_user_id, 1, MAX_TEXT_BYTES, "owner user id")?;
        validate_text(&self.relationship_id, 1, MAX_TEXT_BYTES, "relationship id")?;
        validate_text(&self.reason, 1, MAX_REASON_BYTES, "revocation reason")?;
        if self.reason.trim() != self.reason {
            return Err(invalid("relationship revocation reason is untrimmed"));
        }
        Ok(())
    }
}

impl Validate for RequestResyncInput {
    fn validate(&self) -> Result<()> {
        validate_text(&self.owner_user_id, 1, MAX_TEXT_BYTES, "owner user id")?;
        validate_text(&self.relationship_id, 1, MAX_TEXT_BYTES, "relationship id")?;
        validate_projection_ids(&self.projection_ids)
    }
}

impl Validate for ApiTypedQuery {
    fn validate(&self) -> Result<()> {
        validate_projection_id(&self.projection_id)?;
        validate_json_object(&self.parameters)?;
        if let Some(interval) = &self.interval {
            let start = parse_timestamp(&interval.starts_at, "query interval start")?;
            let end = parse_timestamp(&interval.ends_at, "query interval end")?;
            if start >= end || end - start > 366 * 24 * 60 * 60 {
                return Err(invalid("query interval is empty or exceeds one year"));
            }
            validate_text(&interval.time_zone, 1, 64, "query time zone")?;
        }
        validate_unique_texts(&self.entity_ids, 256, 240, "query entity ids")?;
        validate_unique_texts(&self.fields, 64, 120, "query fields")?;
        validate_text(&self.precision, 1, 80, "query precision")?;
        if self.maximum_result_count == 0
            || usize::from(self.maximum_result_count) > MAX_REQUESTED_QUERY_RECORDS
        {
            return Err(limit("query maximumResultCount must be within 1..=1000"));
        }
        Ok(())
    }
}

impl Validate for ExecuteQueryInput {
    fn validate(&self) -> Result<()> {
        validate_text(&self.owner_user_id, 1, MAX_TEXT_BYTES, "owner user id")?;
        validate_text(&self.relationship_id, 1, MAX_TEXT_BYTES, "relationship id")?;
        validate_text(&self.person_id, 1, MAX_TEXT_BYTES, "person id")?;
        self.query.validate()?;
        if self.timeout_ms == 0 || self.timeout_ms > MAX_QUERY_TIMEOUT_MS {
            return Err(limit("query timeout must be within 1..=12000 milliseconds"));
        }
        Ok(())
    }
}

impl Validate for ClaimInboundQueryInput {
    fn validate(&self) -> Result<()> {
        validate_text(&self.owner_user_id, 1, MAX_TEXT_BYTES, "owner user id")?;
        validate_text(&self.worker_id, 1, MAX_TEXT_BYTES, "query worker id")?;
        if !(100..=30_000).contains(&self.lease_ms) {
            return Err(limit("query claim leaseMs must be within 100..=30000"));
        }
        Ok(())
    }
}

impl Validate for RespondInboundQueryInput {
    fn validate(&self) -> Result<()> {
        validate_text(&self.owner_user_id, 1, MAX_TEXT_BYTES, "owner user id")?;
        validate_text(&self.worker_id, 1, MAX_TEXT_BYTES, "query worker id")?;
        decode_hex_array::<16>(&self.claim_id, "query claim id")?;
        decode_hex_array::<16>(&self.query_id, "query id")?;
        validate_query_payload(&self.payload)?;
        parse_timestamp(&self.as_of, "query response asOf")?;
        validate_unique_texts(
            &self.redacted_fields,
            MAX_QUERY_FIELDS,
            120,
            "query response redacted fields",
        )?;
        for field in &self.redacted_fields {
            wire_projection_field(field)?;
        }
        Ok(())
    }
}

impl Validate for ListRevocationEventsInput {
    fn validate(&self) -> Result<()> {
        validate_text(&self.owner_user_id, 1, MAX_TEXT_BYTES, "owner user id")?;
        validate_text(
            &self.consumer_id,
            1,
            MAX_TEXT_BYTES,
            "revocation consumer id",
        )?;
        parse_canonical_u64(&self.after_cursor, "revocation afterCursor")?;
        if !(1..=128).contains(&self.limit) {
            return Err(limit("revocation event limit must be within 1..=128"));
        }
        Ok(())
    }
}

impl Validate for AckRevocationEventsInput {
    fn validate(&self) -> Result<()> {
        validate_text(&self.owner_user_id, 1, MAX_TEXT_BYTES, "owner user id")?;
        validate_text(
            &self.consumer_id,
            1,
            MAX_TEXT_BYTES,
            "revocation consumer id",
        )?;
        if parse_canonical_u64(&self.through_cursor, "revocation throughCursor")? == 0 {
            return Err(invalid("revocation throughCursor must be positive"));
        }
        validate_sha256_hex(&self.event_hash, "revocation event hash")
    }
}

fn parse_canonical_u64(value: &str, label: &str) -> Result<u64> {
    let parsed = value
        .parse::<u64>()
        .map_err(|_| invalid(format!("{label} is not a canonical u64")))?;
    if parsed.to_string() != value {
        return Err(invalid(format!("{label} is not canonical decimal")));
    }
    Ok(parsed)
}

fn rejected(request_id: String, error: &PeerError) -> IpcResponse {
    let code = match error {
        PeerError::Authentication(_) => IpcErrorCode::AuthenticationFailed,
        PeerError::Authorization(_) => IpcErrorCode::AuthorizationFailed,
        PeerError::StateConflict(_) | PeerError::InviteConflict(_) | PeerError::Replay(_) => {
            IpcErrorCode::Conflict
        }
        PeerError::Timeout(_) | PeerError::Transport(_) => IpcErrorCode::Unavailable,
        _ => IpcErrorCode::InvalidRequest,
    };
    IpcResponse::Rejected {
        request_id,
        code,
        detail: error.to_string().chars().take(256).collect(),
    }
}

fn canonical_command_request_hash(
    request: &IpcRequest,
    authorization: Option<&CommandAuthorization>,
) -> Result<[u8; 32]> {
    let mut value = serde_json::to_value(request)
        .map_err(|error| invalid(format!("serializing command request: {error}")))?;
    let object = value
        .as_object_mut()
        .ok_or_else(|| invalid("command request is not a JSON object"))?;
    object.remove("requestId");
    object.remove("commandId");
    if let Some(authorization) = authorization {
        object.insert(
            "authorization".into(),
            serde_json::to_value(authorization)
                .map_err(|error| invalid(format!("serializing command authorization: {error}")))?,
        );
    }
    let canonical = serde_json_canonicalizer::to_vec(&value)
        .map_err(|error| invalid(format!("canonicalizing command request: {error}")))?;
    if canonical.len() > crate::codec::MAX_IPC_FRAME_BYTES {
        return Err(limit(
            "canonical command request exceeds the IPC frame limit",
        ));
    }
    Ok(*blake3::hash(&canonical).as_bytes())
}

pub fn command_action_digest(request: &IpcRequest) -> Result<String> {
    if !request.requires_command_authorization() {
        return Err(invalid(
            "command action digest requires a mutating IPC request",
        ));
    }
    let mut value = serde_json::to_value(request)
        .map_err(|error| invalid(format!("serializing command action: {error}")))?;
    value
        .as_object_mut()
        .ok_or_else(|| invalid("command action is not a JSON object"))?
        .remove("requestId");
    let canonical = serde_json_canonicalizer::to_vec(&value)
        .map_err(|error| invalid(format!("canonicalizing command action: {error}")))?;
    if canonical.len() > crate::codec::MAX_IPC_FRAME_BYTES {
        return Err(limit(
            "canonical command action exceeds the IPC frame limit",
        ));
    }
    let mut hasher = Sha256::new();
    hasher.update(b"forge-peer/node-command-action/v1\0");
    hasher.update(canonical);
    Ok(hex::encode(hasher.finalize()))
}

fn command_authority_sync_id(
    state: &VerifiedCommandAuthorityState,
    caller_command_id: Option<&str>,
) -> Result<String> {
    let command_id = format!(
        "authority-state-{}-{}",
        state.epoch,
        &hex::encode(state.state_hash)[..32]
    );
    crate::ipc::validate_command_id(&command_id)?;
    if caller_command_id.is_some_and(|candidate| candidate != command_id) {
        return Err(PeerError::Authorization(
            "command authority sync commandId is not bound to the signed state".into(),
        ));
    }
    Ok(command_id)
}

fn command_authority_high_water(
    state: &DurableDaemonState,
) -> Result<Option<(String, u64, [u8; 32])>> {
    let mut high_water: Option<(String, u64, [u8; 32])> = None;
    for receipt in &state.command_receipts {
        let Ok(stored) = serde_json::from_slice::<StoredCommandResponse<serde_json::Value>>(
            &receipt.response_json,
        ) else {
            continue;
        };
        let Some(authorization) = stored.authorization else {
            continue;
        };
        let epoch = authorization
            .invalidation_epoch
            .parse::<u64>()
            .map_err(|_| {
                PeerError::Rollback(
                    "durable command authorization epoch is not canonical u64".into(),
                )
            })?;
        if epoch.to_string() != authorization.invalidation_epoch {
            return Err(PeerError::Rollback(
                "durable command authorization epoch is not canonical decimal".into(),
            ));
        }
        let state_hash_bytes = hex::decode(&authorization.authority_state_hash).map_err(|_| {
            PeerError::Rollback("durable command authority state hash is invalid".into())
        })?;
        let state_hash: [u8; 32] = state_hash_bytes.try_into().map_err(|_| {
            PeerError::Rollback("durable command authority state hash has wrong length".into())
        })?;
        match &high_water {
            None => {
                high_water = Some((authorization.authority_key_id, epoch, state_hash));
            }
            Some((key_id, current_epoch, current_hash)) => {
                if key_id != &authorization.authority_key_id {
                    return Err(PeerError::Rollback(
                        "durable commands contain conflicting Node authority keys".into(),
                    ));
                }
                if epoch == *current_epoch && state_hash.ct_eq(current_hash).unwrap_u8() != 1 {
                    return Err(PeerError::Rollback(
                        "durable commands contain a forked authority state epoch".into(),
                    ));
                }
                if epoch > *current_epoch {
                    high_water = Some((authorization.authority_key_id, epoch, state_hash));
                }
            }
        }
    }
    Ok(high_water)
}

fn ensure_query_response_frameable(result: &QueryGatewayResult) -> Result<()> {
    let response = IpcResponse::QueryExecuted {
        request_id: "r".repeat(64),
        result: result.clone(),
    };
    let encoded = serde_json::to_vec(&response)
        .map_err(|error| invalid(format!("serializing query IPC response: {error}")))?;
    if encoded.len() > MAX_IPC_FRAME_BYTES {
        return Err(limit(
            "authenticated query response exceeds the IPC frame ceiling",
        ));
    }
    Ok(())
}

fn relationship_view(relationship: &StoredRelationship) -> Result<PairingRelationship> {
    Ok(PairingRelationship {
        id: relationship.id.clone(),
        local_principal: principal_view(&relationship.local_certificate)?,
        remote_principal: principal_view(&relationship.remote_certificate)?,
        local_device: device_view(
            &relationship.local_certificate,
            &relationship.local_endpoints,
        )?,
        remote_device: device_view(
            &relationship.remote_certificate,
            &relationship.remote_endpoints,
        )?,
        negotiated_protocol_version: PROTOCOL_NAME.to_owned(),
        verification_phrase_hash: hex::encode(relationship.verification_phrase_hash),
        privacy_mode: relationship.privacy_mode,
    })
}

fn revocation_event_view(event: &StoredRevocationEvent) -> Result<RevocationEventView> {
    event.validate()?;
    let signing_certificate = encode_limited::<{ 24 * 1024 }, _>(&event.signing_certificate)?;
    let (target_certificate, target_certificate_hash, target_certificate_serial) = event
        .body
        .target_certificate
        .as_ref()
        .map(|certificate| -> Result<(String, String, String)> {
            Ok((
                URL_SAFE_NO_PAD.encode(encode_limited::<{ 24 * 1024 }, _>(certificate)?),
                hex::encode(certificate.fingerprint()?),
                certificate.body.serial.to_string(),
            ))
        })
        .transpose()?
        .map_or((None, None, None), |(certificate, hash, serial)| {
            (Some(certificate), Some(hash), Some(serial))
        });
    Ok(RevocationEventView {
        cursor: event.body.cursor.to_string(),
        event_hash: hex::encode(revocation_event_hash(event)?),
        previous_event_hash: hex::encode(event.body.previous_event_hash),
        kind: event.body.kind,
        source: event.body.source,
        relationship_id: event.body.relationship_id.clone(),
        grant_id: event.body.grant_id.clone(),
        device_id: event.body.device_id.clone(),
        target_certificate,
        target_certificate_hash,
        target_certificate_serial,
        reason: event.body.reason.clone(),
        occurred_at: format_timestamp(event.body.occurred_at)?,
        authenticated_remote_principal_id: event.body.authenticated_remote_principal_id.clone(),
        authenticated_remote_device_id: event.body.authenticated_remote_device_id.clone(),
        signing_device_id: device_id(&event.signing_certificate),
        signing_certificate: URL_SAFE_NO_PAD.encode(signing_certificate),
        signing_certificate_hash: hex::encode(event.signing_certificate.fingerprint()?),
        signature: URL_SAFE_NO_PAD.encode(event.signature.0),
    })
}

fn principal_view(certificate: &DeviceCertificate) -> Result<PairingPrincipal> {
    Ok(PairingPrincipal {
        id: principal_id(certificate),
        root_public_key: URL_SAFE_NO_PAD.encode(certificate.root_public_key),
        trust_state: PrincipalTrustState::Verified,
        certificate_hash: hex::encode(certificate.fingerprint()?),
    })
}

fn device_view(
    certificate: &DeviceCertificate,
    endpoints: &[EndpointDescriptor],
) -> Result<PairingDevice> {
    validate_canonical_endpoints(endpoints)?;
    let encoded = encode_limited::<{ 24 * 1024 }, _>(certificate)?;
    let view = PairingDevice {
        id: device_id(certificate),
        principal_id: principal_id(certificate),
        signing_public_key: URL_SAFE_NO_PAD.encode(certificate.body.device_public_key),
        key_agreement_public_key: URL_SAFE_NO_PAD
            .encode(certificate.body.device_key_agreement_public_key),
        certificate_serial: certificate.body.serial.to_string(),
        certificate: URL_SAFE_NO_PAD.encode(encoded),
        certificate_hash: hex::encode(certificate.fingerprint()?),
        capabilities: pairing_capabilities(certificate.body.capabilities),
        transport_endpoints: endpoints.iter().map(endpoint_view).collect(),
        status: PairingDeviceStatus::Approved,
    };
    view.validate()?;
    Ok(view)
}

fn pairing_capabilities(capabilities: DeviceCapabilities) -> Vec<PairingDeviceCapability> {
    [
        (
            DeviceCapabilities::DIRECT_STREAM,
            PairingDeviceCapability::DirectStream,
        ),
        (DeviceCapabilities::IROH, PairingDeviceCapability::Iroh),
        (DeviceCapabilities::TOR, PairingDeviceCapability::Tor),
        (
            DeviceCapabilities::HTTP_MAILBOX,
            PairingDeviceCapability::HttpMailbox,
        ),
        (DeviceCapabilities::QUERY, PairingDeviceCapability::Query),
        (
            DeviceCapabilities::PROJECTION,
            PairingDeviceCapability::Projection,
        ),
        (
            DeviceCapabilities::KEY_PACKAGE,
            PairingDeviceCapability::KeyPackage,
        ),
    ]
    .into_iter()
    .filter_map(|(bit, capability)| capabilities.contains(bit).then_some(capability))
    .collect()
}

pub fn decode_pairing_device_certificate(device: &PairingDevice) -> Result<DeviceCertificate> {
    if device.certificate.len() < 64 || device.certificate.len() > 32_768 {
        return Err(limit(
            "pairing device certificate must contain 64..=32768 base64url characters",
        ));
    }
    let encoded = decode_base64(&device.certificate, 24 * 1024, "pairing device certificate")?;
    let certificate: DeviceCertificate = decode_limited::<{ 24 * 1024 }, _>(&encoded)?;
    certificate.validate()?;
    let certificate_serial = device
        .certificate_serial
        .parse::<u64>()
        .map_err(|_| invalid("pairing device certificateSerial is not a canonical u64"))?;
    if certificate_serial == 0 || certificate_serial.to_string() != device.certificate_serial {
        return Err(invalid(
            "pairing device certificateSerial is not canonical decimal",
        ));
    }
    let expected_capabilities = pairing_capabilities(certificate.body.capabilities);
    if device.id != device_id(&certificate)
        || device.principal_id != principal_id(&certificate)
        || device.signing_public_key != URL_SAFE_NO_PAD.encode(certificate.body.device_public_key)
        || device.key_agreement_public_key
            != URL_SAFE_NO_PAD.encode(certificate.body.device_key_agreement_public_key)
        || certificate_serial != certificate.body.serial
        || device.certificate_hash != hex::encode(certificate.fingerprint()?)
        || device.capabilities != expected_capabilities
        || device.status != PairingDeviceStatus::Approved
    {
        return Err(PeerError::Authentication(
            "pairing device fields do not match the signed certificate".into(),
        ));
    }
    let endpoints = device
        .transport_endpoints
        .iter()
        .map(endpoint_from_view)
        .collect::<Result<Vec<_>>>()?;
    validate_canonical_endpoints(&endpoints)?;
    Ok(certificate)
}

fn endpoint_view(endpoint: &EndpointDescriptor) -> ApiTransportEndpoint {
    match endpoint {
        EndpointDescriptor::Direct(value) => ApiTransportEndpoint::LocalDirect {
            host: value.address.to_std().to_string(),
            port: value.port,
        },
        EndpointDescriptor::Iroh(value) => ApiTransportEndpoint::Iroh {
            endpoint_id: URL_SAFE_NO_PAD.encode(value.endpoint_id),
            relay_origin: value
                .relay_origin
                .as_ref()
                .map(|origin| origin.as_str().to_owned()),
        },
        EndpointDescriptor::Tor(value) => ApiTransportEndpoint::TorOnion {
            onion_host: value.onion_host.as_str().to_owned(),
            port: value.port,
        },
        EndpointDescriptor::HttpMailbox(value) => ApiTransportEndpoint::HttpMailbox {
            origin: value.origin.as_str().to_owned(),
            opaque_channel: URL_SAFE_NO_PAD.encode(value.opaque_channel),
        },
    }
}

fn endpoint_from_view(endpoint: &ApiTransportEndpoint) -> Result<EndpointDescriptor> {
    let endpoint = match endpoint {
        ApiTransportEndpoint::LocalDirect { host, port } => {
            let parsed = host
                .parse::<std::net::IpAddr>()
                .map_err(|_| invalid("local_direct endpoint address is not an IP address"))?;
            if parsed.to_string() != *host {
                return Err(invalid(
                    "local_direct endpoint address is not in canonical form",
                ));
            }
            EndpointDescriptor::Direct(DirectEndpoint {
                address: IpAddress::from(parsed),
                port: *port,
            })
        }
        ApiTransportEndpoint::Iroh {
            endpoint_id,
            relay_origin,
        } => EndpointDescriptor::Iroh(IrohEndpointDescriptor {
            endpoint_id: decode_base64_array(endpoint_id, "Iroh endpoint id")?,
            relay_origin: relay_origin
                .as_ref()
                .map(|origin| BoundedString::new(origin.clone()))
                .transpose()?,
        }),
        ApiTransportEndpoint::TorOnion { onion_host, port } => {
            EndpointDescriptor::Tor(TorEndpoint {
                onion_host: BoundedString::new(onion_host.clone())?,
                port: *port,
            })
        }
        ApiTransportEndpoint::HttpMailbox {
            origin,
            opaque_channel,
        } => EndpointDescriptor::HttpMailbox(MailboxEndpointDescriptor {
            origin: BoundedString::new(origin.clone())?,
            opaque_channel: decode_base64_array(opaque_channel, "mailbox opaque channel")?,
        }),
    };
    endpoint.validate()?;
    Ok(endpoint)
}

fn endpoint_sort_key(endpoint: &EndpointDescriptor) -> Result<Vec<u8>> {
    endpoint.validate()?;
    let mut key = Vec::with_capacity(320);
    match endpoint {
        EndpointDescriptor::Direct(value) => {
            key.push(0);
            match value.address {
                IpAddress::V4(address) => {
                    key.push(0);
                    key.extend_from_slice(&address);
                }
                IpAddress::V6(address) => {
                    key.push(1);
                    key.extend_from_slice(&address);
                }
            }
            key.extend_from_slice(&value.port.to_be_bytes());
        }
        EndpointDescriptor::Iroh(value) => {
            key.push(1);
            key.extend_from_slice(&value.endpoint_id);
            match &value.relay_origin {
                None => key.push(0),
                Some(origin) => {
                    key.push(1);
                    append_endpoint_sort_text(&mut key, origin.as_str())?;
                }
            }
        }
        EndpointDescriptor::Tor(value) => {
            key.push(2);
            append_endpoint_sort_text(&mut key, value.onion_host.as_str())?;
            key.extend_from_slice(&value.port.to_be_bytes());
        }
        EndpointDescriptor::HttpMailbox(value) => {
            key.push(3);
            append_endpoint_sort_text(&mut key, value.origin.as_str())?;
            key.extend_from_slice(&value.opaque_channel);
        }
    }
    Ok(key)
}

fn append_endpoint_sort_text(key: &mut Vec<u8>, value: &str) -> Result<()> {
    let length = u16::try_from(value.len())
        .map_err(|_| limit("transport endpoint sort field exceeds u16"))?;
    key.extend_from_slice(&length.to_be_bytes());
    key.extend_from_slice(value.as_bytes());
    Ok(())
}

fn canonicalize_endpoints(endpoints: Vec<EndpointDescriptor>) -> Result<Vec<EndpointDescriptor>> {
    if endpoints.len() > 8 {
        return Err(limit("transport endpoint list exceeds eight entries"));
    }
    let mut keyed = endpoints
        .into_iter()
        .map(|endpoint| {
            let key = endpoint_sort_key(&endpoint)?;
            Ok((key, endpoint))
        })
        .collect::<Result<Vec<_>>>()?;
    keyed.sort_by(|left, right| left.0.cmp(&right.0));
    if keyed.windows(2).any(|pair| pair[0].0 == pair[1].0) {
        return Err(invalid("transport endpoint list contains duplicates"));
    }
    Ok(keyed.into_iter().map(|(_, endpoint)| endpoint).collect())
}

fn validate_canonical_endpoints(endpoints: &[EndpointDescriptor]) -> Result<()> {
    if endpoints.len() > 8 {
        return Err(limit("transport endpoint list exceeds eight entries"));
    }
    let keys = endpoints
        .iter()
        .map(endpoint_sort_key)
        .collect::<Result<Vec<_>>>()?;
    for pair in keys.windows(2) {
        match pair[0].cmp(&pair[1]) {
            std::cmp::Ordering::Less => {}
            std::cmp::Ordering::Equal => {
                return Err(invalid("transport endpoint list contains duplicates"));
            }
            std::cmp::Ordering::Greater => {
                return Err(invalid("transport endpoint list is not in canonical order"));
            }
        }
    }
    Ok(())
}

impl Validate for ApiTransportEndpoint {
    fn validate(&self) -> Result<()> {
        endpoint_from_view(self).map(|_| ())
    }
}

impl Validate for PairingRelationship {
    fn validate(&self) -> Result<()> {
        decode_hex_array::<16>(&self.id, "relationship id")?;
        let local_certificate = decode_pairing_device_certificate(&self.local_device)?;
        let remote_certificate = decode_pairing_device_certificate(&self.remote_device)?;
        validate_principal_view(&self.local_principal, &local_certificate)?;
        validate_principal_view(&self.remote_principal, &remote_certificate)?;
        if self.local_principal.id != self.local_device.principal_id
            || self.remote_principal.id != self.remote_device.principal_id
            || self.local_principal.id == self.remote_principal.id
            || self.local_device.id == self.remote_device.id
        {
            return Err(PeerError::Authentication(
                "relationship principal and device identities do not match".into(),
            ));
        }
        if self.negotiated_protocol_version != PROTOCOL_NAME {
            return Err(PeerError::Version(
                "relationship negotiated protocol is unsupported".into(),
            ));
        }
        decode_hex_array::<32>(&self.verification_phrase_hash, "verification phrase hash")?;
        Ok(())
    }
}

fn validate_principal_view(
    principal: &PairingPrincipal,
    certificate: &DeviceCertificate,
) -> Result<()> {
    let root_public_key = decode_base64_array::<32>(
        &principal.root_public_key,
        "pairing principal root public key",
    )?;
    if principal.id != principal_id(certificate)
        || root_public_key != certificate.root_public_key
        || principal.certificate_hash != hex::encode(certificate.fingerprint()?)
        || principal.trust_state != PrincipalTrustState::Verified
    {
        return Err(PeerError::Authentication(
            "pairing principal fields do not match the signed device certificate".into(),
        ));
    }
    Ok(())
}

fn pairing_request_from_json(
    payload: &serde_json::Map<String, serde_json::Value>,
) -> Result<PairingRequestPayload> {
    serde_json::from_value(serde_json::Value::Object(payload.clone()))
        .map_err(|error| invalid(format!("invalid pairing pending-request payload: {error}")))
}

fn pending_payload_hash(payload: &serde_json::Map<String, serde_json::Value>) -> Result<String> {
    let canonical = serde_json_canonicalizer::to_vec(payload)
        .map_err(|error| invalid(format!("canonicalizing pending request payload: {error}")))?;
    Ok(hex::encode(Sha256::digest(canonical)))
}

fn canonical_pending_request_hash(request: &ApiPendingRequest) -> Result<[u8; 32]> {
    let canonical = serde_json_canonicalizer::to_vec(request)
        .map_err(|error| invalid(format!("canonicalizing pending request: {error}")))?;
    if canonical.len() > MAX_IPC_FRAME_BYTES {
        return Err(limit("pending request exceeds the IPC frame limit"));
    }
    Ok(*blake3::hash(&canonical).as_bytes())
}

fn pending_decision_id(request_id: &str) -> Result<[u8; 16]> {
    validate_text(request_id, 1, MAX_TEXT_BYTES, "pending request id")?;
    let derived = blake3::derive_key("forge-peer/1 pending decision id", request_id.as_bytes());
    let id: [u8; 16] = derived[..16]
        .try_into()
        .map_err(|_| invalid("pending decision id has the wrong size"))?;
    if id == [0; 16] {
        return Err(invalid("pending decision id is all zero"));
    }
    Ok(id)
}

fn pairing_payload(
    pairing: &StoredPairing,
    local: &DeviceCertificate,
) -> Result<PairingRequestPayload> {
    Ok(PairingRequestPayload {
        protocol_version: PROTOCOL_NAME.to_owned(),
        invitation_id: hex::encode(pairing.signed_invite.body.invite_id.0),
        transcript_hash: hex::encode(pairing.transcript_body.transcript_hash()?),
        verification_phrase: pairing.verification_phrase.clone(),
        verification_phrase_hash: hex::encode(pairing.transcript_body.verification_phrase_hash),
        local_principal_id: principal_id(local),
        local_device_id: device_id(local),
        remote_principal_id: principal_id(&pairing.signed_invite.body.inviter_device),
        remote_device_id: device_id(&pairing.signed_invite.body.inviter_device),
        state_binding: hex::encode(pairing.state_binding),
    })
}

#[derive(Encode, Decode)]
struct PairingAcceptancePlaintext {
    version: u16,
    bootstrap_proof: [u8; 32],
    transcript_body: PairingTranscriptBody,
    accepter_signature: SignatureBytes,
    local_endpoints: BoundedVec<EndpointDescriptor, 8>,
    openmls_key_package: BoundedBytes<{ 64 * 1024 }>,
}

impl Validate for PairingAcceptancePlaintext {
    fn validate(&self) -> Result<()> {
        if self.version != 3 || self.bootstrap_proof == [0; 32] {
            return Err(invalid("pairing acceptance plaintext is invalid"));
        }
        self.transcript_body.validate()?;
        self.accepter_signature.validate()?;
        self.local_endpoints.validate()?;
        if self.local_endpoints.is_empty() {
            return Err(invalid("pairing acceptance has no accepter endpoint"));
        }
        validate_canonical_endpoints(self.local_endpoints.as_slice())?;
        self.openmls_key_package.validate()?;
        if self.openmls_key_package.is_empty() {
            return Err(invalid("pairing acceptance has no OpenMLS key package"));
        }
        Ok(())
    }
}

#[derive(Encode, Decode)]
struct PairingAcceptanceEnvelopeBody {
    version: u16,
    invite_id: InviteId,
    sender_certificate: DeviceCertificate,
    ephemeral_public_key: [u8; 32],
    nonce: [u8; 24],
    created_at: u64,
    expires_at: u64,
    ciphertext: Vec<u8>,
}

impl Validate for PairingAcceptanceEnvelopeBody {
    fn validate(&self) -> Result<()> {
        if self.version != 1 || self.ephemeral_public_key == [0; 32] || self.nonce == [0; 24] {
            return Err(invalid("pairing acceptance envelope header is invalid"));
        }
        self.invite_id.validate()?;
        self.sender_certificate.validate()?;
        if self.created_at >= self.expires_at
            || self.ciphertext.is_empty()
            || self.ciphertext.len() > 64 * 1024
        {
            return Err(limit("pairing acceptance envelope is empty or oversized"));
        }
        Ok(())
    }
}

#[derive(Encode, Decode)]
struct PairingAcceptanceEnvelope {
    body: PairingAcceptanceEnvelopeBody,
    signature: SignatureBytes,
}

impl Validate for PairingAcceptanceEnvelope {
    fn validate(&self) -> Result<()> {
        self.body.validate()?;
        self.signature.validate()
    }
}

fn pairing_acceptance_envelope(
    pairing: &StoredPairing,
    identity: &LocalIdentityState,
    local_endpoints: &[EndpointDescriptor],
    openmls_key_package: &[u8],
    now: u64,
) -> Result<Vec<u8>> {
    let plaintext = PairingAcceptancePlaintext {
        version: 3,
        bootstrap_proof: pairing.bootstrap_proof,
        transcript_body: pairing.transcript_body.clone(),
        accepter_signature: pairing.accepter_signature,
        local_endpoints: BoundedVec::new(local_endpoints.to_vec())?,
        openmls_key_package: BoundedBytes::new(openmls_key_package.to_vec())?,
    };
    let plaintext = Zeroizing::new(encode_limited::<{ 64 * 1024 }, _>(&plaintext)?);
    let ephemeral_secret = StaticSecret::from(nonzero_random_32());
    let ephemeral_public_key = X25519PublicKey::from(&ephemeral_secret).to_bytes();
    let shared = ephemeral_secret
        .diffie_hellman(&X25519PublicKey::from(
            pairing.signed_invite.body.bootstrap_public_key,
        ))
        .to_bytes();
    if shared == [0; 32] {
        return Err(PeerError::Authentication(
            "pairing bootstrap key agreement was non-contributory".into(),
        ));
    }
    let mut key_material = Zeroizing::new(Vec::with_capacity(48));
    key_material.extend_from_slice(&shared);
    key_material.extend_from_slice(&pairing.signed_invite.body.invite_id.0);
    let key = Zeroizing::new(blake3::derive_key(
        "forge-peer/1 pairing acceptance encryption",
        &key_material,
    ));
    let nonce = nonzero_random_24();
    let ciphertext = XChaCha20Poly1305::new((&*key).into())
        .encrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: &plaintext,
                aad: &pairing.signed_invite.body.invite_id.0,
            },
        )
        .map_err(|_| PeerError::Authentication("encrypting pairing acceptance failed".into()))?;
    let body = PairingAcceptanceEnvelopeBody {
        version: 1,
        invite_id: pairing.signed_invite.body.invite_id,
        sender_certificate: identity.certificate().clone(),
        ephemeral_public_key,
        nonce,
        created_at: now,
        expires_at: pairing.transcript_body.expires_at,
        ciphertext,
    };
    let signature = identity
        .device_signer()
        .sign(PAIRING_ACCEPTANCE_DOMAIN, &body)?;
    encode_limited::<{ 96 * 1024 }, _>(&PairingAcceptanceEnvelope { body, signature })
}

fn open_pairing_acceptance(
    bytes: &[u8],
    invitation: &StoredInvitation,
    identity: &LocalIdentityState,
    now: u64,
    allow_loopback_direct: bool,
) -> Result<(PairingAcceptancePlaintext, SignedPairingTranscript)> {
    if invitation.consumed || invitation.bootstrap_private_key == [0; 32] {
        return Err(PeerError::Authorization(
            "pairing invitation is canceled or already consumed".into(),
        ));
    }
    let envelope: PairingAcceptanceEnvelope = decode_limited::<{ 96 * 1024 }, _>(bytes)?;
    envelope.body.sender_certificate.verify(now)?;
    envelope.body.sender_certificate.verify_device_signature(
        PAIRING_ACCEPTANCE_DOMAIN,
        &envelope.body,
        &envelope.signature,
    )?;
    if envelope.body.invite_id != invitation.bundle.signed_invite.body.invite_id
        || envelope.body.created_at > now.saturating_add(MAX_CLOCK_SKEW_SECONDS)
        || now > envelope.body.expires_at
        || envelope.body.expires_at > invitation.bundle.signed_invite.body.expires_at
    {
        return Err(PeerError::Authentication(
            "pairing acceptance header does not match the durable invitation".into(),
        ));
    }
    let shared = StaticSecret::from(invitation.bootstrap_private_key)
        .diffie_hellman(&X25519PublicKey::from(envelope.body.ephemeral_public_key))
        .to_bytes();
    if shared == [0; 32] {
        return Err(PeerError::Authentication(
            "pairing acceptance key agreement was non-contributory".into(),
        ));
    }
    let mut key_material = Zeroizing::new(Vec::with_capacity(48));
    key_material.extend_from_slice(&shared);
    key_material.extend_from_slice(&envelope.body.invite_id.0);
    let key = Zeroizing::new(blake3::derive_key(
        "forge-peer/1 pairing acceptance encryption",
        &key_material,
    ));
    let plaintext = Zeroizing::new(
        XChaCha20Poly1305::new((&*key).into())
            .decrypt(
                XNonce::from_slice(&envelope.body.nonce),
                Payload {
                    msg: &envelope.body.ciphertext,
                    aad: &envelope.body.invite_id.0,
                },
            )
            .map_err(|_| PeerError::Authentication("opening pairing acceptance failed".into()))?,
    );
    let plaintext: PairingAcceptancePlaintext = decode_limited::<{ 64 * 1024 }, _>(&plaintext)?;
    if crate::invite::bootstrap_proof_commitment(&plaintext.bootstrap_proof)?
        .ct_eq(
            &invitation
                .bundle
                .signed_invite
                .body
                .bootstrap_secret_commitment,
        )
        .unwrap_u8()
        != 1
        || plaintext.transcript_body.accepter_device != envelope.body.sender_certificate
        || plaintext.transcript_body.inviter_device != *identity.certificate()
    {
        return Err(PeerError::Authentication(
            "pairing acceptance is not bound to its signed devices and bootstrap proof".into(),
        ));
    }
    validate_canonical_endpoints(plaintext.transcript_body.selected_endpoints.as_slice())?;
    validate_canonical_endpoints(plaintext.local_endpoints.as_slice())?;
    validate_direct_endpoint_policy(
        plaintext.transcript_body.selected_endpoints.as_slice(),
        allow_loopback_direct,
    )?;
    validate_direct_endpoint_policy(plaintext.local_endpoints.as_slice(), allow_loopback_direct)?;
    let inviter_signature = SignedPairingTranscript::sign_as_inviter(
        &plaintext.transcript_body,
        identity.device_signer(),
    )?;
    let transcript = SignedPairingTranscript::assemble(
        plaintext.transcript_body.clone(),
        inviter_signature,
        plaintext.accepter_signature,
    )?;
    transcript.verify_against_invite(&invitation.bundle.signed_invite, now)?;
    Ok((plaintext, transcript))
}

fn validate_api_invitation(api: &ApiPairingInvitation, bundle: &PairingQrBundle) -> Result<()> {
    api.validate()?;
    let invite = &bundle.signed_invite;
    let expected_signature = URL_SAFE_NO_PAD.encode(invite.inviter_signature.0);
    let expected_kinds: BTreeSet<_> = invite
        .body
        .endpoints
        .as_slice()
        .iter()
        .map(transport_kind)
        .collect();
    let supplied_kinds: BTreeSet<_> = api.transport_kinds.iter().copied().collect();
    if api.id != hex::encode(invite.body.invite_id.0)
        || api.inviter_principal_id != principal_id(&invite.body.inviter_device)
        || api.inviter_device_id != device_id(&invite.body.inviter_device)
        || api.fingerprint != base32_fingerprint(&invite.body.inviter_fingerprint)
        || parse_timestamp(&api.expires_at, "invitation expiresAt")? != invite.body.expires_at
        || expected_signature
            .as_bytes()
            .ct_eq(api.signature.as_bytes())
            .unwrap_u8()
            != 1
        || expected_kinds != supplied_kinds
    {
        return Err(PeerError::Authentication(
            "API invitation metadata does not match its signed bootstrap".into(),
        ));
    }
    Ok(())
}

fn select_remote_endpoints(
    endpoints: &[EndpointDescriptor],
    privacy: PrivacyMode,
    allow_loopback_direct: bool,
) -> Result<BoundedVec<EndpointDescriptor, 8>> {
    let selected: Vec<_> = endpoints
        .iter()
        .filter(|endpoint| privacy != PrivacyMode::HideNetworkAddress || hides_address(endpoint))
        .cloned()
        .collect();
    if selected.is_empty() {
        return Err(PeerError::Transport(
            "invitation has no endpoint compatible with selected privacy".into(),
        ));
    }
    validate_direct_endpoint_policy(&selected, allow_loopback_direct)?;
    BoundedVec::new(canonicalize_endpoints(selected)?)
}

fn validate_direct_endpoint_policy(
    endpoints: &[EndpointDescriptor],
    allow_loopback_direct: bool,
) -> Result<()> {
    for endpoint in endpoints {
        if let EndpointDescriptor::Direct(endpoint) = endpoint {
            endpoint.socket_addr_with_loopback(allow_loopback_direct)?;
        }
    }
    Ok(())
}

fn hides_address(endpoint: &EndpointDescriptor) -> bool {
    matches!(
        endpoint,
        EndpointDescriptor::Tor(_) | EndpointDescriptor::HttpMailbox(_)
    )
}

fn transport_kind(endpoint: &EndpointDescriptor) -> TransportKind {
    match endpoint {
        EndpointDescriptor::Direct(_) => TransportKind::LocalDirect,
        EndpointDescriptor::Iroh(_) => TransportKind::Iroh,
        EndpointDescriptor::Tor(_) => TransportKind::TorOnion,
        EndpointDescriptor::HttpMailbox(_) => TransportKind::HttpMailbox,
    }
}

fn bound_mailbox_credential(
    secret: &MailboxRelationshipSecret,
    role: MailboxChannelRole,
    endpoints: &[EndpointDescriptor],
) -> Result<Option<MailboxChannelCredential>> {
    let mut mailbox_endpoints = endpoints.iter().filter_map(|endpoint| {
        if let EndpointDescriptor::HttpMailbox(endpoint) = endpoint {
            Some(endpoint)
        } else {
            None
        }
    });
    let Some(endpoint) = mailbox_endpoints.next() else {
        return Ok(None);
    };
    if mailbox_endpoints.next().is_some() {
        return Err(limit(
            "a pairing direction may authenticate at most one mailbox endpoint",
        ));
    }
    let credential = secret.credential(role, endpoint.origin.as_str())?;
    credential.require_endpoint(endpoint)?;
    Ok(Some(credential))
}

fn mailbox_role_for_endpoint(
    secret: &MailboxRelationshipSecret,
    endpoint: &MailboxEndpointDescriptor,
) -> Result<MailboxChannelRole> {
    for role in [
        MailboxChannelRole::InviterInbox,
        MailboxChannelRole::AccepterInbox,
    ] {
        let credential = secret.credential(role, endpoint.origin.as_str())?;
        if credential.endpoint() == endpoint {
            return Ok(role);
        }
    }
    Err(PeerError::Authentication(
        "mailbox endpoint is not derived from its sealed relationship capability".into(),
    ))
}

fn validate_stored_relationship_mailbox(relationship: &StoredRelationship) -> Result<()> {
    let Some(stored_secret) = &relationship.mailbox_secret else {
        return Ok(());
    };
    let secret = MailboxRelationshipSecret::from_stored(stored_secret)?;
    let local = relationship
        .local_endpoints
        .iter()
        .filter_map(|endpoint| {
            if let EndpointDescriptor::HttpMailbox(endpoint) = endpoint {
                Some(endpoint)
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    let remote = relationship
        .remote_endpoints
        .iter()
        .filter_map(|endpoint| {
            if let EndpointDescriptor::HttpMailbox(endpoint) = endpoint {
                Some(endpoint)
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    if local.len() != 1 || remote.len() != 1 {
        return Err(PeerError::Rollback(
            "sealed mailbox relationship lacks exact directional endpoints".into(),
        ));
    }
    let local_role = mailbox_role_for_endpoint(&secret, local[0])?;
    let remote_role = mailbox_role_for_endpoint(&secret, remote[0])?;
    if local_role.opposite() != remote_role {
        return Err(PeerError::Rollback(
            "sealed mailbox relationship reuses one directional channel".into(),
        ));
    }
    Ok(())
}

fn validate_transport_kinds(kinds: &[TransportKind]) -> Result<()> {
    if kinds.is_empty() || kinds.len() > 4 {
        return Err(limit("transportKinds must contain 1..=4 entries"));
    }
    if kinds.iter().copied().collect::<BTreeSet<_>>().len() != kinds.len() {
        return Err(invalid("transportKinds contains duplicates"));
    }
    Ok(())
}

fn relationship_mut<'a>(
    state: &'a mut DurableDaemonState,
    relationship_id: &str,
) -> Result<&'a mut StoredRelationship> {
    state
        .relationships
        .iter_mut()
        .find(|candidate| candidate.id == relationship_id)
        .ok_or_else(|| PeerError::Authorization("relationship is not bound to this daemon".into()))
}

fn active_relationship_mut<'a>(
    state: &'a mut DurableDaemonState,
    relationship_id: &str,
) -> Result<&'a mut StoredRelationship> {
    let relationship = relationship_mut(state, relationship_id)?;
    if relationship.status != RelationshipStatus::Active {
        return Err(PeerError::Authorization(
            "relationship is not active".into(),
        ));
    }
    Ok(relationship)
}

fn active_relationship<'a>(
    state: &'a DurableDaemonState,
    relationship_id: &str,
) -> Result<&'a StoredRelationship> {
    let relationship = state
        .relationships
        .iter()
        .find(|candidate| candidate.id == relationship_id)
        .ok_or_else(|| {
            PeerError::Authorization("relationship is not bound to this daemon".into())
        })?;
    if relationship.status != RelationshipStatus::Active {
        return Err(PeerError::Authorization(
            "relationship is not active".into(),
        ));
    }
    Ok(relationship)
}

fn validate_grant_binding(
    grant: &PeerShareGrantVersion,
    owner_user_id: &str,
    relationship: &StoredRelationship,
) -> Result<()> {
    if grant.owner_user_id != owner_user_id || grant.relationship_id != relationship.id {
        return Err(PeerError::Authorization(
            "grant owner or relationship is not bound to durable daemon state".into(),
        ));
    }
    Ok(())
}

fn local_grant_party(direction: ShareDirection) -> GrantParty {
    match direction {
        ShareDirection::LocalToRemote => GrantParty::Grantor,
        ShareDirection::RemoteToLocal => GrantParty::Grantee,
    }
}

fn remote_grant_party(direction: ShareDirection) -> GrantParty {
    match direction {
        ShareDirection::LocalToRemote => GrantParty::Grantee,
        ShareDirection::RemoteToLocal => GrantParty::Grantor,
    }
}

fn opposite_grant_party(party: GrantParty) -> GrantParty {
    match party {
        GrantParty::Grantor => GrantParty::Grantee,
        GrantParty::Grantee => GrantParty::Grantor,
    }
}

fn validate_directional_grant_signatures(
    grant: &PeerShareGrantVersion,
    relationship: &StoredRelationship,
    origin_is_local: bool,
) -> Result<()> {
    for signature in &grant.signatures {
        let signer_is_local = std::iter::once(&relationship.local_certificate)
            .chain(relationship.local_certificate_history.iter())
            .any(|certificate| device_id(certificate) == signature.device_id);
        let signer_is_remote = relationship
            .devices
            .iter()
            .any(|device| device.external_device_id == signature.device_id)
            || std::iter::once(&relationship.remote_certificate)
                .chain(relationship.remote_certificate_history.iter())
                .any(|certificate| device_id(certificate) == signature.device_id);
        if signer_is_local == signer_is_remote {
            return Err(PeerError::Authentication(
                "grant signature is not bound to exactly one relationship side".into(),
            ));
        }
        let signer_is_origin = signer_is_local == origin_is_local;
        let expected_party = if signer_is_origin {
            local_grant_party(grant.direction)
        } else {
            remote_grant_party(grant.direction)
        };
        if signature.party != expected_party {
            return Err(PeerError::Authorization(
                "grant signature party contradicts the declared share direction".into(),
            ));
        }
    }
    Ok(())
}

fn grant_trust(
    relationship: &StoredRelationship,
    local: &DeviceCertificate,
    grant: &PeerShareGrantVersion,
    now: u64,
    allow_historical: bool,
) -> Result<MemoryGrantTrustStore> {
    let local_device_id = device_id(local);
    let local_from_signature = grant
        .signatures
        .iter()
        .find(|signature| signature.device_id == local_device_id)
        .map(|signature| signature.party);
    let remote_from_signature = grant
        .signatures
        .iter()
        .find(|signature| signature.device_id != local_device_id)
        .map(|signature| signature.party);
    let local_party = local_from_signature
        .or_else(|| remote_from_signature.map(opposite_grant_party))
        .unwrap_or_else(|| local_grant_party(grant.direction));
    let remote_party = remote_from_signature
        .or_else(|| local_from_signature.map(opposite_grant_party))
        .unwrap_or_else(|| remote_grant_party(grant.direction));
    if local_party == remote_party {
        return Err(PeerError::Authentication(
            "grant signatures do not identify opposite consent parties".into(),
        ));
    }
    let trust = MemoryGrantTrustStore::default();
    trust.insert(trusted_grant_signer(
        relationship,
        &local_device_id,
        local_party,
        local,
        &relationship.local_certificate_history,
        grant,
        now,
        allow_historical,
    )?)?;
    for device in &relationship.devices {
        if device.status == StoredDeviceStatus::Approved {
            let history =
                if device.external_device_id == device_id(&relationship.remote_certificate) {
                    relationship.remote_certificate_history.as_slice()
                } else {
                    &[]
                };
            trust.insert(trusted_grant_signer(
                relationship,
                &device.external_device_id,
                remote_party,
                &device.certificate,
                history,
                grant,
                now,
                allow_historical,
            )?)?;
        }
    }
    Ok(trust)
}

#[allow(clippy::too_many_arguments)]
fn trusted_grant_signer(
    relationship: &StoredRelationship,
    external_device_id: &str,
    party: GrantParty,
    current: &DeviceCertificate,
    history: &[DeviceCertificate],
    grant: &PeerShareGrantVersion,
    now: u64,
    allow_historical: bool,
) -> Result<TrustedGrantSigner> {
    let signature = grant
        .signatures
        .iter()
        .find(|signature| signature.device_id == external_device_id && signature.party == party);
    let Some(signature) = signature else {
        return TrustedGrantSigner::new(
            relationship.id.clone(),
            external_device_id.to_owned(),
            party,
            current.clone(),
        );
    };
    if !allow_historical {
        return TrustedGrantSigner::new(
            relationship.id.clone(),
            external_device_id.to_owned(),
            party,
            current.clone(),
        );
    }
    let mut matching = Vec::new();
    for certificate in history.iter().chain(std::iter::once(current)) {
        let candidate = if certificate == current {
            TrustedGrantSigner::new(
                relationship.id.clone(),
                external_device_id.to_owned(),
                party,
                certificate.clone(),
            )?
        } else {
            TrustedGrantSigner::new_historical(
                relationship.id.clone(),
                external_device_id.to_owned(),
                party,
                certificate.clone(),
            )?
        };
        let candidate_trust = MemoryGrantTrustStore::default();
        candidate_trust.insert(candidate.clone())?;
        if verify_grant_consent_signature(grant, signature, &candidate_trust, now).is_ok() {
            matching.push(candidate);
        }
    }
    let [signer] = matching.as_slice() else {
        return Err(PeerError::Authentication(
            "durable grant signature does not select one certified credential generation".into(),
        ));
    };
    Ok(signer.clone())
}

fn mls_trust(
    local: &DeviceCertificate,
    remote: &DeviceCertificate,
    now: u64,
) -> Result<MemoryDeviceTrustStore> {
    let trust = MemoryDeviceTrustStore::default();
    trust.trust_principal(local.root_public_key)?;
    trust.trust_principal(remote.root_public_key)?;
    trust.admit_certificate(local, now)?;
    trust.admit_certificate(remote, now)?;
    Ok(trust)
}

fn validate_certificate_successor(
    predecessor: &DeviceCertificate,
    successor: &DeviceCertificate,
    now: u64,
) -> Result<()> {
    if predecessor.body.capabilities != successor.body.capabilities
        || predecessor.body.protocol_range != successor.body.protocol_range
        || predecessor.body.device_public_key == successor.body.device_public_key
        || predecessor.body.device_key_agreement_public_key
            == successor.body.device_key_agreement_public_key
    {
        return Err(PeerError::Authorization(
            "host credential successor changes capabilities, protocol policy, or reuses keys"
                .into(),
        ));
    }
    let trust = MemoryDeviceTrustStore::default();
    trust.trust_principal(predecessor.root_public_key)?;
    trust.admit_certificate(predecessor, predecessor.body.not_before)?;
    trust.admit_certificate(successor, now)?;
    trust.verify_certificate_transition(predecessor, successor, now)
}

fn validate_relationship_certificate_history(
    history: &[DeviceCertificate],
    current: &DeviceCertificate,
) -> Result<()> {
    if history.len() > MAX_RELATIONSHIP_CERTIFICATE_HISTORY {
        return Err(limit(
            "relationship certificate history exceeds its retention bound",
        ));
    }
    let mut previous: Option<&DeviceCertificate> = None;
    for certificate in history.iter().chain(std::iter::once(current)) {
        certificate.verify(certificate.body.not_before)?;
        if let Some(predecessor) = previous {
            validate_certificate_successor(predecessor, certificate, certificate.body.not_before)?;
        }
        previous = Some(certificate);
    }
    Ok(())
}

fn grant_party_for_device(grant: &PeerShareGrantVersion, device_id: &str) -> Option<GrantParty> {
    grant
        .signatures
        .iter()
        .find(|signature| signature.device_id == device_id)
        .map(|signature| signature.party)
}

fn wire_grant_id(grant_id: &str) -> Result<GrantId> {
    validate_text(grant_id, 1, MAX_TEXT_BYTES, "grant id")?;
    let derived = blake3::derive_key("forge-peer/1 wire grant id", grant_id.as_bytes());
    let value: [u8; 16] = derived[..16]
        .try_into()
        .map_err(|_| invalid("wire grant id has the wrong size"))?;
    let id = GrantId(value);
    id.validate()?;
    Ok(id)
}

fn wire_projection_name(projection: ProjectionId) -> &'static str {
    match projection {
        ProjectionId::CalendarAvailabilityV1 => "calendar.availability.v1",
        ProjectionId::CalendarSelectedEventsV1 => "calendar.selected_events.v1",
        ProjectionId::GoalsHorizonSummaryV1 => "goals.horizon_summary.v1",
        ProjectionId::HealthCyclingAggregateV1 => "health.cycling.aggregate.v1",
        ProjectionId::PersonProfileV1 => "person.profile.v1",
        ProjectionId::LifeEventsSelectedV1 => "life_events.selected.v1",
        ProjectionId::MovementAggregateV1 => "movement.aggregate.v1",
        ProjectionId::CustomSelectedEntitiesV1 => "custom.selected_entities.v1",
    }
}

fn wire_projection_id(value: &str) -> Result<ProjectionId> {
    match value {
        "calendar.availability.v1" => Ok(ProjectionId::CalendarAvailabilityV1),
        "calendar.selected_events.v1" => Ok(ProjectionId::CalendarSelectedEventsV1),
        "goals.horizon_summary.v1" => Ok(ProjectionId::GoalsHorizonSummaryV1),
        "health.cycling.aggregate.v1" => Ok(ProjectionId::HealthCyclingAggregateV1),
        "person.profile.v1" => Ok(ProjectionId::PersonProfileV1),
        "life_events.selected.v1" => Ok(ProjectionId::LifeEventsSelectedV1),
        "movement.aggregate.v1" => Ok(ProjectionId::MovementAggregateV1),
        "custom.selected_entities.v1" => Ok(ProjectionId::CustomSelectedEntitiesV1),
        _ => Err(invalid("unknown typed projection id")),
    }
}

fn query_precision(query: &TypedQuery) -> Precision {
    match query {
        TypedQuery::CalendarAvailability { precision, .. } => *precision,
        _ => Precision::Exact,
    }
}

fn wire_precision(value: &str) -> Result<Precision> {
    match value {
        "exact" => Ok(Precision::Exact),
        "fifteen_minutes" => Ok(Precision::FifteenMinutes),
        "hour" => Ok(Precision::Hour),
        "day" => Ok(Precision::Day),
        "week" => Ok(Precision::Week),
        "month" => Ok(Precision::Month),
        "aggregate_only" => Ok(Precision::AggregateOnly),
        _ => Err(invalid("typed query precision is unsupported")),
    }
}

fn wire_granularity(value: &str) -> Result<Granularity> {
    match value {
        "day" => Ok(Granularity::Day),
        "week" => Ok(Granularity::Week),
        "month" => Ok(Granularity::Month),
        _ => Err(invalid("typed query granularity is unsupported")),
    }
}

fn wire_projection_field(value: &str) -> Result<ProjectionField> {
    match value {
        "start" => Ok(ProjectionField::Start),
        "end" => Ok(ProjectionField::End),
        "timezone" => Ok(ProjectionField::Timezone),
        "busyState" => Ok(ProjectionField::BusyState),
        "eventTitle" => Ok(ProjectionField::EventTitle),
        "eventLocation" => Ok(ProjectionField::EventLocation),
        "goalTitle" => Ok(ProjectionField::GoalTitle),
        "goalSummary" => Ok(ProjectionField::GoalSummary),
        "goalState" => Ok(ProjectionField::GoalState),
        "goalProgress" => Ok(ProjectionField::GoalProgress),
        "duration" => Ok(ProjectionField::Duration),
        "distance" => Ok(ProjectionField::Distance),
        "activityCount" => Ok(ProjectionField::ActivityCount),
        "energy" => Ok(ProjectionField::Energy),
        "displayName" => Ok(ProjectionField::DisplayName),
        "preferredName" => Ok(ProjectionField::PreferredName),
        "pronouns" => Ok(ProjectionField::Pronouns),
        "relationshipLabel" => Ok(ProjectionField::RelationshipLabel),
        "shortDescription" => Ok(ProjectionField::ShortDescription),
        "lifeEventTitle" => Ok(ProjectionField::LifeEventTitle),
        "lifeEventType" => Ok(ProjectionField::LifeEventType),
        "lifeEventPlace" => Ok(ProjectionField::LifeEventPlace),
        "movementDuration" => Ok(ProjectionField::MovementDuration),
        "movementDistance" => Ok(ProjectionField::MovementDistance),
        "customTitle" => Ok(ProjectionField::CustomTitle),
        "customSummary" => Ok(ProjectionField::CustomSummary),
        "customState" => Ok(ProjectionField::CustomState),
        _ => Err(invalid("typed query field is unsupported")),
    }
}

fn projection_field_name(value: ProjectionField) -> &'static str {
    match value {
        ProjectionField::Start => "start",
        ProjectionField::End => "end",
        ProjectionField::Timezone => "timezone",
        ProjectionField::BusyState => "busyState",
        ProjectionField::EventTitle => "eventTitle",
        ProjectionField::EventLocation => "eventLocation",
        ProjectionField::GoalTitle => "goalTitle",
        ProjectionField::GoalSummary => "goalSummary",
        ProjectionField::GoalState => "goalState",
        ProjectionField::GoalProgress => "goalProgress",
        ProjectionField::Duration => "duration",
        ProjectionField::Distance => "distance",
        ProjectionField::ActivityCount => "activityCount",
        ProjectionField::Energy => "energy",
        ProjectionField::DisplayName => "displayName",
        ProjectionField::PreferredName => "preferredName",
        ProjectionField::Pronouns => "pronouns",
        ProjectionField::RelationshipLabel => "relationshipLabel",
        ProjectionField::ShortDescription => "shortDescription",
        ProjectionField::LifeEventTitle => "lifeEventTitle",
        ProjectionField::LifeEventType => "lifeEventType",
        ProjectionField::LifeEventPlace => "lifeEventPlace",
        ProjectionField::MovementDuration => "movementDuration",
        ProjectionField::MovementDistance => "movementDistance",
        ProjectionField::CustomTitle => "customTitle",
        ProjectionField::CustomSummary => "customSummary",
        ProjectionField::CustomState => "customState",
    }
}

fn wire_time_range(interval: Option<&ApiQueryInterval>) -> Result<TimeRange> {
    let interval = interval.ok_or_else(|| invalid("typed query requires an interval"))?;
    let range = TimeRange {
        start: parse_timestamp(&interval.starts_at, "query interval startsAt")?,
        end: parse_timestamp(&interval.ends_at, "query interval endsAt")?,
    };
    range.validate()?;
    Ok(range)
}

fn wire_record_ids(values: &[String]) -> Result<BoundedVec<OpaqueRecordId, 256>> {
    let mut records = Vec::with_capacity(values.len());
    for value in values {
        records.push(wire_record_id(value)?);
    }
    BoundedVec::new(records)
}

fn wire_record_id(value: &str) -> Result<OpaqueRecordId> {
    validate_text(value, 1, MAX_TEXT_BYTES, "query entity id")?;
    let id = OpaqueRecordId(blake3::derive_key(
        "forge-peer/1 opaque query entity id",
        value.as_bytes(),
    ));
    id.validate()?;
    Ok(id)
}

fn wire_fields(values: &[String]) -> Result<BoundedVec<ProjectionField, 64>> {
    values
        .iter()
        .map(|value| wire_projection_field(value))
        .collect::<Result<Vec<_>>>()
        .and_then(BoundedVec::new)
}

fn require_parameter_keys(
    parameters: &serde_json::Map<String, serde_json::Value>,
    expected: &[&str],
) -> Result<()> {
    let actual = parameters
        .keys()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    let expected = expected.iter().copied().collect::<BTreeSet<_>>();
    if actual != expected {
        return Err(invalid(
            "typed query parameters do not match the projection schema",
        ));
    }
    Ok(())
}

fn to_wire_query(query: &ApiTypedQuery) -> Result<TypedQuery> {
    query.validate()?;
    let wire = match query.projection_id.as_str() {
        "calendar.availability.v1" => {
            require_parameter_keys(&query.parameters, &[])?;
            let interval = query
                .interval
                .as_ref()
                .ok_or_else(|| invalid("calendar availability requires an interval"))?;
            TypedQuery::CalendarAvailability {
                range: wire_time_range(Some(interval))?,
                timezone: BoundedString::new(interval.time_zone.clone())?,
                precision: wire_precision(&query.precision)?,
            }
        }
        "calendar.selected_events.v1" => {
            require_parameter_keys(&query.parameters, &[])?;
            TypedQuery::CalendarSelectedEvents {
                range: wire_time_range(query.interval.as_ref())?,
                record_ids: wire_record_ids(&query.entity_ids)?,
            }
        }
        "goals.horizon_summary.v1" => {
            require_parameter_keys(&query.parameters, &[])?;
            TypedQuery::GoalsHorizonSummary {
                horizon: wire_time_range(query.interval.as_ref())?,
            }
        }
        "health.cycling.aggregate.v1" => {
            require_parameter_keys(&query.parameters, &["granularity", "units"])?;
            let granularity = query.parameters["granularity"]
                .as_str()
                .ok_or_else(|| invalid("cycling granularity must be a string"))?;
            let units = query.parameters["units"]
                .as_str()
                .ok_or_else(|| invalid("cycling units must be a string"))?;
            TypedQuery::HealthCyclingAggregate {
                range: wire_time_range(query.interval.as_ref())?,
                granularity: wire_granularity(granularity)?,
                units: BoundedString::new(units.to_owned())?,
            }
        }
        "person.profile.v1" => {
            require_parameter_keys(&query.parameters, &[])?;
            TypedQuery::PersonProfile {
                fields: wire_fields(&query.fields)?,
            }
        }
        "life_events.selected.v1" => {
            require_parameter_keys(&query.parameters, &[])?;
            TypedQuery::LifeEventsSelected {
                range: wire_time_range(query.interval.as_ref())?,
                record_ids: wire_record_ids(&query.entity_ids)?,
            }
        }
        "movement.aggregate.v1" => {
            require_parameter_keys(&query.parameters, &["granularity"])?;
            let granularity = query.parameters["granularity"]
                .as_str()
                .ok_or_else(|| invalid("movement granularity must be a string"))?;
            TypedQuery::MovementAggregate {
                range: wire_time_range(query.interval.as_ref())?,
                granularity: wire_granularity(granularity)?,
            }
        }
        "custom.selected_entities.v1" => {
            require_parameter_keys(&query.parameters, &[])?;
            TypedQuery::CustomSelectedEntities {
                record_ids: wire_record_ids(&query.entity_ids)?,
                fields: wire_fields(&query.fields)?,
            }
        }
        _ => return Err(invalid("typed query projection is unsupported")),
    };
    wire.validate()?;
    Ok(wire)
}

fn verify_inbound_query_requester(
    query: &StoredInboundQuery,
    relationship: &StoredRelationship,
) -> Result<()> {
    let expected_fingerprint = relationship.remote_certificate.fingerprint()?;
    if query.relationship_id.as_deref() != Some(relationship.id.as_str())
        || query.requester_device_id != Some(relationship.remote_certificate.body.device_id)
        || query.requester_certificate_hash != Some(expected_fingerprint)
        || !relationship.devices.iter().any(|device| {
            device.status == StoredDeviceStatus::Approved
                && device.certificate.body.device_id
                    == relationship.remote_certificate.body.device_id
                && device
                    .certificate
                    .fingerprint()
                    .is_ok_and(|fingerprint| fingerprint == expected_fingerprint)
        })
    {
        return Err(PeerError::Authorization(
            "inbound query is no longer bound to its approved requester certificate".into(),
        ));
    }
    Ok(())
}

fn verify_stored_inbound_authorization(
    query: &StoredInboundQuery,
    authorization: &InboundQueryAuthorization,
) -> Result<()> {
    let request = query.request().ok_or_else(|| {
        PeerError::Rollback("inbound query authorization has no wire request".into())
    })?;
    if query.grant_id.as_deref() != Some(authorization.grant_id.as_str())
        || query.rule_id.as_deref() != Some(authorization.rule_id.as_str())
        || query.grant_verification_id.as_deref()
            != Some(authorization.grant_verification_id.as_str())
        || query.verified_grant_hash.as_deref() != Some(authorization.verified_grant_hash.as_str())
        || query.effective_fields != authorization.effective_fields
        || query.redacted_fields != authorization.redacted_fields
        || query.maximum_result_count != authorization.maximum_result_count
        || query.maximum_payload_bytes != authorization.maximum_payload_bytes
        || request.grant_sequence != authorization.grant_sequence
    {
        return Err(PeerError::Authorization(
            "inbound query authorization changed after durable admission".into(),
        ));
    }
    Ok(())
}

fn inbound_api_query(
    query: &StoredInboundQuery,
    relationship: &StoredRelationship,
) -> Result<(ApiTypedQuery, bool, bool)> {
    let wire = match query.wire_query.as_ref() {
        Some(StoredInboundWireQuery::V2(request)) => request,
        Some(StoredInboundWireQuery::V1(_)) | None => {
            return Err(PeerError::Version(
                "legacy query has no bridge-safe API representation".into(),
            ));
        }
    };
    let typed = &wire.request.query;
    let mut parameters = serde_json::Map::new();
    match typed {
        TypedQuery::HealthCyclingAggregate {
            granularity, units, ..
        } => {
            parameters.insert(
                "granularity".into(),
                serde_json::Value::String(granularity_name(*granularity).into()),
            );
            parameters.insert(
                "units".into(),
                serde_json::Value::String(units.as_str().to_owned()),
            );
        }
        TypedQuery::MovementAggregate { granularity, .. } => {
            parameters.insert(
                "granularity".into(),
                serde_json::Value::String(granularity_name(*granularity).into()),
            );
        }
        _ => {}
    }
    let (entity_ids, entity_ids_are_opaque) =
        inbound_query_entity_ids(query, relationship, wire_query_record_ids(typed))?;
    let (interval, interval_time_zone_authenticated) = match typed {
        TypedQuery::CalendarAvailability {
            range, timezone, ..
        } => (
            Some(ApiQueryInterval {
                starts_at: format_timestamp(range.start)?,
                ends_at: format_timestamp(range.end)?,
                time_zone: timezone.as_str().to_owned(),
            }),
            true,
        ),
        _ => (
            wire_query_time_range(typed)
                .map(|range| {
                    Ok::<ApiQueryInterval, PeerError>(ApiQueryInterval {
                        starts_at: format_timestamp(range.start)?,
                        ends_at: format_timestamp(range.end)?,
                        time_zone: "UTC".into(),
                    })
                })
                .transpose()?,
            false,
        ),
    };
    let api = ApiTypedQuery {
        projection_id: wire_projection_name(typed.projection()).to_owned(),
        parameters,
        interval,
        entity_ids,
        fields: query
            .effective_fields
            .iter()
            .copied()
            .map(projection_field_name)
            .map(str::to_owned)
            .collect(),
        precision: precision_name(query_precision(typed)).to_owned(),
        maximum_result_count: query.maximum_result_count,
    };
    api.validate()?;
    Ok((api, entity_ids_are_opaque, interval_time_zone_authenticated))
}

fn inbound_query_entity_ids(
    query: &StoredInboundQuery,
    relationship: &StoredRelationship,
    requested: &[OpaqueRecordId],
) -> Result<(Vec<String>, bool)> {
    if requested.is_empty() {
        return Ok((Vec::new(), false));
    }
    let grant_id = query
        .grant_id
        .as_deref()
        .ok_or_else(|| PeerError::Rollback("inbound query grant id is missing".into()))?;
    let rule_id = query
        .rule_id
        .as_deref()
        .ok_or_else(|| PeerError::Rollback("inbound query rule id is missing".into()))?;
    let request = query
        .request()
        .ok_or_else(|| PeerError::Rollback("inbound query request is missing".into()))?;
    let rule = relationship
        .grants
        .iter()
        .find(|stored| {
            stored.grant.id == grant_id && stored.grant.sequence == request.grant_sequence
        })
        .and_then(|stored| stored.grant.rules.iter().find(|rule| rule.id == rule_id));
    if let Some(selector) = rule.and_then(|rule| rule.entity_selector.as_ref()) {
        let mut resolved = Vec::with_capacity(requested.len());
        for requested_id in requested {
            let raw = selector
                .entity_ids
                .iter()
                .find(|candidate| wire_record_id(candidate).is_ok_and(|id| &id == requested_id));
            if let Some(raw) = raw {
                resolved.push(raw.clone());
            } else {
                return Ok((
                    requested
                        .iter()
                        .map(|id| URL_SAFE_NO_PAD.encode(id.0))
                        .collect(),
                    true,
                ));
            }
        }
        return Ok((resolved, false));
    }
    Ok((
        requested
            .iter()
            .map(|id| URL_SAFE_NO_PAD.encode(id.0))
            .collect(),
        true,
    ))
}

fn granularity_name(granularity: Granularity) -> &'static str {
    match granularity {
        Granularity::Day => "day",
        Granularity::Week => "week",
        Granularity::Month => "month",
    }
}

fn validate_inbound_response_payload(
    query: &StoredInboundQuery,
    input: &RespondInboundQueryInput,
) -> Result<()> {
    validate_query_payload(&input.payload)?;
    if input.payload.records.len() > usize::from(query.maximum_result_count) {
        return Err(PeerError::Authorization(
            "query response exceeds its durably attenuated record count".into(),
        ));
    }
    let expected_redactions = query
        .redacted_fields
        .iter()
        .copied()
        .map(projection_field_name)
        .collect::<Vec<_>>();
    if input
        .redacted_fields
        .iter()
        .map(String::as_str)
        .ne(expected_redactions.iter().copied())
    {
        return Err(PeerError::Authorization(
            "query response redactions differ from durable grant attenuation".into(),
        ));
    }
    let effective = query
        .effective_fields
        .iter()
        .copied()
        .map(projection_field_name)
        .collect::<BTreeSet<_>>();
    for record in &input.payload.records {
        if record.fields.is_empty()
            || record
                .fields
                .keys()
                .any(|field| !effective.contains(field.as_str()))
        {
            return Err(PeerError::Authorization(
                "query response contains an empty or non-authorized field set".into(),
            ));
        }
    }
    let canonical = serde_json_canonicalizer::to_vec(&input.payload)
        .map_err(|error| invalid(format!("canonicalizing query response payload: {error}")))?;
    if canonical.len() > usize::try_from(query.maximum_payload_bytes).unwrap_or(usize::MAX)
        || canonical.len() > MAX_QUERY_JSON_BYTES
    {
        return Err(limit(
            "query response exceeds its durably attenuated payload ceiling",
        ));
    }
    Ok(())
}

fn inbound_response_valid_until(
    relationship: &StoredRelationship,
    grant_id: &str,
    grant_sequence: u64,
    now: u64,
) -> Result<u64> {
    let grant = relationship
        .grants
        .iter()
        .find(|stored| stored.grant.id == grant_id && stored.grant.sequence == grant_sequence)
        .map(|stored| &stored.grant)
        .ok_or_else(|| PeerError::Authorization("query grant disappeared".into()))?;
    let grant_expiry = grant
        .expires_at
        .as_deref()
        .map(|value| parse_timestamp(value, "grant expiresAt"))
        .transpose()?
        .unwrap_or_else(|| now.saturating_add(5 * 60));
    let valid_until = grant_expiry.min(now.saturating_add(5 * 60));
    if valid_until <= now {
        return Err(PeerError::Authorization(
            "query grant expired before response commit".into(),
        ));
    }
    Ok(valid_until)
}

fn enforce_aggregation_response_minimum(
    relationship: &StoredRelationship,
    grant_id: &str,
    grant_sequence: u64,
    rule_id: &str,
    record_count: usize,
) -> Result<()> {
    let aggregation = relationship
        .grants
        .iter()
        .find(|stored| stored.grant.id == grant_id && stored.grant.sequence == grant_sequence)
        .and_then(|stored| stored.grant.rules.iter().find(|rule| rule.id == rule_id))
        .and_then(|rule| rule.aggregation.as_ref());
    if aggregation.is_some_and(|policy| record_count < usize::from(policy.minimum_records)) {
        return Err(PeerError::Authorization(
            "aggregate query response is below the grant privacy threshold".into(),
        ));
    }
    Ok(())
}

fn scoped_projection_record_id(
    relationship: &StoredRelationship,
    verified_grant_hash: &str,
    local_record_id: &str,
) -> Result<OpaqueRecordId> {
    validate_text(local_record_id, 1, MAX_TEXT_BYTES, "query record id")?;
    let mut scope = Vec::with_capacity(relationship.id.len() + verified_grant_hash.len() + 1);
    scope.extend_from_slice(relationship.id.as_bytes());
    scope.push(0);
    scope.extend_from_slice(verified_grant_hash.as_bytes());
    let key = blake3::derive_key("forge-peer/1 projection record scope", &scope);
    let id = OpaqueRecordId(*blake3::keyed_hash(&key, local_record_id.as_bytes()).as_bytes());
    id.validate()?;
    Ok(id)
}

fn authorize_legacy_inbound_wire_query<'a>(
    owner_user_id: &str,
    relationship: &'a StoredRelationship,
    request: &QueryRequest,
    local: &DeviceCertificate,
    now: u64,
) -> Result<&'a PeerShareGrantVersion> {
    request.validate()?;
    if request.relationship_id.0 != decode_hex_array::<16>(&relationship.id, "relationship id")?
        || request.requested_at > now.saturating_add(MAX_CLOCK_SKEW_SECONDS)
        || now > request.expires_at
    {
        return Err(PeerError::Authentication(
            "query request is not bound to this live relationship window".into(),
        ));
    }
    let local_device_id = device_id(local);
    let remote_device_id = device_id(&relationship.remote_certificate);
    for stored in relationship.grants.iter().rev() {
        let grant = &stored.grant;
        if grant.status != GrantStatus::Active
            || grant.sequence != request.grant_sequence
            || wire_grant_id(&grant.id)? != request.grant_id
            || grant_party_for_device(grant, &local_device_id) != Some(GrantParty::Grantor)
            || grant_party_for_device(grant, &remote_device_id) != Some(GrantParty::Grantee)
        {
            continue;
        }
        validate_directional_grant_signatures(
            grant,
            relationship,
            grant.owner_user_id == owner_user_id,
        )?;
        verify_durable_active_grant(stored, now)?;
        if grant.rules.iter().any(|rule| {
            rule.effect == crate::grant::RuleEffect::Allow
                && rule.projection_id.as_str() == wire_projection_name(request.query.projection())
                && device_authorized(rule, &remote_device_id)
        }) {
            return Ok(grant);
        }
    }
    Err(PeerError::Authorization(
        "no active signed grant authorizes the remote typed query".into(),
    ))
}

#[allow(clippy::too_many_lines)]
fn authorize_inbound_wire_query(
    owner_user_id: &str,
    relationship: &StoredRelationship,
    request: &QueryRequestV2,
    local: &DeviceCertificate,
    prior_queries: &[StoredInboundQuery],
    now: u64,
) -> Result<InboundQueryAuthorization> {
    request.validate()?;
    let wire = &request.request;
    if wire.relationship_id.0 != decode_hex_array::<16>(&relationship.id, "relationship id")?
        || wire.requested_at > now.saturating_add(MAX_CLOCK_SKEW_SECONDS)
        || now > wire.expires_at
    {
        return Err(PeerError::Authentication(
            "query request is not bound to this live relationship window".into(),
        ));
    }

    let remote_fingerprint = relationship.remote_certificate.fingerprint()?;
    let remote_device_id = device_id(&relationship.remote_certificate);
    let remote_is_approved = relationship.devices.iter().any(|device| {
        device.status == StoredDeviceStatus::Approved
            && device.certificate.body.device_id == relationship.remote_certificate.body.device_id
            && device
                .certificate
                .fingerprint()
                .is_ok_and(|fingerprint| fingerprint == remote_fingerprint)
    });
    if !remote_is_approved {
        return Err(PeerError::Authorization(
            "inbound query requester is not the currently approved relationship device".into(),
        ));
    }

    let mut matching_grants = relationship
        .grants
        .iter()
        .filter(|stored| {
            stored.grant.sequence == wire.grant_sequence
                && wire_grant_id(&stored.grant.id).is_ok_and(|id| id == wire.grant_id)
        })
        .collect::<Vec<_>>();
    if matching_grants.len() != 1 {
        return Err(PeerError::Authorization(
            "query grant binding is missing or ambiguous".into(),
        ));
    }
    let stored = matching_grants
        .pop()
        .ok_or_else(|| PeerError::Authorization("query grant binding is missing".into()))?;
    let grant = &stored.grant;
    if relationship.grants.iter().any(|candidate| {
        candidate.grant.id == grant.id && candidate.grant.sequence > grant.sequence
    }) {
        return Err(PeerError::Replay(
            "query references a stale grant version".into(),
        ));
    }
    let local_device_id = device_id(local);
    validate_directional_grant_signatures(
        grant,
        relationship,
        grant.owner_user_id == owner_user_id,
    )?;
    if grant.relationship_id != relationship.id
        || grant.status != GrantStatus::Active
        || grant_party_for_device(grant, &local_device_id) != Some(GrantParty::Grantor)
        || grant_party_for_device(grant, &remote_device_id) != Some(GrantParty::Grantee)
    {
        return Err(PeerError::Authorization(
            "query grant is not an active local-to-remote consent binding".into(),
        ));
    }
    verify_durable_active_grant(stored, now)?;
    let trust = grant_trust(relationship, local, grant, now, true)?;
    let evidence = verify_active_grant(grant, &trust, now)?;
    let verified_hash = evidence.verified_grant_hash();
    if stored.verified_hash.as_deref() != Some(verified_hash) {
        return Err(PeerError::Authentication(
            "query grant no longer matches its durable cryptographic verification".into(),
        ));
    }
    let verification_id = stored.verification_id.as_deref().ok_or_else(|| {
        PeerError::Authentication("query grant lacks durable verification provenance".into())
    })?;

    let projection = wire.query.projection();
    if grant.rules.iter().any(|rule| {
        rule.effect == crate::grant::RuleEffect::Deny
            && rule.projection_id.as_str() == wire_projection_name(projection)
    }) {
        return Err(PeerError::Authorization(
            "query projection is explicitly denied by the active grant".into(),
        ));
    }

    let requested_fields = request.requested_fields.as_slice();
    let requested_entities = wire_query_record_ids(&wire.query);
    let requested_range = wire_query_time_range(&wire.query);
    let requested_precision = precision_name(query_precision(&wire.query));
    let requested_granularity = wire_query_granularity(&wire.query);
    let mut saw_device = false;
    let mut saw_entities = false;
    let mut saw_time = false;

    for rule in grant.rules.iter().filter(|rule| {
        rule.effect == crate::grant::RuleEffect::Allow
            && rule.projection_id.as_str() == wire_projection_name(projection)
    }) {
        if !device_authorized(rule, &remote_device_id) {
            continue;
        }
        saw_device = true;
        if !wire_entities_authorized(rule, requested_entities)? {
            continue;
        }
        saw_entities = true;
        if !wire_time_authorized(rule, requested_range, now)? {
            continue;
        }
        saw_time = true;
        if rule.precision != requested_precision {
            continue;
        }
        if request.maximum_result_count > rule.maximum_result_count {
            return Err(PeerError::Authorization(
                "query result count exceeds the active grant rule".into(),
            ));
        }
        if request.maximum_payload_bytes > rule.maximum_payload_bytes {
            return Err(PeerError::Authorization(
                "query payload ceiling exceeds the active grant rule".into(),
            ));
        }
        if !aggregation_authorized(rule, requested_granularity) {
            return Err(PeerError::Authorization(
                "query aggregation does not match the active grant rule".into(),
            ));
        }
        if let Some(aggregation) = &rule.aggregation {
            let day = now / (24 * 60 * 60);
            let prior_count = prior_queries
                .iter()
                .filter(|query| {
                    query.relationship_id.as_deref() == Some(relationship.id.as_str())
                        && query.grant_id.as_deref() == Some(grant.id.as_str())
                        && query.rule_id.as_deref() == Some(rule.id.as_str())
                        && query.query_id != wire.query_id
                        && query.received_at / (24 * 60 * 60) == day
                })
                .count();
            if prior_count >= usize::from(aggregation.maximum_queries_per_day) {
                return Err(PeerError::Authorization(
                    "query aggregation daily limit is exhausted".into(),
                ));
            }
        }

        let mut effective_fields = Vec::new();
        let mut redacted_fields = Vec::new();
        for field in requested_fields {
            let name = projection_field_name(*field);
            if rule.fields.include.iter().any(|included| included == name)
                && !rule.fields.exclude.iter().any(|excluded| excluded == name)
            {
                effective_fields.push(*field);
            } else {
                redacted_fields.push(*field);
            }
        }
        if effective_fields.is_empty() {
            return Err(PeerError::Authorization(
                "query has no fields after grant attenuation".into(),
            ));
        }
        return Ok(InboundQueryAuthorization {
            grant_id: grant.id.clone(),
            grant_sequence: grant.sequence,
            rule_id: rule.id.clone(),
            grant_verification_id: verification_id.to_owned(),
            verified_grant_hash: verified_hash.to_owned(),
            effective_fields,
            redacted_fields,
            maximum_result_count: request.maximum_result_count.min(rule.maximum_result_count),
            maximum_payload_bytes: request
                .maximum_payload_bytes
                .min(rule.maximum_payload_bytes)
                .min(MAX_WIRE_QUERY_RESPONSE_BYTES),
        });
    }

    let reason = if !saw_device {
        "query requester device is not approved by the active grant"
    } else if !saw_entities {
        "query entities are not granted"
    } else if !saw_time {
        "query time range is not granted"
    } else {
        "query precision is not granted"
    };
    Err(PeerError::Authorization(reason.into()))
}

fn wire_query_record_ids(query: &TypedQuery) -> &[OpaqueRecordId] {
    match query {
        TypedQuery::CalendarSelectedEvents { record_ids, .. }
        | TypedQuery::LifeEventsSelected { record_ids, .. }
        | TypedQuery::CustomSelectedEntities { record_ids, .. } => record_ids.as_slice(),
        _ => &[],
    }
}

fn wire_query_time_range(query: &TypedQuery) -> Option<TimeRange> {
    match query {
        TypedQuery::CalendarAvailability { range, .. }
        | TypedQuery::CalendarSelectedEvents { range, .. }
        | TypedQuery::HealthCyclingAggregate { range, .. }
        | TypedQuery::LifeEventsSelected { range, .. }
        | TypedQuery::MovementAggregate { range, .. } => Some(*range),
        TypedQuery::GoalsHorizonSummary { horizon } => Some(*horizon),
        TypedQuery::PersonProfile { .. } | TypedQuery::CustomSelectedEntities { .. } => None,
    }
}

fn wire_query_granularity(query: &TypedQuery) -> Option<Granularity> {
    match query {
        TypedQuery::HealthCyclingAggregate { granularity, .. }
        | TypedQuery::MovementAggregate { granularity, .. } => Some(*granularity),
        _ => None,
    }
}

fn precision_name(precision: Precision) -> &'static str {
    match precision {
        Precision::Exact => "exact",
        Precision::FifteenMinutes => "fifteen_minutes",
        Precision::Hour => "hour",
        Precision::Day => "day",
        Precision::Week => "week",
        Precision::Month => "month",
        Precision::AggregateOnly => "aggregate_only",
    }
}

fn wire_entities_authorized(
    rule: &crate::grant::ShareRule,
    requested: &[OpaqueRecordId],
) -> Result<bool> {
    let Some(selector) = &rule.entity_selector else {
        return Ok(requested.is_empty());
    };
    match selector.mode {
        crate::grant::EntitySelectorMode::AllShareable => Ok(true),
        crate::grant::EntitySelectorMode::Selected => {
            if requested.is_empty() {
                return Ok(false);
            }
            let allowed = selector
                .entity_ids
                .iter()
                .map(|value| wire_record_id(value))
                .collect::<Result<Vec<_>>>()?;
            Ok(requested.iter().all(|id| allowed.contains(id)))
        }
    }
}

fn wire_time_authorized(
    rule: &crate::grant::ShareRule,
    requested: Option<TimeRange>,
    now: u64,
) -> Result<bool> {
    let policy = &rule.time;
    let has_bounds = policy.starts_at.is_some()
        || policy.ends_at.is_some()
        || policy.rolling_past_days.is_some()
        || policy.rolling_future_days.is_some();
    let Some(range) = requested else {
        return Ok(!has_bounds);
    };
    if let Some(start) = policy
        .starts_at
        .as_deref()
        .map(|value| parse_timestamp(value, "grant time start"))
        .transpose()?
        && range.start < start
    {
        return Ok(false);
    }
    if let Some(end) = policy
        .ends_at
        .as_deref()
        .map(|value| parse_timestamp(value, "grant time end"))
        .transpose()?
        && range.end > end
    {
        return Ok(false);
    }
    if let Some(days) = policy.rolling_past_days
        && range.start < now.saturating_sub(u64::from(days).saturating_mul(24 * 60 * 60))
    {
        return Ok(false);
    }
    if let Some(days) = policy.rolling_future_days
        && range.end > now.saturating_add(u64::from(days).saturating_mul(24 * 60 * 60))
    {
        return Ok(false);
    }
    Ok(true)
}

fn aggregation_authorized(rule: &crate::grant::ShareRule, requested: Option<Granularity>) -> bool {
    let Some(requested) = requested else {
        return true;
    };
    let Some(policy) = &rule.aggregation else {
        return false;
    };
    matches!(
        (requested, policy.granularity),
        (Granularity::Day, crate::grant::AggregationGranularity::Day)
            | (
                Granularity::Week,
                crate::grant::AggregationGranularity::Week
            )
            | (
                Granularity::Month,
                crate::grant::AggregationGranularity::Month
            )
    )
}

fn verify_durable_active_grant(stored: &StoredGrant, now: u64) -> Result<()> {
    let grant = &stored.grant;
    grant.validate()?;
    if grant.status != GrantStatus::Active {
        return Err(PeerError::Authorization(
            "durable grant evidence is not active".into(),
        ));
    }
    let version_hash = grant.version_hash_hex()?;
    let verification_id = format!("fpv_{}", &version_hash[..32]);
    if stored.verified_hash.as_deref() != Some(version_hash.as_str())
        || stored.verification_id.as_deref() != Some(verification_id.as_str())
    {
        return Err(PeerError::Authentication(
            "durable grant verification evidence does not match the exact grant version".into(),
        ));
    }
    let issued_at = parse_timestamp(&grant.issued_at, "grant issuedAt")?;
    let effective_at = grant
        .effective_at
        .as_deref()
        .map(|value| parse_timestamp(value, "grant effectiveAt"))
        .transpose()?
        .unwrap_or(issued_at);
    let expires_at = grant
        .expires_at
        .as_deref()
        .map(|value| parse_timestamp(value, "grant expiresAt"))
        .transpose()?;
    if effective_at > now.saturating_add(MAX_CLOCK_SKEW_SECONDS)
        || expires_at.is_some_and(|expires_at| now >= expires_at)
    {
        return Err(PeerError::Authorization(
            "durable active grant is not within its authorization window".into(),
        ));
    }
    Ok(())
}

fn unavailable_query_response(
    request: &QueryRequest,
    grant: &PeerShareGrantVersion,
    local: &DeviceCertificate,
    now: u64,
) -> Result<QueryResponse> {
    let grant_expiry = grant
        .expires_at
        .as_deref()
        .map(|value| parse_timestamp(value, "grant expiresAt"))
        .transpose()?
        .unwrap_or_else(|| now.saturating_add(60));
    let valid_until = now.saturating_add(60).min(grant_expiry);
    if valid_until <= now {
        return Err(PeerError::Authorization(
            "query grant expires before a response can be authenticated".into(),
        ));
    }
    let response = QueryResponse {
        query_id: request.query_id,
        metadata: ResponseMetadata {
            source_principal: local.body.principal_id,
            source_device: local.body.device_id,
            as_of: now,
            received_at: now,
            valid_until,
            grant_id: request.grant_id,
            grant_sequence: request.grant_sequence,
            projection: request.query.projection(),
            completeness: Completeness::Unknown,
            precision: query_precision(&request.query),
            freshness: FreshnessState::Unavailable,
            redactions: BoundedVec::new(Vec::new())?,
        },
        outcome: QueryOutcome::Unavailable(UnavailableReason::Unsupported),
    };
    response.validate()?;
    Ok(response)
}

fn append_grant(
    relationship: &mut StoredRelationship,
    grant: PeerShareGrantVersion,
    verification_id: Option<String>,
    verified_hash: Option<String>,
) -> Result<()> {
    if relationship.grants.len() >= MAX_GRANTS_PER_RELATIONSHIP {
        return Err(limit("relationship grant history reached its hard limit"));
    }
    let hash = grant.version_hash_hex()?;
    if let Some(existing) = relationship
        .grants
        .iter()
        .find(|entry| entry.grant.id == grant.id && entry.grant.sequence == grant.sequence)
    {
        if existing.grant.version_hash_hex()? == hash {
            return Ok(());
        }
        return Err(PeerError::StateConflict(
            "grant sequence fork detected".into(),
        ));
    }
    if let Some(previous) = relationship
        .grants
        .iter()
        .filter(|entry| entry.grant.id == grant.id)
        .max_by_key(|entry| entry.grant.sequence)
    {
        if grant.sequence != previous.grant.sequence.saturating_add(1)
            || grant.previous_version_hash.as_deref() != Some(&previous.grant.version_hash_hex()?)
        {
            return Err(PeerError::Replay(
                "grant version does not extend durable hash head".into(),
            ));
        }
    } else if grant.sequence != 1 || grant.previous_version_hash.is_some() {
        return Err(PeerError::Replay(
            "first durable grant version is not sequence one".into(),
        ));
    }
    relationship.grants.push(StoredGrant {
        grant,
        verification_id,
        verified_hash,
    });
    Ok(())
}

fn store_active_grant(
    relationship: &mut StoredRelationship,
    grant: PeerShareGrantVersion,
    verification_id: String,
    verified_hash: String,
) -> Result<()> {
    if grant.status != GrantStatus::Active {
        return Err(invalid("active grant store received a non-active grant"));
    }
    if let Some(index) = relationship
        .grants
        .iter()
        .position(|stored| stored.grant.id == grant.id && stored.grant.sequence == grant.sequence)
    {
        let existing = &relationship.grants[index].grant;
        if existing == &grant {
            relationship.grants[index].verification_id = Some(verification_id);
            relationship.grants[index].verified_hash = Some(verified_hash);
            return Ok(());
        }
        if !matches!(
            existing.status,
            GrantStatus::Proposed | GrantStatus::Countered
        ) || existing.canonical_consent_json()? != grant.canonical_consent_json()?
        {
            return Err(PeerError::StateConflict(
                "active grant conflicts with its pending consent version".into(),
            ));
        }
        relationship.grants[index] = StoredGrant {
            grant,
            verification_id: Some(verification_id),
            verified_hash: Some(verified_hash),
        };
        return Ok(());
    }
    append_grant(
        relationship,
        grant,
        Some(verification_id),
        Some(verified_hash),
    )
}

fn authorize_query<'a>(
    owner_user_id: &str,
    relationship: &'a StoredRelationship,
    query: &ApiTypedQuery,
    local: &DeviceCertificate,
    now: u64,
) -> Result<(
    &'a PeerShareGrantVersion,
    &'a str,
    &'a str,
    &'a crate::grant::ShareRule,
)> {
    let local_device_id = device_id(local);
    let expected_fingerprint = relationship.remote_certificate.fingerprint()?;
    let mut approved_source = false;
    for device in &relationship.devices {
        if device.status == StoredDeviceStatus::Approved
            && device.certificate.body.device_id == relationship.remote_certificate.body.device_id
            && device.certificate.fingerprint()? == expected_fingerprint
        {
            approved_source = true;
            break;
        }
    }
    if !approved_source {
        return Err(PeerError::Authorization(
            "relationship has no currently approved remote source device".into(),
        ));
    }
    let mut seen_grant_ids = BTreeSet::new();
    for stored in relationship.grants.iter().rev() {
        let grant = &stored.grant;
        if !seen_grant_ids.insert(grant.id.as_str()) {
            continue;
        }
        if grant.status != GrantStatus::Active
            || grant_party_for_device(grant, &local_device_id) != Some(GrantParty::Grantee)
            || grant_party_for_device(grant, &device_id(&relationship.remote_certificate))
                != Some(GrantParty::Grantor)
        {
            continue;
        }
        validate_directional_grant_signatures(
            grant,
            relationship,
            grant.owner_user_id == owner_user_id,
        )?;
        verify_durable_active_grant(stored, now)?;
        let trust = grant_trust(relationship, local, grant, now, true)?;
        let evidence = verify_active_grant(grant, &trust, now)?;
        if stored.verified_hash.as_deref() != Some(evidence.verified_grant_hash()) {
            return Err(PeerError::Authentication(
                "outbound query grant no longer matches its durable verification".into(),
            ));
        }
        let issued_at = parse_timestamp(&grant.issued_at, "grant issuedAt")?;
        let effective_at = grant
            .effective_at
            .as_deref()
            .map(|value| parse_timestamp(value, "grant effectiveAt"))
            .transpose()?
            .unwrap_or(issued_at);
        let expires_at = grant
            .expires_at
            .as_deref()
            .map(|value| parse_timestamp(value, "grant expiresAt"))
            .transpose()?;
        if effective_at > now || expires_at.is_some_and(|expiry| expiry <= now) {
            continue;
        }
        for rule in &grant.rules {
            if rule.effect != crate::grant::RuleEffect::Allow
                || rule.projection_id.as_str() != query.projection_id
                || query.maximum_result_count > rule.maximum_result_count
                || query.precision != rule.precision
                || !fields_authorized(&query.fields, &rule.fields.include, &rule.fields.exclude)
                || !device_authorized(rule, &local_device_id)
                || !entities_authorized(rule, &query.entity_ids)
                || !time_authorized(rule, query.interval.as_ref(), now)?
            {
                continue;
            }
            let verification_id = stored.verification_id.as_deref().ok_or_else(|| {
                PeerError::Authorization("active grant lacks daemon verification evidence".into())
            })?;
            let verified_hash = stored.verified_hash.as_deref().ok_or_else(|| {
                PeerError::Authorization("active grant lacks a verified hash".into())
            })?;
            return Ok((grant, verification_id, verified_hash, rule));
        }
    }
    Err(PeerError::Authorization(
        "no daemon-verified active grant authorizes this typed query".into(),
    ))
}

fn device_authorized(rule: &crate::grant::ShareRule, local_device_id: &str) -> bool {
    match rule.device_policy {
        crate::grant::DevicePolicy::Explicit => rule
            .approved_device_ids
            .iter()
            .any(|device_id| device_id == local_device_id),
        crate::grant::DevicePolicy::ApprovedCurrentDevices => true,
    }
}

fn entities_authorized(rule: &crate::grant::ShareRule, requested: &[String]) -> bool {
    let Some(selector) = &rule.entity_selector else {
        return requested.is_empty();
    };
    match selector.mode {
        crate::grant::EntitySelectorMode::AllShareable => true,
        crate::grant::EntitySelectorMode::Selected => {
            !requested.is_empty()
                && requested
                    .iter()
                    .all(|id| selector.entity_ids.iter().any(|allowed| allowed == id))
        }
    }
}

fn time_authorized(
    rule: &crate::grant::ShareRule,
    interval: Option<&ApiQueryInterval>,
    now: u64,
) -> Result<bool> {
    let policy = &rule.time;
    if policy.starts_at.is_none()
        && policy.ends_at.is_none()
        && policy.rolling_past_days.is_none()
        && policy.rolling_future_days.is_none()
    {
        return Ok(true);
    }
    let Some(interval) = interval else {
        return Ok(false);
    };
    let starts_at = parse_timestamp(&interval.starts_at, "query interval start")?;
    let ends_at = parse_timestamp(&interval.ends_at, "query interval end")?;
    if let Some(policy_start) = policy
        .starts_at
        .as_deref()
        .map(|value| parse_timestamp(value, "grant time start"))
        .transpose()?
        && starts_at < policy_start
    {
        return Ok(false);
    }
    if let Some(policy_end) = policy
        .ends_at
        .as_deref()
        .map(|value| parse_timestamp(value, "grant time end"))
        .transpose()?
        && ends_at > policy_end
    {
        return Ok(false);
    }
    if let Some(days) = policy.rolling_past_days {
        let seconds = u64::from(days).saturating_mul(24 * 60 * 60);
        if starts_at < now.saturating_sub(seconds) {
            return Ok(false);
        }
    }
    if let Some(days) = policy.rolling_future_days {
        let seconds = u64::from(days).saturating_mul(24 * 60 * 60);
        if ends_at > now.saturating_add(seconds) {
            return Ok(false);
        }
    }
    Ok(true)
}

fn validate_authenticated_query_payload(
    payload: &ApiQueryPayload,
    query: &ApiTypedQuery,
    rule: &crate::grant::ShareRule,
) -> Result<()> {
    if payload.records.len() > usize::from(query.maximum_result_count)
        || payload.records.len() > usize::from(rule.maximum_result_count)
    {
        return Err(PeerError::Authorization(
            "query response exceeds the authorized record count".into(),
        ));
    }
    let requested: BTreeSet<_> = query.fields.iter().map(String::as_str).collect();
    for record in &payload.records {
        if record
            .fields
            .keys()
            .any(|field| !requested.contains(field.as_str()))
        {
            return Err(PeerError::Authorization(
                "query response contains a field absent from the typed request".into(),
            ));
        }
    }
    Ok(())
}

fn fields_authorized(requested: &[String], included: &[String], excluded: &[String]) -> bool {
    let include: BTreeSet<_> = included.iter().map(String::as_str).collect();
    let exclude: BTreeSet<_> = excluded.iter().map(String::as_str).collect();
    requested.iter().all(|field| {
        !exclude.contains(field.as_str())
            && (include.is_empty() || include.contains(field.as_str()))
    })
}

fn validate_projection_ids(values: &[String]) -> Result<()> {
    if values.is_empty() || values.len() > 8 {
        return Err(limit("projectionIds must contain 1..=8 entries"));
    }
    for value in values {
        validate_projection_id(value)?;
    }
    if values.iter().collect::<BTreeSet<_>>().len() != values.len() {
        return Err(invalid("projectionIds contains duplicates"));
    }
    Ok(())
}

fn validate_projection_id(value: &str) -> Result<()> {
    if matches!(
        value,
        "calendar.availability.v1"
            | "calendar.selected_events.v1"
            | "goals.horizon_summary.v1"
            | "health.cycling.aggregate.v1"
            | "person.profile.v1"
            | "life_events.selected.v1"
            | "movement.aggregate.v1"
            | "custom.selected_entities.v1"
    ) {
        Ok(())
    } else {
        Err(invalid("unknown typed projection id"))
    }
}

fn validate_query_payload(payload: &ApiQueryPayload) -> Result<()> {
    if payload.records.len() > MAX_QUERY_RECORDS {
        return Err(limit("query payload has more than 64 records"));
    }
    let mut ids = BTreeSet::new();
    for record in &payload.records {
        validate_text(&record.record_id, 1, 240, "query record id")?;
        if !ids.insert(record.record_id.as_str()) {
            return Err(invalid("query payload contains duplicate record ids"));
        }
        if record.fields.len() > MAX_QUERY_FIELDS {
            return Err(limit("query record has more than 64 fields"));
        }
        validate_json_object(&record.fields)?;
    }
    Ok(())
}

fn decode_query_payload(bytes: &[u8]) -> Result<ApiQueryPayload> {
    if bytes.len() > MAX_QUERY_JSON_BYTES {
        return Err(limit(format!(
            "stored query payload exceeds the {MAX_QUERY_JSON_BYTES}-byte IPC ceiling"
        )));
    }
    let payload: ApiQueryPayload = serde_json::from_slice(bytes)
        .map_err(|error| invalid(format!("decoding query payload: {error}")))?;
    validate_query_payload(&payload)?;
    Ok(payload)
}

fn query_hash(query: &ApiTypedQuery) -> Result<[u8; 32]> {
    query.validate()?;
    let bytes = serde_json_canonicalizer::to_vec(query)
        .map_err(|error| invalid(format!("canonicalizing typed query: {error}")))?;
    if bytes.len() > 32 * 1024 {
        return Err(limit("canonical typed query exceeds 32 KiB"));
    }
    Ok(*blake3::hash(&bytes).as_bytes())
}

fn validate_json_object(value: &serde_json::Map<String, serde_json::Value>) -> Result<()> {
    if value.len() > 256 {
        return Err(limit("JSON object contains more than 256 keys"));
    }
    let mut nodes = 0_usize;
    for (key, nested) in value {
        validate_text(key, 1, 120, "JSON key")?;
        if matches!(key.as_str(), "__proto__" | "constructor" | "prototype") {
            return Err(invalid("JSON object contains a protected key"));
        }
        validate_json_value(nested, 1, &mut nodes)?;
    }
    Ok(())
}

fn validate_json_value(value: &serde_json::Value, depth: usize, nodes: &mut usize) -> Result<()> {
    *nodes = nodes.saturating_add(1);
    if depth > 12 || *nodes > 4_096 {
        return Err(limit("JSON value exceeds structural limits"));
    }
    match value {
        serde_json::Value::Null | serde_json::Value::Bool(_) => Ok(()),
        serde_json::Value::Number(number)
            if number.is_f64() || number.is_i64() || number.is_u64() =>
        {
            Ok(())
        }
        serde_json::Value::String(value) => validate_text(value, 0, 4_096, "JSON string"),
        serde_json::Value::Array(values) => {
            if values.len() > 256 {
                return Err(limit("JSON array exceeds 256 entries"));
            }
            for value in values {
                validate_json_value(value, depth + 1, nodes)?;
            }
            Ok(())
        }
        serde_json::Value::Object(values) => {
            if values.len() > 256 {
                return Err(limit("nested JSON object exceeds 256 keys"));
            }
            for (key, value) in values {
                validate_text(key, 1, 120, "JSON key")?;
                if matches!(key.as_str(), "__proto__" | "constructor" | "prototype") {
                    return Err(invalid("JSON object contains a protected key"));
                }
                validate_json_value(value, depth + 1, nodes)?;
            }
            Ok(())
        }
        serde_json::Value::Number(_) => Err(invalid("JSON number is not finite")),
    }
}

fn validate_unique_texts(
    values: &[String],
    maximum_count: usize,
    maximum_length: usize,
    label: &str,
) -> Result<()> {
    if values.len() > maximum_count {
        return Err(limit(format!("{label} exceeds {maximum_count} entries")));
    }
    let mut unique = BTreeSet::new();
    for value in values {
        validate_text(value, 1, maximum_length, label)?;
        if !unique.insert(value) {
            return Err(invalid(format!("{label} contains duplicates")));
        }
    }
    Ok(())
}

fn validate_text(value: &str, minimum: usize, maximum: usize, label: &str) -> Result<()> {
    if value.len() < minimum || value.len() > maximum || value.contains('\0') {
        return Err(invalid(format!("{label} length/content is invalid")));
    }
    Ok(())
}

fn validate_sha256_hex(value: &str, label: &str) -> Result<()> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(invalid(format!(
            "{label} is not a lowercase SHA-256 digest"
        )));
    }
    Ok(())
}

fn seal_state(
    key: &[u8; 32],
    certificate: &DeviceCertificate,
    plaintext: &[u8],
) -> Result<Vec<u8>> {
    let nonce = nonzero_random_24();
    let aad = state_aad(certificate, DAEMON_STATE_MAGIC);
    let ciphertext = XChaCha20Poly1305::new(key.into())
        .encrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: plaintext,
                aad: &aad,
            },
        )
        .map_err(|_| PeerError::Authentication("sealing daemon state failed".into()))?;
    let mut sealed = Vec::with_capacity(DAEMON_STATE_MAGIC.len() + nonce.len() + ciphertext.len());
    sealed.extend_from_slice(DAEMON_STATE_MAGIC);
    sealed.extend_from_slice(&nonce);
    sealed.extend_from_slice(&ciphertext);
    Ok(sealed)
}

fn open_state(
    key: &[u8; 32],
    certificate: &DeviceCertificate,
    sealed: &[u8],
) -> Result<DurableDaemonState> {
    if sealed.len() <= DAEMON_STATE_MAGIC.len() + 24 || sealed.len() > DAEMON_STATE_LIMIT + 128 {
        return Err(PeerError::Authentication(
            "daemon state envelope is invalid".into(),
        ));
    }
    let envelope_magic = sealed
        .get(..DAEMON_STATE_MAGIC.len())
        .ok_or_else(|| PeerError::Authentication("daemon state envelope is truncated".into()))?;
    if envelope_magic != DAEMON_STATE_MAGIC
        && envelope_magic != PRE_MAILBOX_DAEMON_STATE_MAGIC
        && envelope_magic != PRE_QUERY_BRIDGE_DAEMON_STATE_MAGIC
        && envelope_magic != PRE_ROTATION_DAEMON_STATE_MAGIC
        && envelope_magic != IDENTITY_BOUNDARY_DAEMON_STATE_MAGIC
        && envelope_magic != ENDPOINT_DAEMON_STATE_MAGIC
        && envelope_magic != PREVIOUS_DAEMON_STATE_MAGIC
        && envelope_magic != LEGACY_DAEMON_STATE_MAGIC
    {
        return Err(PeerError::Authentication(
            "daemon state envelope is invalid".into(),
        ));
    }
    let nonce_start = DAEMON_STATE_MAGIC.len();
    let nonce_end = nonce_start + 24;
    let aad = state_aad(certificate, envelope_magic);
    let plaintext = Zeroizing::new(
        XChaCha20Poly1305::new(key.into())
            .decrypt(
                XNonce::from_slice(&sealed[nonce_start..nonce_end]),
                Payload {
                    msg: &sealed[nonce_end..],
                    aad: &aad,
                },
            )
            .map_err(|_| PeerError::Authentication("opening daemon state failed".into()))?,
    );
    if envelope_magic == DAEMON_STATE_MAGIC {
        decode_limited::<DAEMON_STATE_LIMIT, _>(&plaintext)
    } else if envelope_magic == PRE_MAILBOX_DAEMON_STATE_MAGIC {
        decode_limited::<DAEMON_STATE_LIMIT, PreMailboxDaemonState>(&plaintext)
            .map(DurableDaemonState::from_pre_mailbox)
    } else if envelope_magic == PRE_QUERY_BRIDGE_DAEMON_STATE_MAGIC {
        decode_limited::<DAEMON_STATE_LIMIT, PreQueryBridgeDaemonState>(&plaintext)
            .map(DurableDaemonState::from_pre_query_bridge)
    } else if envelope_magic == PRE_ROTATION_DAEMON_STATE_MAGIC {
        decode_limited::<DAEMON_STATE_LIMIT, PreRotationDaemonState>(&plaintext)
            .map(DurableDaemonState::from_pre_rotation)
    } else if envelope_magic == IDENTITY_BOUNDARY_DAEMON_STATE_MAGIC {
        decode_limited::<DAEMON_STATE_LIMIT, IdentityBoundaryDaemonState>(&plaintext)
            .map(|state| DurableDaemonState::from_identity_boundary(state, certificate))
    } else if envelope_magic == ENDPOINT_DAEMON_STATE_MAGIC {
        decode_limited::<DAEMON_STATE_LIMIT, EndpointDurableDaemonState>(&plaintext)
            .map(|state| DurableDaemonState::from_endpoint(state, certificate))
    } else if envelope_magic == PREVIOUS_DAEMON_STATE_MAGIC {
        decode_limited::<DAEMON_STATE_LIMIT, PreviousDurableDaemonState>(&plaintext)
            .map(|state| DurableDaemonState::from_previous(state, certificate))
    } else {
        decode_limited::<DAEMON_STATE_LIMIT, LegacyDurableDaemonState>(&plaintext)
            .map(|state| DurableDaemonState::from_legacy(state, certificate))
    }
}

fn seal_bytes(key: &[u8; 32], aad: &[u8], bytes: &[u8]) -> Result<([u8; 24], Vec<u8>)> {
    let nonce = nonzero_random_24();
    let ciphertext = XChaCha20Poly1305::new(key.into())
        .encrypt(XNonce::from_slice(&nonce), Payload { msg: bytes, aad })
        .map_err(|_| PeerError::Authentication("sealing bootstrap backup failed".into()))?;
    Ok((nonce, ciphertext))
}

fn state_aad(certificate: &DeviceCertificate, magic: &[u8]) -> Vec<u8> {
    let mut aad = Vec::with_capacity(magic.len() + 32);
    aad.extend_from_slice(magic);
    aad.extend_from_slice(&certificate.body.principal_id.0);
    aad
}

fn parse_timestamp(value: &str, label: &str) -> Result<u64> {
    let timestamp = OffsetDateTime::parse(value, &Rfc3339)
        .map_err(|error| invalid(format!("invalid {label}: {error}")))?
        .unix_timestamp();
    u64::try_from(timestamp).map_err(|_| invalid(format!("{label} predates Unix epoch")))
}

fn format_timestamp(value: u64) -> Result<String> {
    let timestamp = i64::try_from(value).map_err(|_| limit("timestamp does not fit i64"))?;
    OffsetDateTime::from_unix_timestamp(timestamp)
        .map_err(|error| invalid(format!("invalid timestamp: {error}")))?
        .format(&Rfc3339)
        .map_err(|error| invalid(format!("formatting timestamp: {error}")))
}

fn unix_time() -> Result<u64> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .map_err(|_| PeerError::StateConflict("system clock predates Unix epoch".into()))
}

fn principal_id(certificate: &DeviceCertificate) -> String {
    hex::encode(certificate.body.principal_id.0)
}

fn device_id(certificate: &DeviceCertificate) -> String {
    hex::encode(certificate.body.device_id.0)
}

fn base32_fingerprint(bytes: &[u8; 32]) -> String {
    const ALPHABET: &[u8; 32] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let mut output = String::with_capacity(39);
    let mut accumulator = 0_u16;
    let mut bits = 0_u8;
    let mut emitted = 0_usize;
    for byte in &bytes[..20] {
        accumulator = (accumulator << 8) | u16::from(*byte);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            if emitted > 0 && emitted.is_multiple_of(4) {
                output.push('-');
            }
            let index = usize::from((accumulator >> bits) & 0x1f);
            output.push(char::from(ALPHABET[index]));
            emitted += 1;
            accumulator &= if bits == 0 { 0 } else { (1_u16 << bits) - 1 };
        }
    }
    output
}

fn verification_phrase() -> String {
    let random: [u8; 12] = rand::random();
    random
        .chunks_exact(2)
        .map(hex::encode_upper)
        .collect::<Vec<_>>()
        .join("-")
}

fn phrase_hash(value: &str) -> [u8; 32] {
    let mut hasher = blake3::Hasher::new_derive_key("forge-peer/1 verification phrase");
    hasher.update(value.as_bytes());
    *hasher.finalize().as_bytes()
}

fn pairing_state_binding(
    request_id: [u8; 16],
    transcript_hash: [u8; 32],
    local_fingerprint: [u8; 32],
) -> [u8; 32] {
    let mut hasher = blake3::Hasher::new_derive_key("forge-peer/1 pairing IPC state binding");
    hasher.update(&request_id);
    hasher.update(&transcript_hash);
    hasher.update(&local_fingerprint);
    *hasher.finalize().as_bytes()
}

fn relationship_id_for_transcript(transcript_hash: [u8; 32]) -> Result<[u8; 16]> {
    if transcript_hash == [0; 32] {
        return Err(invalid("pairing transcript hash is all zero"));
    }
    let derived = blake3::derive_key("forge-peer/1 relationship id", &transcript_hash);
    let relationship_id: [u8; 16] = derived[..16]
        .try_into()
        .map_err(|_| invalid("derived relationship id has the wrong size"))?;
    if relationship_id == [0; 16] {
        return Err(invalid("derived relationship id is all zero"));
    }
    Ok(relationship_id)
}

fn channel_id_for_relationship(relationship_id: &str) -> Result<ChannelId> {
    let relationship_id = decode_hex_array::<16>(relationship_id, "relationship id")?;
    let channel = blake3::derive_key("forge-peer/1 relationship channel id", &relationship_id);
    let channel = ChannelId(channel);
    channel.validate()?;
    Ok(channel)
}

fn enqueue_outbound_packet(
    state: &mut DurableDaemonState,
    relationship_id: Option<String>,
    packet: PeerWirePacket,
    endpoints: &[EndpointDescriptor],
    expected_receiver: DeviceCertificate,
    now: u64,
) -> Result<()> {
    if state.transport_outbox.len() >= MAX_TRANSPORT_OUTBOX {
        return Err(limit("durable transport outbox limit reached"));
    }
    packet.validate_at(now)?;
    expected_receiver.verify(now)?;
    if state
        .transport_outbox
        .iter()
        .any(|outbound| outbound.packet.packet_id == packet.packet_id)
    {
        return Err(PeerError::StateConflict(
            "transport packet id collides with an outbox entry".into(),
        ));
    }
    let operational_endpoints = endpoints
        .iter()
        .filter_map(|endpoint| match endpoint {
            EndpointDescriptor::Direct(_)
            | EndpointDescriptor::Iroh(IrohEndpointDescriptor {
                relay_origin: None, ..
            })
            | EndpointDescriptor::Tor(_)
            | EndpointDescriptor::HttpMailbox(_) => Some(endpoint.clone()),
            EndpointDescriptor::Iroh(IrohEndpointDescriptor {
                relay_origin: Some(_),
                ..
            }) => None,
        })
        .collect::<Vec<_>>();
    if operational_endpoints.is_empty() {
        return Err(PeerError::Transport(
            "relationship has no operational authenticated endpoint".into(),
        ));
    }
    state.transport_outbox.push(StoredOutboundPacket {
        relationship_id,
        packet,
        endpoints: operational_endpoints,
        expected_receiver,
        attempts: 0,
        next_attempt_at: now,
    });
    Ok(())
}

fn endpoint_provider_kind(endpoint: &EndpointDescriptor) -> ProviderKind {
    match endpoint {
        EndpointDescriptor::Direct(_) => ProviderKind::LocalDirect,
        EndpointDescriptor::Iroh(_) => ProviderKind::Iroh,
        EndpointDescriptor::Tor(_) => ProviderKind::TorOnion,
        EndpointDescriptor::HttpMailbox(_) => ProviderKind::HttpMailbox,
    }
}

fn enqueue_pending_application(
    state: &mut DurableDaemonState,
    message_id: EnvelopeMessageId,
    relationship_id: &str,
    message: ApplicationMessage,
    created_at: u64,
    expires_at: u64,
) -> Result<()> {
    message_id.validate()?;
    message.validate()?;
    if created_at >= expires_at || expires_at - created_at > 24 * 60 * 60 {
        return Err(invalid("application transport lifetime is invalid"));
    }
    if state.pending_applications.len() >= MAX_TRANSPORT_OUTBOX {
        return Err(limit("durable pending application limit reached"));
    }
    if state
        .pending_applications
        .iter()
        .any(|pending| pending.message_id == message_id)
    {
        return Err(PeerError::StateConflict(
            "pending application message id collision".into(),
        ));
    }
    state.pending_applications.push(StoredPendingApplication {
        message_id,
        relationship_id: relationship_id.to_owned(),
        message,
        created_at,
        expires_at,
    });
    Ok(())
}

fn append_inbound_receipt(
    state: &mut DurableDaemonState,
    packet: &PeerWirePacket,
    acknowledgement: &SignedDeliveryAck,
) -> Result<()> {
    let packet_hash = packet.hash()?;
    if let Some(existing) = state
        .inbound_receipts
        .iter()
        .find(|receipt| receipt.packet_id == packet.packet_id)
    {
        if existing.packet_hash == packet_hash && existing.acknowledgement == *acknowledgement {
            return Ok(());
        }
        return Err(PeerError::Replay(
            "transport packet id was reused with different authenticated bytes".into(),
        ));
    }
    if state.inbound_receipts.len() >= MAX_INBOUND_RECEIPTS {
        return Err(limit(
            "durable inbound transport receipt limit reached; local-console compaction is required",
        ));
    }
    state.inbound_receipts.push(StoredInboundReceipt {
        packet_id: packet.packet_id,
        packet_hash,
        acknowledgement: acknowledgement.clone(),
    });
    Ok(())
}

fn decode_base64(value: &str, maximum: usize, label: &str) -> Result<Vec<u8>> {
    if value.is_empty() || value.len() > maximum.saturating_mul(2) {
        return Err(limit(format!("{label} is empty or oversized")));
    }
    let decoded = URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| invalid(format!("{label} is not canonical base64url")))?;
    if decoded.len() > maximum || URL_SAFE_NO_PAD.encode(&decoded) != value {
        return Err(limit(format!("{label} is non-canonical or oversized")));
    }
    Ok(decoded)
}

fn decode_base64_array<const N: usize>(value: &str, label: &str) -> Result<[u8; N]> {
    let decoded = decode_base64(value, N, label)?;
    decoded
        .try_into()
        .map_err(|_| invalid(format!("{label} must decode to exactly {N} bytes")))
}

fn decode_hex_array<const N: usize>(value: &str, label: &str) -> Result<[u8; N]> {
    if value.len() != N * 2
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(invalid(format!(
            "{label} is not an exact lowercase hexadecimal identifier"
        )));
    }
    let decoded = hex::decode(value).map_err(|_| invalid(format!("{label} is invalid")))?;
    let array: [u8; N] = decoded
        .try_into()
        .map_err(|_| invalid(format!("{label} has the wrong size")))?;
    if array == [0; N] {
        return Err(invalid(format!("{label} is all zero")));
    }
    Ok(array)
}

fn nonzero_random_16() -> [u8; 16] {
    loop {
        let value = rand::random();
        if value != [0; 16] {
            return value;
        }
    }
}

fn nonzero_random_24() -> [u8; 24] {
    loop {
        let value = rand::random();
        if value != [0; 24] {
            return value;
        }
    }
}

fn nonzero_random_32() -> [u8; 32] {
    loop {
        let value = rand::random();
        if value != [0; 32] {
            return value;
        }
    }
}

fn nonzero_invite_id() -> InviteId {
    InviteId(nonzero_random_16())
}

#[cfg(test)]
mod tests {
    use std::net::{IpAddr, Ipv4Addr};
    use std::os::unix::fs::PermissionsExt as _;

    use ed25519_dalek::SigningKey;
    use sha3::{Digest as _, Sha3_256};

    use super::*;
    use crate::codec::{read_json_frame, write_json_frame};
    use crate::endpoint::{DirectEndpoint, IpAddress};
    use crate::grant::{
        CacheMode, CachePolicy, DevicePolicy, FieldPolicy, ProjectionId as GrantProjectionId,
        RuleEffect, ShareRule, TimePolicy,
    };
    use crate::ipc::{IpcErrorCode, OwnerIpcServer};
    use crate::transport::DirectTransportRuntime;
    use tokio::net::UnixStream;

    fn test_approval_deadline() -> Result<String> {
        static DEADLINE: std::sync::OnceLock<String> = std::sync::OnceLock::new();
        if let Some(deadline) = DEADLINE.get() {
            return Ok(deadline.clone());
        }
        let generated = format_timestamp(unix_time()?.saturating_add(3_600))?;
        let _already_set = DEADLINE.set(generated);
        DEADLINE
            .get()
            .cloned()
            .ok_or_else(|| PeerError::StateConflict("test approval deadline was not set".into()))
    }

    #[derive(Debug, Deserialize)]
    #[allow(clippy::large_enum_variant)]
    #[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
    enum DaemonTestResponse {
        Health {
            #[serde(rename = "requestId")]
            request_id: String,
            healthy: bool,
            provenance: AuthenticatedProvenance,
            enabled: bool,
            #[serde(rename = "protocolVersion")]
            protocol_version: String,
            reason: Option<String>,
        },
        TransportReadiness {
            #[serde(rename = "requestId")]
            request_id: String,
            transports: Vec<ProviderReadiness>,
            provenance: AuthenticatedProvenance,
        },
        LocalIdentity {
            #[serde(rename = "requestId")]
            request_id: String,
            identity: LocalIdentityView,
        },
        InvitationCreated {
            #[serde(rename = "requestId")]
            request_id: String,
            material: InvitationMaterial,
        },
        InvitationCanceled {
            #[serde(rename = "requestId")]
            request_id: String,
            result: InvitationCancellation,
        },
        InvitationAccepted {
            #[serde(rename = "requestId")]
            request_id: String,
            acceptance: PairingAcceptance,
        },
        PendingRequestAccepted {
            #[serde(rename = "requestId")]
            request_id: String,
            result: PendingRequestResult,
        },
        PairingConfirmed {
            #[serde(rename = "requestId")]
            request_id: String,
            confirmation: PairingConfirmation,
        },
        GrantSigned {
            #[serde(rename = "requestId")]
            request_id: String,
            result: GrantOperationResult,
        },
        GrantAccepted {
            #[serde(rename = "requestId")]
            request_id: String,
            result: GrantOperationResult,
        },
        GrantRevoked {
            #[serde(rename = "requestId")]
            request_id: String,
            result: GrantOperationResult,
        },
        DeviceUpdated {
            #[serde(rename = "requestId")]
            request_id: String,
            #[serde(rename = "result")]
            _result: MutationResult,
        },
        RelationshipRevoked {
            #[serde(rename = "requestId")]
            request_id: String,
            #[serde(rename = "result")]
            _result: MutationResult,
        },
        ResyncRequested {
            #[serde(rename = "requestId")]
            request_id: String,
            #[serde(rename = "result")]
            _result: ResyncResult,
        },
        QueryExecuted {
            #[serde(rename = "requestId")]
            request_id: String,
            result: QueryGatewayResult,
        },
        RevocationEventsListed {
            #[serde(rename = "requestId")]
            request_id: String,
            page: RevocationEventPage,
        },
        RevocationEventsAcknowledged {
            #[serde(rename = "requestId")]
            request_id: String,
            result: RevocationAckResult,
        },
        Rejected {
            #[serde(rename = "requestId")]
            request_id: String,
            code: IpcErrorCode,
            #[serde(rename = "detail")]
            _detail: String,
        },
    }

    impl Validate for DaemonTestResponse {
        fn validate(&self) -> Result<()> {
            let request_id = match self {
                Self::Health { request_id, .. }
                | Self::TransportReadiness { request_id, .. }
                | Self::LocalIdentity { request_id, .. }
                | Self::InvitationCreated { request_id, .. }
                | Self::InvitationCanceled { request_id, .. }
                | Self::InvitationAccepted { request_id, .. }
                | Self::PendingRequestAccepted { request_id, .. }
                | Self::PairingConfirmed { request_id, .. }
                | Self::GrantSigned { request_id, .. }
                | Self::GrantAccepted { request_id, .. }
                | Self::GrantRevoked { request_id, .. }
                | Self::DeviceUpdated { request_id, .. }
                | Self::RelationshipRevoked { request_id, .. }
                | Self::ResyncRequested { request_id, .. }
                | Self::QueryExecuted { request_id, .. }
                | Self::RevocationEventsListed { request_id, .. }
                | Self::RevocationEventsAcknowledged { request_id, .. }
                | Self::Rejected { request_id, .. } => request_id,
            };
            if request_id.is_empty() || request_id.len() > 64 {
                return Err(invalid("test IPC response has an invalid request id"));
            }
            Ok(())
        }
    }

    fn handler(owner: &str) -> Result<(tempfile::TempDir, Arc<DurableDaemonHandler>)> {
        let temporary = tempfile::tempdir()?;
        std::fs::set_permissions(temporary.path(), std::fs::Permissions::from_mode(0o700))?;
        let state_dir = std::fs::canonicalize(temporary.path())?.join("state");
        let identity = LocalIdentityState::generate(unix_time()?.saturating_sub(1), 86_400)?;
        let handler = DurableDaemonHandler::open(
            state_dir,
            identity,
            DaemonConfig {
                owner_user_id: owner.to_owned(),
                endpoints: vec![EndpointDescriptor::Direct(DirectEndpoint {
                    address: IpAddress::from(IpAddr::V4(Ipv4Addr::new(10, 20, 30, 40))),
                    port: 4242,
                })],
                allow_loopback_direct: false,
                command_authority: None,
            },
        )?;
        Ok((temporary, Arc::new(handler)))
    }

    fn valid_onion_host() -> String {
        const ALPHABET: &[u8; 32] = b"abcdefghijklmnopqrstuvwxyz234567";

        let public_key = SigningKey::from_bytes(&[42; 32]).verifying_key().to_bytes();
        let mut checksum_input = Vec::new();
        checksum_input.extend_from_slice(b".onion checksum");
        checksum_input.extend_from_slice(&public_key);
        checksum_input.push(3);
        let checksum = Sha3_256::digest(checksum_input);
        let mut service_id = Vec::from(public_key);
        service_id.extend_from_slice(&checksum[..2]);
        service_id.push(3);
        let mut encoded = String::new();
        let mut accumulator = 0_u16;
        let mut bits = 0_u8;
        for byte in service_id {
            accumulator = (accumulator << 8) | u16::from(byte);
            bits += 8;
            while bits >= 5 {
                bits -= 5;
                encoded.push(char::from(
                    ALPHABET[usize::from((accumulator >> bits) & 0x1f)],
                ));
                accumulator &= if bits == 0 { 0 } else { (1_u16 << bits) - 1 };
            }
        }
        format!("{encoded}.onion")
    }

    async fn socket_request(
        socket: &std::path::Path,
        request: &IpcRequest,
    ) -> Result<DaemonTestResponse> {
        let mut stream = UnixStream::connect(socket).await?;
        write_json_frame(&mut stream, request).await?;
        read_json_frame(&mut stream).await
    }

    fn grant(
        owner: &str,
        relationship_id: &str,
        id: &str,
        direction: ShareDirection,
        approved_device_id: &str,
        now: u64,
    ) -> Result<PeerShareGrantVersion> {
        let grant = PeerShareGrantVersion {
            id: id.into(),
            owner_user_id: owner.into(),
            relationship_id: relationship_id.into(),
            direction,
            sequence: 1,
            previous_version_hash: None,
            status: GrantStatus::Proposed,
            label: "Bounded profile grant".into(),
            purpose: "operational IPC test".into(),
            issued_at: format_timestamp(now)?,
            effective_at: Some(format_timestamp(now)?),
            expires_at: Some(format_timestamp(now.saturating_add(3_600))?),
            revoked_at: None,
            cache_policy: CachePolicy {
                mode: CacheMode::None,
                maximum_retention_seconds: 0,
                purge_on_revocation: true,
            },
            rules: vec![ShareRule {
                id: "profile_rule".into(),
                effect: RuleEffect::Allow,
                projection_id: GrantProjectionId::PersonProfileV1,
                entity_selector: None,
                fields: FieldPolicy {
                    include: vec!["displayName".into()],
                    exclude: Vec::new(),
                },
                time: TimePolicy {
                    starts_at: None,
                    ends_at: None,
                    rolling_past_days: None,
                    rolling_future_days: None,
                },
                precision: "exact".into(),
                aggregation: None,
                approved_device_ids: vec![approved_device_id.into()],
                device_policy: DevicePolicy::Explicit,
                maximum_result_count: 16,
                maximum_payload_bytes: 262_144,
            }],
            signatures: Vec::new(),
            protocol_version: PROTOCOL_NAME.into(),
            schema_version: 1,
        };
        grant.validate()?;
        Ok(grant)
    }

    #[test]
    #[allow(clippy::too_many_lines)]
    fn remote_to_local_query_enforces_directional_signature_roles() -> Result<()> {
        let now = unix_time()?;
        let (_source_temporary, source_handler) = handler("source_owner")?;
        let source = source_handler.identity.load_full();
        let requester = LocalIdentityState::generate(now.saturating_sub(1), 86_400)?;
        let relationship_id = "31".repeat(16);
        let requester_device_id = device_id(requester.certificate());
        let source_device_id = device_id(source.certificate());
        let mut active = grant(
            "remote_requester_owner",
            &relationship_id,
            "reverse_direction_grant",
            ShareDirection::RemoteToLocal,
            &requester_device_id,
            now,
        )?;
        active.signatures.push(sign_grant_consent(
            &active,
            GrantSignerMetadata {
                device_id: requester_device_id.clone(),
                party: GrantParty::Grantee,
                algorithm: GrantSignatureAlgorithm::Ed25519,
                signed_at: format_timestamp(now)?,
            },
            requester.device_signer(),
            requester.certificate(),
        )?);
        active.signatures.push(sign_grant_consent(
            &active,
            GrantSignerMetadata {
                device_id: source_device_id.clone(),
                party: GrantParty::Grantor,
                algorithm: GrantSignatureAlgorithm::Ed25519,
                signed_at: format_timestamp(now)?,
            },
            source.device_signer(),
            source.certificate(),
        )?);
        active.status = GrantStatus::Active;
        active.validate()?;
        let verified_hash = active.version_hash_hex()?;
        let verification_id = format!("fpv_{}", &verified_hash[..32]);
        let relationship = StoredRelationship {
            id: relationship_id.clone(),
            local_certificate: source.certificate().clone(),
            remote_certificate: requester.certificate().clone(),
            local_certificate_history: Vec::new(),
            remote_certificate_history: Vec::new(),
            status: RelationshipStatus::Active,
            privacy_mode: PrivacyMode::Fastest,
            verification_phrase_hash: [1; 32],
            local_endpoints: Vec::new(),
            remote_endpoints: Vec::new(),
            mailbox_secret: None,
            devices: vec![StoredDevice {
                external_device_id: requester_device_id.clone(),
                certificate: requester.certificate().clone(),
                status: StoredDeviceStatus::Approved,
            }],
            grants: vec![StoredGrant {
                grant: active.clone(),
                verification_id: Some(verification_id.clone()),
                verified_hash: Some(verified_hash.clone()),
            }],
            outbound_sequence: 0,
            revoked_reason: None,
        };
        validate_directional_grant_signatures(&active, &relationship, false)?;

        let query = ApiTypedQuery {
            projection_id: "person.profile.v1".into(),
            parameters: serde_json::Map::new(),
            interval: None,
            entity_ids: Vec::new(),
            fields: vec!["displayName".into()],
            precision: "exact".into(),
            maximum_result_count: 8,
        };
        let request = QueryRequestV2 {
            request: QueryRequest {
                query_id: QueryId([2; 16]),
                relationship_id: RelationshipId([0x31; 16]),
                grant_id: wire_grant_id(&active.id)?,
                grant_sequence: active.sequence,
                requested_at: now,
                expires_at: now.saturating_add(60),
                query: to_wire_query(&query)?,
            },
            requested_fields: wire_fields(&query.fields)?,
            maximum_result_count: query.maximum_result_count,
            maximum_payload_bytes: 4_096,
        };
        request.validate()?;
        let authorization = authorize_inbound_wire_query(
            "source_owner",
            &relationship,
            &request,
            source.certificate(),
            &[],
            now,
        )?;
        assert_eq!(authorization.grant_id, active.id);
        assert_eq!(
            authorization.effective_fields,
            vec![ProjectionField::DisplayName]
        );
        let unavailable = source_handler.unavailable_query_result(
            &ExecuteQueryInput {
                owner_user_id: "source_owner".into(),
                relationship_id: relationship_id.clone(),
                person_id: "local_person_id".into(),
                query: query.clone(),
                timeout_ms: 100,
            },
            &relationship,
            &active,
            &verification_id,
            &verified_hash,
            now,
        )?;
        assert_eq!(unavailable.state, QueryResultState::Unavailable);
        assert_eq!(unavailable.metadata.state, QueryResultState::Unavailable);
        assert!(unavailable.payload.records.is_empty());
        assert_eq!(unavailable.metadata.source.relationship_id, relationship_id);
        assert_eq!(
            unavailable.metadata.source.device_id,
            device_id(requester.certificate())
        );
        assert_eq!(unavailable.metadata.valid_until, None);
        assert!(unavailable.metadata.completeness.abs() < f64::EPSILON);

        let mut role_swapped = grant(
            "remote_requester_owner",
            &relationship_id,
            "role_swapped_grant",
            ShareDirection::RemoteToLocal,
            &requester_device_id,
            now,
        )?;
        role_swapped.signatures.push(sign_grant_consent(
            &role_swapped,
            GrantSignerMetadata {
                device_id: requester_device_id,
                party: GrantParty::Grantor,
                algorithm: GrantSignatureAlgorithm::Ed25519,
                signed_at: format_timestamp(now)?,
            },
            requester.device_signer(),
            requester.certificate(),
        )?);
        role_swapped.signatures.push(sign_grant_consent(
            &role_swapped,
            GrantSignerMetadata {
                device_id: source_device_id,
                party: GrantParty::Grantee,
                algorithm: GrantSignatureAlgorithm::Ed25519,
                signed_at: format_timestamp(now)?,
            },
            source.device_signer(),
            source.certificate(),
        )?);
        role_swapped.status = GrantStatus::Active;
        role_swapped.validate()?;
        let trust = grant_trust(
            &relationship,
            source.certificate(),
            &role_swapped,
            now,
            false,
        )?;
        verify_active_grant(&role_swapped, &trust, now)?;
        assert!(matches!(
            validate_directional_grant_signatures(&role_swapped, &relationship, false),
            Err(PeerError::Authorization(_))
        ));

        Ok(())
    }

    #[tokio::test]
    #[allow(clippy::too_many_lines)]
    async fn live_owner_socket_executes_every_gateway_operation_and_replays_commands() -> Result<()>
    {
        let owner = "owner_socket_contract";
        let (_inviter_temp, inviter) = handler(owner)?;
        let (accepter_temp, accepter) = handler(owner)?;
        let socket_temp = tempfile::tempdir()?;
        std::fs::set_permissions(socket_temp.path(), std::fs::Permissions::from_mode(0o700))?;
        let socket_root = std::fs::canonicalize(socket_temp.path())?;
        let inviter_socket = socket_root.join("inviter.sock");
        let accepter_socket = socket_root.join("accepter.sock");
        let inviter_server = OwnerIpcServer::bind(&inviter_socket, Arc::clone(&inviter))?;
        let accepter_server = OwnerIpcServer::bind(&accepter_socket, Arc::clone(&accepter))?;
        let (inviter_shutdown_tx, inviter_shutdown_rx) = tokio::sync::oneshot::channel();
        let (accepter_shutdown_tx, accepter_shutdown_rx) = tokio::sync::oneshot::channel();
        let inviter_task = tokio::spawn(inviter_server.serve_until(async {
            let _result = inviter_shutdown_rx.await;
        }));
        let accepter_task = tokio::spawn(accepter_server.serve_until(async {
            let _result = accepter_shutdown_rx.await;
        }));

        let health = socket_request(
            &accepter_socket,
            &IpcRequest::Health {
                request_id: "health_1".into(),
            },
        )
        .await?;
        assert!(matches!(
            health,
            DaemonTestResponse::Health {
                healthy: true,
                enabled: true,
                protocol_version,
                reason: None,
                provenance,
                ..
            } if protocol_version == PROTOCOL_NAME
                && provenance.owner_user_id == owner
        ));
        let readiness = socket_request(
            &accepter_socket,
            &IpcRequest::TransportReadiness {
                request_id: "transport_readiness_1".into(),
                input: LocalIdentityInput {
                    owner_user_id: owner.into(),
                },
            },
        )
        .await?;
        assert!(matches!(
            readiness,
            DaemonTestResponse::TransportReadiness {
                transports,
                provenance,
                ..
            } if provenance.owner_user_id == owner && !transports.is_empty()
        ));
        let local_identity = socket_request(
            &accepter_socket,
            &IpcRequest::LocalIdentity {
                request_id: "local_identity_1".into(),
                input: LocalIdentityInput {
                    owner_user_id: owner.into(),
                },
            },
        )
        .await?;
        assert!(matches!(
            local_identity,
            DaemonTestResponse::LocalIdentity { identity, .. }
                if identity.principal.id == principal_id(accepter.identity.load().certificate())
                    && identity.device.id == device_id(accepter.identity.load().certificate())
                    && decode_pairing_device_certificate(&identity.device).is_ok()
                    && identity.provenance.owner_user_id == owner
        ));

        let now = unix_time()?;
        let create = socket_request(
            &inviter_socket,
            &IpcRequest::CreateInvitation {
                request_id: "create_1".into(),
                command_id: "command-create-0001".into(),
                approval_deadline: test_approval_deadline()?,
                input: CreateInvitationInput {
                    owner_user_id: owner.into(),
                    label: "Peer A".into(),
                    expires_at: format_timestamp(now.saturating_add(600))?,
                    privacy_mode: PrivacyMode::Fastest,
                    transport_kinds: vec![TransportKind::LocalDirect],
                },
            },
        )
        .await?;
        let material = match create {
            DaemonTestResponse::InvitationCreated { material, .. } => material,
            other => return Err(invalid(format!("unexpected create response: {other:?}"))),
        };

        let cancellation_target = match socket_request(
            &inviter_socket,
            &IpcRequest::CreateInvitation {
                request_id: "create_cancel_target".into(),
                command_id: "command-create-cancel-target-0001".into(),
                approval_deadline: test_approval_deadline()?,
                input: CreateInvitationInput {
                    owner_user_id: owner.into(),
                    label: "Cancelable invitation".into(),
                    expires_at: format_timestamp(now.saturating_add(600))?,
                    privacy_mode: PrivacyMode::Fastest,
                    transport_kinds: vec![TransportKind::LocalDirect],
                },
            },
        )
        .await?
        {
            DaemonTestResponse::InvitationCreated { material, .. } => material.invitation.id,
            other => {
                return Err(invalid(format!(
                    "unexpected cancellation-target response: {other:?}"
                )));
            }
        };
        let cancel_input = CancelInvitationInput {
            owner_user_id: owner.into(),
            invitation_id: cancellation_target.clone(),
        };
        let canceled = socket_request(
            &inviter_socket,
            &IpcRequest::CancelInvitation {
                request_id: "cancel_invitation_1".into(),
                command_id: "command-cancel-invitation-0001".into(),
                approval_deadline: test_approval_deadline()?,
                input: cancel_input.clone(),
            },
        )
        .await?;
        assert!(matches!(
            canceled,
            DaemonTestResponse::InvitationCanceled { result, .. }
                if result.invitation_id == cancellation_target
                    && result.provenance.owner_user_id == owner
        ));
        let cancel_replay = socket_request(
            &inviter_socket,
            &IpcRequest::CancelInvitation {
                request_id: "cancel_invitation_retry".into(),
                command_id: "command-cancel-invitation-0001".into(),
                approval_deadline: test_approval_deadline()?,
                input: cancel_input,
            },
        )
        .await?;
        assert!(matches!(
            cancel_replay,
            DaemonTestResponse::InvitationCanceled { result, .. }
                if result.invitation_id == cancellation_target
        ));
        let cancel_conflict = socket_request(
            &inviter_socket,
            &IpcRequest::CancelInvitation {
                request_id: "cancel_invitation_conflict".into(),
                command_id: "command-cancel-invitation-0001".into(),
                approval_deadline: test_approval_deadline()?,
                input: CancelInvitationInput {
                    owner_user_id: owner.into(),
                    invitation_id: material.invitation.id.clone(),
                },
            },
        )
        .await?;
        assert!(matches!(
            cancel_conflict,
            DaemonTestResponse::Rejected {
                code: IpcErrorCode::Conflict,
                ..
            }
        ));

        let accept = socket_request(
            &accepter_socket,
            &IpcRequest::AcceptInvitation {
                request_id: "accept_invite_1".into(),
                command_id: "command-accept-invite-0001".into(),
                approval_deadline: test_approval_deadline()?,
                input: AcceptInvitationInput {
                    owner_user_id: owner.into(),
                    invitation: material.invitation,
                    local_device_id: device_id(accepter.identity.load().certificate()),
                    privacy_mode: PrivacyMode::Fastest,
                    scanned_at: format_timestamp(now)?,
                },
            },
        )
        .await?;
        let acceptance = match accept {
            DaemonTestResponse::InvitationAccepted { acceptance, .. } => acceptance,
            other => return Err(invalid(format!("unexpected accept response: {other:?}"))),
        };

        let pending_payload = serde_json::to_value(&acceptance.request_payload)
            .map_err(|error| invalid(format!("serializing pending payload: {error}")))?
            .as_object()
            .cloned()
            .ok_or_else(|| invalid("pairing payload did not serialize as an object"))?;
        let pending_request = ApiPendingRequest {
            id: acceptance.request_id.clone(),
            owner_user_id: owner.into(),
            relationship_id: None,
            kind: PendingRequestKind::Pairing,
            status: PendingRequestStatus::Pending,
            version: 1,
            payload_hash: pending_payload_hash(&pending_payload)?,
            payload: pending_payload,
            expires_at: acceptance.expires_at.clone(),
            decided_at: None,
            decision_reason: String::new(),
            created_at: format_timestamp(now)?,
            updated_at: format_timestamp(now)?,
        };
        let accept_pending_input = AcceptPendingRequestInput {
            owner_user_id: owner.into(),
            request: pending_request.clone(),
        };
        let pending_accepted = socket_request(
            &accepter_socket,
            &IpcRequest::AcceptPendingRequest {
                request_id: "accept_pending_1".into(),
                command_id: "command-accept-pending-0001".into(),
                approval_deadline: test_approval_deadline()?,
                input: accept_pending_input.clone(),
            },
        )
        .await?;
        assert!(matches!(
            pending_accepted,
            DaemonTestResponse::PendingRequestAccepted { result, .. }
                if result.request_id == acceptance.request_id
                    && result.kind == PendingRequestKind::Pairing
                    && result.provenance.remote_principal_id.is_some()
        ));
        let pending_replay = socket_request(
            &accepter_socket,
            &IpcRequest::AcceptPendingRequest {
                request_id: "accept_pending_retry".into(),
                command_id: "command-accept-pending-0001".into(),
                approval_deadline: test_approval_deadline()?,
                input: accept_pending_input,
            },
        )
        .await?;
        assert!(matches!(
            pending_replay,
            DaemonTestResponse::PendingRequestAccepted { result, .. }
                if result.request_id == acceptance.request_id
        ));
        let mut drifted_pending = pending_request;
        drifted_pending.decision_reason = "body drift".into();
        let pending_conflict = socket_request(
            &accepter_socket,
            &IpcRequest::AcceptPendingRequest {
                request_id: "accept_pending_conflict".into(),
                command_id: "command-accept-pending-0001".into(),
                approval_deadline: test_approval_deadline()?,
                input: AcceptPendingRequestInput {
                    owner_user_id: owner.into(),
                    request: drifted_pending,
                },
            },
        )
        .await?;
        assert!(matches!(
            pending_conflict,
            DaemonTestResponse::Rejected {
                code: IpcErrorCode::Conflict,
                ..
            }
        ));

        let confirm = socket_request(
            &accepter_socket,
            &IpcRequest::ConfirmPairing {
                request_id: "confirm_1".into(),
                command_id: "command-confirm-pairing-0001".into(),
                approval_deadline: test_approval_deadline()?,
                input: ConfirmPairingInput {
                    owner_user_id: owner.into(),
                    pairing_id: acceptance.request_id.clone(),
                    request_payload: acceptance.request_payload.clone(),
                    transcript_hash: acceptance.request_payload.transcript_hash.clone(),
                    verification_phrase: acceptance.request_payload.verification_phrase.clone(),
                },
            },
        )
        .await?;
        let confirmation = match confirm {
            DaemonTestResponse::PairingConfirmed { confirmation, .. } => confirmation,
            other => return Err(invalid(format!("unexpected confirm response: {other:?}"))),
        };
        assert!(confirmation.outbound_envelope.is_some());
        let relationship_id = confirmation.relationship.id;
        let remote_device_id = device_id(inviter.identity.load().certificate());

        let proposal = grant(
            owner,
            &relationship_id,
            "proposal_grant",
            ShareDirection::LocalToRemote,
            &remote_device_id,
            now,
        )?;
        let signed = socket_request(
            &accepter_socket,
            &IpcRequest::SignGrant {
                request_id: "sign_grant_1".into(),
                command_id: "command-sign-grant-0001".into(),
                approval_deadline: test_approval_deadline()?,
                input: SignGrantInput {
                    owner_user_id: owner.into(),
                    relationship_id: relationship_id.clone(),
                    grant: proposal,
                },
            },
        )
        .await?;
        assert!(matches!(
            signed,
            DaemonTestResponse::GrantSigned { result, .. }
                if result.grant.signatures.len() == 1
                    && result.provenance.relationship_id.as_deref() == Some(relationship_id.as_str())
        ));

        let mut active = grant(
            owner,
            &relationship_id,
            "active_grant",
            ShareDirection::RemoteToLocal,
            &device_id(accepter.identity.load().certificate()),
            now,
        )?;
        let remote_metadata = GrantSignerMetadata {
            device_id: remote_device_id.clone(),
            party: GrantParty::Grantor,
            algorithm: GrantSignatureAlgorithm::Ed25519,
            signed_at: format_timestamp(now)?,
        };
        let local_metadata = GrantSignerMetadata {
            device_id: device_id(accepter.identity.load().certificate()),
            party: GrantParty::Grantee,
            algorithm: GrantSignatureAlgorithm::Ed25519,
            signed_at: format_timestamp(now)?,
        };
        active.signatures.push(sign_grant_consent(
            &active,
            remote_metadata,
            inviter.identity.load().device_signer(),
            inviter.identity.load().certificate(),
        )?);
        active.signatures.push(sign_grant_consent(
            &active,
            local_metadata,
            accepter.identity.load().device_signer(),
            accepter.identity.load().certificate(),
        )?);
        active.status = GrantStatus::Active;
        active.validate()?;
        accepter.mutate(|state| {
            append_grant(
                active_relationship_mut(state, &relationship_id)?,
                active.clone(),
                None,
                None,
            )
        })?;
        let grant_accept_response = socket_request(
            &accepter_socket,
            &IpcRequest::AcceptGrant {
                request_id: "accept_grant_1".into(),
                command_id: "command-accept-grant-0001".into(),
                approval_deadline: test_approval_deadline()?,
                input: AcceptGrantInput {
                    owner_user_id: owner.into(),
                    grant: active,
                },
            },
        )
        .await?;
        let accepted_grant = match grant_accept_response {
            DaemonTestResponse::GrantAccepted { result, .. }
                if result.grant.status == GrantStatus::Active =>
            {
                result.grant
            }
            other => {
                return Err(invalid(format!(
                    "unexpected grant acceptance response: {other:?}"
                )));
            }
        };

        let query = ApiTypedQuery {
            projection_id: "person.profile.v1".into(),
            parameters: serde_json::Map::new(),
            interval: None,
            entity_ids: Vec::new(),
            fields: vec!["displayName".into()],
            precision: "exact".into(),
            maximum_result_count: 16,
        };
        accepter.store_authenticated_query_result(
            &relationship_id,
            &query,
            &ApiQueryPayload {
                records: vec![ApiQueryRecord {
                    record_id: "opaque_remote_profile".into(),
                    fields: serde_json::Map::from_iter([(
                        "displayName".into(),
                        serde_json::Value::String("Remote Person".into()),
                    )]),
                }],
            },
            now,
            Some(now.saturating_add(600)),
        )?;
        let queried = socket_request(
            &accepter_socket,
            &IpcRequest::ExecuteQuery {
                request_id: "query_1".into(),
                input: ExecuteQueryInput {
                    owner_user_id: owner.into(),
                    relationship_id: relationship_id.clone(),
                    person_id: "person_remote".into(),
                    query: query.clone(),
                    timeout_ms: 1_000,
                },
            },
        )
        .await?;
        assert!(matches!(
            queried,
            DaemonTestResponse::QueryExecuted { result, .. }
                if result.state == QueryResultState::Live
                    && result.payload.records.len() == 1
                    && result.metadata.source.device_id == remote_device_id
                    && result.metadata.grant_verification_id.starts_with("fpv_")
        ));

        let mut frameable_payload = ApiQueryPayload {
            records: Vec::new(),
        };
        let mut oversized_payload = None;
        for index in 0..16 {
            let mut candidate = frameable_payload.clone();
            candidate.records.push(ApiQueryRecord {
                record_id: format!("boundary_record_{index}"),
                fields: serde_json::Map::from_iter([(
                    "displayName".into(),
                    serde_json::Value::String("x".repeat(3_900)),
                )]),
            });
            let encoded = serde_json::to_vec(&candidate)
                .map_err(|error| invalid(format!("serializing boundary payload: {error}")))?;
            if encoded.len() > MAX_QUERY_JSON_BYTES {
                oversized_payload = Some(candidate);
                break;
            }
            frameable_payload = candidate;
        }
        let frameable_size = serde_json::to_vec(&frameable_payload)
            .map_err(|error| invalid(format!("serializing frameable payload: {error}")))?
            .len();
        assert!(frameable_size <= MAX_QUERY_JSON_BYTES);
        assert!(MAX_QUERY_JSON_BYTES - frameable_size < 4_096);
        accepter.store_authenticated_query_result(
            &relationship_id,
            &query,
            &frameable_payload,
            now,
            Some(now.saturating_add(600)),
        )?;
        let boundary_response = socket_request(
            &accepter_socket,
            &IpcRequest::ExecuteQuery {
                request_id: "r".repeat(64),
                input: ExecuteQueryInput {
                    owner_user_id: owner.into(),
                    relationship_id: relationship_id.clone(),
                    person_id: "person_remote".into(),
                    query: query.clone(),
                    timeout_ms: 1_000,
                },
            },
        )
        .await?;
        assert!(matches!(
            boundary_response,
            DaemonTestResponse::QueryExecuted { result, .. }
                if result.payload == frameable_payload
        ));
        let oversized_payload = oversized_payload
            .ok_or_else(|| invalid("boundary generator did not cross the query payload ceiling"))?;
        assert!(
            accepter
                .store_authenticated_query_result(
                    &relationship_id,
                    &query,
                    &oversized_payload,
                    now,
                    Some(now.saturating_add(600)),
                )
                .is_err()
        );

        let resync_input = RequestResyncInput {
            owner_user_id: owner.into(),
            relationship_id: relationship_id.clone(),
            projection_ids: vec!["person.profile.v1".into()],
        };
        let resync = socket_request(
            &accepter_socket,
            &IpcRequest::RequestResync {
                request_id: "resync_1".into(),
                command_id: "command-resync-0001".into(),
                approval_deadline: test_approval_deadline()?,
                input: resync_input.clone(),
            },
        )
        .await?;
        assert!(matches!(
            resync,
            DaemonTestResponse::Rejected {
                code: IpcErrorCode::Unavailable,
                ..
            }
        ));
        let replay = socket_request(
            &accepter_socket,
            &IpcRequest::RequestResync {
                request_id: "resync_retry".into(),
                command_id: "command-resync-0001".into(),
                approval_deadline: test_approval_deadline()?,
                input: resync_input.clone(),
            },
        )
        .await?;
        assert!(matches!(
            replay,
            DaemonTestResponse::Rejected {
                code: IpcErrorCode::Unavailable,
                ..
            }
        ));
        let changed_after_failure = socket_request(
            &accepter_socket,
            &IpcRequest::RequestResync {
                request_id: "resync_conflict".into(),
                command_id: "command-resync-0001".into(),
                approval_deadline: test_approval_deadline()?,
                input: RequestResyncInput {
                    projection_ids: vec!["goals.horizon_summary.v1".into()],
                    ..resync_input
                },
            },
        )
        .await?;
        assert!(matches!(
            changed_after_failure,
            DaemonTestResponse::Rejected {
                code: IpcErrorCode::Unavailable,
                ..
            }
        ));

        let updated = socket_request(
            &accepter_socket,
            &IpcRequest::UpdateDevice {
                request_id: "device_1".into(),
                command_id: "command-update-device-0001".into(),
                approval_deadline: test_approval_deadline()?,
                input: UpdateDeviceInput {
                    owner_user_id: owner.into(),
                    relationship_id: relationship_id.clone(),
                    device_id: remote_device_id,
                    action: DeviceAction::Approve,
                },
            },
        )
        .await?;
        assert!(matches!(updated, DaemonTestResponse::DeviceUpdated { .. }));

        let revocation_time = unix_time()?;
        let mut revoked_grant = accepted_grant.clone();
        revoked_grant.sequence = revoked_grant
            .sequence
            .checked_add(1)
            .ok_or_else(|| PeerError::StateConflict("test grant sequence overflow".into()))?;
        revoked_grant.previous_version_hash = Some(accepted_grant.version_hash_hex()?);
        revoked_grant.status = GrantStatus::Revoked;
        revoked_grant.issued_at = format_timestamp(revocation_time)?;
        revoked_grant.revoked_at = Some(format_timestamp(revocation_time)?);
        revoked_grant.signatures.clear();
        revoked_grant.validate()?;
        let revoke_grant_input = RevokeGrantInput {
            owner_user_id: owner.into(),
            grant: revoked_grant,
            reason: "owner withdrew local consent".into(),
        };
        let grant_revoked = socket_request(
            &accepter_socket,
            &IpcRequest::RevokeGrant {
                request_id: "revoke_grant_1".into(),
                command_id: "command-revoke-grant-0001".into(),
                approval_deadline: test_approval_deadline()?,
                input: revoke_grant_input.clone(),
            },
        )
        .await?;
        let signed_revocation = match grant_revoked {
            DaemonTestResponse::GrantRevoked { result, .. }
                if result.grant.status == GrantStatus::Revoked
                    && result.grant.signatures.len() == 1 =>
            {
                result.grant
            }
            other => {
                return Err(invalid(format!(
                    "unexpected grant revocation response: {other:?}"
                )));
            }
        };
        let grant_revoke_replay = socket_request(
            &accepter_socket,
            &IpcRequest::RevokeGrant {
                request_id: "revoke_grant_retry".into(),
                command_id: "command-revoke-grant-0001".into(),
                approval_deadline: test_approval_deadline()?,
                input: revoke_grant_input.clone(),
            },
        )
        .await?;
        assert!(matches!(
            grant_revoke_replay,
            DaemonTestResponse::GrantRevoked { result, .. }
                if result.grant == signed_revocation
        ));
        let revocation_page = socket_request(
            &accepter_socket,
            &IpcRequest::ListRevocationEvents {
                request_id: "list_revocations_1".into(),
                input: ListRevocationEventsInput {
                    owner_user_id: owner.into(),
                    consumer_id: "node-revocation-worker".into(),
                    after_cursor: "0".into(),
                    limit: 16,
                },
            },
        )
        .await?;
        let first_revocation_hash = match revocation_page {
            DaemonTestResponse::RevocationEventsListed { page, .. }
                if page.events.len() == 1
                    && page.events[0].cursor == "1"
                    && page.events[0].previous_event_hash == "0".repeat(64)
                    && page.events[0].kind == RevocationEventKind::Grant
                    && page.events[0].grant_id.as_deref()
                        == Some(signed_revocation.id.as_str())
                    && page.acknowledged_cursor == "0"
                    && page.next_cursor == "1"
                    && !page.has_more =>
            {
                page.events[0].event_hash.clone()
            }
            other => {
                return Err(invalid(format!(
                    "unexpected revocation event page: {other:?}"
                )));
            }
        };
        let bad_revocation_ack = socket_request(
            &accepter_socket,
            &IpcRequest::AckRevocationEvents {
                request_id: "ack_revocations_bad_hash".into(),
                command_id: "command-ack-revocations-bad-0001".into(),
                approval_deadline: test_approval_deadline()?,
                input: AckRevocationEventsInput {
                    owner_user_id: owner.into(),
                    consumer_id: "node-revocation-worker".into(),
                    through_cursor: "1".into(),
                    event_hash: "f".repeat(64),
                },
            },
        )
        .await?;
        assert!(matches!(
            bad_revocation_ack,
            DaemonTestResponse::Rejected {
                code: IpcErrorCode::AuthenticationFailed,
                ..
            }
        ));
        let revocation_ack_input = AckRevocationEventsInput {
            owner_user_id: owner.into(),
            consumer_id: "node-revocation-worker".into(),
            through_cursor: "1".into(),
            event_hash: first_revocation_hash.clone(),
        };
        let revocation_ack = socket_request(
            &accepter_socket,
            &IpcRequest::AckRevocationEvents {
                request_id: "ack_revocations_1".into(),
                command_id: "command-ack-revocations-0001".into(),
                approval_deadline: test_approval_deadline()?,
                input: revocation_ack_input.clone(),
            },
        )
        .await?;
        let first_acknowledged_at = match revocation_ack {
            DaemonTestResponse::RevocationEventsAcknowledged { result, .. }
                if result.acknowledged_cursor == "1"
                    && result.event_hash == first_revocation_hash =>
            {
                result.acknowledged_at
            }
            other => {
                return Err(invalid(format!(
                    "unexpected revocation acknowledgement: {other:?}"
                )));
            }
        };
        let duplicate_revocation_ack = socket_request(
            &accepter_socket,
            &IpcRequest::AckRevocationEvents {
                request_id: "ack_revocations_duplicate".into(),
                command_id: "command-ack-revocations-duplicate-0001".into(),
                approval_deadline: test_approval_deadline()?,
                input: revocation_ack_input,
            },
        )
        .await?;
        assert!(matches!(
            duplicate_revocation_ack,
            DaemonTestResponse::RevocationEventsAcknowledged { result, .. }
                if result.acknowledged_at == first_acknowledged_at
                    && result.acknowledged_cursor == "1"
        ));
        let grant_revoke_conflict = socket_request(
            &accepter_socket,
            &IpcRequest::RevokeGrant {
                request_id: "revoke_grant_conflict".into(),
                command_id: "command-revoke-grant-0001".into(),
                approval_deadline: test_approval_deadline()?,
                input: RevokeGrantInput {
                    reason: "changed reason".into(),
                    ..revoke_grant_input
                },
            },
        )
        .await?;
        assert!(matches!(
            grant_revoke_conflict,
            DaemonTestResponse::Rejected {
                code: IpcErrorCode::Conflict,
                ..
            }
        ));
        let query_after_revocation = socket_request(
            &accepter_socket,
            &IpcRequest::ExecuteQuery {
                request_id: "query_after_revoke".into(),
                input: ExecuteQueryInput {
                    owner_user_id: owner.into(),
                    relationship_id: relationship_id.clone(),
                    person_id: "person_remote".into(),
                    query,
                    timeout_ms: 1_000,
                },
            },
        )
        .await?;
        assert!(matches!(
            query_after_revocation,
            DaemonTestResponse::Rejected {
                code: IpcErrorCode::AuthorizationFailed,
                ..
            }
        ));

        let wrong_owner = socket_request(
            &accepter_socket,
            &IpcRequest::RevokeRelationship {
                request_id: "wrong_owner_1".into(),
                command_id: "command-wrong-owner-0001".into(),
                approval_deadline: test_approval_deadline()?,
                input: RevokeRelationshipInput {
                    owner_user_id: "attacker_owner".into(),
                    relationship_id: relationship_id.clone(),
                    reason: "attempt".into(),
                },
            },
        )
        .await?;
        assert!(matches!(
            wrong_owner,
            DaemonTestResponse::Rejected {
                code: IpcErrorCode::AuthorizationFailed,
                ..
            }
        ));

        let revoked = socket_request(
            &accepter_socket,
            &IpcRequest::RevokeRelationship {
                request_id: "revoke_1".into(),
                command_id: "command-revoke-relationship-0001".into(),
                approval_deadline: test_approval_deadline()?,
                input: RevokeRelationshipInput {
                    owner_user_id: owner.into(),
                    relationship_id,
                    reason: "user requested local revocation".into(),
                },
            },
        )
        .await?;
        assert!(matches!(
            revoked,
            DaemonTestResponse::RelationshipRevoked { .. }
        ));
        let revocation_page = socket_request(
            &accepter_socket,
            &IpcRequest::ListRevocationEvents {
                request_id: "list_revocations_2".into(),
                input: ListRevocationEventsInput {
                    owner_user_id: owner.into(),
                    consumer_id: "node-revocation-worker".into(),
                    after_cursor: "1".into(),
                    limit: 16,
                },
            },
        )
        .await?;
        let second_revocation_hash = match revocation_page {
            DaemonTestResponse::RevocationEventsListed { page, .. }
                if page.events.len() == 1
                    && page.events[0].cursor == "2"
                    && page.events[0].previous_event_hash == first_revocation_hash
                    && page.events[0].kind == RevocationEventKind::Relationship
                    && page.acknowledged_cursor == "1"
                    && page.next_cursor == "2"
                    && !page.has_more =>
            {
                page.events[0].event_hash.clone()
            }
            other => {
                return Err(invalid(format!(
                    "unexpected second revocation event page: {other:?}"
                )));
            }
        };
        let second_ack = socket_request(
            &accepter_socket,
            &IpcRequest::AckRevocationEvents {
                request_id: "ack_revocations_2".into(),
                command_id: "command-ack-revocations-0002".into(),
                approval_deadline: test_approval_deadline()?,
                input: AckRevocationEventsInput {
                    owner_user_id: owner.into(),
                    consumer_id: "node-revocation-worker".into(),
                    through_cursor: "2".into(),
                    event_hash: second_revocation_hash,
                },
            },
        )
        .await?;
        assert!(matches!(
            second_ack,
            DaemonTestResponse::RevocationEventsAcknowledged { result, .. }
                if result.acknowledged_cursor == "2"
        ));
        let rollback_ack = socket_request(
            &accepter_socket,
            &IpcRequest::AckRevocationEvents {
                request_id: "ack_revocations_rollback".into(),
                command_id: "command-ack-revocations-rollback-0001".into(),
                approval_deadline: test_approval_deadline()?,
                input: AckRevocationEventsInput {
                    owner_user_id: owner.into(),
                    consumer_id: "node-revocation-worker".into(),
                    through_cursor: "1".into(),
                    event_hash: first_revocation_hash,
                },
            },
        )
        .await?;
        assert!(matches!(rollback_ack, DaemonTestResponse::Rejected { .. }));

        let accepter_identity =
            LocalIdentityState::decode_secret(&accepter.identity.load().encode_secret()?)?;

        inviter_shutdown_tx
            .send(())
            .map_err(|()| PeerError::StateConflict("inviter server stopped early".into()))?;
        accepter_shutdown_tx
            .send(())
            .map_err(|()| PeerError::StateConflict("accepter server stopped early".into()))?;
        inviter_task
            .await
            .map_err(|error| PeerError::StateConflict(format!("inviter task failed: {error}")))??;
        accepter_task.await.map_err(|error| {
            PeerError::StateConflict(format!("accepter task failed: {error}"))
        })??;
        drop(accepter);
        let reopened = Arc::new(DurableDaemonHandler::open(
            std::fs::canonicalize(accepter_temp.path())?.join("state"),
            accepter_identity,
            DaemonConfig {
                owner_user_id: owner.into(),
                endpoints: vec![EndpointDescriptor::Direct(DirectEndpoint {
                    address: IpAddress::from(IpAddr::V4(Ipv4Addr::new(10, 20, 30, 40))),
                    port: 4242,
                })],
                allow_loopback_direct: false,
                command_authority: None,
            },
        )?);
        let reopened_server = OwnerIpcServer::bind(&accepter_socket, reopened)?;
        let reopened_list_request = IpcRequest::ListRevocationEvents {
            request_id: "list_revocations_after_restart".into(),
            input: ListRevocationEventsInput {
                owner_user_id: owner.into(),
                consumer_id: "node-revocation-worker".into(),
                after_cursor: "0".into(),
                limit: 16,
            },
        };
        let reopened_request = socket_request(&accepter_socket, &reopened_list_request);
        let (serve_result, reopened_page) =
            tokio::join!(reopened_server.serve_once(), reopened_request);
        serve_result?;
        assert!(matches!(
            reopened_page?,
            DaemonTestResponse::RevocationEventsListed { page, .. }
                if page.events.len() == 2
                    && page.acknowledged_cursor == "2"
                    && page.next_cursor == "2"
        ));
        reopened_server.close()?;
        Ok(())
    }

    #[test]
    fn typed_query_payload_is_records_with_record_id_and_fields() -> Result<()> {
        let payload = ApiQueryPayload {
            records: vec![ApiQueryRecord {
                record_id: "opaque_record".into(),
                fields: serde_json::Map::from_iter([(
                    "displayName".into(),
                    serde_json::Value::String("Remote".into()),
                )]),
            }],
        };
        validate_query_payload(&payload)?;
        let value = serde_json::to_value(payload)
            .map_err(|error| invalid(format!("serializing test payload: {error}")))?;
        assert_eq!(value["records"][0]["recordId"], "opaque_record");
        assert_eq!(value["records"][0]["fields"]["displayName"], "Remote");
        assert!(value["records"][0].get("payload").is_none());
        Ok(())
    }

    #[test]
    fn revocation_events_are_signed_hash_chained_and_strictly_typed() -> Result<()> {
        let now = unix_time()?;
        let identity = LocalIdentityState::generate(now.saturating_sub(1), 86_400)?;
        let first_body = RevocationEventBody {
            cursor: 1,
            previous_event_hash: [0; 32],
            kind: RevocationEventKind::Grant,
            source: RevocationEventSource::LocalOperator,
            relationship_id: "11".repeat(16),
            grant_id: Some("grant_signed_event".into()),
            device_id: None,
            target_certificate: None,
            reason: "local consent withdrawn".into(),
            occurred_at: now,
            authenticated_remote_principal_id: None,
            authenticated_remote_device_id: None,
        };
        let first = StoredRevocationEvent {
            signature: identity
                .device_signer()
                .sign(REVOCATION_EVENT_SIGNATURE_DOMAIN, &first_body)?,
            signing_certificate: identity.certificate().clone(),
            body: first_body,
        };
        first.validate()?;
        let first_hash = revocation_event_hash(&first)?;
        assert_ne!(first_hash, [0; 32]);

        let mut tampered = first.clone();
        tampered.body.reason = "tampered reason".into();
        assert!(tampered.validate().is_err());

        let second_body = RevocationEventBody {
            cursor: 2,
            previous_event_hash: first_hash,
            kind: RevocationEventKind::CredentialRetirement,
            source: RevocationEventSource::CertifiedRotation,
            relationship_id: "11".repeat(16),
            grant_id: None,
            device_id: Some(device_id(identity.certificate())),
            target_certificate: Some(identity.certificate().clone()),
            reason: "certified successor acknowledged".into(),
            occurred_at: now,
            authenticated_remote_principal_id: None,
            authenticated_remote_device_id: None,
        };
        let second = StoredRevocationEvent {
            signature: identity
                .device_signer()
                .sign(REVOCATION_EVENT_SIGNATURE_DOMAIN, &second_body)?,
            signing_certificate: identity.certificate().clone(),
            body: second_body,
        };
        second.validate()?;
        let view = revocation_event_view(&second)?;
        assert_eq!(view.previous_event_hash, hex::encode(first_hash));
        assert_eq!(
            view.target_certificate_serial.as_deref(),
            Some(identity.certificate().body.serial.to_string().as_str())
        );
        let mut unknown_field = serde_json::to_value(&view)
            .map_err(|error| invalid(format!("serializing revocation event test: {error}")))?;
        unknown_field
            .as_object_mut()
            .ok_or_else(|| invalid("revocation event test view is not an object"))?
            .insert("callerAssertedTrust".into(), serde_json::Value::Bool(true));
        assert!(serde_json::from_value::<RevocationEventView>(unknown_field).is_err());
        Ok(())
    }

    #[test]
    fn typed_query_request_and_response_limits_are_independent() -> Result<()> {
        let mut query = ApiTypedQuery {
            projection_id: "person.profile.v1".into(),
            parameters: serde_json::Map::new(),
            interval: None,
            entity_ids: Vec::new(),
            fields: vec!["displayName".into()],
            precision: "exact".into(),
            maximum_result_count: 1_000,
        };
        query.validate()?;
        query.maximum_result_count = 1_001;
        assert!(query.validate().is_err());

        let payload = ApiQueryPayload {
            records: (0..=MAX_QUERY_RECORDS)
                .map(|index| ApiQueryRecord {
                    record_id: format!("record_{index}"),
                    fields: serde_json::Map::new(),
                })
                .collect(),
        };
        assert!(validate_query_payload(&payload).is_err());
        Ok(())
    }

    #[test]
    fn api_transport_endpoint_union_has_exact_fields_and_canonical_order() -> Result<()> {
        let endpoints = canonicalize_endpoints(vec![
            EndpointDescriptor::HttpMailbox(MailboxEndpointDescriptor {
                origin: BoundedString::new("https://mail.example")?,
                opaque_channel: [9; 32],
            }),
            EndpointDescriptor::Tor(TorEndpoint {
                onion_host: BoundedString::new(valid_onion_host())?,
                port: 443,
            }),
            EndpointDescriptor::Iroh(IrohEndpointDescriptor {
                endpoint_id: [7; 32],
                relay_origin: None,
            }),
            EndpointDescriptor::Direct(DirectEndpoint {
                address: IpAddress::from(IpAddr::V4(Ipv4Addr::new(10, 20, 30, 40))),
                port: 4242,
            }),
        ])?;
        let views = endpoints.iter().map(endpoint_view).collect::<Vec<_>>();
        for view in &views {
            view.validate()?;
        }
        let json = serde_json::to_value(&views)
            .map_err(|error| invalid(format!("serializing endpoint union: {error}")))?;
        assert_eq!(
            json[0],
            serde_json::json!({
                "kind": "local_direct",
                "host": "10.20.30.40",
                "port": 4242
            })
        );
        assert_eq!(
            json[1],
            serde_json::json!({
                "kind": "iroh",
                "endpointId": URL_SAFE_NO_PAD.encode([7; 32]),
                "relayOrigin": null
            })
        );
        assert_eq!(json[2]["kind"], "tor_onion");
        assert_eq!(json[2]["onionHost"], valid_onion_host());
        assert_eq!(json[2]["port"], 443);
        assert_eq!(
            json[3],
            serde_json::json!({
                "kind": "http_mailbox",
                "origin": "https://mail.example",
                "opaqueChannel": URL_SAFE_NO_PAD.encode([9; 32])
            })
        );

        let mut too_many = Vec::new();
        for index in 1..=9 {
            too_many.push(EndpointDescriptor::Direct(DirectEndpoint {
                address: IpAddress::from(IpAddr::V4(Ipv4Addr::new(10, 20, 30, index))),
                port: 4242,
            }));
        }
        assert!(canonicalize_endpoints(too_many).is_err());
        Ok(())
    }

    #[test]
    #[allow(clippy::too_many_lines)]
    fn pairing_identity_views_have_stable_strict_json_schemas() -> Result<()> {
        let identity = LocalIdentityState::generate(unix_time()?.saturating_sub(1), 86_400)?;
        let endpoints = canonicalize_endpoints(vec![
            EndpointDescriptor::Iroh(IrohEndpointDescriptor {
                endpoint_id: [7; 32],
                relay_origin: Some(BoundedString::new("https://relay.example")?),
            }),
            EndpointDescriptor::Direct(DirectEndpoint {
                address: IpAddress::from(IpAddr::V4(Ipv4Addr::new(10, 20, 30, 40))),
                port: 4242,
            }),
        ])?;
        let principal = principal_view(identity.certificate())?;
        let device = device_view(identity.certificate(), &endpoints)?;
        let remote_identity = LocalIdentityState::generate(unix_time()?.saturating_sub(1), 86_400)?;
        let remote_principal = principal_view(remote_identity.certificate())?;
        let remote_device = device_view(remote_identity.certificate(), &endpoints)?;
        let principal_json = serde_json::to_value(&principal)
            .map_err(|error| invalid(format!("serializing principal view: {error}")))?;
        let device_json = serde_json::to_value(&device)
            .map_err(|error| invalid(format!("serializing device view: {error}")))?;
        let principal_keys = principal_json
            .as_object()
            .ok_or_else(|| invalid("principal view is not an object"))?
            .keys()
            .map(String::as_str)
            .collect::<BTreeSet<_>>();
        let device_keys = device_json
            .as_object()
            .ok_or_else(|| invalid("device view is not an object"))?
            .keys()
            .map(String::as_str)
            .collect::<BTreeSet<_>>();
        assert_eq!(
            principal_keys,
            BTreeSet::from(["certificateHash", "id", "rootPublicKey", "trustState"])
        );
        assert_eq!(
            device_keys,
            BTreeSet::from([
                "capabilities",
                "certificate",
                "certificateHash",
                "certificateSerial",
                "id",
                "keyAgreementPublicKey",
                "principalId",
                "signingPublicKey",
                "status",
                "transportEndpoints",
            ])
        );
        assert_eq!(
            device_json["certificateSerial"],
            serde_json::Value::String(identity.certificate().body.serial.to_string())
        );
        assert_eq!(device_json["transportEndpoints"][0]["kind"], "local_direct");
        assert_eq!(device_json["transportEndpoints"][0]["host"], "10.20.30.40");
        assert_eq!(device_json["transportEndpoints"][1]["kind"], "iroh");
        let decoded = decode_pairing_device_certificate(&device)?;
        assert_eq!(&decoded, identity.certificate());
        let relationship = PairingRelationship {
            id: "01".repeat(16),
            local_principal: principal.clone(),
            remote_principal,
            local_device: device.clone(),
            remote_device,
            negotiated_protocol_version: PROTOCOL_NAME.into(),
            verification_phrase_hash: "02".repeat(32),
            privacy_mode: PrivacyMode::Fastest,
        };
        relationship.validate()?;
        let mut principal_tampered = relationship.clone();
        principal_tampered.remote_principal.root_public_key = URL_SAFE_NO_PAD.encode([99; 32]);
        assert!(principal_tampered.validate().is_err());
        assert_eq!(
            device.certificate_hash,
            hex::encode(
                blake3::hash(&decode_base64(
                    &device.certificate,
                    24 * 1024,
                    "test certificate"
                )?)
                .as_bytes()
            )
        );
        let mut hash_tampered = device.clone();
        hash_tampered.certificate_hash = "0".repeat(64);
        assert!(decode_pairing_device_certificate(&hash_tampered).is_err());
        let mut certificate_tampered = device.clone();
        let replacement = if certificate_tampered.certificate.ends_with('A') {
            'B'
        } else {
            'A'
        };
        certificate_tampered.certificate.pop();
        certificate_tampered.certificate.push(replacement);
        assert!(decode_pairing_device_certificate(&certificate_tampered).is_err());
        let mut serial_with_leading_zero = device.clone();
        serial_with_leading_zero.certificate_serial = format!("0{}", device.certificate_serial);
        assert!(serial_with_leading_zero.validate().is_err());
        let mut serial_overflow = device.clone();
        serial_overflow.certificate_serial = "18446744073709551616".into();
        assert!(serial_overflow.validate().is_err());
        let mut numeric_serial = device_json.clone();
        numeric_serial["certificateSerial"] = serde_json::json!(1);
        assert!(serde_json::from_value::<PairingDevice>(numeric_serial).is_err());
        let mut duplicate_endpoints = device.clone();
        duplicate_endpoints
            .transport_endpoints
            .push(duplicate_endpoints.transport_endpoints[0].clone());
        assert!(duplicate_endpoints.validate().is_err());
        let mut reversed_endpoints = device.clone();
        reversed_endpoints.transport_endpoints.reverse();
        assert!(reversed_endpoints.validate().is_err());
        let mut malformed_endpoint = device.clone();
        malformed_endpoint.transport_endpoints[1] = ApiTransportEndpoint::Iroh {
            endpoint_id: "not-base64url32".into(),
            relay_origin: None,
        };
        assert!(malformed_endpoint.validate().is_err());
        let mut endpoint_with_unknown = device_json["transportEndpoints"][0].clone();
        endpoint_with_unknown
            .as_object_mut()
            .ok_or_else(|| invalid("transport endpoint is not mutable"))?
            .insert(
                "token".into(),
                serde_json::Value::String("forbidden".into()),
            );
        assert!(serde_json::from_value::<ApiTransportEndpoint>(endpoint_with_unknown).is_err());
        let mut principal_with_unknown = principal_json;
        principal_with_unknown
            .as_object_mut()
            .ok_or_else(|| invalid("principal view is not mutable"))?
            .insert("callerTrust".into(), serde_json::Value::Bool(true));
        assert!(serde_json::from_value::<PairingPrincipal>(principal_with_unknown).is_err());
        let mut device_with_unknown = device_json;
        device_with_unknown
            .as_object_mut()
            .ok_or_else(|| invalid("device view is not mutable"))?
            .insert("bearerToken".into(), serde_json::Value::String("no".into()));
        assert!(serde_json::from_value::<PairingDevice>(device_with_unknown).is_err());
        let mut uppercase_relationship = relationship;
        uppercase_relationship.id = "AB".repeat(16);
        assert!(uppercase_relationship.validate().is_err());
        Ok(())
    }

    #[test]
    fn grant_sequence_must_be_javascript_safe() -> Result<()> {
        let now = unix_time()?;
        let identity = LocalIdentityState::generate(now.saturating_sub(1), 86_400)?;
        let mut grant = grant(
            "owner",
            &"01".repeat(16),
            "grant_safe_integer",
            ShareDirection::LocalToRemote,
            &device_id(identity.certificate()),
            now,
        )?;
        grant.sequence = 9_007_199_254_740_992;
        grant.previous_version_hash = Some("02".repeat(32));
        assert!(grant.validate().is_err());
        Ok(())
    }

    #[test]
    fn certificate_serial_above_javascript_safe_integer_is_a_decimal_json_string() -> Result<()> {
        let now = unix_time()?;
        let root = crate::identity::PrincipalRootSigner::generate();
        let signer = DeviceSigner::generate(crate::identity::DeviceId::random());
        let certificate = DeviceCertificate::issue(
            &root,
            &signer,
            DeviceCapabilities::all_known(),
            ProtocolRange::CURRENT,
            9_007_199_254_740_993,
            now.saturating_sub(1),
            now.saturating_add(86_400),
        )?;
        let device = device_view(
            &certificate,
            &[EndpointDescriptor::Direct(DirectEndpoint {
                address: IpAddress::from(IpAddr::V4(Ipv4Addr::new(10, 20, 30, 40))),
                port: 4242,
            })],
        )?;
        let json = serde_json::to_value(&device)
            .map_err(|error| invalid(format!("serializing high-serial device: {error}")))?;
        assert_eq!(
            json["certificateSerial"],
            serde_json::Value::String("9007199254740993".into())
        );
        assert_eq!(decode_pairing_device_certificate(&device)?, certificate);
        Ok(())
    }

    #[test]
    fn legacy_encrypted_state_migrates_without_discarding_collections() -> Result<()> {
        let identity = LocalIdentityState::generate(unix_time()?.saturating_sub(1), 86_400)?;
        let state_key = identity.derive_storage_key("durable daemon state")?;
        let legacy = LegacyDurableDaemonState {
            version: LEGACY_DAEMON_STATE_VERSION,
            owner_user_id: "legacy_owner".into(),
            high_water_unix_time: unix_time()?,
            invitations: Vec::new(),
            pairings: Vec::new(),
            relationships: Vec::new(),
            query_results: Vec::new(),
            command_receipts: vec![CommandReceipt {
                command_id: "legacy-command-0001".into(),
                operation: "create_invitation".into(),
                request_hash: [7; 32],
                response_json: br#"{"legacy":true}"#.to_vec(),
            }],
        };
        let plaintext = encode_limited::<DAEMON_STATE_LIMIT, _>(&legacy)?;
        let nonce = nonzero_random_24();
        let aad = state_aad(identity.certificate(), LEGACY_DAEMON_STATE_MAGIC);
        let ciphertext = XChaCha20Poly1305::new(state_key.as_ref().into())
            .encrypt(
                XNonce::from_slice(&nonce),
                Payload {
                    msg: &plaintext,
                    aad: &aad,
                },
            )
            .map_err(|_| PeerError::Authentication("sealing legacy test state failed".into()))?;
        let mut sealed = LEGACY_DAEMON_STATE_MAGIC.to_vec();
        sealed.extend_from_slice(&nonce);
        sealed.extend_from_slice(&ciphertext);
        let migrated = open_state(&state_key, identity.certificate(), &sealed)?;
        assert_eq!(migrated.version, DAEMON_STATE_VERSION);
        assert_eq!(migrated.owner_user_id, "legacy_owner");
        assert_eq!(migrated.command_receipts.len(), 1);
        assert!(migrated.accepted_pending_requests.is_empty());
        assert!(migrated.grant_revocations.is_empty());
        Ok(())
    }

    #[test]
    fn pre_mailbox_state_preserves_endpoints_without_inventing_channel_authority() -> Result<()> {
        let now = unix_time()?;
        let identity = LocalIdentityState::generate(now.saturating_sub(1), 86_400)?;
        let remote = LocalIdentityState::generate(now.saturating_sub(1), 86_400)?;
        let local_endpoint = EndpointDescriptor::HttpMailbox(MailboxEndpointDescriptor {
            origin: BoundedString::new("https://mailbox.example")?,
            opaque_channel: [11; 32],
        });
        let remote_endpoint = EndpointDescriptor::HttpMailbox(MailboxEndpointDescriptor {
            origin: BoundedString::new("https://mailbox.example")?,
            opaque_channel: [12; 32],
        });
        let previous = PreMailboxDaemonState {
            version: PRE_MAILBOX_DAEMON_STATE_VERSION,
            owner_user_id: "pre_mailbox_owner".into(),
            high_water_unix_time: now,
            invitations: Vec::new(),
            pairings: Vec::new(),
            relationships: vec![PreMailboxStoredRelationship {
                id: "04".repeat(16),
                local_certificate: identity.certificate().clone(),
                remote_certificate: remote.certificate().clone(),
                status: RelationshipStatus::Active,
                privacy_mode: PrivacyMode::Fastest,
                verification_phrase_hash: [5; 32],
                local_endpoints: vec![local_endpoint.clone()],
                remote_endpoints: vec![remote_endpoint.clone()],
                devices: vec![StoredDevice {
                    external_device_id: device_id(remote.certificate()),
                    certificate: remote.certificate().clone(),
                    status: StoredDeviceStatus::Approved,
                }],
                grants: Vec::new(),
                outbound_sequence: 0,
                revoked_reason: None,
            }],
            query_results: Vec::new(),
            accepted_pending_requests: Vec::new(),
            grant_revocations: Vec::new(),
            mls_states: Vec::new(),
            mls_checkpoints: Vec::new(),
            pending_mls_clients: Vec::new(),
            mls_relationships: Vec::new(),
            transport_outbox: Vec::new(),
            pending_applications: Vec::new(),
            inbound_receipts: Vec::new(),
            query_exchanges: Vec::new(),
            inbound_queries: Vec::new(),
            projection_deltas: Vec::new(),
            revocation_events: Vec::new(),
            revocation_consumers: Vec::new(),
            host_credential_rotation: None,
            command_receipts: Vec::new(),
        };
        previous.validate()?;
        let state_key = identity.derive_storage_key("durable daemon state")?;
        let plaintext = encode_limited::<DAEMON_STATE_LIMIT, _>(&previous)?;
        let nonce = nonzero_random_24();
        let aad = state_aad(identity.certificate(), PRE_MAILBOX_DAEMON_STATE_MAGIC);
        let ciphertext = XChaCha20Poly1305::new(state_key.as_ref().into())
            .encrypt(
                XNonce::from_slice(&nonce),
                Payload {
                    msg: &plaintext,
                    aad: &aad,
                },
            )
            .map_err(|_| {
                PeerError::Authentication("sealing pre-mailbox test state failed".into())
            })?;
        let mut sealed = PRE_MAILBOX_DAEMON_STATE_MAGIC.to_vec();
        sealed.extend_from_slice(&nonce);
        sealed.extend_from_slice(&ciphertext);

        let migrated = open_state(&state_key, identity.certificate(), &sealed)?;
        assert_eq!(migrated.version, DAEMON_STATE_VERSION);
        let relationship = &migrated.relationships[0];
        assert_eq!(relationship.local_endpoints, vec![local_endpoint]);
        assert_eq!(relationship.remote_endpoints, vec![remote_endpoint]);
        assert!(relationship.local_certificate_history.is_empty());
        assert!(relationship.remote_certificate_history.is_empty());
        assert!(relationship.mailbox_secret.is_none());
        Ok(())
    }

    #[test]
    fn identity_boundary_state_is_upgraded_before_device_rotation() -> Result<()> {
        let temporary = tempfile::tempdir()?;
        std::fs::set_permissions(temporary.path(), std::fs::Permissions::from_mode(0o700))?;
        let state_dir = std::fs::canonicalize(temporary.path())?.join("state");
        let now = unix_time()?;
        let identity = LocalIdentityState::generate(now.saturating_sub(1), 86_400)?;
        let old_local_certificate = identity.certificate().clone();
        let remote = LocalIdentityState::generate(now.saturating_sub(1), 86_400)?;
        let local_endpoint = EndpointDescriptor::Direct(DirectEndpoint {
            address: IpAddress::from(IpAddr::V4(Ipv4Addr::new(10, 20, 30, 40))),
            port: 4242,
        });
        let remote_endpoint = EndpointDescriptor::Iroh(IrohEndpointDescriptor {
            endpoint_id: [7; 32],
            relay_origin: None,
        });
        let previous = IdentityBoundaryDaemonState {
            version: IDENTITY_BOUNDARY_DAEMON_STATE_VERSION,
            owner_user_id: "owner_rotation_migration".into(),
            high_water_unix_time: now,
            invitations: Vec::new(),
            pairings: Vec::new(),
            relationships: vec![IdentityBoundaryStoredRelationship {
                id: "03".repeat(16),
                remote_certificate: remote.certificate().clone(),
                status: RelationshipStatus::Revoked,
                privacy_mode: PrivacyMode::Fastest,
                verification_phrase_hash: [5; 32],
                local_endpoints: vec![local_endpoint.clone()],
                remote_endpoints: vec![remote_endpoint.clone()],
                devices: Vec::new(),
                grants: Vec::new(),
                outbound_sequence: 0,
                revoked_reason: Some("migration test".into()),
            }],
            query_results: Vec::new(),
            accepted_pending_requests: Vec::new(),
            grant_revocations: Vec::new(),
            mls_states: Vec::new(),
            mls_checkpoints: Vec::new(),
            pending_mls_clients: Vec::new(),
            mls_relationships: Vec::new(),
            transport_outbox: Vec::new(),
            pending_applications: Vec::new(),
            inbound_receipts: Vec::new(),
            query_exchanges: Vec::new(),
            inbound_queries: Vec::new(),
            projection_deltas: Vec::new(),
            command_receipts: Vec::new(),
        };
        previous.validate()?;
        let state_key = identity.derive_storage_key("durable daemon state")?;
        let plaintext = encode_limited::<DAEMON_STATE_LIMIT, _>(&previous)?;
        let nonce = nonzero_random_24();
        let aad = state_aad(identity.certificate(), IDENTITY_BOUNDARY_DAEMON_STATE_MAGIC);
        let ciphertext = XChaCha20Poly1305::new(state_key.as_ref().into())
            .encrypt(
                XNonce::from_slice(&nonce),
                Payload {
                    msg: &plaintext,
                    aad: &aad,
                },
            )
            .map_err(|_| {
                PeerError::Authentication("sealing identity-boundary test state failed".into())
            })?;
        let mut sealed = IDENTITY_BOUNDARY_DAEMON_STATE_MAGIC.to_vec();
        sealed.extend_from_slice(&nonce);
        sealed.extend_from_slice(&ciphertext);
        let directory = SecureDirectory::open_or_create(&state_dir)?;
        directory.atomic_write_secret(DAEMON_STATE_FILE, &sealed)?;
        drop(directory);

        DurableDaemonHandler::ensure_local_identity_rotation_allowed(&state_dir, &identity, now)?;
        let rotated = identity.rotate(now.saturating_add(1), 86_400)?;
        let directory = SecureDirectory::open_or_create(&state_dir)?;
        let upgraded = directory.read_secret(DAEMON_STATE_FILE)?;
        assert!(upgraded.starts_with(DAEMON_STATE_MAGIC));
        let rotated_key = rotated.derive_storage_key("durable daemon state")?;
        let migrated = open_state(&rotated_key, rotated.certificate(), &upgraded)?;
        assert_eq!(migrated.relationships.len(), 1);
        let relationship = &migrated.relationships[0];
        assert_eq!(relationship.local_certificate, old_local_certificate);
        assert_eq!(relationship.local_endpoints, vec![local_endpoint]);
        assert_eq!(relationship.remote_endpoints, vec![remote_endpoint]);
        Ok(())
    }

    #[tokio::test]
    async fn live_invitation_blocks_local_identity_rotation() -> Result<()> {
        let temporary = tempfile::tempdir()?;
        std::fs::set_permissions(temporary.path(), std::fs::Permissions::from_mode(0o700))?;
        let state_dir = std::fs::canonicalize(temporary.path())?.join("state");
        let now = unix_time()?;
        let identity = LocalIdentityState::generate(now.saturating_sub(1), 86_400)?;
        let identity_bytes = identity.encode_secret()?;
        let handler = DurableDaemonHandler::open(
            &state_dir,
            LocalIdentityState::decode_secret(&identity_bytes)?,
            DaemonConfig {
                owner_user_id: "owner_rotation_block".into(),
                endpoints: vec![EndpointDescriptor::Direct(DirectEndpoint {
                    address: IpAddress::from(IpAddr::V4(Ipv4Addr::new(10, 20, 30, 40))),
                    port: 4242,
                })],
                allow_loopback_direct: false,
                command_authority: None,
            },
        )?;
        let response = handler
            .handle(IpcRequest::CreateInvitation {
                request_id: "rotation_block".into(),
                command_id: "rotation-block-command-0001".into(),
                approval_deadline: test_approval_deadline()?,
                input: CreateInvitationInput {
                    owner_user_id: "owner_rotation_block".into(),
                    label: "Rotation blocker".into(),
                    expires_at: format_timestamp(now.saturating_add(600))?,
                    privacy_mode: PrivacyMode::Fastest,
                    transport_kinds: vec![TransportKind::LocalDirect],
                },
            })
            .await;
        assert!(matches!(response, IpcResponse::InvitationCreated { .. }));
        drop(handler);
        let restored = LocalIdentityState::decode_secret(&identity_bytes)?;
        assert!(matches!(
            DurableDaemonHandler::ensure_local_identity_rotation_allowed(
                &state_dir, &restored, now
            ),
            Err(PeerError::Authorization(_))
        ));
        Ok(())
    }

    #[test]
    fn durable_owner_binding_survives_restart_and_rejects_rebinding() -> Result<()> {
        let temporary = tempfile::tempdir()?;
        std::fs::set_permissions(temporary.path(), std::fs::Permissions::from_mode(0o700))?;
        let state_dir = std::fs::canonicalize(temporary.path())?.join("state");
        let identity = LocalIdentityState::generate(unix_time()?.saturating_sub(1), 86_400)?;
        let identity_bytes = identity.encode_secret()?;
        let config = || DaemonConfig {
            owner_user_id: "owner_a".into(),
            endpoints: vec![EndpointDescriptor::Direct(DirectEndpoint {
                address: IpAddress::from(IpAddr::V4(Ipv4Addr::new(10, 20, 30, 40))),
                port: 4242,
            })],
            allow_loopback_direct: false,
            command_authority: None,
        };
        let first = DurableDaemonHandler::open(&state_dir, identity, config())?;
        let first_identity = first.local_identity(&LocalIdentityInput {
            owner_user_id: "owner_a".into(),
        })?;
        drop(first);
        let reopened = DurableDaemonHandler::open(
            &state_dir,
            LocalIdentityState::decode_secret(&identity_bytes)?,
            config(),
        )?;
        let reopened_identity = reopened.local_identity(&LocalIdentityInput {
            owner_user_id: "owner_a".into(),
        })?;
        assert_eq!(first_identity.principal, reopened_identity.principal);
        assert_eq!(first_identity.device, reopened_identity.device);
        drop(reopened);
        let restored = LocalIdentityState::decode_secret(&identity_bytes)?;
        assert!(
            DurableDaemonHandler::open(
                &state_dir,
                restored,
                DaemonConfig {
                    owner_user_id: "owner_b".into(),
                    endpoints: config().endpoints,
                    allow_loopback_direct: false,
                    command_authority: None,
                }
            )
            .is_err()
        );
        Ok(())
    }

    #[tokio::test]
    async fn command_receipt_replays_exact_result_after_restart_and_rejects_body_drift()
    -> Result<()> {
        let temporary = tempfile::tempdir()?;
        std::fs::set_permissions(temporary.path(), std::fs::Permissions::from_mode(0o700))?;
        let state_dir = std::fs::canonicalize(temporary.path())?.join("state");
        let identity = LocalIdentityState::generate(unix_time()?.saturating_sub(1), 86_400)?;
        let identity_bytes = identity.encode_secret()?;
        let endpoint = EndpointDescriptor::Direct(DirectEndpoint {
            address: IpAddress::from(IpAddr::V4(Ipv4Addr::new(10, 20, 30, 40))),
            port: 4242,
        });
        let expires_at = format_timestamp(unix_time()?.saturating_add(600))?;
        let input = CreateInvitationInput {
            owner_user_id: "owner_restart".into(),
            label: "Restart stable".into(),
            expires_at,
            privacy_mode: PrivacyMode::Fastest,
            transport_kinds: vec![TransportKind::LocalDirect],
        };
        let first_handler = DurableDaemonHandler::open(
            &state_dir,
            identity,
            DaemonConfig {
                owner_user_id: "owner_restart".into(),
                endpoints: vec![endpoint.clone()],
                allow_loopback_direct: false,
                command_authority: None,
            },
        )?;
        let first = first_handler
            .handle(IpcRequest::CreateInvitation {
                request_id: "restart_first".into(),
                command_id: "command-restart-create-0001".into(),
                approval_deadline: test_approval_deadline()?,
                input: input.clone(),
            })
            .await;
        let IpcResponse::InvitationCreated {
            material: first_material,
            ..
        } = first
        else {
            return Err(invalid("first command did not create an invitation"));
        };
        drop(first_handler);

        let restored = DurableDaemonHandler::open(
            &state_dir,
            LocalIdentityState::decode_secret(&identity_bytes)?,
            DaemonConfig {
                owner_user_id: "owner_restart".into(),
                endpoints: vec![endpoint],
                allow_loopback_direct: false,
                command_authority: None,
            },
        )?;
        let replay = restored
            .handle(IpcRequest::CreateInvitation {
                request_id: "restart_retry".into(),
                command_id: "command-restart-create-0001".into(),
                approval_deadline: test_approval_deadline()?,
                input: input.clone(),
            })
            .await;
        assert!(matches!(
            replay,
            IpcResponse::InvitationCreated { material, .. } if material == first_material
        ));
        let conflict = restored
            .handle(IpcRequest::CreateInvitation {
                request_id: "restart_conflict".into(),
                command_id: "command-restart-create-0001".into(),
                approval_deadline: test_approval_deadline()?,
                input: CreateInvitationInput {
                    label: "Changed body".into(),
                    ..input
                },
            })
            .await;
        assert!(matches!(
            conflict,
            IpcResponse::Rejected {
                code: IpcErrorCode::Conflict,
                ..
            }
        ));
        Ok(())
    }

    #[tokio::test]
    async fn approval_deadline_blocks_dispatch_and_receipt_is_queryable_after_expiry() -> Result<()>
    {
        let (_temporary, handler) = handler("owner_deadline")?;
        let now = unix_time()?;
        let expired = handler
            .handle(IpcRequest::CreateInvitation {
                request_id: "deadline_expired".into(),
                command_id: "command-deadline-expired-0001".into(),
                approval_deadline: format_timestamp(now.saturating_sub(1))?,
                input: CreateInvitationInput {
                    owner_user_id: "owner_deadline".into(),
                    label: "must not dispatch".into(),
                    expires_at: format_timestamp(now.saturating_add(600))?,
                    privacy_mode: PrivacyMode::Fastest,
                    transport_kinds: vec![TransportKind::LocalDirect],
                },
            })
            .await;
        assert!(matches!(
            expired,
            IpcResponse::Rejected {
                code: IpcErrorCode::AuthorizationFailed,
                ..
            }
        ));
        let state = handler.state_snapshot()?;
        assert!(state.invitations.is_empty());
        assert!(state.transport_outbox.is_empty());
        assert!(state.command_receipts.is_empty());

        let deadline = now.saturating_add(10);
        let deadline_text = format_timestamp(deadline)?;
        let command_digest = "49".repeat(32);
        let result = handler.idempotent_with_clock(
            "command-deadline-replay-0001",
            "deadline_test",
            [73; 32],
            &command_digest,
            &deadline_text,
            None,
            true,
            || Ok(now),
            || Ok::<_, PeerError>(47_u64),
        )?;
        assert_eq!(result, 47);
        let replay_executed = std::sync::atomic::AtomicBool::new(false);
        let replay = handler.idempotent_with_clock(
            "command-deadline-replay-0001",
            "deadline_test",
            [73; 32],
            &command_digest,
            &deadline_text,
            None,
            true,
            || Ok(deadline.saturating_add(100)),
            || {
                replay_executed.store(true, std::sync::atomic::Ordering::Release);
                Ok::<_, PeerError>(99_u64)
            },
        )?;
        assert_eq!(replay, 47);
        assert!(!replay_executed.load(std::sync::atomic::Ordering::Acquire));

        let receipt = handler
            .handle(IpcRequest::CommandReceipt {
                request_id: "receipt_after_expiry".into(),
                input: CommandReceiptInput {
                    owner_user_id: "owner_deadline".into(),
                    command_id: "command-deadline-replay-0001".into(),
                },
            })
            .await;
        assert!(matches!(
            receipt,
            IpcResponse::CommandReceipt { receipt, .. }
                if receipt.approval_deadline == Some(deadline_text)
                    && receipt.committed_at == Some(format_timestamp(now)?)
                    && receipt.result == serde_json::json!(47)
        ));
        Ok(())
    }

    #[test]
    fn approval_deadline_rejects_a_commit_that_finishes_late() -> Result<()> {
        let (_temporary, handler) = handler("owner_late_commit")?;
        let initial_high_water = handler.state_snapshot()?.high_water_unix_time;
        let now = unix_time()?;
        let deadline = now.saturating_add(5);
        let mut clock_calls = 0_u8;
        let command_digest = "4a".repeat(32);
        let result: Result<u64> = handler.idempotent_with_clock(
            "command-late-commit-0001",
            "late_commit_test",
            [74; 32],
            &command_digest,
            &format_timestamp(deadline)?,
            None,
            true,
            || {
                clock_calls = clock_calls.saturating_add(1);
                Ok(if clock_calls == 1 {
                    now
                } else {
                    deadline.saturating_add(1)
                })
            },
            || {
                handler.mutate(|state| {
                    state.high_water_unix_time = state.high_water_unix_time.saturating_add(1);
                    Ok(())
                })?;
                Ok(88)
            },
        );
        assert!(matches!(result, Err(PeerError::Authorization(_))));
        let state = handler.state_snapshot()?;
        assert!(state.command_receipts.is_empty());
        assert_eq!(state.high_water_unix_time, initial_high_water);
        Ok(())
    }

    #[tokio::test]
    async fn transport_retry_bookkeeping_is_idempotent_after_concurrent_removal() -> Result<()> {
        let (_temporary, handler) = handler("owner_transport_retry_race")?;
        let now = unix_time()?;
        handler
            .record_outbound_failure([31; 16], [32; 32], now)
            .await?;
        handler.defer_outbound([31; 16], [32; 32], now).await?;
        assert!(handler.state_snapshot()?.transport_outbox.is_empty());
        Ok(())
    }

    #[test]
    fn failed_command_does_not_absorb_concurrent_transport_mutation() -> Result<()> {
        let (_temporary, handler) = handler("owner_concurrency")?;
        let initial_high_water = handler.state_snapshot()?.high_water_unix_time;
        let (staged_tx, staged_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let command_handler = Arc::clone(&handler);
        let command = std::thread::spawn(move || -> Result<()> {
            let approval_deadline = test_approval_deadline()?;
            let command_digest = "5b".repeat(32);
            let result: Result<u64> = command_handler.idempotent(
                "command-concurrency-failure-0001",
                "concurrency_test",
                [91; 32],
                &command_digest,
                &approval_deadline,
                None,
                true,
                || {
                    command_handler.mutate(|state| {
                        state.high_water_unix_time = state.high_water_unix_time.saturating_add(1);
                        Ok(())
                    })?;
                    staged_tx.send(()).map_err(|_| {
                        PeerError::StateConflict("concurrency test signal closed".into())
                    })?;
                    release_rx.recv().map_err(|_| {
                        PeerError::StateConflict("concurrency test release closed".into())
                    })?;
                    Err(PeerError::StateConflict(
                        "injected command transaction failure".into(),
                    ))
                },
            );
            if result.is_ok() {
                return Err(PeerError::StateConflict(
                    "injected command transaction unexpectedly committed".into(),
                ));
            }
            Ok(())
        });
        staged_rx
            .recv()
            .map_err(|_| PeerError::StateConflict("command did not stage state".into()))?;

        let (transport_done_tx, transport_done_rx) = std::sync::mpsc::channel();
        let transport_handler = Arc::clone(&handler);
        let transport = std::thread::spawn(move || -> Result<()> {
            transport_handler.mutate(|state| {
                state.high_water_unix_time = state.high_water_unix_time.saturating_add(10);
                Ok(())
            })?;
            transport_done_tx.send(()).map_err(|_| {
                PeerError::StateConflict("transport completion signal closed".into())
            })?;
            Ok(())
        });
        assert!(
            transport_done_rx
                .recv_timeout(std::time::Duration::from_millis(50))
                .is_err(),
            "transport mutation crossed an uncommitted command transaction"
        );
        release_tx
            .send(())
            .map_err(|_| PeerError::StateConflict("command release failed".into()))?;
        command
            .join()
            .map_err(|_| PeerError::StateConflict("command test thread panicked".into()))??;
        transport
            .join()
            .map_err(|_| PeerError::StateConflict("transport test thread panicked".into()))??;
        transport_done_rx
            .recv()
            .map_err(|_| PeerError::StateConflict("transport mutation did not complete".into()))?;
        assert_eq!(
            handler.state_snapshot()?.high_water_unix_time,
            initial_high_water.saturating_add(10)
        );
        Ok(())
    }

    fn reserve_loopback_port() -> Result<u16> {
        let listener = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
        Ok(listener.local_addr()?.port())
    }

    fn loopback_endpoint(port: u16) -> EndpointDescriptor {
        EndpointDescriptor::Direct(DirectEndpoint {
            address: IpAddress::from(IpAddr::V4(Ipv4Addr::LOCALHOST)),
            port,
        })
    }

    async fn wait_for_state(
        mut predicate: impl FnMut() -> Result<bool>,
        label: &'static str,
    ) -> Result<()> {
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(10);
        loop {
            if predicate()? {
                return Ok(());
            }
            if tokio::time::Instant::now() >= deadline {
                return Err(PeerError::Timeout(label));
            }
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }
    }

    #[tokio::test]
    #[allow(clippy::too_many_lines)]
    async fn two_daemons_complete_live_direct_openmls_grant_and_query_roundtrip() -> Result<()> {
        let inviter_temp = tempfile::tempdir()?;
        let accepter_temp = tempfile::tempdir()?;
        std::fs::set_permissions(inviter_temp.path(), std::fs::Permissions::from_mode(0o700))?;
        std::fs::set_permissions(accepter_temp.path(), std::fs::Permissions::from_mode(0o700))?;
        let inviter_port = reserve_loopback_port()?;
        let accepter_port = reserve_loopback_port()?;
        let inviter_endpoint = loopback_endpoint(inviter_port);
        let accepter_endpoint = loopback_endpoint(accepter_port);
        let now = unix_time()?;
        let inviter_state_dir = std::fs::canonicalize(inviter_temp.path())?.join("state");
        let accepter_state_dir = std::fs::canonicalize(accepter_temp.path())?.join("state");
        let inviter_identity = LocalIdentityState::generate(now.saturating_sub(1), 86_400)?;
        let accepter_identity = LocalIdentityState::generate(now.saturating_sub(1), 86_400)?;
        let inviter_identity_bytes = inviter_identity.encode_secret()?;
        let accepter_identity_bytes = accepter_identity.encode_secret()?;
        SecureDirectory::open_or_create(&inviter_state_dir)?
            .atomic_write_secret(IDENTITY_STATE_FILE, &inviter_identity_bytes)?;
        SecureDirectory::open_or_create(&accepter_state_dir)?
            .atomic_write_secret(IDENTITY_STATE_FILE, &accepter_identity_bytes)?;
        let inviter = Arc::new(DurableDaemonHandler::open(
            &inviter_state_dir,
            inviter_identity,
            DaemonConfig {
                owner_user_id: "owner_inviter".into(),
                endpoints: vec![inviter_endpoint.clone()],
                allow_loopback_direct: true,
                command_authority: None,
            },
        )?);
        let accepter = Arc::new(DurableDaemonHandler::open(
            &accepter_state_dir,
            accepter_identity,
            DaemonConfig {
                owner_user_id: "owner_accepter".into(),
                endpoints: vec![accepter_endpoint.clone()],
                allow_loopback_direct: true,
                command_authority: None,
            },
        )?);
        let inviter_direct = match &inviter_endpoint {
            EndpointDescriptor::Direct(endpoint) => endpoint.clone(),
            _ => return Err(invalid("test inviter endpoint is not direct")),
        };
        let accepter_direct = match &accepter_endpoint {
            EndpointDescriptor::Direct(endpoint) => endpoint.clone(),
            _ => return Err(invalid("test accepter endpoint is not direct")),
        };
        let inviter_transport = DirectTransportRuntime::bind(
            std::slice::from_ref(&inviter_direct),
            Arc::clone(&inviter),
            true,
        )
        .await?;
        let accepter_transport = DirectTransportRuntime::bind(
            std::slice::from_ref(&accepter_direct),
            Arc::clone(&accepter),
            true,
        )
        .await?;
        let (inviter_shutdown_tx, inviter_shutdown_rx) = tokio::sync::oneshot::channel();
        let (accepter_shutdown_tx, accepter_shutdown_rx) = tokio::sync::oneshot::channel();
        let inviter_task = tokio::spawn(async move {
            inviter_transport
                .serve_until(async move {
                    let _ = inviter_shutdown_rx.await;
                })
                .await
        });
        let accepter_task = tokio::spawn(async move {
            accepter_transport
                .serve_until(async move {
                    let _ = accepter_shutdown_rx.await;
                })
                .await
        });

        let invitation = inviter
            .handle(IpcRequest::CreateInvitation {
                request_id: "live_create".into(),
                command_id: "live-command-create-0001".into(),
                approval_deadline: test_approval_deadline()?,
                input: CreateInvitationInput {
                    owner_user_id: "owner_inviter".into(),
                    label: "Live direct pairing".into(),
                    expires_at: format_timestamp(now.saturating_add(600))?,
                    privacy_mode: PrivacyMode::Fastest,
                    transport_kinds: vec![TransportKind::LocalDirect],
                },
            })
            .await;
        let IpcResponse::InvitationCreated { material, .. } = invitation else {
            return Err(invalid(format!("live invitation failed: {invitation:?}")));
        };
        let acceptance = accepter
            .handle(IpcRequest::AcceptInvitation {
                request_id: "live_accept".into(),
                command_id: "live-command-accept-0001".into(),
                approval_deadline: test_approval_deadline()?,
                input: AcceptInvitationInput {
                    owner_user_id: "owner_accepter".into(),
                    invitation: material.invitation,
                    local_device_id: device_id(accepter.identity.load().certificate()),
                    privacy_mode: PrivacyMode::Fastest,
                    scanned_at: format_timestamp(now)?,
                },
            })
            .await;
        let IpcResponse::InvitationAccepted { acceptance, .. } = acceptance else {
            return Err(invalid(format!(
                "live invitation acceptance failed: {acceptance:?}"
            )));
        };
        let confirm_input = ConfirmPairingInput {
            owner_user_id: "owner_accepter".into(),
            pairing_id: acceptance.request_id,
            transcript_hash: acceptance.request_payload.transcript_hash.clone(),
            verification_phrase: acceptance.request_payload.verification_phrase.clone(),
            request_payload: acceptance.request_payload,
        };
        let confirmation = accepter
            .handle(IpcRequest::ConfirmPairing {
                request_id: "live_confirm".into(),
                command_id: "live-command-confirm-0001".into(),
                approval_deadline: test_approval_deadline()?,
                input: confirm_input.clone(),
            })
            .await;
        let IpcResponse::PairingConfirmed { confirmation, .. } = confirmation else {
            return Err(invalid(format!(
                "live pairing confirmation failed: {confirmation:?}"
            )));
        };
        let expected_confirmation = confirmation.clone();
        let relationship_id = confirmation.relationship.id.clone();
        wait_for_state(
            || {
                Ok(inviter
                    .state_snapshot()?
                    .mls_relationships
                    .iter()
                    .any(|binding| binding.relationship_id == relationship_id)
                    && accepter
                        .state_snapshot()?
                        .mls_relationships
                        .iter()
                        .any(|binding| binding.relationship_id == relationship_id))
            },
            "waiting for live OpenMLS pairing",
        )
        .await?;

        let proposal = grant(
            "owner_inviter",
            &relationship_id,
            "live_profile_grant",
            ShareDirection::LocalToRemote,
            &device_id(accepter.identity.load().certificate()),
            unix_time()?,
        )?;
        let signed = inviter
            .handle(IpcRequest::SignGrant {
                request_id: "live_grant_propose".into(),
                command_id: "live-command-grant-propose-0001".into(),
                approval_deadline: test_approval_deadline()?,
                input: SignGrantInput {
                    owner_user_id: "owner_inviter".into(),
                    relationship_id: relationship_id.clone(),
                    grant: proposal,
                },
            })
            .await;
        let IpcResponse::GrantSigned { result, .. } = signed else {
            return Err(invalid(format!("live grant proposal failed: {signed:?}")));
        };
        let proposed = result.grant;
        wait_for_state(
            || {
                Ok(accepter
                    .state_snapshot()?
                    .relationships
                    .iter()
                    .find(|relationship| relationship.id == relationship_id)
                    .is_some_and(|relationship| {
                        relationship
                            .grants
                            .iter()
                            .any(|stored| stored.grant == proposed)
                    }))
            },
            "waiting for authenticated grant proposal",
        )
        .await?;
        let countersigned = accepter
            .handle(IpcRequest::SignGrant {
                request_id: "live_grant_accept".into(),
                command_id: "live-command-grant-accept-0001".into(),
                approval_deadline: test_approval_deadline()?,
                input: SignGrantInput {
                    owner_user_id: "owner_accepter".into(),
                    relationship_id: relationship_id.clone(),
                    grant: proposed,
                },
            })
            .await;
        let IpcResponse::GrantSigned { result, .. } = countersigned else {
            return Err(invalid(format!(
                "live grant countersign failed: {countersigned:?}"
            )));
        };
        assert_eq!(result.grant.status, GrantStatus::Active);
        wait_for_state(
            || {
                Ok(inviter
                    .state_snapshot()?
                    .relationships
                    .iter()
                    .find(|relationship| relationship.id == relationship_id)
                    .is_some_and(|relationship| {
                        relationship.grants.iter().any(|stored| {
                            stored.grant.id == "live_profile_grant"
                                && stored.grant.status == GrantStatus::Active
                                && stored.verification_id.is_some()
                        })
                    }))
            },
            "waiting for authenticated active grant",
        )
        .await?;

        let query_daemon = Arc::clone(&accepter);
        let query_relationship_id = relationship_id.clone();
        let query_task = tokio::spawn(async move {
            query_daemon
                .handle(IpcRequest::ExecuteQuery {
                    request_id: "live_query".into(),
                    input: ExecuteQueryInput {
                        owner_user_id: "owner_accepter".into(),
                        relationship_id: query_relationship_id,
                        person_id: "local-only-person-id".into(),
                        query: ApiTypedQuery {
                            projection_id: "person.profile.v1".into(),
                            parameters: serde_json::Map::new(),
                            interval: None,
                            entity_ids: Vec::new(),
                            fields: vec!["displayName".into()],
                            precision: "exact".into(),
                            maximum_result_count: 15,
                        },
                        timeout_ms: 12_000,
                    },
                })
                .await
        });
        let claim = {
            let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(10);
            let mut attempt = 0_u32;
            loop {
                attempt = attempt.saturating_add(1);
                let response = inviter
                    .handle(IpcRequest::ClaimInboundQuery {
                        request_id: format!("live_claim_{attempt}"),
                        command_id: format!("live-command-claim-{attempt:08}"),
                        approval_deadline: test_approval_deadline()?,
                        input: ClaimInboundQueryInput {
                            owner_user_id: "owner_inviter".into(),
                            worker_id: "direct_query_worker_0001".into(),
                            lease_ms: 4_000,
                        },
                    })
                    .await;
                if let IpcResponse::InboundQueryClaimed { result, .. } = response
                    && let Some(claim) = result.claim
                {
                    break claim;
                }
                if tokio::time::Instant::now() >= deadline {
                    return Err(PeerError::Timeout("waiting for direct inbound query claim"));
                }
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            }
        };
        let source_record_id = "source-local-record-id";
        let response = inviter
            .handle(IpcRequest::RespondInboundQuery {
                request_id: "live_respond_query".into(),
                command_id: "live-command-respond-query-0001".into(),
                approval_deadline: test_approval_deadline()?,
                input: RespondInboundQueryInput {
                    owner_user_id: "owner_inviter".into(),
                    worker_id: "direct_query_worker_0001".into(),
                    claim_id: claim.claim_id,
                    query_id: claim.query_id,
                    payload: ApiQueryPayload {
                        records: vec![ApiQueryRecord {
                            record_id: source_record_id.into(),
                            fields: serde_json::Map::from_iter([(
                                "displayName".into(),
                                serde_json::Value::String("Direct Person".into()),
                            )]),
                        }],
                    },
                    as_of: format_timestamp(unix_time()?)?,
                    completeness: InboundQueryCompleteness::Complete,
                    redacted_fields: Vec::new(),
                },
            })
            .await;
        if !matches!(response, IpcResponse::InboundQueryResponded { .. }) {
            return Err(invalid(format!(
                "live inbound query response failed: {response:?}"
            )));
        }
        let query_response = query_task
            .await
            .map_err(|error| PeerError::Transport(format!("joining query task: {error}")))?;
        assert!(matches!(
            query_response,
            IpcResponse::QueryExecuted { result, .. }
                if result.state == QueryResultState::Live
                    && result.payload.records.len() == 1
                    && result.payload.records[0].record_id != source_record_id
                    && result.payload.records[0].fields.get("displayName")
                        == Some(&serde_json::Value::String("Direct Person".into()))
                    && result.metadata.source.device_id
                        == device_id(inviter.identity.load().certificate())
        ));

        let inviter_sequence_before = inviter
            .state_snapshot()?
            .mls_relationships
            .iter()
            .find(|binding| binding.relationship_id == relationship_id)
            .ok_or_else(|| invalid("inviter MLS binding disappeared"))?
            .inbound_replay
            .highest_sequence;
        let accepter_sequence_before = accepter
            .state_snapshot()?
            .mls_relationships
            .iter()
            .find(|binding| binding.relationship_id == relationship_id)
            .ok_or_else(|| invalid("accepter MLS binding disappeared"))?
            .inbound_replay
            .highest_sequence;
        let resync_input = RequestResyncInput {
            owner_user_id: "owner_accepter".into(),
            relationship_id: relationship_id.clone(),
            projection_ids: vec!["person.profile.v1".into()],
        };
        let resync = accepter
            .handle(IpcRequest::RequestResync {
                request_id: "live_resync".into(),
                command_id: "live-command-resync-0001".into(),
                approval_deadline: test_approval_deadline()?,
                input: resync_input.clone(),
            })
            .await;
        let IpcResponse::ResyncRequested { result, .. } = resync else {
            return Err(invalid(format!("live resync request failed: {resync:?}")));
        };
        assert_eq!(result.envelope_ids.len(), 1);
        let expected_resync_ids = result.envelope_ids;
        let replay = accepter
            .handle(IpcRequest::RequestResync {
                request_id: "live_resync_replay".into(),
                command_id: "live-command-resync-0001".into(),
                approval_deadline: test_approval_deadline()?,
                input: resync_input,
            })
            .await;
        assert!(matches!(
            replay,
            IpcResponse::ResyncRequested { result, .. }
                if result.envelope_ids == expected_resync_ids
        ));
        wait_for_state(
            || {
                let inviter_state = inviter.state_snapshot()?;
                let accepter_state = accepter.state_snapshot()?;
                let inviter_received = inviter_state
                    .mls_relationships
                    .iter()
                    .find(|binding| binding.relationship_id == relationship_id)
                    .is_some_and(|binding| {
                        binding.inbound_replay.highest_sequence > inviter_sequence_before
                    });
                let accepter_received = accepter_state
                    .mls_relationships
                    .iter()
                    .find(|binding| binding.relationship_id == relationship_id)
                    .is_some_and(|binding| {
                        binding.inbound_replay.highest_sequence > accepter_sequence_before
                    });
                Ok(inviter_received && accepter_received)
            },
            "waiting for authenticated resync exchange",
        )
        .await?;

        wait_for_state(
            || {
                let inviter_state = inviter.state_snapshot()?;
                let accepter_state = accepter.state_snapshot()?;
                Ok(inviter_state.transport_outbox.is_empty()
                    && inviter_state.pending_applications.is_empty()
                    && accepter_state.transport_outbox.is_empty()
                    && accepter_state.pending_applications.is_empty())
            },
            "waiting for transport drain before credential rotation",
        )
        .await?;
        let _ = inviter_shutdown_tx.send(());
        let _ = accepter_shutdown_tx.send(());
        inviter_task.await.map_err(|error| {
            PeerError::StateConflict(format!("inviter transport task: {error}"))
        })??;
        accepter_task.await.map_err(|error| {
            PeerError::StateConflict(format!("accepter transport task: {error}"))
        })??;

        let predecessor = inviter.identity.load().certificate().clone();
        let rotation_input = RotateHostCredentialInput {
            owner_user_id: "owner_inviter".into(),
            not_after: format_timestamp(unix_time()?.saturating_add(2 * 24 * 60 * 60))?,
        };
        let rotation_deadline = test_approval_deadline()?;
        let rotation_response = inviter
            .handle(IpcRequest::RotateHostCredential {
                request_id: "live_rotate_host".into(),
                command_id: "live-command-rotate-host-0001".into(),
                approval_deadline: rotation_deadline.clone(),
                input: rotation_input.clone(),
            })
            .await;
        let IpcResponse::HostCredentialRotationStarted {
            result: rotation_result,
            ..
        } = rotation_response
        else {
            return Err(invalid(format!(
                "live host rotation did not start: {rotation_response:?}"
            )));
        };
        assert_eq!(
            rotation_result.successor.certificate_serial,
            predecessor.body.serial.saturating_add(1).to_string()
        );
        assert_eq!(
            rotation_result.relationship_ids,
            vec![relationship_id.clone()]
        );
        assert_eq!(
            inviter.identity.load().certificate(),
            &predecessor,
            "predecessor retired before an authenticated peer acknowledgement"
        );
        assert!(inviter.state_snapshot()?.host_credential_rotation.is_some());

        // Crash after the MLS commit and durable outbox write, before peer delivery.
        drop(inviter);
        let inviter_identity = LocalIdentityState::decode_secret(
            &SecureDirectory::open_or_create(&inviter_state_dir)?
                .read_secret(IDENTITY_STATE_FILE)?,
        )?;
        let inviter = Arc::new(DurableDaemonHandler::open(
            &inviter_state_dir,
            inviter_identity,
            DaemonConfig {
                owner_user_id: "owner_inviter".into(),
                endpoints: vec![inviter_endpoint.clone()],
                allow_loopback_direct: true,
                command_authority: None,
            },
        )?);
        assert_eq!(inviter.identity.load().certificate(), &predecessor);
        let dispatches = inviter.due_outbound(unix_time()?, 16).await?;
        let [dispatch] = dispatches.as_slice() else {
            return Err(invalid(
                "rotation restart did not restore exactly one outbox packet",
            ));
        };
        assert!(matches!(
            &dispatch.packet.payload,
            PeerWirePayload::HostCredentialRotation(_)
        ));
        let first_ack = accepter.ingest_and_ack(dispatch.packet.clone()).await?;

        // Simulate acknowledgement response loss and prove receiver restart replays it exactly.
        drop(accepter);
        let accepter_identity = LocalIdentityState::decode_secret(
            &SecureDirectory::open_or_create(&accepter_state_dir)?
                .read_secret(IDENTITY_STATE_FILE)?,
        )?;
        let accepter = Arc::new(DurableDaemonHandler::open(
            &accepter_state_dir,
            accepter_identity,
            DaemonConfig {
                owner_user_id: "owner_accepter".into(),
                endpoints: vec![accepter_endpoint.clone()],
                allow_loopback_direct: true,
                command_authority: None,
            },
        )?);
        let replayed_ack = accepter.ingest_and_ack(dispatch.packet.clone()).await?;
        assert_eq!(first_ack, replayed_ack);
        assert!(inviter.commit_verified_outbound_acknowledgement(
            &dispatch.packet,
            &dispatch.expected_receiver,
            &replayed_ack,
            unix_time()?,
        )?);
        assert!(
            inviter
                .state_snapshot()?
                .host_credential_rotation
                .as_ref()
                .is_some_and(|rotation| rotation
                    .relationships
                    .iter()
                    .all(|relationship| relationship.acknowledged))
        );

        // Crash after durable acknowledgement commit but before the identity-file swap.
        drop(inviter);
        let inviter_identity = LocalIdentityState::decode_secret(
            &SecureDirectory::open_or_create(&inviter_state_dir)?
                .read_secret(IDENTITY_STATE_FILE)?,
        )?;
        assert_eq!(inviter_identity.certificate(), &predecessor);
        let inviter = Arc::new(DurableDaemonHandler::open(
            &inviter_state_dir,
            inviter_identity,
            DaemonConfig {
                owner_user_id: "owner_inviter".into(),
                endpoints: vec![inviter_endpoint.clone()],
                allow_loopback_direct: true,
                command_authority: None,
            },
        )?);
        let successor = inviter.identity.load().certificate().clone();
        assert_eq!(
            successor.body.serial,
            predecessor.body.serial.saturating_add(1)
        );
        assert!(inviter.state_snapshot()?.host_credential_rotation.is_none());
        assert_eq!(
            LocalIdentityState::decode_secret(
                &SecureDirectory::open_or_create(&inviter_state_dir)?
                    .read_secret(IDENTITY_STATE_FILE)?,
            )?
            .certificate(),
            &successor
        );
        let inviter_snapshot = inviter.state_snapshot()?;
        let inviter_relationship = active_relationship(&inviter_snapshot, &relationship_id)?;
        let inviter_grant = inviter_relationship
            .grants
            .iter()
            .find(|stored| stored.grant.status == GrantStatus::Active)
            .ok_or_else(|| invalid("active grant disappeared after local rotation"))?;
        let durable_local_trust = grant_trust(
            inviter_relationship,
            &successor,
            &inviter_grant.grant,
            unix_time()?,
            true,
        )?;
        verify_active_grant(&inviter_grant.grant, &durable_local_trust, unix_time()?)?;
        let current_only_local_trust = grant_trust(
            inviter_relationship,
            &successor,
            &inviter_grant.grant,
            unix_time()?,
            false,
        )?;
        assert!(
            verify_active_grant(
                &inviter_grant.grant,
                &current_only_local_trust,
                unix_time()?,
            )
            .is_err()
        );
        let accepter_snapshot = accepter.state_snapshot()?;
        let accepter_relationship = active_relationship(&accepter_snapshot, &relationship_id)?;
        let accepter_grant = accepter_relationship
            .grants
            .iter()
            .find(|stored| stored.grant.status == GrantStatus::Active)
            .ok_or_else(|| invalid("active grant disappeared after remote rotation"))?;
        let durable_remote_trust = grant_trust(
            accepter_relationship,
            accepter.identity.load().certificate(),
            &accepter_grant.grant,
            unix_time()?,
            true,
        )?;
        verify_active_grant(&accepter_grant.grant, &durable_remote_trust, unix_time()?)?;
        let current_only_remote_trust = grant_trust(
            accepter_relationship,
            accepter.identity.load().certificate(),
            &accepter_grant.grant,
            unix_time()?,
            false,
        )?;
        assert!(
            verify_active_grant(
                &accepter_grant.grant,
                &current_only_remote_trust,
                unix_time()?,
            )
            .is_err()
        );
        let receipt = inviter
            .handle(IpcRequest::CommandReceipt {
                request_id: "live_rotate_receipt".into(),
                input: CommandReceiptInput {
                    owner_user_id: "owner_inviter".into(),
                    command_id: "live-command-rotate-host-0001".into(),
                },
            })
            .await;
        let expected_rotation_result = serde_json::to_value(&rotation_result)
            .map_err(|error| invalid(format!("serializing rotation test result: {error}")))?;
        assert!(matches!(
            receipt,
            IpcResponse::CommandReceipt { receipt, .. }
                if receipt.committed_at.is_some()
                    && receipt.approval_deadline == Some(rotation_deadline)
                    && receipt.result == expected_rotation_result
        ));

        // A root-signed same-serial fork from the retired predecessor is still stale.
        let fork = LocalIdentityState::decode_secret(&inviter_identity_bytes)?
            .rotate(unix_time()?, 2 * 24 * 60 * 60)?;
        let predecessor_signer = LocalIdentityState::decode_secret(&inviter_identity_bytes)?;
        let stale_now = unix_time()?;
        let stale_rotation = SignedHostCredentialRotation::sign(
            HostCredentialRotationBody {
                version: 1,
                relationship_id: decode_hex_array::<16>(&relationship_id, "relationship id")?,
                predecessor_certificate: predecessor.clone(),
                successor_certificate: fork.certificate().clone(),
                mls_commit: BoundedBytes::new(vec![1])?,
                created_at: stale_now,
                expires_at: stale_now.saturating_add(300),
            },
            predecessor_signer.device_signer(),
        )?;
        let stale_packet = PeerWirePacket::new(
            PeerWirePayload::HostCredentialRotation(stale_rotation),
            stale_now,
            stale_now.saturating_add(300),
        )?;
        assert!(matches!(
            accepter.ingest_and_ack(stale_packet).await,
            Err(PeerError::Authentication(_) | PeerError::Replay(_))
        ));

        let inviter_transport = DirectTransportRuntime::bind(
            std::slice::from_ref(&inviter_direct),
            Arc::clone(&inviter),
            true,
        )
        .await?;
        let accepter_transport = DirectTransportRuntime::bind(
            std::slice::from_ref(&accepter_direct),
            Arc::clone(&accepter),
            true,
        )
        .await?;
        let (inviter_shutdown_tx, inviter_shutdown_rx) = tokio::sync::oneshot::channel();
        let (accepter_shutdown_tx, accepter_shutdown_rx) = tokio::sync::oneshot::channel();
        let inviter_task = tokio::spawn(async move {
            inviter_transport
                .serve_until(async move {
                    let _ = inviter_shutdown_rx.await;
                })
                .await
        });
        let accepter_task = tokio::spawn(async move {
            accepter_transport
                .serve_until(async move {
                    let _ = accepter_shutdown_rx.await;
                })
                .await
        });
        let rotated_query_daemon = Arc::clone(&accepter);
        let rotated_query_relationship_id = relationship_id.clone();
        let query_after_rotation_task = tokio::spawn(async move {
            rotated_query_daemon
                .handle(IpcRequest::ExecuteQuery {
                    request_id: "live_query_after_rotation".into(),
                    input: ExecuteQueryInput {
                        owner_user_id: "owner_accepter".into(),
                        relationship_id: rotated_query_relationship_id,
                        person_id: "local-only-person-id".into(),
                        query: ApiTypedQuery {
                            projection_id: "person.profile.v1".into(),
                            parameters: serde_json::Map::new(),
                            interval: None,
                            entity_ids: Vec::new(),
                            fields: vec!["displayName".into()],
                            precision: "exact".into(),
                            maximum_result_count: 16,
                        },
                        timeout_ms: 12_000,
                    },
                })
                .await
        });
        let rotated_claim = {
            let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(10);
            let mut attempt = 0_u32;
            loop {
                attempt = attempt.saturating_add(1);
                let response = inviter
                    .handle(IpcRequest::ClaimInboundQuery {
                        request_id: format!("rotated_claim_{attempt}"),
                        command_id: format!("live-command-rotated-claim-{attempt:08}"),
                        approval_deadline: test_approval_deadline()?,
                        input: ClaimInboundQueryInput {
                            owner_user_id: "owner_inviter".into(),
                            worker_id: "rotated_query_worker_0001".into(),
                            lease_ms: 4_000,
                        },
                    })
                    .await;
                if let IpcResponse::InboundQueryClaimed { result, .. } = response
                    && let Some(claim) = result.claim
                {
                    break claim;
                }
                if tokio::time::Instant::now() >= deadline {
                    if query_after_rotation_task.is_finished() {
                        let early = query_after_rotation_task.await.map_err(|error| {
                            PeerError::Transport(format!(
                                "joining early rotated query task: {error}"
                            ))
                        })?;
                        return Err(invalid(format!(
                            "post-rotation query completed before source claim: {early:?}"
                        )));
                    }
                    let requester = accepter.state_snapshot()?;
                    let source = inviter.state_snapshot()?;
                    return Err(invalid(format!(
                        "post-rotation query was not delivered: requester outbox={}, pending={}, exchanges={}; source inbound={}, outbox={}",
                        requester.transport_outbox.len(),
                        requester.pending_applications.len(),
                        requester.query_exchanges.len(),
                        source.inbound_queries.len(),
                        source.transport_outbox.len(),
                    )));
                }
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            }
        };
        let rotated_response = inviter
            .handle(IpcRequest::RespondInboundQuery {
                request_id: "live_respond_after_rotation".into(),
                command_id: "live-command-respond-after-rotation-0001".into(),
                approval_deadline: test_approval_deadline()?,
                input: RespondInboundQueryInput {
                    owner_user_id: "owner_inviter".into(),
                    worker_id: "rotated_query_worker_0001".into(),
                    claim_id: rotated_claim.claim_id,
                    query_id: rotated_claim.query_id,
                    payload: ApiQueryPayload {
                        records: vec![ApiQueryRecord {
                            record_id: "rotated-source-local-record".into(),
                            fields: serde_json::Map::from_iter([(
                                "displayName".into(),
                                serde_json::Value::String("Rotated Person".into()),
                            )]),
                        }],
                    },
                    as_of: format_timestamp(unix_time()?)?,
                    completeness: InboundQueryCompleteness::Complete,
                    redacted_fields: Vec::new(),
                },
            })
            .await;
        if !matches!(rotated_response, IpcResponse::InboundQueryResponded { .. }) {
            return Err(invalid(format!(
                "post-rotation query response failed: {rotated_response:?}"
            )));
        }
        let query_after_rotation = query_after_rotation_task.await.map_err(|error| {
            PeerError::Transport(format!("joining rotated query task: {error}"))
        })?;
        assert!(matches!(
            query_after_rotation,
            IpcResponse::QueryExecuted { result, .. }
                if result.state == QueryResultState::Live
                    && result.metadata.source.device_id == device_id(&successor)
        ));

        let inviter_sequence_before_removal = inviter
            .state_snapshot()?
            .mls_relationships
            .iter()
            .find(|binding| binding.relationship_id == relationship_id)
            .ok_or_else(|| invalid("inviter MLS binding disappeared before device removal"))?
            .inbound_replay
            .highest_sequence;
        let device_update = accepter
            .handle(IpcRequest::UpdateDevice {
                request_id: "live_device_remove".into(),
                command_id: "live-command-device-remove-0001".into(),
                approval_deadline: test_approval_deadline()?,
                input: UpdateDeviceInput {
                    owner_user_id: "owner_accepter".into(),
                    relationship_id: relationship_id.clone(),
                    device_id: device_id(inviter.identity.load().certificate()),
                    action: DeviceAction::Remove,
                },
            })
            .await;
        assert!(matches!(device_update, IpcResponse::DeviceUpdated { .. }));
        wait_for_state(
            || {
                Ok(inviter
                    .state_snapshot()?
                    .relationships
                    .iter()
                    .find(|relationship| relationship.id == relationship_id)
                    .is_some_and(|relationship| {
                        relationship.devices.iter().any(|device| {
                            device.certificate.body.device_id
                                == accepter.identity.load().certificate().body.device_id
                                && device.status == StoredDeviceStatus::Removed
                        })
                    })
                    && inviter
                        .state_snapshot()?
                        .mls_relationships
                        .iter()
                        .find(|binding| binding.relationship_id == relationship_id)
                        .is_some_and(|binding| {
                            binding.inbound_replay.highest_sequence
                                > inviter_sequence_before_removal
                        }))
            },
            "waiting for authenticated device removal",
        )
        .await?;

        let relationship_revocation = accepter
            .handle(IpcRequest::RevokeRelationship {
                request_id: "live_relationship_revoke".into(),
                command_id: "live-command-relationship-revoke-0001".into(),
                approval_deadline: test_approval_deadline()?,
                input: RevokeRelationshipInput {
                    owner_user_id: "owner_accepter".into(),
                    relationship_id: relationship_id.clone(),
                    reason: "live authenticated relationship revocation".into(),
                },
            })
            .await;
        assert!(matches!(
            relationship_revocation,
            IpcResponse::RelationshipRevoked { .. }
        ));
        wait_for_state(
            || {
                Ok(inviter
                    .state_snapshot()?
                    .relationships
                    .iter()
                    .find(|relationship| relationship.id == relationship_id)
                    .is_some_and(|relationship| {
                        relationship.status == RelationshipStatus::Revoked
                            && relationship.revoked_reason.as_deref()
                                == Some("live authenticated relationship revocation")
                    }))
            },
            "waiting for authenticated relationship revocation",
        )
        .await?;

        let _ = inviter_shutdown_tx.send(());
        let _ = accepter_shutdown_tx.send(());
        inviter_task.await.map_err(|error| {
            PeerError::StateConflict(format!("inviter transport task: {error}"))
        })??;
        accepter_task.await.map_err(|error| {
            PeerError::StateConflict(format!("accepter transport task: {error}"))
        })??;
        drop(inviter);
        drop(accepter);
        let reopened = DurableDaemonHandler::open(
            &accepter_state_dir,
            LocalIdentityState::decode_secret(&accepter_identity_bytes)?,
            DaemonConfig {
                owner_user_id: "owner_accepter".into(),
                endpoints: vec![accepter_endpoint],
                allow_loopback_direct: true,
                command_authority: None,
            },
        )?;
        let replay = reopened
            .handle(IpcRequest::ConfirmPairing {
                request_id: "live_confirm_replay".into(),
                command_id: "live-command-confirm-0001".into(),
                approval_deadline: test_approval_deadline()?,
                input: confirm_input,
            })
            .await;
        assert!(matches!(
            replay,
            IpcResponse::PairingConfirmed { confirmation, .. }
                if confirmation == expected_confirmation
                    && confirmation.relationship.local_device.transport_endpoints
                        == expected_confirmation.relationship.local_device.transport_endpoints
                    && confirmation.relationship.remote_device.transport_endpoints
                        == expected_confirmation.relationship.remote_device.transport_endpoints
        ));
        Ok(())
    }

    #[tokio::test]
    async fn query_contract_is_validated_before_relationship_lookup() -> Result<()> {
        let (_temporary, handler) = handler("owner_query_contract")?;
        let query = ApiTypedQuery {
            projection_id: "calendar.availability.v1".into(),
            parameters: serde_json::Map::new(),
            interval: Some(ApiQueryInterval {
                starts_at: "2026-07-19T22:00:00Z".into(),
                ends_at: "2026-07-20T22:00:00Z".into(),
                time_zone: "Europe/Zurich".into(),
            }),
            entity_ids: Vec::new(),
            fields: vec!["start".into()],
            precision: "fifteen_minutes".into(),
            maximum_result_count: 100,
        };
        let input = ExecuteQueryInput {
            owner_user_id: "owner_query_contract".into(),
            relationship_id: "11".repeat(16),
            person_id: "person_query_contract".into(),
            query: query.clone(),
            timeout_ms: 2_000,
        };
        assert!(matches!(
            handler
                .handle(IpcRequest::ExecuteQuery {
                    request_id: "canonical_query_missing_relationship".into(),
                    input: input.clone(),
                })
                .await,
            IpcResponse::Rejected {
                code: IpcErrorCode::AuthorizationFailed,
                ..
            }
        ));

        let mut drifted = input;
        drifted
            .query
            .parameters
            .insert("unknown".into(), serde_json::Value::Bool(true));
        assert!(matches!(
            handler
                .handle(IpcRequest::ExecuteQuery {
                    request_id: "drifted_query_missing_relationship".into(),
                    input: drifted,
                })
                .await,
            IpcResponse::Rejected {
                code: IpcErrorCode::InvalidRequest,
                ..
            }
        ));
        Ok(())
    }

    #[test]
    fn empty_query_claim_receipts_are_bounded_without_dropping_unproven_claims() -> Result<()> {
        let (_temporary, handler) = handler("owner_idle_receipts")?;
        let empty_claim = handler.claim_inbound_query(&ClaimInboundQueryInput {
            owner_user_id: "owner_idle_receipts".into(),
            worker_id: "idle_receipt_worker".into(),
            lease_ms: 1_000,
        })?;
        assert!(empty_claim.claim.is_none());
        let now = unix_time()?;
        let mut receipts = vec![CommandReceipt {
            command_id: "unproven-claim-receipt".into(),
            operation: "claim_inbound_query".into(),
            request_hash: [1; 32],
            response_json: vec![0xff],
        }];
        for index in 0..(RETAINED_EMPTY_QUERY_CLAIM_RECEIPTS + 10) {
            receipts.push(CommandReceipt {
                command_id: format!("idle-claim-{index:04}"),
                operation: "claim_inbound_query".into(),
                request_hash: [2; 32],
                response_json: serde_json::to_vec(&StoredCommandResponse {
                    receipt_version: 1,
                    approval_deadline: now.saturating_add(60),
                    approval_deadline_rfc3339: None,
                    committed_at: now,
                    authorization: None,
                    authorization_document_hash: None,
                    result: empty_claim.clone(),
                })
                .map_err(|error| invalid(format!("serializing idle claim receipt: {error}")))?,
            });
        }

        compact_empty_query_claim_receipts(&mut receipts);

        assert_eq!(
            receipts
                .iter()
                .filter(|receipt| is_proven_empty_query_claim_receipt(receipt))
                .count(),
            RETAINED_EMPTY_QUERY_CLAIM_RECEIPTS
        );
        assert_eq!(receipts.len(), RETAINED_EMPTY_QUERY_CLAIM_RECEIPTS + 1);
        assert!(
            receipts
                .iter()
                .any(|receipt| receipt.command_id == "unproven-claim-receipt")
        );
        assert!(
            !receipts
                .iter()
                .any(|receipt| receipt.command_id == "idle-claim-0000")
        );
        assert!(receipts.iter().any(|receipt| {
            receipt.command_id
                == format!("idle-claim-{:04}", RETAINED_EMPTY_QUERY_CLAIM_RECEIPTS + 9)
        }));
        Ok(())
    }

    #[test]
    fn canonical_command_request_hash_matches_node_bridge() -> Result<()> {
        let request = IpcRequest::RevokeRelationship {
            request_id: "request_cross_language_hash".into(),
            command_id: "command_cross_language_hash_0001".into(),
            approval_deadline: "2026-07-16T08:30:00.000Z".into(),
            input: RevokeRelationshipInput {
                owner_user_id: "owner_cross_language".into(),
                relationship_id: "0123456789abcdef0123456789abcdef".into(),
                reason: "Compromised remote identity".into(),
            },
        };

        assert_eq!(
            hex::encode(canonical_command_request_hash(&request, None)?),
            "bec08dd14e44e4f3cfe88410b5ffe982e536eaa4324d9f85d9cf977a937ba829"
        );
        let large_request = IpcRequest::RevokeRelationship {
            request_id: "request_cross_language_large_hash".into(),
            command_id: "command_cross_language_large_hash_0001".into(),
            approval_deadline: "2026-07-16T08:30:00.000Z".into(),
            input: RevokeRelationshipInput {
                owner_user_id: "owner_cross_language".into(),
                relationship_id: "0123456789abcdef0123456789abcdef".into(),
                reason: "x".repeat(1_024),
            },
        };
        assert_eq!(
            hex::encode(canonical_command_request_hash(&large_request, None)?),
            "5b9e870c39574a14a5381f47b051978fcc34034997ca06caf71923551483a3e4"
        );
        let tree_request = IpcRequest::RequestResync {
            request_id: "request_cross_language_tree_hash".into(),
            command_id: "command_cross_language_tree_hash_0001".into(),
            approval_deadline: "2026-07-16T08:30:00.000Z".into(),
            input: RequestResyncInput {
                owner_user_id: "owner_cross_language".into(),
                relationship_id: "0123456789abcdef0123456789abcdef".into(),
                projection_ids: (0..128)
                    .map(|index| format!("projection_{index:03}_{}", "z".repeat(40)))
                    .collect(),
            },
        };
        assert_eq!(
            hex::encode(canonical_command_request_hash(&tree_request, None)?),
            "9cc1d511ad7211e7dc21ffd05210bad3542de2b6de8ad0620cf45a9f38b411d4"
        );

        let authorized_command_id = "command_cross_language_auth_0001";
        let authorized_deadline = "2026-07-16T08:30:00.000Z";
        let command_digest = "d".repeat(64);
        let authorized_request = IpcRequest::ClaimInboundQuery {
            request_id: "request_cross_language_auth".into(),
            command_id: authorized_command_id.into(),
            approval_deadline: authorized_deadline.into(),
            input: ClaimInboundQueryInput {
                owner_user_id: "owner_cross_language".into(),
                worker_id: "worker_cross_language".into(),
                lease_ms: 5_000,
            },
        };
        let authorization = CommandAuthorization {
            protocol: crate::command_auth::COMMAND_AUTHORIZATION_PROTOCOL.into(),
            authority_key_id: "A".repeat(43),
            authorization_id: "authorization_cross_language".into(),
            owner_user_id: "owner_cross_language".into(),
            actor: crate::command_auth::CommandActor {
                class: crate::command_auth::CommandActorClass::ServiceWorker,
                actor_id: "worker_cross_language".into(),
                session_id: "session_cross_language".into(),
                device_id: None,
            },
            capability: crate::command_auth::NodeCommandCapability {
                kind: CommandCapabilityKind::QueryWorker,
                capability_id: "capability_cross_language".into(),
                action_digest: command_digest.clone(),
                state: CommandCapabilityState::Active,
                issued_at: "2026-07-16T08:29:00.000Z".into(),
                expires_at: authorized_deadline.into(),
            },
            action: "claim_inbound_query".into(),
            command_id: authorized_command_id.into(),
            command_digest,
            approval_deadline: authorized_deadline.into(),
            issued_at: "2026-07-16T08:29:00.000Z".into(),
            invalidation_epoch: "7".into(),
            signature: "S".repeat(86),
        };
        assert_eq!(
            hex::encode(canonical_command_request_hash(
                &authorized_request,
                Some(&authorization)
            )?),
            "48e9800d2ca850b7da4a03031a6027f119a6c3d689ecb724bbefb58b754d68ac"
        );
        Ok(())
    }

    #[test]
    fn helper_builds_valid_handler() -> Result<()> {
        let (_temporary, handler) = handler("owner")?;
        assert_eq!(handler.health()?.owner_user_id, "owner");
        Ok(())
    }
}
