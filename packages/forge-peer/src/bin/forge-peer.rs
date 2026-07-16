#![forbid(unsafe_code)]

use std::fs::File;
use std::io::Read as _;
use std::net::SocketAddr;
use std::os::unix::fs::MetadataExt as _;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use clap::{Parser, Subcommand};
use forge_peer::codec::encode_limited;
use forge_peer::command_auth::NodeCommandAuthority;
use forge_peer::daemon::{DaemonConfig, DurableDaemonHandler};
use forge_peer::endpoint::{
    DirectEndpoint, EndpointDescriptor, IpAddress, MailboxEndpointPolicy, SystemEndpointResolver,
    validate_mailbox_origin,
};
use forge_peer::ipc::{OwnerIpcServer, recover_stale_owner_socket};
use forge_peer::local_identity::LocalIdentityState;
use forge_peer::manifest::{SignedReleaseManifest, TrustedManifestKeyring};
use forge_peer::provider::mailbox::{
    MailboxPacketClient, MailboxTlsRoots, mailbox_endpoint_for_identity,
};
use forge_peer::provider::tor::{TorRuntime, TorRuntimeConfig};
use forge_peer::secure_fs::SecureDirectory;
use forge_peer::transport::{
    DirectTransportRuntime, IrohRuntimeIdentity, MailboxTransportRuntime, OptionalTransportRuntimes,
};

const IDENTITY_STATE_FILE: &str = "identity-state.bin";
const MAX_REVOCATION_BYTES: usize = 64 * 1024;

#[derive(Debug, Parser)]
#[command(version, about = "Forge peer protocol daemon and verification tools")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
#[allow(clippy::large_enum_variant)]
enum Command {
    /// Print the protocol identity without starting networking.
    Protocol,
    /// Run owner-only operational IPC backed by encrypted durable peer state.
    Serve {
        #[arg(long)]
        socket: PathBuf,
        #[arg(long)]
        state_dir: PathBuf,
        #[arg(long)]
        owner_user_id: String,
        #[arg(long, allow_hyphen_values = true)]
        command_authority_public_key: Option<String>,
        #[arg(long = "direct-endpoint")]
        direct_endpoints: Vec<SocketAddr>,
        #[arg(long, default_value_t = false)]
        allow_loopback_direct: bool,
        #[arg(long, default_value_t = false)]
        enable_iroh: bool,
        #[arg(long)]
        tor_executable: Option<PathBuf>,
        #[arg(long)]
        tor_data_dir: Option<PathBuf>,
        #[arg(long)]
        tor_socks_endpoint: Option<SocketAddr>,
        #[arg(long, default_value_t = 443)]
        tor_virtual_port: u16,
        #[arg(long, default_value_t = 60)]
        tor_startup_timeout_seconds: u16,
        #[arg(long, default_value_t = 5)]
        tor_restart_limit: u8,
        #[arg(long, default_value_t = 250)]
        tor_minimum_restart_backoff_ms: u32,
        #[arg(long, default_value_t = 10_000)]
        tor_maximum_restart_backoff_ms: u32,
        #[arg(long)]
        mailbox_origin: Option<String>,
        #[arg(long, default_value_t = false)]
        mailbox_allow_private_origin: bool,
        #[arg(long, default_value_t = false)]
        mailbox_allow_loopback_origin: bool,
        #[arg(long)]
        mailbox_ca_file: Option<PathBuf>,
        #[arg(long, default_value_t = 1_000)]
        mailbox_poll_interval_ms: u64,
    },
    /// Remove a proven stale owner-only socket without touching live endpoints.
    RecoverSocket {
        #[arg(long)]
        socket: PathBuf,
    },
    /// Manage the owner-only principal and device identity from the local console.
    Identity {
        #[command(subcommand)]
        command: IdentityCommand,
    },
    /// Verify a signed release manifest and an exact artifact bundle.
    VerifyManifest {
        #[arg(long)]
        signed_manifest: PathBuf,
        #[arg(long)]
        trusted_keys: PathBuf,
        #[arg(long)]
        bundle: PathBuf,
    },
}

#[derive(Debug, Subcommand)]
enum IdentityCommand {
    /// Create a new root and device identity in an empty private state directory.
    Init {
        #[arg(long)]
        state_dir: PathBuf,
        #[arg(long, default_value_t = 365)]
        valid_days: u64,
    },
    /// Print only public identity and revocation metadata.
    Inspect {
        #[arg(long)]
        state_dir: PathBuf,
    },
    /// Atomically rotate both device keys and advance the certificate serial.
    Rotate {
        #[arg(long)]
        state_dir: PathBuf,
        #[arg(long, default_value_t = 365)]
        valid_days: u64,
    },
    /// Root-sign a revocation of the current certificate serial.
    Revoke {
        #[arg(long)]
        state_dir: PathBuf,
        #[arg(long)]
        permanent: bool,
    },
    /// Recreate public revocation artifacts from the authoritative identity state.
    ExportRevocations {
        #[arg(long)]
        state_dir: PathBuf,
    },
    /// Recreate the current public certificate and all revocation artifacts.
    ExportPublic {
        #[arg(long)]
        state_dir: PathBuf,
    },
}

#[tokio::main]
async fn main() -> ExitCode {
    initialize_diagnostics();
    match run(Cli::parse()).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("forge-peer: {error}");
            ExitCode::FAILURE
        }
    }
}

fn initialize_diagnostics() {
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("forge_peer=warn"));
    drop(
        tracing_subscriber::fmt()
            .with_env_filter(filter)
            .with_target(false)
            .try_init(),
    );
}

#[allow(clippy::too_many_lines)]
async fn run(cli: Cli) -> forge_peer::Result<()> {
    match cli.command {
        Command::Protocol => println!("{}", forge_peer::PROTOCOL_NAME),
        Command::Serve {
            socket,
            state_dir,
            owner_user_id,
            command_authority_public_key,
            direct_endpoints,
            allow_loopback_direct,
            enable_iroh,
            tor_executable,
            tor_data_dir,
            tor_socks_endpoint,
            tor_virtual_port,
            tor_startup_timeout_seconds,
            tor_restart_limit,
            tor_minimum_restart_backoff_ms,
            tor_maximum_restart_backoff_ms,
            mailbox_origin,
            mailbox_allow_private_origin,
            mailbox_allow_loopback_origin,
            mailbox_ca_file,
            mailbox_poll_interval_ms,
        } => {
            let directory = SecureDirectory::open_or_create(&state_dir)?;
            let identity = read_identity(&directory)?;
            let command_authority = command_authority_public_key
                .as_deref()
                .map(NodeCommandAuthority::from_base64url_public_key)
                .transpose()?;
            let iroh_identity = enable_iroh
                .then(|| IrohRuntimeIdentity::derive(&identity))
                .transpose()?;
            let mut endpoints = direct_endpoints
                .iter()
                .map(|address| {
                    EndpointDescriptor::Direct(DirectEndpoint {
                        address: IpAddress::from(address.ip()),
                        port: address.port(),
                    })
                })
                .collect::<Vec<_>>();
            if let Some(iroh) = &iroh_identity {
                endpoints.push(iroh.endpoint_descriptor());
            }
            let tor = prepare_tor_runtime(
                directory.path(),
                tor_executable,
                tor_data_dir,
                tor_socks_endpoint,
                tor_virtual_port,
                tor_startup_timeout_seconds,
                tor_restart_limit,
                tor_minimum_restart_backoff_ms,
                tor_maximum_restart_backoff_ms,
            )
            .await?;
            if let Some((runtime, _)) = &tor {
                endpoints.push(EndpointDescriptor::Tor(runtime.endpoint_descriptor()));
            }
            let mailbox = prepare_mailbox_runtime(
                &identity,
                mailbox_origin,
                mailbox_allow_private_origin,
                mailbox_allow_loopback_origin,
                mailbox_ca_file,
                mailbox_poll_interval_ms,
            )
            .await?;
            if let Some(runtime) = &mailbox {
                endpoints.push(EndpointDescriptor::HttpMailbox(
                    runtime.endpoint_descriptor(),
                ));
            }
            let direct_listeners = direct_endpoints
                .into_iter()
                .map(|address| DirectEndpoint {
                    address: IpAddress::from(address.ip()),
                    port: address.port(),
                })
                .collect::<Vec<_>>();
            let handler = Arc::new(DurableDaemonHandler::open(
                &state_dir,
                identity,
                DaemonConfig {
                    owner_user_id,
                    endpoints,
                    allow_loopback_direct,
                    command_authority,
                },
            )?);
            let transport = DirectTransportRuntime::bind_with_optional(
                &direct_listeners,
                iroh_identity,
                OptionalTransportRuntimes { tor, mailbox },
                Arc::clone(&handler),
                allow_loopback_direct,
            )
            .await?;
            let server = OwnerIpcServer::bind(socket, handler)?;
            supervise_daemon(server, transport).await?;
        }
        Command::RecoverSocket { socket } => {
            recover_stale_owner_socket(socket)?;
            println!("recovered stale forge-peer IPC socket");
        }
        Command::Identity { command } => run_identity_command(command)?,
        Command::VerifyManifest {
            signed_manifest,
            trusted_keys,
            bundle,
        } => {
            reject_keyring_inside_bundle(&trusted_keys, &bundle)?;
            let signed = SignedReleaseManifest::from_json(&read_bounded(&signed_manifest)?)?;
            let keyring = TrustedManifestKeyring::from_json(&read_bounded(&trusted_keys)?)?;
            let verified = signed.verify(&keyring, &bundle, unix_time()?)?;
            println!(
                "verified forge-peer {} for {} ({})",
                verified.version(),
                verified.release_target(),
                verified.manifest_sha256()
            );
        }
    }
    Ok(())
}

async fn supervise_daemon(
    server: OwnerIpcServer<DurableDaemonHandler>,
    transport: DirectTransportRuntime<DurableDaemonHandler>,
) -> forge_peer::Result<()> {
    let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);
    let mut tasks = tokio::task::JoinSet::new();
    let ipc_shutdown = shutdown_rx.clone();
    tasks.spawn(async move { server.serve_until(wait_for_shutdown(ipc_shutdown)).await });
    tasks.spawn(async move { transport.serve_until(wait_for_shutdown(shutdown_rx)).await });

    let mut failure = None;
    tokio::select! {
        signal = process_shutdown_signal() => {
            signal?;
        }
        completed = tasks.join_next() => {
            failure = Some(match completed {
                Some(Ok(Err(error))) => error,
                Some(Ok(Ok(()))) => forge_peer::PeerError::StateConflict(
                    "daemon component stopped before shutdown".into(),
                ),
                Some(Err(error)) => forge_peer::PeerError::StateConflict(
                    format!("daemon component task failed: {error}"),
                ),
                None => forge_peer::PeerError::StateConflict(
                    "daemon supervision had no running components".into(),
                ),
            });
        }
    }
    let _ = shutdown_tx.send(true);
    while let Some(completed) = tasks.join_next().await {
        match completed {
            Ok(Err(error)) if failure.is_none() => failure = Some(error),
            Err(error) if failure.is_none() => {
                failure = Some(forge_peer::PeerError::StateConflict(format!(
                    "daemon component task failed: {error}"
                )));
            }
            Ok(Ok(()) | Err(_)) | Err(_) => {}
        }
    }
    failure.map_or(Ok(()), Err)
}

#[cfg(unix)]
async fn process_shutdown_signal() -> forge_peer::Result<()> {
    let mut terminate = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        .map_err(forge_peer::PeerError::Io)?;
    tokio::select! {
        signal = tokio::signal::ctrl_c() => signal.map_err(forge_peer::PeerError::Io),
        received = terminate.recv() => received.ok_or_else(|| {
            forge_peer::PeerError::StateConflict("SIGTERM listener stopped unexpectedly".into())
        }),
    }
}

#[cfg(not(unix))]
async fn process_shutdown_signal() -> forge_peer::Result<()> {
    tokio::signal::ctrl_c()
        .await
        .map_err(forge_peer::PeerError::Io)
}

async fn wait_for_shutdown(mut receiver: tokio::sync::watch::Receiver<bool>) {
    while !*receiver.borrow() {
        if receiver.changed().await.is_err() {
            break;
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn prepare_tor_runtime(
    state_directory: &Path,
    executable: Option<PathBuf>,
    data_directory: Option<PathBuf>,
    socks_address: Option<SocketAddr>,
    virtual_port: u16,
    startup_timeout_seconds: u16,
    restart_limit: u8,
    minimum_restart_backoff_ms: u32,
    maximum_restart_backoff_ms: u32,
) -> forge_peer::Result<Option<(TorRuntime, tokio::net::TcpListener)>> {
    let (executable, socks_address) = match (executable, socks_address) {
        (None, None) => {
            if data_directory.is_some() {
                return Err(forge_peer::PeerError::InvalidData(
                    "--tor-data-dir requires --tor-executable and --tor-socks-endpoint".into(),
                ));
            }
            return Ok(None);
        }
        (Some(executable), Some(socks_address)) => (executable, socks_address),
        _ => {
            return Err(forge_peer::PeerError::InvalidData(
                "--tor-executable and --tor-socks-endpoint must be configured together".into(),
            ));
        }
    };
    let data_directory = data_directory.unwrap_or_else(|| state_directory.join("tor-runtime"));
    let (runtime, listener) = TorRuntime::bind(TorRuntimeConfig {
        executable,
        data_directory,
        socks_address,
        virtual_port,
        startup_timeout_seconds,
        restart_limit,
        minimum_restart_backoff_ms,
        maximum_restart_backoff_ms,
    })
    .await?;
    Ok(Some((runtime, listener)))
}

async fn prepare_mailbox_runtime(
    identity: &LocalIdentityState,
    origin: Option<String>,
    allow_private_origin: bool,
    allow_loopback_origin: bool,
    ca_file: Option<PathBuf>,
    poll_interval_ms: u64,
) -> forge_peer::Result<Option<MailboxTransportRuntime>> {
    let Some(origin) = origin else {
        if allow_private_origin || allow_loopback_origin || ca_file.is_some() {
            return Err(forge_peer::PeerError::InvalidData(
                "mailbox trust options require --mailbox-origin".into(),
            ));
        }
        return Ok(None);
    };
    if allow_private_origin && allow_loopback_origin {
        return Err(forge_peer::PeerError::InvalidData(
            "mailbox private-origin and loopback-origin modes are mutually exclusive".into(),
        ));
    }
    if allow_loopback_origin && ca_file.is_none() {
        return Err(forge_peer::PeerError::InvalidData(
            "loopback mailbox origin requires --mailbox-ca-file".into(),
        ));
    }
    let private_exceptions = allow_private_origin
        .then(|| origin.clone())
        .into_iter()
        .collect::<Vec<_>>();
    let loopback_exceptions = allow_loopback_origin
        .then(|| origin.clone())
        .into_iter()
        .collect::<Vec<_>>();
    let policy = MailboxEndpointPolicy::new([origin.clone()], private_exceptions)?
        .with_loopback_exceptions(loopback_exceptions)?;
    let validated = validate_mailbox_origin(&origin, &policy, &SystemEndpointResolver).await?;
    let endpoint = mailbox_endpoint_for_identity(identity, &validated)?;
    let roots = match ca_file {
        Some(path) => MailboxTlsRoots::ExclusivePem(read_explicit_ca(&path)?),
        None => MailboxTlsRoots::System,
    };
    let client = MailboxPacketClient::new(validated, roots)?;
    let runtime =
        MailboxTransportRuntime::prepare(client, endpoint, Duration::from_millis(poll_interval_ms))
            .await?;
    Ok(Some(runtime))
}

fn read_explicit_ca(path: &Path) -> forge_peer::Result<Vec<u8>> {
    const MAX_CA_BYTES: usize = 64 * 1024;
    let bytes = read_bounded(path)?;
    if bytes.len() > MAX_CA_BYTES {
        return Err(forge_peer::PeerError::LimitExceeded(
            "mailbox CA bundle exceeds 64 KiB".into(),
        ));
    }
    Ok(bytes)
}

fn run_identity_command(command: IdentityCommand) -> forge_peer::Result<()> {
    match command {
        IdentityCommand::Init {
            state_dir,
            valid_days,
        } => {
            let directory = SecureDirectory::open_or_create(state_dir)?;
            let state_path = directory.path().join(IDENTITY_STATE_FILE);
            match std::fs::symlink_metadata(&state_path) {
                Ok(_) => {
                    return Err(forge_peer::PeerError::StateConflict(
                        "identity state already exists; refusing to overwrite it".into(),
                    ));
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.into()),
            }
            let state = LocalIdentityState::generate(unix_time_u64()?, valid_seconds(valid_days)?)?;
            write_identity(&directory, &state)?;
            export_certificate(&directory, &state)?;
            print_identity(&state)?;
        }
        IdentityCommand::Inspect { state_dir } => {
            let directory = SecureDirectory::open_or_create(state_dir)?;
            print_identity(&read_identity(&directory)?)?;
        }
        IdentityCommand::Rotate {
            state_dir,
            valid_days,
        } => {
            let directory = SecureDirectory::open_or_create(state_dir)?;
            let now = unix_time_u64()?;
            let current = read_identity(&directory)?;
            DurableDaemonHandler::ensure_local_identity_rotation_allowed(
                directory.path(),
                &current,
                now,
            )?;
            let state = current.rotate(now, valid_seconds(valid_days)?)?;
            write_identity(&directory, &state)?;
            export_certificate(&directory, &state)?;
            print_identity(&state)?;
        }
        IdentityCommand::Revoke {
            state_dir,
            permanent,
        } => {
            let directory = SecureDirectory::open_or_create(state_dir)?;
            let mut state = read_identity(&directory)?;
            let revocation = state.revoke_current(unix_time_u64()?, permanent)?;
            write_identity(&directory, &state)?;
            export_revocation(&directory, &revocation)?;
            println!(
                "revoked device serial through {} at revocation sequence {} (permanent={})",
                revocation.body.revoked_through_serial,
                revocation.body.sequence,
                revocation.body.permanent
            );
        }
        IdentityCommand::ExportRevocations { state_dir } => {
            let directory = SecureDirectory::open_or_create(state_dir)?;
            let state = read_identity(&directory)?;
            for revocation in state.revocations() {
                export_revocation(&directory, revocation)?;
            }
            println!(
                "exported {} device revocation(s)",
                state.revocations().len()
            );
        }
        IdentityCommand::ExportPublic { state_dir } => {
            let directory = SecureDirectory::open_or_create(state_dir)?;
            let state = read_identity(&directory)?;
            export_certificate(&directory, &state)?;
            for revocation in state.revocations() {
                export_revocation(&directory, revocation)?;
            }
            println!(
                "exported certificate serial {} and {} device revocation(s)",
                state.certificate().body.serial,
                state.revocations().len()
            );
        }
    }
    Ok(())
}

fn read_identity(directory: &SecureDirectory) -> forge_peer::Result<LocalIdentityState> {
    LocalIdentityState::decode_secret(&directory.read_secret(IDENTITY_STATE_FILE)?)
}

fn write_identity(
    directory: &SecureDirectory,
    state: &LocalIdentityState,
) -> forge_peer::Result<()> {
    directory.atomic_write_secret(IDENTITY_STATE_FILE, &state.encode_secret()?)
}

fn export_revocation(
    directory: &SecureDirectory,
    revocation: &forge_peer::identity::SignedDeviceRevocation,
) -> forge_peer::Result<()> {
    let file_name = format!("device-revocation-{}.bin", revocation.body.sequence);
    directory.atomic_write_secret(
        &file_name,
        &encode_limited::<MAX_REVOCATION_BYTES, _>(revocation)?,
    )
}

fn export_certificate(
    directory: &SecureDirectory,
    state: &LocalIdentityState,
) -> forge_peer::Result<()> {
    let file_name = format!("device-certificate-{}.bin", state.certificate().body.serial);
    directory.atomic_write_secret(
        &file_name,
        &encode_limited::<MAX_REVOCATION_BYTES, _>(state.certificate())?,
    )
}

fn print_identity(state: &LocalIdentityState) -> forge_peer::Result<()> {
    let certificate = state.certificate();
    println!("principal={}", hex::encode(certificate.body.principal_id.0));
    println!("device={}", hex::encode(certificate.body.device_id.0));
    println!("serial={}", certificate.body.serial);
    println!("not_before={}", certificate.body.not_before);
    println!("not_after={}", certificate.body.not_after);
    println!(
        "root_public_key={}",
        hex::encode(certificate.root_public_key)
    );
    println!(
        "device_signing_public_key={}",
        hex::encode(certificate.body.device_public_key)
    );
    println!(
        "device_key_agreement_public_key={}",
        hex::encode(certificate.body.device_key_agreement_public_key)
    );
    println!(
        "certificate_hash={}",
        hex::encode(certificate.fingerprint()?)
    );
    println!("revocations={}", state.revocations().len());
    if let Some(revocation) = state.revocations().last() {
        println!("revocation_head={}", hex::encode(revocation.hash()?));
        println!(
            "revoked_through_serial={}",
            revocation.body.revoked_through_serial
        );
        println!("permanently_revoked={}", revocation.body.permanent);
    }
    Ok(())
}

fn valid_seconds(valid_days: u64) -> forge_peer::Result<u64> {
    if valid_days == 0 {
        return Err(forge_peer::PeerError::InvalidData(
            "identity validity must be at least one day".into(),
        ));
    }
    valid_days
        .checked_mul(24 * 60 * 60)
        .ok_or_else(|| forge_peer::PeerError::InvalidData("identity validity overflows".into()))
}

fn read_bounded(path: &Path) -> forge_peer::Result<Vec<u8>> {
    const MAX_BYTES: u64 = 256 * 1024;
    let expected = std::fs::symlink_metadata(path)?;
    if !expected.is_file()
        || expected.file_type().is_symlink()
        || expected.nlink() != 1
        || expected.len() == 0
        || expected.len() > MAX_BYTES
    {
        return Err(forge_peer::PeerError::Manifest(
            "manifest input must be a non-empty single-link regular file no larger than 256 KiB"
                .into(),
        ));
    }
    let file = File::from(
        rustix::fs::open(
            path,
            rustix::fs::OFlags::RDONLY | rustix::fs::OFlags::NOFOLLOW | rustix::fs::OFlags::CLOEXEC,
            rustix::fs::Mode::empty(),
        )
        .map_err(std::io::Error::from)?,
    );
    let opened = file.metadata()?;
    if !opened.is_file()
        || opened.dev() != expected.dev()
        || opened.ino() != expected.ino()
        || opened.len() != expected.len()
        || opened.nlink() != 1
    {
        return Err(forge_peer::PeerError::Manifest(
            "manifest input changed between validation and open".into(),
        ));
    }
    let capacity = usize::try_from(opened.len()).map_err(|_| {
        forge_peer::PeerError::LimitExceeded("manifest input length does not fit memory".into())
    })?;
    let mut bytes = Vec::with_capacity(capacity);
    file.take(MAX_BYTES + 1).read_to_end(&mut bytes)?;
    if bytes.len() != capacity {
        return Err(forge_peer::PeerError::Manifest(
            "manifest input changed while being read".into(),
        ));
    }
    let final_path = std::fs::symlink_metadata(path)?;
    if final_path.file_type().is_symlink()
        || final_path.dev() != opened.dev()
        || final_path.ino() != opened.ino()
        || final_path.len() != opened.len()
    {
        return Err(forge_peer::PeerError::Manifest(
            "manifest input path changed while being read".into(),
        ));
    }
    Ok(bytes)
}

fn reject_keyring_inside_bundle(keyring: &Path, bundle: &Path) -> forge_peer::Result<()> {
    let keyring = std::fs::canonicalize(keyring)?;
    let bundle = std::fs::canonicalize(bundle)?;
    if keyring.starts_with(bundle) {
        return Err(forge_peer::PeerError::Manifest(
            "trusted keyring must be supplied from outside the untrusted release bundle".into(),
        ));
    }
    Ok(())
}

fn unix_time() -> forge_peer::Result<i64> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| forge_peer::PeerError::Manifest("system clock predates Unix epoch".into()))?
        .as_secs()
        .try_into()
        .map_err(|_| forge_peer::PeerError::Manifest("system time exceeds i64".into()))
}

fn unix_time_u64() -> forge_peer::Result<u64> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .map_err(|_| forge_peer::PeerError::InvalidData("system clock predates Unix epoch".into()))
}
