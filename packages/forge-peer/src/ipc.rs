use std::collections::BTreeMap;
use std::future::Future;
use std::os::unix::fs::{FileTypeExt as _, MetadataExt as _, PermissionsExt as _};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use async_trait::async_trait;
use serde::de::IgnoredAny;
use serde::{Deserialize, Serialize, Serializer};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::Semaphore;
use tokio::task::JoinSet;

use crate::PROTOCOL_NAME;
use crate::codec::{Validate, read_json_frame_body, write_json_frame};
use crate::command_auth::CommandAuthorization;
use crate::daemon::{
    AcceptGrantInput, AcceptInvitationInput, AcceptPendingRequestInput, AckRevocationEventsInput,
    AuthenticatedProvenance, CancelInvitationInput, ClaimInboundQueryInput,
    CommandAuthorityStateInput, CommandAuthorityStateView, CommandReceiptView, ConfirmPairingInput,
    CreateInvitationInput, ExecuteQueryInput, GrantOperationResult, HostCredentialRotationResult,
    InboundQueryClaimResult, InboundQueryResponseResult, InvitationCancellation,
    InvitationMaterial, ListRevocationEventsInput, LocalIdentityInput, LocalIdentityView,
    MutationResult, PairingAcceptance, PairingConfirmation, PendingRequestResult,
    QueryGatewayResult, RequestResyncInput, RespondInboundQueryInput, ResyncResult,
    RevocationAckResult, RevocationEventPage, RevokeGrantInput, RevokeRelationshipInput,
    RotateHostCredentialInput, SignGrantInput, UpdateDeviceInput,
};
use crate::error::{PeerError, Result, invalid};
use crate::grant::{
    GrantTrustResolver, PeerShareGrantVersion, VerifiedGrantEvidence, verify_active_grant,
};
use crate::provider::ProviderReadiness;
use crate::secure_fs::SecureDirectory;

const MAX_REQUEST_ID_BYTES: usize = 64;
const MIN_COMMAND_ID_CHARS: usize = 16;
const MAX_COMMAND_ID_CHARS: usize = 240;
const MAX_IPC_CONNECTIONS: usize = 32;
const IPC_HANDLER_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Deserialize)]
#[allow(clippy::zero_sized_map_values)]
struct RequestIdProbe {
    #[serde(rename = "requestId")]
    request_id: String,
    #[serde(flatten)]
    _ignored: BTreeMap<String, IgnoredAny>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum IpcRequest {
    ProtocolInfo {
        #[serde(rename = "requestId")]
        request_id: String,
    },
    VerifyGrant {
        #[serde(rename = "requestId")]
        request_id: String,
        grant: Box<PeerShareGrantVersion>,
    },
    Health {
        #[serde(rename = "requestId")]
        request_id: String,
    },
    TransportReadiness {
        #[serde(rename = "requestId")]
        request_id: String,
        input: LocalIdentityInput,
    },
    LocalIdentity {
        #[serde(rename = "requestId")]
        request_id: String,
        input: LocalIdentityInput,
    },
    CommandReceipt {
        #[serde(rename = "requestId")]
        request_id: String,
        input: crate::daemon::CommandReceiptInput,
    },
    SyncCommandAuthorizationState {
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(rename = "commandId", default, skip_serializing_if = "Option::is_none")]
        command_id: Option<String>,
        input: CommandAuthorityStateInput,
    },
    CreateInvitation {
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(rename = "commandId")]
        command_id: String,
        #[serde(rename = "approvalDeadline")]
        approval_deadline: String,
        input: CreateInvitationInput,
    },
    CancelInvitation {
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(rename = "commandId")]
        command_id: String,
        #[serde(rename = "approvalDeadline")]
        approval_deadline: String,
        input: CancelInvitationInput,
    },
    AcceptInvitation {
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(rename = "commandId")]
        command_id: String,
        #[serde(rename = "approvalDeadline")]
        approval_deadline: String,
        input: AcceptInvitationInput,
    },
    AcceptPendingRequest {
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(rename = "commandId")]
        command_id: String,
        #[serde(rename = "approvalDeadline")]
        approval_deadline: String,
        input: AcceptPendingRequestInput,
    },
    ConfirmPairing {
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(rename = "commandId")]
        command_id: String,
        #[serde(rename = "approvalDeadline")]
        approval_deadline: String,
        input: ConfirmPairingInput,
    },
    SignGrant {
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(rename = "commandId")]
        command_id: String,
        #[serde(rename = "approvalDeadline")]
        approval_deadline: String,
        input: SignGrantInput,
    },
    AcceptGrant {
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(rename = "commandId")]
        command_id: String,
        #[serde(rename = "approvalDeadline")]
        approval_deadline: String,
        input: AcceptGrantInput,
    },
    RevokeGrant {
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(rename = "commandId")]
        command_id: String,
        #[serde(rename = "approvalDeadline")]
        approval_deadline: String,
        input: RevokeGrantInput,
    },
    UpdateDevice {
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(rename = "commandId")]
        command_id: String,
        #[serde(rename = "approvalDeadline")]
        approval_deadline: String,
        input: UpdateDeviceInput,
    },
    RotateHostCredential {
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(rename = "commandId")]
        command_id: String,
        #[serde(rename = "approvalDeadline")]
        approval_deadline: String,
        input: RotateHostCredentialInput,
    },
    RevokeRelationship {
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(rename = "commandId")]
        command_id: String,
        #[serde(rename = "approvalDeadline")]
        approval_deadline: String,
        input: RevokeRelationshipInput,
    },
    RequestResync {
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(rename = "commandId")]
        command_id: String,
        #[serde(rename = "approvalDeadline")]
        approval_deadline: String,
        input: RequestResyncInput,
    },
    ExecuteQuery {
        #[serde(rename = "requestId")]
        request_id: String,
        input: ExecuteQueryInput,
    },
    ClaimInboundQuery {
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(rename = "commandId")]
        command_id: String,
        #[serde(rename = "approvalDeadline")]
        approval_deadline: String,
        input: ClaimInboundQueryInput,
    },
    RespondInboundQuery {
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(rename = "commandId")]
        command_id: String,
        #[serde(rename = "approvalDeadline")]
        approval_deadline: String,
        input: RespondInboundQueryInput,
    },
    ListRevocationEvents {
        #[serde(rename = "requestId")]
        request_id: String,
        input: ListRevocationEventsInput,
    },
    AckRevocationEvents {
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(rename = "commandId")]
        command_id: String,
        #[serde(rename = "approvalDeadline")]
        approval_deadline: String,
        input: AckRevocationEventsInput,
    },
}

impl IpcRequest {
    pub(crate) fn request_id(&self) -> &str {
        match self {
            Self::ProtocolInfo { request_id }
            | Self::VerifyGrant { request_id, .. }
            | Self::Health { request_id }
            | Self::TransportReadiness { request_id, .. }
            | Self::LocalIdentity { request_id, .. }
            | Self::CommandReceipt { request_id, .. }
            | Self::SyncCommandAuthorizationState { request_id, .. }
            | Self::CreateInvitation { request_id, .. }
            | Self::CancelInvitation { request_id, .. }
            | Self::AcceptInvitation { request_id, .. }
            | Self::AcceptPendingRequest { request_id, .. }
            | Self::ConfirmPairing { request_id, .. }
            | Self::SignGrant { request_id, .. }
            | Self::AcceptGrant { request_id, .. }
            | Self::RevokeGrant { request_id, .. }
            | Self::UpdateDevice { request_id, .. }
            | Self::RotateHostCredential { request_id, .. }
            | Self::RevokeRelationship { request_id, .. }
            | Self::RequestResync { request_id, .. }
            | Self::ExecuteQuery { request_id, .. }
            | Self::ClaimInboundQuery { request_id, .. }
            | Self::RespondInboundQuery { request_id, .. }
            | Self::ListRevocationEvents { request_id, .. }
            | Self::AckRevocationEvents { request_id, .. } => request_id,
        }
    }

    pub fn command_id(&self) -> Option<&str> {
        match self {
            Self::CreateInvitation { command_id, .. }
            | Self::CancelInvitation { command_id, .. }
            | Self::AcceptInvitation { command_id, .. }
            | Self::AcceptPendingRequest { command_id, .. }
            | Self::ConfirmPairing { command_id, .. }
            | Self::SignGrant { command_id, .. }
            | Self::AcceptGrant { command_id, .. }
            | Self::RevokeGrant { command_id, .. }
            | Self::UpdateDevice { command_id, .. }
            | Self::RotateHostCredential { command_id, .. }
            | Self::RevokeRelationship { command_id, .. }
            | Self::RequestResync { command_id, .. }
            | Self::ClaimInboundQuery { command_id, .. }
            | Self::RespondInboundQuery { command_id, .. }
            | Self::AckRevocationEvents { command_id, .. } => Some(command_id),
            Self::ProtocolInfo { .. }
            | Self::VerifyGrant { .. }
            | Self::Health { .. }
            | Self::TransportReadiness { .. }
            | Self::LocalIdentity { .. }
            | Self::CommandReceipt { .. }
            | Self::SyncCommandAuthorizationState { .. }
            | Self::ListRevocationEvents { .. }
            | Self::ExecuteQuery { .. } => None,
        }
    }

    pub fn approval_deadline(&self) -> Option<&str> {
        match self {
            Self::CreateInvitation {
                approval_deadline, ..
            }
            | Self::CancelInvitation {
                approval_deadline, ..
            }
            | Self::AcceptInvitation {
                approval_deadline, ..
            }
            | Self::AcceptPendingRequest {
                approval_deadline, ..
            }
            | Self::ConfirmPairing {
                approval_deadline, ..
            }
            | Self::SignGrant {
                approval_deadline, ..
            }
            | Self::AcceptGrant {
                approval_deadline, ..
            }
            | Self::RevokeGrant {
                approval_deadline, ..
            }
            | Self::UpdateDevice {
                approval_deadline, ..
            }
            | Self::RotateHostCredential {
                approval_deadline, ..
            }
            | Self::RevokeRelationship {
                approval_deadline, ..
            }
            | Self::RequestResync {
                approval_deadline, ..
            }
            | Self::ClaimInboundQuery {
                approval_deadline, ..
            }
            | Self::RespondInboundQuery {
                approval_deadline, ..
            }
            | Self::AckRevocationEvents {
                approval_deadline, ..
            } => Some(approval_deadline),
            Self::ProtocolInfo { .. }
            | Self::VerifyGrant { .. }
            | Self::Health { .. }
            | Self::TransportReadiness { .. }
            | Self::LocalIdentity { .. }
            | Self::CommandReceipt { .. }
            | Self::SyncCommandAuthorizationState { .. }
            | Self::ListRevocationEvents { .. }
            | Self::ExecuteQuery { .. } => None,
        }
    }

    pub const fn requires_command_authorization(&self) -> bool {
        matches!(
            self,
            Self::CreateInvitation { .. }
                | Self::CancelInvitation { .. }
                | Self::AcceptInvitation { .. }
                | Self::AcceptPendingRequest { .. }
                | Self::ConfirmPairing { .. }
                | Self::SignGrant { .. }
                | Self::AcceptGrant { .. }
                | Self::RevokeGrant { .. }
                | Self::UpdateDevice { .. }
                | Self::RotateHostCredential { .. }
                | Self::RevokeRelationship { .. }
                | Self::RequestResync { .. }
                | Self::ClaimInboundQuery { .. }
                | Self::RespondInboundQuery { .. }
                | Self::AckRevocationEvents { .. }
        )
    }

    pub const fn command_action(&self) -> Option<&'static str> {
        match self {
            Self::CreateInvitation { .. } => Some("create_invitation"),
            Self::CancelInvitation { .. } => Some("cancel_invitation"),
            Self::AcceptInvitation { .. } => Some("accept_invitation"),
            Self::AcceptPendingRequest { .. } => Some("accept_pending_request"),
            Self::ConfirmPairing { .. } => Some("confirm_pairing"),
            Self::SignGrant { .. } => Some("sign_grant"),
            Self::AcceptGrant { .. } => Some("accept_grant"),
            Self::RevokeGrant { .. } => Some("revoke_grant"),
            Self::UpdateDevice { .. } => Some("update_device"),
            Self::RotateHostCredential { .. } => Some("rotate_host_credential"),
            Self::RevokeRelationship { .. } => Some("revoke_relationship"),
            Self::RequestResync { .. } => Some("request_resync"),
            Self::ClaimInboundQuery { .. } => Some("claim_inbound_query"),
            Self::RespondInboundQuery { .. } => Some("respond_inbound_query"),
            Self::AckRevocationEvents { .. } => Some("ack_revocation_events"),
            Self::ProtocolInfo { .. }
            | Self::VerifyGrant { .. }
            | Self::Health { .. }
            | Self::TransportReadiness { .. }
            | Self::LocalIdentity { .. }
            | Self::CommandReceipt { .. }
            | Self::SyncCommandAuthorizationState { .. }
            | Self::ListRevocationEvents { .. }
            | Self::ExecuteQuery { .. } => None,
        }
    }
}

pub struct AuthorizedIpcRequest<'a> {
    request: &'a IpcRequest,
    authorization: &'a CommandAuthorization,
}

impl<'a> AuthorizedIpcRequest<'a> {
    pub fn new(request: &'a IpcRequest, authorization: &'a CommandAuthorization) -> Result<Self> {
        if !request.requires_command_authorization() {
            return Err(invalid(
                "command authorization may only accompany a mutating IPC request",
            ));
        }
        Ok(Self {
            request,
            authorization,
        })
    }
}

impl Serialize for AuthorizedIpcRequest<'_> {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut value = serde_json::to_value(self.request).map_err(serde::ser::Error::custom)?;
        value
            .as_object_mut()
            .ok_or_else(|| serde::ser::Error::custom("IPC request is not an object"))?
            .insert(
                "authorization".into(),
                serde_json::to_value(self.authorization).map_err(serde::ser::Error::custom)?,
            );
        value.serialize(serializer)
    }
}

impl Validate for AuthorizedIpcRequest<'_> {
    fn validate(&self) -> Result<()> {
        self.request.validate()?;
        if !self.request.requires_command_authorization() {
            return Err(invalid(
                "command authorization may only accompany a mutating IPC request",
            ));
        }
        if self.authorization.signature.is_empty() {
            return Err(invalid("command authorization signature is empty"));
        }
        Ok(())
    }
}

fn decode_ipc_request(body: &[u8]) -> Result<(IpcRequest, Option<CommandAuthorization>)> {
    let mut value: serde_json::Value = serde_json::from_slice(body)
        .map_err(|error| invalid(format!("decoding IPC JSON: {error}")))?;
    let object = value
        .as_object_mut()
        .ok_or_else(|| invalid("IPC request must be a JSON object"))?;
    let authorization = object
        .remove("authorization")
        .map(serde_json::from_value::<CommandAuthorization>)
        .transpose()
        .map_err(|error| invalid(format!("decoding command authorization: {error}")))?;
    let request: IpcRequest = serde_json::from_value(value)
        .map_err(|error| invalid(format!("decoding strict IPC request: {error}")))?;
    request.validate()?;
    match (request.requires_command_authorization(), &authorization) {
        (true, None) if cfg!(test) => Ok((request, None)),
        (true, None) => Err(PeerError::Authentication(
            "mutating IPC request requires a Node command authorization".into(),
        )),
        (false, Some(_)) => Err(invalid(
            "command authorization is not accepted on a non-mutating IPC request",
        )),
        _ => Ok((request, authorization)),
    }
}

impl Validate for IpcRequest {
    fn validate(&self) -> Result<()> {
        validate_request_id(self.request_id())?;
        if let Some(command_id) = self.command_id() {
            validate_command_id(command_id)?;
        }
        if let Some(deadline) = self.approval_deadline()
            && (deadline.len() < 20
                || deadline.len() > 40
                || !deadline.is_ascii()
                || deadline.contains('\0'))
        {
            return Err(invalid(
                "approvalDeadline is not a bounded RFC3339 timestamp",
            ));
        }
        match self {
            Self::VerifyGrant { grant, .. } => grant.validate(),
            Self::CreateInvitation { input, .. } => input.validate(),
            Self::CancelInvitation { input, .. } => input.validate(),
            Self::AcceptInvitation { input, .. } => input.validate(),
            Self::AcceptPendingRequest { input, .. } => input.validate(),
            Self::ConfirmPairing { input, .. } => input.validate(),
            Self::SignGrant { input, .. } => input.validate(),
            Self::AcceptGrant { input, .. } => input.validate(),
            Self::RevokeGrant { input, .. } => input.validate(),
            Self::UpdateDevice { input, .. } => input.validate(),
            Self::RotateHostCredential { input, .. } => input.validate(),
            Self::RevokeRelationship { input, .. } => input.validate(),
            Self::RequestResync { input, .. } => input.validate(),
            Self::ExecuteQuery { input, .. } => input.validate(),
            Self::ClaimInboundQuery { input, .. } => input.validate(),
            Self::RespondInboundQuery { input, .. } => input.validate(),
            Self::ListRevocationEvents { input, .. } => input.validate(),
            Self::AckRevocationEvents { input, .. } => input.validate(),
            Self::TransportReadiness { input, .. } | Self::LocalIdentity { input, .. } => {
                input.validate()
            }
            Self::CommandReceipt { input, .. } => input.validate(),
            Self::SyncCommandAuthorizationState {
                command_id, input, ..
            } => {
                if let Some(command_id) = command_id {
                    validate_command_id(command_id)?;
                }
                input.validate()
            }
            Self::ProtocolInfo { .. } | Self::Health { .. } => Ok(()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum IpcErrorCode {
    InvalidRequest,
    VerificationFailed,
    AuthenticationFailed,
    AuthorizationFailed,
    Conflict,
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[allow(clippy::large_enum_variant)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum IpcResponse {
    ProtocolInfo {
        #[serde(rename = "requestId")]
        request_id: String,
        protocol: String,
    },
    GrantVerified {
        #[serde(rename = "requestId")]
        request_id: String,
        evidence: VerifiedGrantEvidence,
    },
    Health {
        #[serde(rename = "requestId")]
        request_id: String,
        enabled: bool,
        healthy: bool,
        #[serde(rename = "protocolVersion")]
        protocol_version: String,
        reason: Option<String>,
        provenance: AuthenticatedProvenance,
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
    CommandReceipt {
        #[serde(rename = "requestId")]
        request_id: String,
        receipt: CommandReceiptView,
    },
    CommandAuthorizationStateSynchronized {
        #[serde(rename = "requestId")]
        request_id: String,
        state: CommandAuthorityStateView,
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
        result: MutationResult,
    },
    HostCredentialRotationStarted {
        #[serde(rename = "requestId")]
        request_id: String,
        result: HostCredentialRotationResult,
    },
    RelationshipRevoked {
        #[serde(rename = "requestId")]
        request_id: String,
        result: MutationResult,
    },
    ResyncRequested {
        #[serde(rename = "requestId")]
        request_id: String,
        result: ResyncResult,
    },
    QueryExecuted {
        #[serde(rename = "requestId")]
        request_id: String,
        result: QueryGatewayResult,
    },
    InboundQueryClaimed {
        #[serde(rename = "requestId")]
        request_id: String,
        result: InboundQueryClaimResult,
    },
    InboundQueryResponded {
        #[serde(rename = "requestId")]
        request_id: String,
        result: InboundQueryResponseResult,
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
        detail: String,
    },
}

impl Validate for IpcResponse {
    fn validate(&self) -> Result<()> {
        let (request_id, detail) = match self {
            Self::ProtocolInfo {
                request_id,
                protocol,
            } => {
                if protocol != PROTOCOL_NAME {
                    return Err(invalid("IPC response contains an unsupported protocol"));
                }
                (request_id, None)
            }
            Self::GrantVerified { request_id, .. }
            | Self::LocalIdentity { request_id, .. }
            | Self::CommandReceipt { request_id, .. }
            | Self::CommandAuthorizationStateSynchronized { request_id, .. }
            | Self::InvitationCreated { request_id, .. }
            | Self::InvitationCanceled { request_id, .. }
            | Self::InvitationAccepted { request_id, .. }
            | Self::PendingRequestAccepted { request_id, .. }
            | Self::PairingConfirmed { request_id, .. }
            | Self::GrantSigned { request_id, .. }
            | Self::GrantAccepted { request_id, .. }
            | Self::GrantRevoked { request_id, .. }
            | Self::DeviceUpdated { request_id, .. }
            | Self::HostCredentialRotationStarted { request_id, .. }
            | Self::RelationshipRevoked { request_id, .. }
            | Self::ResyncRequested { request_id, .. }
            | Self::QueryExecuted { request_id, .. }
            | Self::InboundQueryClaimed { request_id, .. }
            | Self::InboundQueryResponded { request_id, .. }
            | Self::RevocationEventsListed { request_id, .. }
            | Self::RevocationEventsAcknowledged { request_id, .. } => (request_id, None),
            Self::Health {
                request_id,
                protocol_version,
                reason,
                ..
            } => {
                if protocol_version != PROTOCOL_NAME
                    || reason
                        .as_ref()
                        .is_some_and(|value| value.len() > 256 || value.contains('\0'))
                {
                    return Err(invalid("IPC health response is invalid"));
                }
                (request_id, None)
            }
            Self::TransportReadiness {
                request_id,
                transports,
                ..
            } => {
                if transports.len() > 4
                    || transports
                        .windows(2)
                        .any(|pair| pair[0].kind >= pair[1].kind)
                {
                    return Err(invalid("IPC transport readiness response is invalid"));
                }
                for transport in transports {
                    transport.validate()?;
                }
                (request_id, None)
            }
            Self::Rejected {
                request_id, detail, ..
            } => (request_id, Some(detail)),
        };
        validate_request_id(request_id)?;
        if detail.is_some_and(|value| value.is_empty() || value.len() > 256 || value.contains('\0'))
        {
            return Err(invalid("IPC rejection detail is invalid"));
        }
        Ok(())
    }
}

#[async_trait]
pub trait IpcHandler: Send + Sync {
    async fn handle(&self, request: IpcRequest) -> IpcResponse;

    async fn handle_authorized(
        &self,
        request: IpcRequest,
        _authorization: Option<CommandAuthorization>,
    ) -> IpcResponse {
        self.handle(request).await
    }
}

pub struct GrantVerificationHandler<R> {
    resolver: Arc<R>,
}

impl<R> GrantVerificationHandler<R> {
    pub fn new(resolver: Arc<R>) -> Self {
        Self { resolver }
    }
}

#[async_trait]
impl<R: GrantTrustResolver + 'static> IpcHandler for GrantVerificationHandler<R> {
    async fn handle(&self, request: IpcRequest) -> IpcResponse {
        match request {
            IpcRequest::ProtocolInfo { request_id } => IpcResponse::ProtocolInfo {
                request_id,
                protocol: PROTOCOL_NAME.to_owned(),
            },
            IpcRequest::VerifyGrant { request_id, grant } => {
                match unix_time()
                    .and_then(|now| verify_active_grant(&grant, self.resolver.as_ref(), now))
                {
                    Ok(evidence) => IpcResponse::GrantVerified {
                        request_id,
                        evidence,
                    },
                    Err(_) => IpcResponse::Rejected {
                        request_id,
                        code: IpcErrorCode::VerificationFailed,
                        detail: "grant verification failed closed".into(),
                    },
                }
            }
            request => IpcResponse::Rejected {
                request_id: request.request_id().to_owned(),
                code: IpcErrorCode::Unavailable,
                detail: "operation requires the durable daemon handler".into(),
            },
        }
    }
}

pub struct OwnerIpcServer<H> {
    listener: UnixListener,
    socket_path: PathBuf,
    socket_device: u64,
    socket_inode: u64,
    owner_uid: u32,
    handler: Arc<H>,
}

impl<H> OwnerIpcServer<H> {
    fn remove_owned_socket(&self) -> Result<()> {
        let metadata = match std::fs::symlink_metadata(&self.socket_path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(error.into()),
        };
        if !metadata.file_type().is_socket()
            || metadata.dev() != self.socket_device
            || metadata.ino() != self.socket_inode
        {
            return Err(PeerError::Ipc(
                "IPC socket path changed while daemon was running".into(),
            ));
        }
        std::fs::remove_file(&self.socket_path)?;
        Ok(())
    }
}

impl<H: IpcHandler + 'static> OwnerIpcServer<H> {
    pub fn bind(socket_path: impl AsRef<Path>, handler: Arc<H>) -> Result<Self> {
        let socket_path = socket_path.as_ref();
        validate_socket_path(socket_path)?;
        let parent = socket_path
            .parent()
            .ok_or_else(|| PeerError::Ipc("IPC socket has no parent directory".into()))?;
        ensure_owner_directory(parent)?;
        match std::fs::symlink_metadata(socket_path) {
            Ok(_) => {
                return Err(PeerError::Ipc(
                    "IPC socket path already exists; refusing implicit removal".into(),
                ));
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
        let listener = UnixListener::bind(socket_path)
            .map_err(|error| PeerError::Ipc(format!("binding IPC socket: {error}")))?;
        std::fs::set_permissions(socket_path, std::fs::Permissions::from_mode(0o600))?;
        let metadata = std::fs::symlink_metadata(socket_path)?;
        let effective_uid = rustix::process::geteuid().as_raw();
        if !metadata.file_type().is_socket()
            || metadata.mode() & 0o7777 != 0o600
            || metadata.uid() != effective_uid
        {
            return Err(PeerError::Ipc(
                "IPC endpoint is not an owner-only Unix socket".into(),
            ));
        }
        Ok(Self {
            listener,
            socket_path: socket_path.to_owned(),
            socket_device: metadata.dev(),
            socket_inode: metadata.ino(),
            owner_uid: effective_uid,
            handler,
        })
    }

    pub async fn serve_once(&self) -> Result<()> {
        let (stream, _) = self.listener.accept().await?;
        self.handle_stream(stream).await
    }

    pub fn close(self) -> Result<()> {
        self.remove_owned_socket()
    }

    pub async fn serve_until<F>(self, shutdown: F) -> Result<()>
    where
        F: Future<Output = ()> + Send,
    {
        tokio::pin!(shutdown);
        let permits = Arc::new(Semaphore::new(MAX_IPC_CONNECTIONS));
        let mut connections = JoinSet::new();
        loop {
            tokio::select! {
                () = &mut shutdown => break,
                accepted = self.listener.accept() => {
                    let (stream, _) = accepted?;
                    let Ok(permit) = Arc::clone(&permits).try_acquire_owned() else {
                        drop(stream);
                        continue;
                    };
                    let handler = Arc::clone(&self.handler);
                    let owner_uid = self.owner_uid;
                    connections.spawn(async move {
                        let _permit = permit;
                        let _result = Self::handle_authenticated_stream(
                            handler,
                            owner_uid,
                            stream,
                        )
                        .await;
                    });
                }
                completed = connections.join_next(), if !connections.is_empty() => {
                    let _completed = completed;
                }
            }
        }
        connections.abort_all();
        while connections.join_next().await.is_some() {}
        self.remove_owned_socket()
    }

    async fn handle_stream(&self, stream: UnixStream) -> Result<()> {
        Self::handle_authenticated_stream(Arc::clone(&self.handler), self.owner_uid, stream).await
    }

    async fn handle_authenticated_stream(
        handler: Arc<H>,
        owner_uid: u32,
        mut stream: UnixStream,
    ) -> Result<()> {
        let peer = stream
            .peer_cred()
            .map_err(|error| PeerError::Ipc(format!("reading IPC peer credentials: {error}")))?;
        if peer.uid() != owner_uid {
            return Err(PeerError::Ipc(
                "IPC peer uid does not own the socket".into(),
            ));
        }
        let body = read_json_frame_body(&mut stream).await?;
        let (request, authorization) = match decode_ipc_request(&body) {
            Ok(request) => request,
            Err(error) => {
                let Some(request_id) = recover_valid_request_id(&body) else {
                    return Err(error);
                };
                let code = if matches!(error, PeerError::Authentication(_)) {
                    IpcErrorCode::AuthenticationFailed
                } else {
                    IpcErrorCode::InvalidRequest
                };
                return write_json_frame(
                    &mut stream,
                    &IpcResponse::Rejected {
                        request_id,
                        code,
                        detail: "IPC request does not match the strict schema".into(),
                    },
                )
                .await;
            }
        };
        let request_id = request.request_id().to_owned();
        let response = tokio::time::timeout(
            IPC_HANDLER_TIMEOUT,
            handler.handle_authorized(request, authorization),
        )
        .await
        .unwrap_or_else(|_| IpcResponse::Rejected {
            request_id,
            code: IpcErrorCode::Unavailable,
            detail: "IPC handler timed out".into(),
        });
        write_json_frame(&mut stream, &response).await
    }
}

fn recover_valid_request_id(body: &[u8]) -> Option<String> {
    let mut deserializer = serde_json::Deserializer::from_slice(body);
    let probe = RequestIdProbe::deserialize(&mut deserializer).ok()?;
    deserializer.end().ok()?;
    validate_request_id(&probe.request_id).ok()?;
    Some(probe.request_id)
}

impl<H> Drop for OwnerIpcServer<H> {
    fn drop(&mut self) {
        let _result = self.remove_owned_socket();
    }
}

pub fn recover_stale_owner_socket(socket_path: impl AsRef<Path>) -> Result<()> {
    let socket_path = socket_path.as_ref();
    validate_socket_path(socket_path)?;
    let parent = socket_path
        .parent()
        .ok_or_else(|| PeerError::Ipc("IPC socket has no parent directory".into()))?;
    ensure_owner_directory(parent)?;
    let metadata = std::fs::symlink_metadata(socket_path)?;
    let effective_uid = rustix::process::geteuid().as_raw();
    if !metadata.file_type().is_socket()
        || metadata.uid() != effective_uid
        || metadata.mode() & 0o7777 != 0o600
    {
        return Err(PeerError::Ipc(
            "stale recovery target is not the owner's private Unix socket".into(),
        ));
    }
    match std::os::unix::net::UnixStream::connect(socket_path) {
        Ok(_) => {
            return Err(PeerError::Ipc(
                "IPC socket is accepting connections and is not stale".into(),
            ));
        }
        Err(error) if error.kind() == std::io::ErrorKind::ConnectionRefused => {}
        Err(error) => {
            return Err(PeerError::Ipc(format!(
                "could not prove that IPC socket is stale: {error}"
            )));
        }
    }
    let current = std::fs::symlink_metadata(socket_path)?;
    if !current.file_type().is_socket()
        || current.dev() != metadata.dev()
        || current.ino() != metadata.ino()
    {
        return Err(PeerError::Ipc(
            "IPC socket changed during stale recovery".into(),
        ));
    }
    std::fs::remove_file(socket_path)?;
    Ok(())
}

fn ensure_owner_directory(path: &Path) -> Result<()> {
    let _directory = SecureDirectory::open_or_create(path)?;
    Ok(())
}

fn validate_socket_path(path: &Path) -> Result<()> {
    if !path.is_absolute()
        || path.file_name().is_none()
        || path.components().any(|component| {
            !matches!(
                component,
                std::path::Component::RootDir | std::path::Component::Normal(_)
            )
        })
    {
        return Err(PeerError::Ipc(
            "IPC socket must be an absolute path with no traversal components".into(),
        ));
    }
    Ok(())
}

fn validate_request_id(value: &str) -> Result<()> {
    if value.is_empty()
        || value.len() > MAX_REQUEST_ID_BYTES
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(invalid("IPC requestId is invalid"));
    }
    Ok(())
}

pub(crate) fn validate_command_id(value: &str) -> Result<()> {
    let character_count = value.chars().count();
    if !(MIN_COMMAND_ID_CHARS..=MAX_COMMAND_ID_CHARS).contains(&character_count)
        || value.chars().any(char::is_control)
        || value.trim() != value
    {
        return Err(invalid(
            "IPC commandId must contain 16..=240 non-control characters with no surrounding whitespace",
        ));
    }
    Ok(())
}

fn unix_time() -> Result<u64> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .map_err(|_| PeerError::Ipc("system clock predates Unix epoch".into()))
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::PermissionsExt as _;

    use super::*;
    use crate::codec::{FRAME_MAGIC, MAX_IPC_FRAME_BYTES, decode_json_frame, read_json_frame};
    use crate::grant::MemoryGrantTrustStore;

    #[derive(Debug, Deserialize)]
    #[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
    enum TestResponse {
        ProtocolInfo {
            #[serde(rename = "requestId")]
            request_id: String,
            protocol: String,
        },
        Rejected {
            #[serde(rename = "requestId")]
            request_id: String,
            code: IpcErrorCode,
            detail: String,
        },
    }

    impl Validate for TestResponse {
        fn validate(&self) -> Result<()> {
            match self {
                Self::ProtocolInfo {
                    request_id,
                    protocol,
                } => {
                    validate_request_id(request_id)?;
                    if protocol != crate::PROTOCOL_NAME {
                        return Err(invalid("test response has wrong protocol"));
                    }
                }
                Self::Rejected {
                    request_id, detail, ..
                } => {
                    validate_request_id(request_id)?;
                    if detail.is_empty() || detail.len() > 256 {
                        return Err(invalid("test response rejection detail is invalid"));
                    }
                }
            }
            Ok(())
        }
    }

    #[test]
    fn verify_request_rejects_caller_asserted_evidence() {
        let body =
            br#"{"type":"protocol_info","requestId":"request_1","verifiedGrantHash":"caller"}"#;
        assert!(body.len() < MAX_IPC_FRAME_BYTES);
        let mut frame = Vec::new();
        frame.extend_from_slice(&FRAME_MAGIC);
        frame.push(crate::codec::FrameType::LocalIpc as u8);
        frame.push(0);
        let body_len = u32::try_from(body.len()).unwrap_or_default();
        frame.extend_from_slice(&body_len.to_be_bytes());
        frame.extend_from_slice(body);
        assert!(decode_json_frame::<IpcRequest>(&frame).is_err());
    }

    #[test]
    fn management_request_rejects_unknown_outer_and_input_fields() -> Result<()> {
        let request = IpcRequest::CancelInvitation {
            request_id: "cancel_schema_1".into(),
            command_id: "command-cancel-schema-0001".into(),
            approval_deadline: "2026-07-15T23:59:59Z".into(),
            input: CancelInvitationInput {
                owner_user_id: "owner".into(),
                invitation_id: "01".repeat(16),
            },
        };
        request.validate()?;
        let mut unknown_outer = serde_json::to_value(&request)
            .map_err(|error| invalid(format!("serializing request schema test: {error}")))?;
        unknown_outer
            .as_object_mut()
            .ok_or_else(|| invalid("request schema test is not an object"))?
            .insert(
                "authorization".into(),
                serde_json::Value::String("caller".into()),
            );
        assert!(serde_json::from_value::<IpcRequest>(unknown_outer).is_err());

        let mut unknown_input = serde_json::to_value(&request)
            .map_err(|error| invalid(format!("serializing request schema test: {error}")))?;
        unknown_input
            .get_mut("input")
            .and_then(serde_json::Value::as_object_mut)
            .ok_or_else(|| invalid("request input schema test is not an object"))?
            .insert("force".into(), serde_json::Value::Bool(true));
        assert!(serde_json::from_value::<IpcRequest>(unknown_input).is_err());
        Ok(())
    }

    #[test]
    fn authority_sync_accepts_a_strict_optional_command_id() -> Result<()> {
        let request = IpcRequest::SyncCommandAuthorizationState {
            request_id: "sync_authority_schema_1".into(),
            command_id: Some("command-sync-authority-0001".into()),
            input: CommandAuthorityStateInput {
                owner_user_id: "owner".into(),
            },
        };
        request.validate()?;

        let mut missing_command_id = serde_json::to_value(&request)
            .map_err(|error| invalid(format!("serializing authority sync: {error}")))?;
        missing_command_id
            .as_object_mut()
            .ok_or_else(|| invalid("authority sync is not an object"))?
            .remove("commandId");
        serde_json::from_value::<IpcRequest>(missing_command_id)
            .map_err(|error| invalid(format!("parsing authority sync: {error}")))?
            .validate()?;

        let mut malformed_command_id = serde_json::to_value(&request)
            .map_err(|error| invalid(format!("serializing authority sync: {error}")))?;
        malformed_command_id
            .as_object_mut()
            .ok_or_else(|| invalid("authority sync is not an object"))?
            .insert(
                "commandId".into(),
                serde_json::Value::String("short".into()),
            );
        let malformed_command_id = serde_json::from_value::<IpcRequest>(malformed_command_id)
            .map_err(|error| invalid(format!("parsing authority sync: {error}")))?;
        assert!(malformed_command_id.validate().is_err());

        let mut unknown = serde_json::to_value(&request)
            .map_err(|error| invalid(format!("serializing authority sync: {error}")))?;
        unknown
            .as_object_mut()
            .ok_or_else(|| invalid("authority sync is not an object"))?
            .insert("force".into(), serde_json::Value::Bool(true));
        assert!(serde_json::from_value::<IpcRequest>(unknown).is_err());
        Ok(())
    }

    #[tokio::test]
    async fn owner_socket_is_mode_0600_and_serves_typed_protocol_info() -> Result<()> {
        let directory = tempfile::tempdir()?;
        std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o700))?;
        let socket = std::fs::canonicalize(directory.path())?.join("forge-peer.sock");
        let handler = Arc::new(GrantVerificationHandler::new(Arc::new(
            MemoryGrantTrustStore::default(),
        )));
        let server = OwnerIpcServer::bind(&socket, handler)?;
        assert_eq!(
            std::fs::metadata(&socket)?.permissions().mode() & 0o777,
            0o600
        );

        let client = async {
            let mut stream = UnixStream::connect(&socket).await?;
            write_json_frame(
                &mut stream,
                &IpcRequest::ProtocolInfo {
                    request_id: "request_1".into(),
                },
            )
            .await?;
            read_json_frame::<_, TestResponse>(&mut stream).await
        };
        let (serve_result, response) = tokio::join!(server.serve_once(), client);
        serve_result?;
        assert!(matches!(
            response?,
            TestResponse::ProtocolInfo { protocol, .. } if protocol == crate::PROTOCOL_NAME
        ));
        server.close()?;
        Ok(())
    }

    #[tokio::test]
    async fn valid_frame_with_query_schema_drift_gets_framed_rejection() -> Result<()> {
        use tokio::io::AsyncWriteExt as _;

        let directory = tempfile::tempdir()?;
        std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o700))?;
        let socket = std::fs::canonicalize(directory.path())?.join("forge-peer.sock");
        let handler = Arc::new(GrantVerificationHandler::new(Arc::new(
            MemoryGrantTrustStore::default(),
        )));
        let server = OwnerIpcServer::bind(&socket, handler)?;
        let request_id = "rust_unknown_query_key_1";
        let body = serde_json::to_vec(&serde_json::json!({
            "type": "execute_query",
            "requestId": request_id,
            "input": {
                "ownerUserId": "user_peer_rust_ipc",
                "relationshipId": "11".repeat(16),
                "personId": "person_rust_ipc",
                "timeoutMs": 2_000,
                "query": {
                    "projectionId": "calendar.availability.v1",
                    "parameters": {},
                    "interval": {
                        "startsAt": "2026-07-19T22:00:00.000Z",
                        "endsAt": "2026-07-20T22:00:00.000Z",
                        "timeZone": "Europe/Zurich"
                    },
                    "entityIds": [],
                    "fields": ["start"],
                    "precision": "fifteen_minutes",
                    "maximumResultCount": 100,
                    "unsupportedKey": true
                }
            }
        }))
        .map_err(|error| invalid(format!("encoding schema-drift request: {error}")))?;
        let body_len = u32::try_from(body.len())
            .map_err(|_| invalid("schema-drift request length does not fit u32"))?;
        let mut frame = Vec::with_capacity(crate::codec::FRAME_HEADER_BYTES + body.len());
        frame.extend_from_slice(&FRAME_MAGIC);
        frame.push(crate::codec::FrameType::LocalIpc as u8);
        frame.push(0);
        frame.extend_from_slice(&body_len.to_be_bytes());
        frame.extend_from_slice(&body);

        let client = async {
            let mut stream = UnixStream::connect(&socket).await?;
            stream.write_all(&frame).await?;
            stream.shutdown().await?;
            read_json_frame::<_, TestResponse>(&mut stream).await
        };
        let (serve_result, response) = tokio::join!(server.serve_once(), client);
        serve_result?;
        assert!(matches!(
            response?,
            TestResponse::Rejected {
                request_id: actual_request_id,
                code: IpcErrorCode::InvalidRequest,
                ..
            } if actual_request_id == request_id
        ));
        server.close()?;
        Ok(())
    }

    #[tokio::test]
    async fn malformed_and_stalled_clients_do_not_stop_or_block_the_daemon() -> Result<()> {
        let directory = tempfile::tempdir()?;
        std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o700))?;
        let socket = std::fs::canonicalize(directory.path())?.join("forge-peer.sock");
        let handler = Arc::new(GrantVerificationHandler::new(Arc::new(
            MemoryGrantTrustStore::default(),
        )));
        let server = OwnerIpcServer::bind(&socket, handler)?;
        let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel();
        let server_task = tokio::spawn(server.serve_until(async {
            let _result = shutdown_rx.await;
        }));

        let _stalled = UnixStream::connect(&socket).await?;
        let mut malformed = UnixStream::connect(&socket).await?;
        tokio::io::AsyncWriteExt::write_all(&mut malformed, b"not-a-forge-frame").await?;
        tokio::io::AsyncWriteExt::shutdown(&mut malformed).await?;

        let mut valid = UnixStream::connect(&socket).await?;
        write_json_frame(
            &mut valid,
            &IpcRequest::ProtocolInfo {
                request_id: "request_after_bad_clients".into(),
            },
        )
        .await?;
        let response: TestResponse = read_json_frame(&mut valid).await?;
        assert!(matches!(response, TestResponse::ProtocolInfo { .. }));

        shutdown_tx.send(()).map_err(|()| {
            PeerError::StateConflict("daemon shutdown receiver disappeared".into())
        })?;
        server_task
            .await
            .map_err(|error| PeerError::StateConflict(format!("daemon task failed: {error}")))??;
        assert!(!socket.exists());
        Ok(())
    }

    #[test]
    fn stale_socket_recovery_refuses_live_or_replaced_paths() -> Result<()> {
        let directory = tempfile::tempdir()?;
        std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o700))?;
        let socket = std::fs::canonicalize(directory.path())?.join("stale.sock");
        let listener = std::os::unix::net::UnixListener::bind(&socket)?;
        std::fs::set_permissions(&socket, std::fs::Permissions::from_mode(0o600))?;
        assert!(recover_stale_owner_socket(&socket).is_err());
        drop(listener);
        recover_stale_owner_socket(&socket)?;
        assert!(!socket.exists());

        std::fs::write(&socket, b"preserve me")?;
        assert!(recover_stale_owner_socket(&socket).is_err());
        assert_eq!(std::fs::read(&socket)?, b"preserve me");
        Ok(())
    }

    #[test]
    fn ipc_refuses_group_accessible_directory() -> Result<()> {
        let directory = tempfile::tempdir()?;
        std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o750))?;
        let handler = Arc::new(GrantVerificationHandler::new(Arc::new(
            MemoryGrantTrustStore::default(),
        )));
        let socket = std::fs::canonicalize(directory.path())?.join("peer.sock");
        assert!(OwnerIpcServer::bind(socket, handler).is_err());
        Ok(())
    }

    #[test]
    fn ipc_refuses_traversal_and_symlinked_parent_paths() -> Result<()> {
        use std::os::unix::fs::symlink;

        let directory = tempfile::tempdir()?;
        let root = std::fs::canonicalize(directory.path())?;
        let private = root.join("private");
        std::fs::create_dir(&private)?;
        std::fs::set_permissions(&private, std::fs::Permissions::from_mode(0o700))?;
        symlink(&private, root.join("linked"))?;
        let handler = Arc::new(GrantVerificationHandler::new(Arc::new(
            MemoryGrantTrustStore::default(),
        )));
        assert!(OwnerIpcServer::bind(root.join("linked/peer.sock"), Arc::clone(&handler)).is_err());
        assert!(OwnerIpcServer::bind(private.join("../escape.sock"), handler).is_err());
        Ok(())
    }
}
