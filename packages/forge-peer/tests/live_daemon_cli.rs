#![cfg(unix)]

use std::net::{Ipv4Addr, TcpListener};
use std::os::unix::fs::PermissionsExt as _;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use ed25519_dalek::{Signer as _, SigningKey};
use forge_peer::codec::write_json_frame;
use forge_peer::command_auth::{
    COMMAND_AUTHORITY_STATE_FILE, COMMAND_AUTHORITY_STATE_PROTOCOL, COMMAND_AUTHORIZATION_PROTOCOL,
    CommandActor, CommandActorClass, CommandAuthorityState, CommandAuthorization,
    CommandCapabilityKind, CommandCapabilityState, NodeCommandAuthority, NodeCommandCapability,
    authority_state_signing_bytes, command_authorization_signing_bytes,
};
use forge_peer::daemon::{
    AcceptGrantInput, AcceptInvitationInput, AcceptPendingRequestInput, AckRevocationEventsInput,
    ApiPendingRequest, ApiQueryPayload, ApiQueryRecord, ApiTypedQuery, CancelInvitationInput,
    ClaimInboundQueryInput, CommandAuthorityStateInput, CommandReceiptInput, CommandReceiptView,
    ConfirmPairingInput, CreateInvitationInput, DeviceAction, ExecuteQueryInput,
    GrantOperationResult, HostCredentialRotationResult, HostCredentialRotationState,
    InboundQueryClaimResult, InboundQueryCompleteness, InvitationMaterial,
    ListRevocationEventsInput, LocalIdentityInput, LocalIdentityView, PairingAcceptance,
    PairingConfirmation, PendingRequestKind, PendingRequestStatus, PrivacyMode, QueryGatewayResult,
    QueryResultState, RequestResyncInput, RespondInboundQueryInput, RevocationAckResult,
    RevocationEventPage, RevokeGrantInput, RevokeRelationshipInput, RotateHostCredentialInput,
    SignGrantInput, TransportKind, UpdateDeviceInput, command_action_digest,
};
use forge_peer::grant::{
    CacheMode, CachePolicy, DevicePolicy, FieldPolicy, GrantStatus, PeerShareGrantVersion,
    ProjectionId, RuleEffect, ShareDirection, ShareRule, TimePolicy,
};
use forge_peer::ipc::{AuthorizedIpcRequest, IpcRequest};
use forge_peer::provider::{ProviderKind, ProviderReadiness, ProviderRuntimeState};
use forge_peer::secure_fs::SecureDirectory;
use forge_peer::{PeerError, Result};
use serde::de::DeserializeOwned;
use sha2::{Digest as _, Sha256};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use tokio::io::AsyncReadExt as _;
use tokio::net::{TcpListener as TokioTcpListener, TcpStream as TokioTcpStream, UnixStream};
use tokio_rustls::TlsAcceptor;
use tokio_rustls::rustls::ServerConfig;
use tokio_rustls::rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};

const LIVE_WAIT_TIMEOUT: Duration = Duration::from_secs(120);
static LIVE_TRANSPORT_TEST_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

struct ChildGuard(Child);

impl Drop for ChildGuard {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

async fn terminate_daemon(child: &mut ChildGuard) -> Result<()> {
    let signal = Command::new("kill")
        .arg("-TERM")
        .arg(child.0.id().to_string())
        .status()?;
    if !signal.success() {
        return Err(PeerError::StateConflict(
            "sending SIGTERM to CLI daemon failed".into(),
        ));
    }
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    loop {
        if let Some(status) = child.0.try_wait()? {
            if status.success() {
                return Ok(());
            }
            return Err(PeerError::StateConflict(format!(
                "CLI daemon exited unsuccessfully after SIGTERM: {status}"
            )));
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(PeerError::Timeout("waiting for CLI SIGTERM shutdown"));
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

#[derive(Clone)]
enum LivePeerTransport {
    Iroh,
    HttpMailbox { origin: String, ca_file: PathBuf },
}

impl LivePeerTransport {
    const fn invitation_kind(&self) -> TransportKind {
        match self {
            Self::Iroh => TransportKind::Iroh,
            Self::HttpMailbox { .. } => TransportKind::HttpMailbox,
        }
    }
}

struct MailboxHarness {
    origin: String,
    ca_file: PathBuf,
    _root: tempfile::TempDir,
    _service: ChildGuard,
    proxy: tokio::task::JoinHandle<()>,
}

impl Drop for MailboxHarness {
    fn drop(&mut self) {
        self.proxy.abort();
    }
}

async fn start_mailbox_harness() -> Result<MailboxHarness> {
    if tokio_rustls::rustls::crypto::CryptoProvider::get_default().is_none() {
        tokio_rustls::rustls::crypto::aws_lc_rs::default_provider()
            .install_default()
            .map_err(|_| {
                PeerError::StateConflict("installing test TLS crypto provider failed".into())
            })?;
    }
    let root = tempfile::tempdir()?;
    std::fs::set_permissions(root.path(), std::fs::Permissions::from_mode(0o700))?;
    let backend_port = reserve_port()?;
    let service_entry = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../forge-connectivity-service/dist/main.js");
    if !service_entry.is_file() {
        return Err(PeerError::StateConflict(
            "connectivity service dist/main.js is unavailable; run its build first".into(),
        ));
    }
    let child = Command::new("node")
        .arg(service_entry)
        .env("FORGE_CONNECTIVITY_HOST", "127.0.0.1")
        .env("FORGE_CONNECTIVITY_PORT", backend_port.to_string())
        .env(
            "FORGE_CONNECTIVITY_DATABASE_PATH",
            root.path().join("connectivity.sqlite"),
        )
        .env("FORGE_CONNECTIVITY_LOG_LEVEL", "silent")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::inherit())
        .spawn()?;
    let mut service = ChildGuard(child);
    let backend_address = format!("127.0.0.1:{backend_port}");
    let startup_deadline = tokio::time::Instant::now() + Duration::from_secs(15);
    loop {
        if TokioTcpStream::connect(&backend_address).await.is_ok() {
            break;
        }
        if let Some(status) = service.0.try_wait()? {
            return Err(PeerError::StateConflict(format!(
                "connectivity service exited during startup with {status}"
            )));
        }
        if tokio::time::Instant::now() >= startup_deadline {
            return Err(PeerError::Timeout(
                "starting local Forge connectivity service",
            ));
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }

    let certified = rcgen::generate_simple_self_signed(vec!["localhost".into()])
        .map_err(|error| PeerError::StateConflict(format!("generating test TLS CA: {error}")))?;
    let ca_file = root.path().join("mailbox-ca.pem");
    std::fs::write(&ca_file, certified.cert.pem())?;
    std::fs::set_permissions(&ca_file, std::fs::Permissions::from_mode(0o600))?;
    let certificate = CertificateDer::from(certified.cert.der().to_vec());
    let private_key = PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(
        certified.signing_key.serialize_der(),
    ));
    let tls_config = ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(vec![certificate], private_key)
        .map_err(|error| PeerError::StateConflict(format!("building test TLS proxy: {error}")))?;
    let listener = TokioTcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await?;
    let proxy_port = listener.local_addr()?.port();
    let acceptor = TlsAcceptor::from(Arc::new(tls_config));
    let proxy_backend = backend_address.clone();
    let proxy = tokio::spawn(async move {
        loop {
            let Ok((stream, _)) = listener.accept().await else {
                return;
            };
            let connection_acceptor = acceptor.clone();
            let connection_backend = proxy_backend.clone();
            tokio::spawn(async move {
                let Ok(mut tls) = connection_acceptor.accept(stream).await else {
                    return;
                };
                let Ok(mut backend) = TokioTcpStream::connect(connection_backend).await else {
                    return;
                };
                let _copied = tokio::io::copy_bidirectional(&mut tls, &mut backend).await;
            });
        }
    });
    Ok(MailboxHarness {
        origin: format!("https://localhost:{proxy_port}"),
        ca_file,
        _root: root,
        _service: service,
        proxy,
    })
}

fn now() -> Result<u64> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .map_err(|_| PeerError::StateConflict("system clock predates Unix epoch".into()))
}

fn timestamp(value: u64) -> Result<String> {
    OffsetDateTime::from_unix_timestamp(
        i64::try_from(value).map_err(|_| PeerError::InvalidData("timestamp overflow".into()))?,
    )
    .map_err(|error| PeerError::InvalidData(format!("invalid timestamp: {error}")))?
    .format(&Rfc3339)
    .map_err(|error| PeerError::InvalidData(format!("formatting timestamp: {error}")))
}

fn approval_deadline() -> Result<String> {
    static DEADLINE: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    if let Some(deadline) = DEADLINE.get() {
        return Ok(deadline.clone());
    }
    let generated = timestamp(now()?.saturating_add(3_600))?;
    let _already_set = DEADLINE.set(generated);
    DEADLINE
        .get()
        .cloned()
        .ok_or_else(|| PeerError::StateConflict("test approval deadline was not set".into()))
}

fn reserve_port() -> Result<u16> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
    Ok(listener.local_addr()?.port())
}

fn initialize_identity(binary: &Path, state_dir: &Path) -> Result<()> {
    let output = Command::new(binary)
        .args(["identity", "init", "--state-dir"])
        .arg(state_dir)
        .args(["--valid-days", "1"])
        .output()?;
    if !output.status.success() {
        return Err(PeerError::StateConflict(format!(
            "identity init failed: {}",
            String::from_utf8_lossy(&output.stderr)
        )));
    }
    Ok(())
}

fn recover_socket(binary: &Path, socket: &Path) -> Result<()> {
    let output = Command::new(binary)
        .args(["recover-socket", "--socket"])
        .arg(socket)
        .output()?;
    if !output.status.success() {
        return Err(PeerError::StateConflict(format!(
            "socket recovery failed: {}",
            String::from_utf8_lossy(&output.stderr)
        )));
    }
    Ok(())
}

fn command_signing_key() -> SigningKey {
    SigningKey::from_bytes(&[83_u8; 32])
}

fn command_authority() -> Result<NodeCommandAuthority> {
    NodeCommandAuthority::from_base64url_public_key(
        &URL_SAFE_NO_PAD.encode(command_signing_key().verifying_key().to_bytes()),
    )
}

fn install_command_authority_state(state_dir: &Path, owner: &str) -> Result<()> {
    install_command_authority_state_at(state_dir, owner, 1, Vec::new())
}

fn install_command_authority_state_at(
    state_dir: &Path,
    owner: &str,
    epoch: u64,
    revoked_session_ids: Vec<String>,
) -> Result<()> {
    let signing_key = command_signing_key();
    let authority = command_authority()?;
    let mut state = CommandAuthorityState {
        protocol: COMMAND_AUTHORITY_STATE_PROTOCOL.into(),
        authority_key_id: authority.key_id().into(),
        owner_user_id: owner.into(),
        epoch: epoch.to_string(),
        invalidated_before: "1970-01-01T00:00:00Z".into(),
        revoked_authorization_ids: Vec::new(),
        revoked_session_ids,
        revoked_device_ids: Vec::new(),
        signature: URL_SAFE_NO_PAD.encode([0_u8; 64]),
    };
    state.signature = URL_SAFE_NO_PAD.encode(
        signing_key
            .sign(&authority_state_signing_bytes(&state)?)
            .to_bytes(),
    );
    let bytes = serde_json::to_vec(&state)
        .map_err(|error| PeerError::InvalidData(format!("encode authority state: {error}")))?;
    SecureDirectory::open_or_create(state_dir)?
        .atomic_write_secret(COMMAND_AUTHORITY_STATE_FILE, &bytes)
}

fn spawn_daemon(
    binary: &Path,
    state_dir: &Path,
    socket: &Path,
    owner: &str,
    port: u16,
    transport: &LivePeerTransport,
) -> Result<ChildGuard> {
    let mut command = Command::new(binary);
    command
        .arg("serve")
        .arg("--socket")
        .arg(socket)
        .arg("--state-dir")
        .arg(state_dir)
        .arg("--owner-user-id")
        .arg(owner)
        .arg("--command-authority-public-key")
        .arg(command_authority()?.public_key_base64url())
        .arg("--direct-endpoint")
        .arg(format!("127.0.0.1:{port}"))
        .arg("--allow-loopback-direct");
    command.env("RUST_LOG", "forge_peer::transport=warn");
    match transport {
        LivePeerTransport::Iroh => {
            command.arg("--enable-iroh");
        }
        LivePeerTransport::HttpMailbox { origin, ca_file } => {
            command
                .arg("--mailbox-origin")
                .arg(origin)
                .arg("--mailbox-allow-loopback-origin")
                .arg("--mailbox-ca-file")
                .arg(ca_file)
                .args(["--mailbox-poll-interval-ms", "250"]);
        }
    }
    let child = command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::inherit())
        .spawn()?;
    Ok(ChildGuard(child))
}

fn command_authorization(request: &IpcRequest) -> Result<CommandAuthorization> {
    let command_id = request
        .command_id()
        .ok_or_else(|| PeerError::InvalidData("mutating test request has no commandId".into()))?;
    let approval_deadline = request.approval_deadline().ok_or_else(|| {
        PeerError::InvalidData("mutating test request has no approvalDeadline".into())
    })?;
    let action = request.command_action().ok_or_else(|| {
        PeerError::InvalidData("mutating test request has no command action".into())
    })?;
    let request_value = serde_json::to_value(request).map_err(|error| {
        PeerError::InvalidData(format!("serialize test command request: {error}"))
    })?;
    let owner = request_value["input"]["ownerUserId"]
        .as_str()
        .ok_or_else(|| PeerError::InvalidData("test command has no ownerUserId".into()))?;
    let issued_at = timestamp(now()?.saturating_sub(1))?;
    let authorization_id = format!(
        "authorization_{}",
        &hex::encode(Sha256::digest(command_id.as_bytes()))[..32]
    );
    let (actor_class, actor_id, capability_kind, capability_state) = match action {
        "claim_inbound_query" | "respond_inbound_query" => (
            CommandActorClass::ServiceWorker,
            "cli_query_worker_000001",
            CommandCapabilityKind::QueryWorker,
            CommandCapabilityState::Active,
        ),
        "ack_revocation_events" => (
            CommandActorClass::ServiceWorker,
            "cli_revocation_worker_000001",
            CommandCapabilityKind::RevocationConsumer,
            CommandCapabilityState::Active,
        ),
        _ => (
            CommandActorClass::OperatorSession,
            "cli_operator_session_000001",
            CommandCapabilityKind::HumanApproval,
            CommandCapabilityState::Consumed,
        ),
    };
    let mut authorization = CommandAuthorization {
        protocol: COMMAND_AUTHORIZATION_PROTOCOL.into(),
        authority_key_id: command_authority()?.key_id().into(),
        authorization_id,
        owner_user_id: owner.into(),
        actor: CommandActor {
            class: actor_class,
            actor_id: actor_id.into(),
            session_id: actor_id.into(),
            device_id: None,
        },
        capability: NodeCommandCapability {
            kind: capability_kind,
            capability_id: format!(
                "capability_{}",
                &hex::encode(Sha256::digest(command_id.as_bytes()))[..32]
            ),
            action_digest: hex::encode(Sha256::digest(
                format!("command-capability:{command_id}").as_bytes(),
            )),
            state: capability_state,
            issued_at: issued_at.clone(),
            expires_at: approval_deadline.into(),
        },
        action: action.into(),
        command_id: command_id.into(),
        command_digest: command_action_digest(request)?,
        approval_deadline: approval_deadline.into(),
        issued_at,
        invalidation_epoch: "1".into(),
        signature: URL_SAFE_NO_PAD.encode([0_u8; 64]),
    };
    authorization.signature = URL_SAFE_NO_PAD.encode(
        command_signing_key()
            .sign(&command_authorization_signing_bytes(&authorization)?)
            .to_bytes(),
    );
    Ok(authorization)
}

async fn write_test_ipc_request(
    stream: &mut UnixStream,
    request: &IpcRequest,
    authorization: Option<&CommandAuthorization>,
) -> Result<()> {
    if request.requires_command_authorization() {
        let authorization = authorization.ok_or_else(|| {
            PeerError::InvalidData("mutating test request has no authorization".into())
        })?;
        write_json_frame(stream, &AuthorizedIpcRequest::new(request, authorization)?).await
    } else {
        write_json_frame(stream, request).await
    }
}

async fn raw_ipc(socket: &Path, request: &IpcRequest) -> Result<serde_json::Value> {
    let authorization = request
        .requires_command_authorization()
        .then(|| command_authorization(request))
        .transpose()?;
    raw_ipc_with_authorization(socket, request, authorization.as_ref()).await
}

async fn raw_ipc_with_authorization(
    socket: &Path,
    request: &IpcRequest,
    authorization: Option<&CommandAuthorization>,
) -> Result<serde_json::Value> {
    let mut stream = UnixStream::connect(socket).await?;
    write_test_ipc_request(&mut stream, request, authorization).await?;
    read_ipc_response(&mut stream).await
}

async fn send_ipc_without_reading_response(
    socket: &Path,
    request: &IpcRequest,
    authorization: &CommandAuthorization,
) -> Result<()> {
    let mut stream = UnixStream::connect(socket).await?;
    write_test_ipc_request(&mut stream, request, Some(authorization)).await?;
    drop(stream);
    Ok(())
}

async fn raw_unauthorized_ipc(socket: &Path, request: &IpcRequest) -> Result<serde_json::Value> {
    let mut stream = UnixStream::connect(socket).await?;
    write_json_frame(&mut stream, request).await?;
    read_ipc_response(&mut stream).await
}

async fn read_ipc_response(stream: &mut UnixStream) -> Result<serde_json::Value> {
    let mut header = [0_u8; 10];
    stream.read_exact(&mut header).await?;
    if header[..4] != *b"FGP1" || header[4] != 2 || header[5] != 0 {
        return Err(PeerError::Ipc("invalid CLI IPC response frame".into()));
    }
    let length =
        usize::try_from(u32::from_be_bytes(header[6..10].try_into().map_err(
            |_| PeerError::Ipc("invalid CLI IPC response length".into()),
        )?))
        .map_err(|_| PeerError::Ipc("CLI IPC response length overflow".into()))?;
    if length > 64 * 1024 {
        return Err(PeerError::LimitExceeded(
            "CLI IPC response exceeds 64 KiB".into(),
        ));
    }
    let mut body = vec![0_u8; length];
    stream.read_exact(&mut body).await?;
    serde_json::from_slice(&body)
        .map_err(|error| PeerError::InvalidData(format!("invalid CLI IPC JSON: {error}")))
}

fn response_field<T: DeserializeOwned>(
    response: &serde_json::Value,
    expected_type: &str,
    field: &str,
) -> Result<T> {
    if response["type"] != expected_type {
        return Err(PeerError::StateConflict(format!(
            "expected {expected_type}, received {response}"
        )));
    }
    serde_json::from_value(response[field].clone()).map_err(|error| {
        PeerError::InvalidData(format!("invalid {expected_type}.{field}: {error}"))
    })
}

async fn wait_for_identity(socket: &Path, owner: &str) -> Result<LocalIdentityView> {
    let deadline = tokio::time::Instant::now() + LIVE_WAIT_TIMEOUT;
    loop {
        if let Ok(response) = raw_ipc(
            socket,
            &IpcRequest::LocalIdentity {
                request_id: "cli_identity_ready".into(),
                input: LocalIdentityInput {
                    owner_user_id: owner.into(),
                },
            },
        )
        .await
            && response["type"] == "local_identity"
        {
            return response_field(&response, "local_identity", "identity");
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(PeerError::Timeout("waiting for CLI daemon identity"));
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

async fn wait_for_transport_readiness(
    socket: &Path,
    owner: &str,
    kind: ProviderKind,
) -> Result<ProviderReadiness> {
    let deadline = tokio::time::Instant::now() + LIVE_WAIT_TIMEOUT;
    loop {
        if let Ok(response) = raw_ipc(
            socket,
            &IpcRequest::TransportReadiness {
                request_id: "cli_transport_ready".into(),
                input: LocalIdentityInput {
                    owner_user_id: owner.into(),
                },
            },
        )
        .await
            && response["type"] == "transport_readiness"
        {
            let transports: Vec<ProviderReadiness> =
                response_field(&response, "transport_readiness", "transports")?;
            if let Some(readiness) = transports.into_iter().find(|item| item.kind == kind)
                && readiness.state == ProviderRuntimeState::Ready
            {
                return Ok(readiness);
            }
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(PeerError::Timeout("waiting for CLI transport readiness"));
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

fn pending_payload_hash(payload: &serde_json::Map<String, serde_json::Value>) -> Result<String> {
    let canonical = serde_json_canonicalizer::to_vec(payload)
        .map_err(|error| PeerError::InvalidData(format!("canonical pending payload: {error}")))?;
    Ok(hex::encode(Sha256::digest(canonical)))
}

fn pending_request(
    id: &str,
    owner: &str,
    relationship_id: Option<String>,
    kind: PendingRequestKind,
    payload: serde_json::Map<String, serde_json::Value>,
    expires_at: String,
    created_at: String,
) -> Result<ApiPendingRequest> {
    Ok(ApiPendingRequest {
        id: id.into(),
        owner_user_id: owner.into(),
        relationship_id,
        kind,
        status: PendingRequestStatus::Pending,
        version: 1,
        payload_hash: pending_payload_hash(&payload)?,
        payload,
        expires_at,
        decided_at: None,
        decision_reason: String::new(),
        created_at: created_at.clone(),
        updated_at: created_at,
    })
}

fn grant(
    owner: &str,
    relationship_id: &str,
    approved_device_id: &str,
    issued_at: String,
) -> Result<PeerShareGrantVersion> {
    let grant = PeerShareGrantVersion {
        id: "cli_live_profile_grant".into(),
        owner_user_id: owner.into(),
        relationship_id: relationship_id.into(),
        direction: ShareDirection::LocalToRemote,
        sequence: 1,
        previous_version_hash: None,
        status: GrantStatus::Proposed,
        label: "CLI live profile grant".into(),
        purpose: "production daemon loopback integration".into(),
        issued_at: issued_at.clone(),
        effective_at: Some(issued_at),
        expires_at: Some(timestamp(now()?.saturating_add(3_600))?),
        revoked_at: None,
        cache_policy: CachePolicy {
            mode: CacheMode::None,
            maximum_retention_seconds: 0,
            purge_on_revocation: true,
        },
        rules: vec![ShareRule {
            id: "profile_rule".into(),
            effect: RuleEffect::Allow,
            projection_id: ProjectionId::PersonProfileV1,
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
        protocol_version: forge_peer::PROTOCOL_NAME.into(),
        schema_version: 1,
    };
    forge_peer::codec::Validate::validate(&grant)?;
    Ok(grant)
}

#[allow(clippy::too_many_lines)]
async fn production_cli_two_daemon_socket_roundtrip_for_transport(
    transport: &LivePeerTransport,
) -> Result<()> {
    let binary = PathBuf::from(env!("CARGO_BIN_EXE_forge-peer"));
    let root = tempfile::tempdir()?;
    std::fs::set_permissions(root.path(), std::fs::Permissions::from_mode(0o700))?;
    let root_path = root.path().canonicalize()?;
    let inviter_state = root_path.join("inviter-state");
    let accepter_state = root_path.join("accepter-state");
    initialize_identity(&binary, &inviter_state)?;
    initialize_identity(&binary, &accepter_state)?;
    install_command_authority_state(&inviter_state, "cli_owner_inviter")?;
    install_command_authority_state(&accepter_state, "cli_owner_accepter")?;
    let sockets = root_path.join("sockets");
    std::fs::create_dir(&sockets)?;
    std::fs::set_permissions(&sockets, std::fs::Permissions::from_mode(0o700))?;
    let inviter_socket = sockets.join("inviter.sock");
    let accepter_socket = sockets.join("accepter.sock");
    let inviter_port = reserve_port()?;
    let accepter_port = reserve_port()?;
    let mut inviter_daemon = spawn_daemon(
        &binary,
        &inviter_state,
        &inviter_socket,
        "cli_owner_inviter",
        inviter_port,
        transport,
    )?;
    let _accepter_daemon = spawn_daemon(
        &binary,
        &accepter_state,
        &accepter_socket,
        "cli_owner_accepter",
        accepter_port,
        transport,
    )?;
    let inviter_identity = wait_for_identity(&inviter_socket, "cli_owner_inviter").await?;
    let accepter_identity = wait_for_identity(&accepter_socket, "cli_owner_accepter").await?;
    assert_eq!(
        inviter_identity.device.transport_endpoints[0],
        forge_peer::daemon::ApiTransportEndpoint::LocalDirect {
            host: "127.0.0.1".into(),
            port: inviter_port,
        }
    );
    let expected_selected_endpoints = match transport {
        LivePeerTransport::Iroh => {
            let inviter = inviter_identity
                .device
                .transport_endpoints
                .iter()
                .find(|endpoint| {
                    matches!(
                        endpoint,
                        forge_peer::daemon::ApiTransportEndpoint::Iroh { .. }
                    )
                })
                .cloned()
                .ok_or_else(|| {
                    PeerError::StateConflict("CLI inviter has no Iroh endpoint".into())
                })?;
            let accepter = accepter_identity
                .device
                .transport_endpoints
                .iter()
                .find(|endpoint| {
                    matches!(
                        endpoint,
                        forge_peer::daemon::ApiTransportEndpoint::Iroh { .. }
                    )
                })
                .cloned()
                .ok_or_else(|| {
                    PeerError::StateConflict("CLI accepter has no Iroh endpoint".into())
                })?;
            Some((inviter, accepter))
        }
        LivePeerTransport::HttpMailbox { .. } => {
            assert!(
                inviter_identity
                    .device
                    .transport_endpoints
                    .iter()
                    .all(|endpoint| !matches!(
                        endpoint,
                        forge_peer::daemon::ApiTransportEndpoint::HttpMailbox { .. }
                    )),
                "local identity must not expose an unauthenticated universal mailbox channel"
            );
            assert!(
                accepter_identity
                    .device
                    .transport_endpoints
                    .iter()
                    .all(|endpoint| !matches!(
                        endpoint,
                        forge_peer::daemon::ApiTransportEndpoint::HttpMailbox { .. }
                    )),
                "local identity must not expose an unauthenticated universal mailbox channel"
            );
            None
        }
    };
    let readiness_kind = match transport {
        LivePeerTransport::Iroh => ProviderKind::Iroh,
        LivePeerTransport::HttpMailbox { .. } => ProviderKind::HttpMailbox,
    };
    for (socket, owner) in [
        (&inviter_socket, "cli_owner_inviter"),
        (&accepter_socket, "cli_owner_accepter"),
    ] {
        let readiness = wait_for_transport_readiness(socket, owner, readiness_kind).await?;
        assert_eq!(
            readiness.detail_code,
            match transport {
                LivePeerTransport::Iroh => "operational",
                LivePeerTransport::HttpMailbox { .. } => "operational_idle",
            }
        );
    }

    let protocol = raw_ipc(
        &inviter_socket,
        &IpcRequest::ProtocolInfo {
            request_id: "cli_protocol_info".into(),
        },
    )
    .await?;
    assert_eq!(protocol["type"], "protocol_info");
    assert_eq!(protocol["protocol"], forge_peer::PROTOCOL_NAME);
    let health = raw_ipc(
        &inviter_socket,
        &IpcRequest::Health {
            request_id: "cli_health".into(),
        },
    )
    .await?;
    assert_eq!(health["type"], "health");
    assert_eq!(health["enabled"], true);
    assert_eq!(health["healthy"], true);
    assert_eq!(health["provenance"]["ownerUserId"], "cli_owner_inviter");

    let mut inviter_authority_command_id = None;
    for (socket, owner, request_id) in [
        (
            &inviter_socket,
            "cli_owner_inviter",
            "sync_inviter_authority",
        ),
        (
            &accepter_socket,
            "cli_owner_accepter",
            "sync_accepter_authority",
        ),
    ] {
        let synchronized = raw_ipc(
            socket,
            &IpcRequest::SyncCommandAuthorizationState {
                request_id: request_id.into(),
                command_id: None,
                input: CommandAuthorityStateInput {
                    owner_user_id: owner.into(),
                },
            },
        )
        .await?;
        assert_eq!(
            synchronized["type"],
            "command_authorization_state_synchronized"
        );
        assert_eq!(synchronized["state"]["invalidationEpoch"], "1");
        let synchronized_command_id = synchronized["state"]["commandId"]
            .as_str()
            .ok_or_else(|| PeerError::InvalidData("authority sync returned no commandId".into()))?
            .to_owned();
        if owner == "cli_owner_inviter" {
            inviter_authority_command_id = Some(synchronized_command_id);
        }
    }
    let inviter_authority_command_id = inviter_authority_command_id.ok_or_else(|| {
        PeerError::InvalidData("inviter authority sync returned no commandId".into())
    })?;
    let authority_sync_replay = raw_ipc(
        &inviter_socket,
        &IpcRequest::SyncCommandAuthorizationState {
            request_id: "sync_inviter_authority_replay".into(),
            command_id: Some(inviter_authority_command_id.clone()),
            input: CommandAuthorityStateInput {
                owner_user_id: "cli_owner_inviter".into(),
            },
        },
    )
    .await?;
    assert_eq!(
        authority_sync_replay["state"]["commandId"],
        inviter_authority_command_id
    );
    let authority_sync_receipt: CommandReceiptView = response_field(
        &raw_ipc(
            &inviter_socket,
            &IpcRequest::CommandReceipt {
                request_id: "cli_sync_authority_receipt".into(),
                input: CommandReceiptInput {
                    owner_user_id: "cli_owner_inviter".into(),
                    command_id: inviter_authority_command_id.clone(),
                },
            },
        )
        .await?,
        "command_receipt",
        "receipt",
    )?;
    assert_eq!(
        authority_sync_receipt.operation,
        "sync_command_authorization_state"
    );
    assert_eq!(
        authority_sync_receipt.result["commandId"],
        inviter_authority_command_id
    );
    let authority_sync_alias = raw_ipc(
        &inviter_socket,
        &IpcRequest::SyncCommandAuthorizationState {
            request_id: "sync_inviter_authority_alias".into(),
            command_id: Some("cli-command-sync-authority-alias-0001".into()),
            input: CommandAuthorityStateInput {
                owner_user_id: "cli_owner_inviter".into(),
            },
        },
    )
    .await?;
    assert_eq!(authority_sync_alias["type"], "rejected");
    assert_eq!(authority_sync_alias["code"], "authorization_failed");

    let started_at = now()?;
    let create_request = IpcRequest::CreateInvitation {
        request_id: "cli_create_invite".into(),
        command_id: "cli-command-create-invite-0001".into(),
        approval_deadline: approval_deadline()?,
        input: CreateInvitationInput {
            owner_user_id: "cli_owner_inviter".into(),
            label: "CLI live transport invite".into(),
            expires_at: timestamp(started_at.saturating_add(600))?,
            privacy_mode: PrivacyMode::Fastest,
            transport_kinds: vec![transport.invitation_kind()],
        },
    };
    let same_uid_attacker = raw_unauthorized_ipc(&inviter_socket, &create_request).await?;
    assert_eq!(same_uid_attacker["type"], "rejected");
    assert_eq!(same_uid_attacker["code"], "authentication_failed");

    let mut forged_authorization = command_authorization(&create_request)?;
    forged_authorization.signature = URL_SAFE_NO_PAD.encode(
        SigningKey::from_bytes(&[84_u8; 32])
            .sign(&command_authorization_signing_bytes(&forged_authorization)?)
            .to_bytes(),
    );
    let forged_same_uid = raw_ipc_with_authorization(
        &inviter_socket,
        &create_request,
        Some(&forged_authorization),
    )
    .await?;
    assert_eq!(forged_same_uid["type"], "rejected");
    assert_eq!(forged_same_uid["code"], "authentication_failed");

    let create = raw_ipc(&inviter_socket, &create_request).await?;
    let material: InvitationMaterial = response_field(&create, "invitation_created", "material")?;
    let create_receipt: CommandReceiptView = response_field(
        &raw_ipc(
            &inviter_socket,
            &IpcRequest::CommandReceipt {
                request_id: "cli_create_receipt".into(),
                input: CommandReceiptInput {
                    owner_user_id: "cli_owner_inviter".into(),
                    command_id: "cli-command-create-invite-0001".into(),
                },
            },
        )
        .await?,
        "command_receipt",
        "receipt",
    )?;
    assert!(create_receipt.committed_at.is_some());
    assert_eq!(
        create_receipt
            .authorization
            .as_ref()
            .and_then(|authorization| authorization.actor_id.as_deref()),
        Some("cli_operator_session_000001")
    );
    let forged_replay = raw_ipc_with_authorization(
        &inviter_socket,
        &create_request,
        Some(&forged_authorization),
    )
    .await?;
    assert_eq!(forged_replay["type"], "rejected");
    assert_eq!(forged_replay["code"], "authentication_failed");

    let cancel_material: InvitationMaterial = response_field(
        &raw_ipc(
            &inviter_socket,
            &IpcRequest::CreateInvitation {
                request_id: "cli_create_cancel".into(),
                command_id: "cli-command-create-cancel-0001".into(),
                approval_deadline: approval_deadline()?,
                input: CreateInvitationInput {
                    owner_user_id: "cli_owner_inviter".into(),
                    label: "Cancel me".into(),
                    expires_at: timestamp(started_at.saturating_add(600))?,
                    privacy_mode: PrivacyMode::Fastest,
                    transport_kinds: vec![TransportKind::LocalDirect],
                },
            },
        )
        .await?,
        "invitation_created",
        "material",
    )?;
    let canceled = raw_ipc(
        &inviter_socket,
        &IpcRequest::CancelInvitation {
            request_id: "cli_cancel_invite".into(),
            command_id: "cli-command-cancel-invite-0001".into(),
            approval_deadline: approval_deadline()?,
            input: CancelInvitationInput {
                owner_user_id: "cli_owner_inviter".into(),
                invitation_id: cancel_material.invitation.id,
            },
        },
    )
    .await?;
    assert_eq!(canceled["type"], "invitation_canceled");

    let accepted = raw_ipc(
        &accepter_socket,
        &IpcRequest::AcceptInvitation {
            request_id: "cli_accept_invite".into(),
            command_id: "cli-command-accept-invite-0001".into(),
            approval_deadline: approval_deadline()?,
            input: AcceptInvitationInput {
                owner_user_id: "cli_owner_accepter".into(),
                invitation: material.invitation,
                local_device_id: accepter_identity.device.id.clone(),
                privacy_mode: PrivacyMode::Fastest,
                scanned_at: timestamp(started_at)?,
            },
        },
    )
    .await?;
    let acceptance: PairingAcceptance =
        response_field(&accepted, "invitation_accepted", "acceptance")?;
    let pairing_payload = serde_json::to_value(&acceptance.request_payload)
        .map_err(|error| PeerError::InvalidData(format!("pairing payload JSON: {error}")))?
        .as_object()
        .cloned()
        .ok_or_else(|| PeerError::InvalidData("pairing payload is not an object".into()))?;
    let pending_pairing = pending_request(
        &acceptance.request_id,
        "cli_owner_accepter",
        None,
        PendingRequestKind::Pairing,
        pairing_payload,
        acceptance.expires_at.clone(),
        timestamp(started_at)?,
    )?;
    let pending_pairing_response = raw_ipc(
        &accepter_socket,
        &IpcRequest::AcceptPendingRequest {
            request_id: "cli_pending_pairing".into(),
            command_id: "cli-command-pending-pair-0001".into(),
            approval_deadline: approval_deadline()?,
            input: AcceptPendingRequestInput {
                owner_user_id: "cli_owner_accepter".into(),
                request: pending_pairing,
            },
        },
    )
    .await?;
    assert_eq!(pending_pairing_response["type"], "pending_request_accepted");

    let confirmed = raw_ipc(
        &accepter_socket,
        &IpcRequest::ConfirmPairing {
            request_id: "cli_confirm_pairing".into(),
            command_id: "cli-command-confirm-pair-0001".into(),
            approval_deadline: approval_deadline()?,
            input: ConfirmPairingInput {
                owner_user_id: "cli_owner_accepter".into(),
                pairing_id: acceptance.request_id,
                transcript_hash: acceptance.request_payload.transcript_hash.clone(),
                verification_phrase: acceptance.request_payload.verification_phrase.clone(),
                request_payload: acceptance.request_payload,
            },
        },
    )
    .await?;
    let confirmation: PairingConfirmation =
        response_field(&confirmed, "pairing_confirmed", "confirmation")?;
    let relationship_id = confirmation.relationship.id;
    if let Some((inviter, accepter)) = expected_selected_endpoints {
        assert_eq!(
            confirmation.relationship.remote_device.transport_endpoints,
            vec![inviter]
        );
        assert_eq!(
            confirmation.relationship.local_device.transport_endpoints,
            vec![accepter]
        );
    } else if let LivePeerTransport::HttpMailbox { origin, .. } = transport {
        let [remote_endpoint] = confirmation
            .relationship
            .remote_device
            .transport_endpoints
            .as_slice()
        else {
            return Err(PeerError::StateConflict(
                "mailbox pairing selected an invalid remote endpoint count".into(),
            ));
        };
        let [local_endpoint] = confirmation
            .relationship
            .local_device
            .transport_endpoints
            .as_slice()
        else {
            return Err(PeerError::StateConflict(
                "mailbox pairing selected an invalid local endpoint count".into(),
            ));
        };
        let remote_channel = match remote_endpoint {
            forge_peer::daemon::ApiTransportEndpoint::HttpMailbox {
                origin: endpoint_origin,
                opaque_channel,
            } if endpoint_origin == origin => opaque_channel,
            _ => {
                return Err(PeerError::StateConflict(
                    "mailbox pairing did not retain the authenticated inviter endpoint".into(),
                ));
            }
        };
        let local_channel = match local_endpoint {
            forge_peer::daemon::ApiTransportEndpoint::HttpMailbox {
                origin: endpoint_origin,
                opaque_channel,
            } if endpoint_origin == origin => opaque_channel,
            _ => {
                return Err(PeerError::StateConflict(
                    "mailbox pairing did not retain the authenticated accepter endpoint".into(),
                ));
            }
        };
        assert_ne!(remote_channel, local_channel);
    }

    let sign_grant_request = IpcRequest::SignGrant {
        request_id: "cli_sign_grant".into(),
        command_id: "cli-command-sign-grant-0001".into(),
        approval_deadline: approval_deadline()?,
        input: SignGrantInput {
            owner_user_id: "cli_owner_inviter".into(),
            relationship_id: relationship_id.clone(),
            grant: grant(
                "cli_owner_inviter",
                &relationship_id,
                &accepter_identity.device.id,
                timestamp(now()?)?,
            )?,
        },
    };
    let proposal_response = {
        let deadline = tokio::time::Instant::now() + LIVE_WAIT_TIMEOUT;
        loop {
            let response = raw_ipc(&inviter_socket, &sign_grant_request).await?;
            if response["type"] == "grant_signed" {
                break response;
            }
            if tokio::time::Instant::now() >= deadline {
                return Err(PeerError::Timeout("waiting for CLI pairing welcome"));
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    };
    let proposal: GrantOperationResult =
        response_field(&proposal_response, "grant_signed", "result")?;
    let proposal_payload = serde_json::to_value(&proposal.grant)
        .map_err(|error| PeerError::InvalidData(format!("grant payload JSON: {error}")))?
        .as_object()
        .cloned()
        .ok_or_else(|| PeerError::InvalidData("grant payload is not an object".into()))?;
    let pending_grant = pending_request(
        "cli_pending_grant_0001",
        "cli_owner_accepter",
        Some(relationship_id.clone()),
        PendingRequestKind::Grant,
        proposal_payload,
        timestamp(now()?.saturating_add(300))?,
        timestamp(now()?)?,
    )?;
    let deadline = tokio::time::Instant::now() + LIVE_WAIT_TIMEOUT;
    loop {
        let response = raw_ipc(
            &accepter_socket,
            &IpcRequest::AcceptPendingRequest {
                request_id: "cli_pending_grant".into(),
                command_id: "cli-command-pending-grant-0001".into(),
                approval_deadline: approval_deadline()?,
                input: AcceptPendingRequestInput {
                    owner_user_id: "cli_owner_accepter".into(),
                    request: pending_grant.clone(),
                },
            },
        )
        .await?;
        if response["type"] == "pending_request_accepted" {
            break;
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(PeerError::Timeout("waiting for CLI grant proposal"));
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    let countersigned = raw_ipc(
        &accepter_socket,
        &IpcRequest::SignGrant {
            request_id: "cli_countersign_grant".into(),
            command_id: "cli-command-countersign-0001".into(),
            approval_deadline: approval_deadline()?,
            input: SignGrantInput {
                owner_user_id: "cli_owner_accepter".into(),
                relationship_id: relationship_id.clone(),
                grant: proposal.grant,
            },
        },
    )
    .await?;
    let active: GrantOperationResult = response_field(&countersigned, "grant_signed", "result")?;
    assert_eq!(active.grant.status, GrantStatus::Active);

    let deadline = tokio::time::Instant::now() + LIVE_WAIT_TIMEOUT;
    loop {
        let response = raw_ipc(
            &inviter_socket,
            &IpcRequest::AcceptGrant {
                request_id: "cli_accept_grant".into(),
                command_id: "cli-command-accept-grant-0001".into(),
                approval_deadline: approval_deadline()?,
                input: AcceptGrantInput {
                    owner_user_id: "cli_owner_inviter".into(),
                    grant: active.grant.clone(),
                },
            },
        )
        .await?;
        if response["type"] == "grant_accepted" {
            break;
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(PeerError::Timeout("waiting for CLI active grant"));
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    let standalone_verify = raw_ipc(
        &inviter_socket,
        &IpcRequest::VerifyGrant {
            request_id: "cli_verify_grant_is_bound".into(),
            grant: Box::new(active.grant.clone()),
        },
    )
    .await?;
    assert_eq!(standalone_verify["type"], "rejected");
    assert_eq!(standalone_verify["code"], "authorization_failed");

    let pending_device = pending_request(
        "cli_pending_device_0001",
        "cli_owner_accepter",
        Some(relationship_id.clone()),
        PendingRequestKind::Device,
        serde_json::Map::from_iter([(
            "deviceId".into(),
            serde_json::Value::String(inviter_identity.device.id.clone()),
        )]),
        timestamp(now()?.saturating_add(300))?,
        timestamp(now()?)?,
    )?;
    let device_accepted = raw_ipc(
        &accepter_socket,
        &IpcRequest::AcceptPendingRequest {
            request_id: "cli_pending_device".into(),
            command_id: "cli-command-pending-device-01".into(),
            approval_deadline: approval_deadline()?,
            input: AcceptPendingRequestInput {
                owner_user_id: "cli_owner_accepter".into(),
                request: pending_device,
            },
        },
    )
    .await?;
    assert_eq!(device_accepted["type"], "pending_request_accepted");

    let device_update = raw_ipc(
        &accepter_socket,
        &IpcRequest::UpdateDevice {
            request_id: "cli_update_device".into(),
            command_id: "cli-command-update-device-0001".into(),
            approval_deadline: approval_deadline()?,
            input: UpdateDeviceInput {
                owner_user_id: "cli_owner_accepter".into(),
                relationship_id: relationship_id.clone(),
                device_id: inviter_identity.device.id.clone(),
                action: DeviceAction::Approve,
            },
        },
    )
    .await?;
    assert_eq!(device_update["type"], "device_updated");

    let resync = raw_ipc(
        &accepter_socket,
        &IpcRequest::RequestResync {
            request_id: "cli_resync".into(),
            command_id: "cli-command-request-resync-01".into(),
            approval_deadline: approval_deadline()?,
            input: RequestResyncInput {
                owner_user_id: "cli_owner_accepter".into(),
                relationship_id: relationship_id.clone(),
                projection_ids: vec!["person.profile.v1".into()],
            },
        },
    )
    .await?;
    assert_eq!(resync["type"], "resync_requested");

    let query_socket = accepter_socket.clone();
    let query_relationship_id = relationship_id.clone();
    let query_task = tokio::spawn(async move {
        raw_ipc(
            &query_socket,
            &IpcRequest::ExecuteQuery {
                request_id: "cli_execute_query".into(),
                input: ExecuteQueryInput {
                    owner_user_id: "cli_owner_accepter".into(),
                    relationship_id: query_relationship_id,
                    person_id: "must-remain-local".into(),
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
            },
        )
        .await
    });
    let claim = {
        let deadline = tokio::time::Instant::now() + LIVE_WAIT_TIMEOUT;
        let mut attempt = 0_u32;
        loop {
            attempt = attempt.saturating_add(1);
            let response = raw_ipc(
                &inviter_socket,
                &IpcRequest::ClaimInboundQuery {
                    request_id: format!("cli_claim_query_{attempt}"),
                    command_id: format!("cli-command-claim-query-{attempt:08}"),
                    approval_deadline: approval_deadline()?,
                    input: ClaimInboundQueryInput {
                        owner_user_id: "cli_owner_inviter".into(),
                        worker_id: "cli_query_worker_000001".into(),
                        lease_ms: 30_000,
                    },
                },
            )
            .await?;
            let result: InboundQueryClaimResult =
                response_field(&response, "inbound_query_claimed", "result")?;
            if let Some(claim) = result.claim {
                break claim;
            }
            if tokio::time::Instant::now() >= deadline {
                return Err(PeerError::Timeout(
                    "waiting for durable inbound query claim",
                ));
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    };
    assert_eq!(claim.relationship_id, relationship_id);
    assert_eq!(claim.query.projection_id, "person.profile.v1");
    assert_eq!(claim.query.fields, vec!["displayName"]);
    assert!(!claim.entity_ids_are_opaque);
    drop(inviter_daemon);
    recover_socket(&binary, &inviter_socket)?;
    inviter_daemon = spawn_daemon(
        &binary,
        &inviter_state,
        &inviter_socket,
        "cli_owner_inviter",
        inviter_port,
        transport,
    )?;
    let _identity_after_claim_restart =
        wait_for_identity(&inviter_socket, "cli_owner_inviter").await?;
    let respond_request = IpcRequest::RespondInboundQuery {
        request_id: "cli_respond_query".into(),
        command_id: "cli-command-respond-query-0001".into(),
        approval_deadline: approval_deadline()?,
        input: RespondInboundQueryInput {
            owner_user_id: "cli_owner_inviter".into(),
            worker_id: "cli_query_worker_000001".into(),
            claim_id: claim.claim_id,
            query_id: claim.query_id,
            payload: ApiQueryPayload {
                records: vec![ApiQueryRecord {
                    record_id: "local-profile-record-must-not-cross-wire".into(),
                    fields: serde_json::Map::from_iter([(
                        "displayName".into(),
                        serde_json::Value::String("Loopback Person".into()),
                    )]),
                }],
            },
            as_of: timestamp(now()?)?,
            completeness: InboundQueryCompleteness::Complete,
            redacted_fields: Vec::new(),
        },
    };
    let respond_authorization = command_authorization(&respond_request)?;
    send_ipc_without_reading_response(&inviter_socket, &respond_request, &respond_authorization)
        .await?;
    let response = raw_ipc_with_authorization(
        &inviter_socket,
        &respond_request,
        Some(&respond_authorization),
    )
    .await?;
    assert_eq!(response["type"], "inbound_query_responded");
    let receipt = raw_ipc(
        &inviter_socket,
        &IpcRequest::CommandReceipt {
            request_id: "cli_respond_query_receipt".into(),
            input: CommandReceiptInput {
                owner_user_id: "cli_owner_inviter".into(),
                command_id: "cli-command-respond-query-0001".into(),
            },
        },
    )
    .await?;
    assert_eq!(receipt["type"], "command_receipt");
    let query = query_task
        .await
        .map_err(|error| PeerError::StateConflict(format!("query task failed: {error}")))??;
    let query_result: QueryGatewayResult = response_field(&query, "query_executed", "result")?;
    assert_eq!(query_result.state, QueryResultState::Live);
    assert_eq!(query_result.payload.records.len(), 1);
    assert_ne!(
        query_result.payload.records[0].record_id,
        "local-profile-record-must-not-cross-wire"
    );
    assert_eq!(
        query_result.payload.records[0].fields["displayName"],
        "Loopback Person"
    );
    assert_eq!(
        query_result.metadata.source.device_id,
        inviter_identity.device.id
    );

    let predecessor_serial = inviter_identity
        .device
        .certificate_serial
        .parse::<u64>()
        .map_err(|_| PeerError::InvalidData("CLI predecessor serial is invalid".into()))?;
    let rotation_request = IpcRequest::RotateHostCredential {
        request_id: "cli_rotate_host_credential".into(),
        command_id: "cli-command-rotate-host-0001".into(),
        approval_deadline: approval_deadline()?,
        input: RotateHostCredentialInput {
            owner_user_id: "cli_owner_inviter".into(),
            not_after: timestamp(now()?.saturating_add(2 * 24 * 60 * 60))?,
        },
    };
    let rotation_response = {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
        loop {
            let response = raw_ipc(&inviter_socket, &rotation_request).await?;
            if response["type"] == "host_credential_rotation_started" {
                break response;
            }
            if response["type"] != "rejected" || response["code"] != "conflict" {
                return Err(PeerError::StateConflict(format!(
                    "CLI host credential rotation failed permanently: {response}"
                )));
            }
            if tokio::time::Instant::now() >= deadline {
                return Err(PeerError::StateConflict(format!(
                    "CLI transport work did not drain before rotation: {response}"
                )));
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    };
    let rotation: HostCredentialRotationResult = response_field(
        &rotation_response,
        "host_credential_rotation_started",
        "result",
    )?;
    assert_eq!(
        rotation.state,
        HostCredentialRotationState::AwaitingPeerAcknowledgements
    );
    assert_eq!(rotation.relationship_ids, vec![relationship_id.clone()]);
    assert_eq!(
        rotation
            .successor
            .certificate_serial
            .parse::<u64>()
            .map_err(|_| PeerError::InvalidData("CLI successor serial is invalid".into()))?,
        predecessor_serial.saturating_add(1)
    );
    let rotation_deadline = tokio::time::Instant::now() + LIVE_WAIT_TIMEOUT;
    loop {
        let identity = wait_for_identity(&inviter_socket, "cli_owner_inviter").await?;
        if identity.device.certificate_hash == rotation.successor.certificate_hash {
            break;
        }
        if tokio::time::Instant::now() >= rotation_deadline {
            return Err(PeerError::Timeout(
                "waiting for peer acknowledgement to finalize CLI credential rotation",
            ));
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let rotation_receipt: CommandReceiptView = response_field(
        &raw_ipc(
            &inviter_socket,
            &IpcRequest::CommandReceipt {
                request_id: "cli_rotation_receipt".into(),
                input: CommandReceiptInput {
                    owner_user_id: "cli_owner_inviter".into(),
                    command_id: "cli-command-rotate-host-0001".into(),
                },
            },
        )
        .await?,
        "command_receipt",
        "receipt",
    )?;
    assert!(rotation_receipt.committed_at.is_some());
    assert_eq!(
        rotation_receipt.result["successor"]["certificateHash"],
        rotation.successor.certificate_hash
    );

    let revoked_at = timestamp(now()?)?;
    let mut revoked = active.grant;
    let previous_hash = revoked.version_hash_hex()?;
    revoked.sequence = revoked.sequence.saturating_add(1);
    revoked.previous_version_hash = Some(previous_hash);
    revoked.status = GrantStatus::Revoked;
    revoked.issued_at.clone_from(&revoked_at);
    revoked.revoked_at = Some(revoked_at);
    revoked.signatures.clear();
    let revoke = raw_ipc(
        &inviter_socket,
        &IpcRequest::RevokeGrant {
            request_id: "cli_revoke_grant".into(),
            command_id: "cli-command-revoke-grant-0001".into(),
            approval_deadline: approval_deadline()?,
            input: RevokeGrantInput {
                owner_user_id: "cli_owner_inviter".into(),
                grant: revoked,
                reason: "CLI integration complete".into(),
            },
        },
    )
    .await?;
    assert_eq!(revoke["type"], "grant_revoked");

    let relationship_revoke = raw_ipc(
        &accepter_socket,
        &IpcRequest::RevokeRelationship {
            request_id: "cli_revoke_relationship".into(),
            command_id: "cli-command-revoke-relation-01".into(),
            approval_deadline: approval_deadline()?,
            input: RevokeRelationshipInput {
                owner_user_id: "cli_owner_accepter".into(),
                relationship_id,
                reason: "CLI integration complete".into(),
            },
        },
    )
    .await?;
    assert_eq!(relationship_revoke["type"], "relationship_revoked");

    let revocation_page: RevocationEventPage = response_field(
        &raw_ipc(
            &inviter_socket,
            &IpcRequest::ListRevocationEvents {
                request_id: "cli_list_revocations".into(),
                input: ListRevocationEventsInput {
                    owner_user_id: "cli_owner_inviter".into(),
                    consumer_id: "cli_revocation_consumer_0001".into(),
                    after_cursor: "0".into(),
                    limit: 64,
                },
            },
        )
        .await?,
        "revocation_events_listed",
        "page",
    )?;
    assert!(!revocation_page.events.is_empty());
    assert!(!revocation_page.has_more);
    let last_revocation = revocation_page
        .events
        .last()
        .cloned()
        .ok_or_else(|| PeerError::StateConflict("CLI revocation log is empty".into()))?;
    assert_eq!(last_revocation.cursor, revocation_page.next_cursor);
    let revocation_ack: RevocationAckResult = response_field(
        &raw_ipc(
            &inviter_socket,
            &IpcRequest::AckRevocationEvents {
                request_id: "cli_ack_revocations".into(),
                command_id: "cli-command-ack-revocations-0001".into(),
                approval_deadline: approval_deadline()?,
                input: AckRevocationEventsInput {
                    owner_user_id: "cli_owner_inviter".into(),
                    consumer_id: "cli_revocation_consumer_0001".into(),
                    through_cursor: last_revocation.cursor.clone(),
                    event_hash: last_revocation.event_hash,
                },
            },
        )
        .await?,
        "revocation_events_acknowledged",
        "result",
    )?;
    assert_eq!(
        revocation_ack.acknowledged_cursor,
        revocation_page.next_cursor
    );
    let acknowledged_revocation_cursor = revocation_ack.acknowledged_cursor.clone();
    let acknowledged_revocation_hash = revocation_ack.event_hash.clone();
    let ack_receipt: CommandReceiptView = response_field(
        &raw_ipc(
            &inviter_socket,
            &IpcRequest::CommandReceipt {
                request_id: "cli_ack_revocations_receipt".into(),
                input: CommandReceiptInput {
                    owner_user_id: "cli_owner_inviter".into(),
                    command_id: "cli-command-ack-revocations-0001".into(),
                },
            },
        )
        .await?,
        "command_receipt",
        "receipt",
    )?;
    assert_eq!(
        ack_receipt.result["acknowledgedCursor"],
        acknowledged_revocation_cursor
    );

    install_command_authority_state_at(
        &inviter_state,
        "cli_owner_inviter",
        2,
        vec!["cli_operator_session_000001".into()],
    )?;
    let authority_sync_conflict = raw_ipc(
        &inviter_socket,
        &IpcRequest::SyncCommandAuthorizationState {
            request_id: "cli_sync_invalidation_conflict".into(),
            command_id: Some(inviter_authority_command_id.clone()),
            input: CommandAuthorityStateInput {
                owner_user_id: "cli_owner_inviter".into(),
            },
        },
    )
    .await?;
    assert_eq!(authority_sync_conflict["type"], "rejected");
    assert_eq!(authority_sync_conflict["code"], "authorization_failed");
    let invalidation_sync = raw_ipc(
        &inviter_socket,
        &IpcRequest::SyncCommandAuthorizationState {
            request_id: "cli_sync_invalidation".into(),
            command_id: None,
            input: CommandAuthorityStateInput {
                owner_user_id: "cli_owner_inviter".into(),
            },
        },
    )
    .await?;
    assert_eq!(
        invalidation_sync["type"],
        "command_authorization_state_synchronized"
    );
    assert_eq!(invalidation_sync["state"]["invalidationEpoch"], "2");

    let invalidated_command = raw_ipc(
        &inviter_socket,
        &IpcRequest::CreateInvitation {
            request_id: "cli_invalidated_session".into(),
            command_id: "cli-command-invalidated-session-01".into(),
            approval_deadline: approval_deadline()?,
            input: CreateInvitationInput {
                owner_user_id: "cli_owner_inviter".into(),
                label: "Must not be created".into(),
                expires_at: timestamp(now()?.saturating_add(300))?,
                privacy_mode: PrivacyMode::Fastest,
                transport_kinds: vec![TransportKind::LocalDirect],
            },
        },
    )
    .await?;
    assert_eq!(invalidated_command["type"], "rejected");
    assert_eq!(invalidated_command["code"], "authorization_failed");

    install_command_authority_state(&inviter_state, "cli_owner_inviter")?;
    let live_rollback = raw_ipc(
        &inviter_socket,
        &IpcRequest::SyncCommandAuthorizationState {
            request_id: "cli_live_authority_rollback".into(),
            command_id: None,
            input: CommandAuthorityStateInput {
                owner_user_id: "cli_owner_inviter".into(),
            },
        },
    )
    .await?;
    assert_eq!(live_rollback["type"], "rejected");

    drop(inviter_daemon);
    recover_socket(&binary, &inviter_socket)?;
    let mut restarted_inviter = spawn_daemon(
        &binary,
        &inviter_state,
        &inviter_socket,
        "cli_owner_inviter",
        inviter_port,
        transport,
    )?;
    let _identity_after_restart = wait_for_identity(&inviter_socket, "cli_owner_inviter").await?;
    let revocations_after_restart: RevocationEventPage = response_field(
        &raw_ipc(
            &inviter_socket,
            &IpcRequest::ListRevocationEvents {
                request_id: "cli_list_revocations_after_restart".into(),
                input: ListRevocationEventsInput {
                    owner_user_id: "cli_owner_inviter".into(),
                    consumer_id: "cli_revocation_consumer_0001".into(),
                    after_cursor: acknowledged_revocation_cursor.clone(),
                    limit: 64,
                },
            },
        )
        .await?,
        "revocation_events_listed",
        "page",
    )?;
    assert_eq!(
        revocations_after_restart.acknowledged_cursor,
        acknowledged_revocation_cursor
    );
    if let Some(first_new_event) = revocations_after_restart.events.first() {
        let acknowledged_cursor = acknowledged_revocation_cursor
            .parse::<u64>()
            .map_err(|_| PeerError::InvalidData("CLI acknowledged cursor is invalid".into()))?;
        assert_eq!(
            first_new_event.cursor,
            acknowledged_cursor.saturating_add(1).to_string()
        );
        assert_eq!(
            first_new_event.previous_event_hash,
            acknowledged_revocation_hash
        );
    }
    let restart_rollback = raw_ipc(
        &inviter_socket,
        &IpcRequest::SyncCommandAuthorizationState {
            request_id: "cli_restart_authority_rollback".into(),
            command_id: None,
            input: CommandAuthorityStateInput {
                owner_user_id: "cli_owner_inviter".into(),
            },
        },
    )
    .await?;
    assert_eq!(restart_rollback["type"], "rejected");

    install_command_authority_state_at(
        &inviter_state,
        "cli_owner_inviter",
        2,
        vec!["cli_operator_session_000001".into()],
    )?;
    let restored_invalidation = raw_ipc(
        &inviter_socket,
        &IpcRequest::SyncCommandAuthorizationState {
            request_id: "cli_restore_authority_epoch".into(),
            command_id: None,
            input: CommandAuthorityStateInput {
                owner_user_id: "cli_owner_inviter".into(),
            },
        },
    )
    .await?;
    assert_eq!(
        restored_invalidation["type"],
        "command_authorization_state_synchronized"
    );
    terminate_daemon(&mut restarted_inviter).await?;
    assert!(!inviter_socket.exists());
    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn production_cli_two_daemon_socket_roundtrip_covers_management_contract() -> Result<()> {
    let _serial = LIVE_TRANSPORT_TEST_LOCK.lock().await;
    Box::pin(production_cli_two_daemon_socket_roundtrip_for_transport(
        &LivePeerTransport::Iroh,
    ))
    .await
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn production_cli_mailbox_matches_connectivity_service_contract() -> Result<()> {
    let _serial = LIVE_TRANSPORT_TEST_LOCK.lock().await;
    let harness = start_mailbox_harness().await?;
    let transport = LivePeerTransport::HttpMailbox {
        origin: harness.origin.clone(),
        ca_file: harness.ca_file.clone(),
    };
    Box::pin(production_cli_two_daemon_socket_roundtrip_for_transport(
        &transport,
    ))
    .await
}

#[test]
fn production_cli_rejects_unsafe_mailbox_trust_combinations() -> Result<()> {
    let binary = PathBuf::from(env!("CARGO_BIN_EXE_forge-peer"));
    let root = tempfile::tempdir()?;
    std::fs::set_permissions(root.path(), std::fs::Permissions::from_mode(0o700))?;
    let root_path = root.path().canonicalize()?;
    let state_dir = root_path.join("identity");
    let socket = root_path.join("must-not-exist.sock");
    initialize_identity(&binary, &state_dir)?;
    let owner_marker = "owner_sensitive_marker_must_not_leak";
    let cases = [
        vec![
            "--mailbox-origin",
            "https://localhost:4443",
            "--mailbox-allow-loopback-origin",
        ],
        vec![
            "--mailbox-origin",
            "https://localhost:4443",
            "--mailbox-allow-loopback-origin",
            "--mailbox-allow-private-origin",
            "--mailbox-ca-file",
            "/must/not/be/read.pem",
        ],
        vec!["--mailbox-allow-private-origin"],
    ];
    for arguments in cases {
        let output = Command::new(&binary)
            .arg("serve")
            .arg("--socket")
            .arg(&socket)
            .arg("--state-dir")
            .arg(&state_dir)
            .arg("--owner-user-id")
            .arg(owner_marker)
            .args(arguments)
            .output()?;
        assert!(!output.status.success());
        assert!(output.stdout.is_empty());
        let diagnostic = String::from_utf8_lossy(&output.stderr);
        assert!(!diagnostic.contains(owner_marker));
        assert!(!socket.exists());
    }
    Ok(())
}
