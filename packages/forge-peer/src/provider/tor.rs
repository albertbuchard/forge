use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::{Component, Path, PathBuf};
use std::process::{Command as StdCommand, Stdio};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use async_trait::async_trait;
use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
use tokio::net::{TcpListener, TcpStream};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

use crate::codec::{BoundedString, Validate};
use crate::endpoint::TorEndpoint;
use crate::envelope::SignedEnvelope;
use crate::error::{PeerError, Result, invalid};
use crate::provider::stream::{receive_on_stream, send_on_stream};
use crate::provider::{
    BoundedInbox, BoxPeerStream, PROVIDER_OPERATION_TIMEOUT, ProviderCapabilities, ProviderHealth,
    ProviderKind, TransportProvider,
};
use crate::secure_fs::SecureDirectory;

const HIDDEN_SERVICE_DIRECTORY: &str = "forge-peer-service";
const HIDDEN_SERVICE_HOSTNAME_FILE: &str = "hostname";
const TOR_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);
const TOR_SOCKS_TIMEOUT: Duration = Duration::from_secs(10);
const TOR_STARTUP_POLL_INTERVAL: Duration = Duration::from_millis(50);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TorProcessSpec {
    pub executable: PathBuf,
    pub data_directory: PathBuf,
    pub arguments: Vec<String>,
    pub startup_timeout_seconds: u16,
}

impl TorProcessSpec {
    pub fn validate(&self) -> Result<()> {
        validate_absolute_path(&self.executable, "Tor executable")?;
        validate_absolute_path(&self.data_directory, "Tor data directory")?;
        if self.arguments.len() > 64 {
            return Err(PeerError::LimitExceeded(
                "Tor adapter argument count exceeds 64".into(),
            ));
        }
        for argument in &self.arguments {
            if argument.is_empty() || argument.len() > 1_024 || argument.contains('\0') {
                return Err(invalid(
                    "Tor adapter argument is empty, oversized, or contains NUL",
                ));
            }
            let normalized = argument.to_ascii_lowercase();
            if normalized == "--datadirectory" || normalized.starts_with("--datadirectory=") {
                return Err(invalid(
                    "Tor adapter arguments cannot override the validated data directory",
                ));
            }
        }
        if !(1..=120).contains(&self.startup_timeout_seconds) {
            return Err(invalid(
                "Tor startup timeout must be within 1..=120 seconds",
            ));
        }
        Ok(())
    }

    pub fn command(&self) -> Result<StdCommand> {
        self.validate()?;
        let mut command = StdCommand::new(&self.executable);
        command.args(&self.arguments);
        command.arg("--DataDirectory").arg(&self.data_directory);
        Ok(command)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TorRuntimeConfig {
    pub executable: PathBuf,
    pub data_directory: PathBuf,
    pub socks_address: SocketAddr,
    pub virtual_port: u16,
    pub startup_timeout_seconds: u16,
    pub restart_limit: u8,
    pub minimum_restart_backoff_ms: u32,
    pub maximum_restart_backoff_ms: u32,
}

impl TorRuntimeConfig {
    pub fn validate(&self) -> Result<()> {
        validate_absolute_path(&self.executable, "Tor executable")?;
        validate_absolute_path(&self.data_directory, "Tor data directory")?;
        if !self.socks_address.ip().is_loopback() || self.socks_address.port() == 0 {
            return Err(invalid(
                "Tor SOCKS endpoint must be a non-zero loopback socket",
            ));
        }
        if self.virtual_port == 0 {
            return Err(invalid("Tor hidden-service virtual port must be non-zero"));
        }
        if !(1..=120).contains(&self.startup_timeout_seconds) {
            return Err(invalid(
                "Tor startup timeout must be within 1..=120 seconds",
            ));
        }
        if self.restart_limit > 16 {
            return Err(invalid("Tor restart limit must be within 0..=16"));
        }
        if !(100..=30_000).contains(&self.minimum_restart_backoff_ms)
            || !(100..=30_000).contains(&self.maximum_restart_backoff_ms)
            || self.minimum_restart_backoff_ms > self.maximum_restart_backoff_ms
        {
            return Err(invalid(
                "Tor restart backoff must be ordered and within 100..=30000 milliseconds",
            ));
        }
        Ok(())
    }
}

struct TorRuntimeShared {
    config: TorRuntimeConfig,
    target_address: SocketAddr,
    endpoint: TorEndpoint,
    child: Mutex<Option<Child>>,
    ready: AtomicBool,
}

#[derive(Clone)]
pub struct TorRuntime {
    shared: Arc<TorRuntimeShared>,
}

impl TorRuntime {
    pub async fn bind(config: TorRuntimeConfig) -> Result<(Self, TcpListener)> {
        config.validate()?;
        validate_executable(&config.executable)?;
        let data_directory = SecureDirectory::open_or_create(&config.data_directory)?;
        let hidden_service_directory =
            SecureDirectory::open_or_create(data_directory.path().join(HIDDEN_SERVICE_DIRECTORY))?;
        let listener = TcpListener::bind(SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0))
            .await
            .map_err(|error| {
                PeerError::Transport(format!("binding Tor hidden-service target: {error}"))
            })?;
        let target_address = listener.local_addr().map_err(|error| {
            PeerError::Transport(format!("reading Tor hidden-service target: {error}"))
        })?;
        let (child, endpoint) =
            spawn_ready(&config, target_address, &hidden_service_directory, None).await?;
        Ok((
            Self {
                shared: Arc::new(TorRuntimeShared {
                    config,
                    target_address,
                    endpoint,
                    child: Mutex::new(Some(child)),
                    ready: AtomicBool::new(true),
                }),
            },
            listener,
        ))
    }

    pub fn endpoint_descriptor(&self) -> TorEndpoint {
        self.shared.endpoint.clone()
    }

    pub fn is_ready(&self) -> bool {
        self.shared.ready.load(Ordering::Acquire)
    }

    pub async fn connect(&self, endpoint: &TorEndpoint) -> Result<TcpStream> {
        endpoint.validate()?;
        if !self.is_ready() {
            return Err(PeerError::Transport(
                "Tor provider is configured but not ready".into(),
            ));
        }
        tokio::time::timeout(
            TOR_SOCKS_TIMEOUT,
            socks5_connect(self.shared.config.socks_address, endpoint),
        )
        .await
        .map_err(|_| PeerError::Timeout("connecting Tor onion endpoint"))?
    }

    pub async fn supervise_until<F>(
        self,
        shutdown: F,
        on_state: impl Fn(bool, &'static str) + Send + Sync,
    ) -> Result<()>
    where
        F: std::future::Future<Output = ()> + Send,
    {
        tokio::pin!(shutdown);
        let hidden_service_directory = SecureDirectory::open_or_create(
            self.shared
                .config
                .data_directory
                .join(HIDDEN_SERVICE_DIRECTORY),
        )?;
        let mut restart_count = 0_u8;
        loop {
            tokio::select! {
                () = &mut shutdown => {
                    on_state(false, "shutdown");
                    self.stop().await?;
                    return Ok(());
                }
                () = tokio::time::sleep(TOR_STARTUP_POLL_INTERVAL) => {}
            }
            let exited = {
                let mut child = self.shared.child.lock().await;
                let child = child.as_mut().ok_or_else(|| {
                    PeerError::StateConflict("Tor supervisor has no child process".into())
                })?;
                child
                    .try_wait()
                    .map_err(|error| {
                        PeerError::Transport(format!("checking Tor subprocess: {error}"))
                    })?
                    .is_some()
            };
            if !exited {
                continue;
            }
            self.shared.child.lock().await.take();
            self.shared.ready.store(false, Ordering::Release);
            on_state(false, "subprocess_exited");
            if restart_count >= self.shared.config.restart_limit {
                return Err(PeerError::Transport(
                    "Tor subprocess exceeded its bounded restart limit".into(),
                ));
            }
            restart_count = restart_count.saturating_add(1);
            let shift = u32::from(restart_count.saturating_sub(1)).min(8);
            let delay_ms = self
                .shared
                .config
                .minimum_restart_backoff_ms
                .saturating_mul(1_u32 << shift)
                .min(self.shared.config.maximum_restart_backoff_ms);
            tokio::select! {
                () = &mut shutdown => {
                    on_state(false, "shutdown");
                    return Ok(());
                }
                () = tokio::time::sleep(Duration::from_millis(u64::from(delay_ms))) => {}
            }
            let (child, endpoint) = spawn_ready(
                &self.shared.config,
                self.shared.target_address,
                &hidden_service_directory,
                Some(&self.shared.endpoint),
            )
            .await?;
            if endpoint != self.shared.endpoint {
                return Err(PeerError::Authentication(
                    "Tor hidden-service identity changed during restart".into(),
                ));
            }
            *self.shared.child.lock().await = Some(child);
            self.shared.ready.store(true, Ordering::Release);
            on_state(true, "operational");
        }
    }

    pub async fn stop(&self) -> Result<()> {
        self.shared.ready.store(false, Ordering::Release);
        if let Some(mut child) = self.shared.child.lock().await.take() {
            stop_child(&mut child).await?;
        }
        Ok(())
    }
}

async fn spawn_ready(
    config: &TorRuntimeConfig,
    target_address: SocketAddr,
    hidden_service_directory: &SecureDirectory,
    expected_endpoint: Option<&TorEndpoint>,
) -> Result<(Child, TorEndpoint)> {
    let mut command = Command::new(&config.executable);
    command
        .env_clear()
        .arg("-f")
        .arg("/dev/null")
        .arg("--DataDirectory")
        .arg(&config.data_directory)
        .arg("--SocksPort")
        .arg(config.socks_address.to_string())
        .arg("--HiddenServiceDir")
        .arg(hidden_service_directory.path())
        .arg("--HiddenServiceVersion")
        .arg("3")
        .arg("--HiddenServicePort")
        .arg(format!("{} {target_address}", config.virtual_port))
        .arg("--RunAsDaemon")
        .arg("0")
        .arg("--Log")
        .arg("notice stdout")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let mut child = command
        .spawn()
        .map_err(|error| PeerError::Transport(format!("starting Tor subprocess: {error}")))?;
    let deadline = tokio::time::Instant::now()
        + Duration::from_secs(u64::from(config.startup_timeout_seconds));
    loop {
        if child
            .try_wait()
            .map_err(|error| PeerError::Transport(format!("checking Tor subprocess: {error}")))?
            .is_some()
        {
            return Err(PeerError::Transport(
                "Tor subprocess exited before becoming ready".into(),
            ));
        }
        if let Ok(endpoint) =
            read_hidden_service_endpoint(hidden_service_directory, config.virtual_port)
        {
            if expected_endpoint.is_some_and(|expected| expected != &endpoint) {
                stop_child(&mut child).await?;
                return Err(PeerError::Authentication(
                    "Tor hidden-service identity changed during restart".into(),
                ));
            }
            if probe_socks5(config.socks_address).await.is_ok() {
                return Ok((child, endpoint));
            }
        }
        if tokio::time::Instant::now() >= deadline {
            stop_child(&mut child).await?;
            return Err(PeerError::Timeout("starting supervised Tor runtime"));
        }
        tokio::time::sleep(TOR_STARTUP_POLL_INTERVAL).await;
    }
}

fn read_hidden_service_endpoint(
    directory: &SecureDirectory,
    virtual_port: u16,
) -> Result<TorEndpoint> {
    let bytes = directory.read_secret(HIDDEN_SERVICE_HOSTNAME_FILE)?;
    let hostname = std::str::from_utf8(&bytes)
        .map_err(|_| invalid("Tor hidden-service hostname is not UTF-8"))?
        .trim_end_matches(['\r', '\n']);
    if hostname.is_empty() || hostname.bytes().any(|byte| byte.is_ascii_whitespace()) {
        return Err(invalid("Tor hidden-service hostname is malformed"));
    }
    let endpoint = TorEndpoint {
        onion_host: BoundedString::new(hostname.to_owned())?,
        port: virtual_port,
    };
    endpoint.validate()?;
    Ok(endpoint)
}

async fn stop_child(child: &mut Child) -> Result<()> {
    if child
        .try_wait()
        .map_err(|error| PeerError::Transport(format!("checking Tor subprocess: {error}")))?
        .is_some()
    {
        return Ok(());
    }
    child
        .start_kill()
        .map_err(|error| PeerError::Transport(format!("stopping Tor subprocess: {error}")))?;
    tokio::time::timeout(TOR_SHUTDOWN_TIMEOUT, child.wait())
        .await
        .map_err(|_| PeerError::Timeout("stopping Tor subprocess"))?
        .map_err(|error| PeerError::Transport(format!("waiting for Tor shutdown: {error}")))?;
    Ok(())
}

async fn probe_socks5(address: SocketAddr) -> Result<()> {
    let mut stream = tokio::time::timeout(TOR_SOCKS_TIMEOUT, TcpStream::connect(address))
        .await
        .map_err(|_| PeerError::Timeout("probing Tor SOCKS endpoint"))?
        .map_err(|error| PeerError::Transport(format!("probing Tor SOCKS endpoint: {error}")))?;
    stream.write_all(&[5, 1, 0]).await?;
    let mut response = [0_u8; 2];
    stream.read_exact(&mut response).await?;
    if response != [5, 0] {
        return Err(PeerError::Authentication(
            "configured Tor SOCKS endpoint rejected no-auth SOCKS5".into(),
        ));
    }
    Ok(())
}

async fn socks5_connect(address: SocketAddr, endpoint: &TorEndpoint) -> Result<TcpStream> {
    let host = endpoint.onion_host.as_str().as_bytes();
    let host_len =
        u8::try_from(host.len()).map_err(|_| invalid("Tor onion hostname exceeds SOCKS5 limit"))?;
    let mut stream = TcpStream::connect(address).await.map_err(|error| {
        PeerError::Transport(format!("connecting configured Tor SOCKS: {error}"))
    })?;
    stream.write_all(&[5, 1, 0]).await?;
    let mut greeting = [0_u8; 2];
    stream.read_exact(&mut greeting).await?;
    if greeting != [5, 0] {
        return Err(PeerError::Authentication(
            "configured Tor SOCKS endpoint does not permit no-auth SOCKS5".into(),
        ));
    }
    let mut request = Vec::with_capacity(host.len() + 7);
    request.extend_from_slice(&[5, 1, 0, 3, host_len]);
    request.extend_from_slice(host);
    request.extend_from_slice(&endpoint.port.to_be_bytes());
    stream.write_all(&request).await?;
    let mut header = [0_u8; 4];
    stream.read_exact(&mut header).await?;
    if header[0] != 5 || header[2] != 0 || header[1] != 0 {
        return Err(PeerError::Transport(format!(
            "Tor SOCKS connection failed with bounded status {}",
            header[1]
        )));
    }
    match header[3] {
        1 => {
            let mut remainder = [0_u8; 6];
            stream.read_exact(&mut remainder).await?;
        }
        3 => {
            let length = stream.read_u8().await?;
            let mut remainder = vec![0_u8; usize::from(length) + 2];
            stream.read_exact(&mut remainder).await?;
        }
        4 => {
            let mut remainder = [0_u8; 18];
            stream.read_exact(&mut remainder).await?;
        }
        _ => {
            return Err(PeerError::Authentication(
                "Tor SOCKS response used an invalid address type".into(),
            ));
        }
    }
    stream
        .set_nodelay(true)
        .map_err(|error| PeerError::Transport(format!("setting Tor TCP_NODELAY: {error}")))?;
    Ok(stream)
}

fn validate_executable(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt as _;
    let metadata = std::fs::symlink_metadata(path)?;
    if !metadata.is_file()
        || metadata.file_type().is_symlink()
        || metadata.permissions().mode() & 0o111 == 0
    {
        return Err(PeerError::Authorization(
            "Tor executable must be a non-symlink executable regular file".into(),
        ));
    }
    Ok(())
}

#[async_trait]
pub trait TorRuntimeAdapter: Send + Sync {
    async fn start(&self, spec: &TorProcessSpec) -> Result<()>;
    async fn connect_onion(&self, endpoint: &TorEndpoint) -> Result<BoxPeerStream>;
    async fn health(&self) -> Result<BoundedString<256>>;
    async fn stop(&self) -> Result<()>;
}

pub struct TorStreamProvider<A> {
    endpoint: TorEndpoint,
    adapter: A,
    inbox: Arc<BoundedInbox>,
}

impl<A> TorStreamProvider<A> {
    pub fn new(endpoint: TorEndpoint, adapter: A) -> Result<Self> {
        endpoint.validate()?;
        Ok(Self {
            endpoint,
            adapter,
            inbox: Arc::new(BoundedInbox::default()),
        })
    }

    pub async fn ingest_stream(&self, stream: BoxPeerStream) -> Result<()> {
        self.inbox.push(receive_on_stream(stream).await?).await
    }
}

impl<A: TorRuntimeAdapter> TorStreamProvider<A> {
    async fn connect_bounded(&self) -> Result<BoxPeerStream> {
        tokio::time::timeout(
            PROVIDER_OPERATION_TIMEOUT,
            self.adapter.connect_onion(&self.endpoint),
        )
        .await
        .map_err(|_| PeerError::Timeout("connecting Tor onion service"))?
    }

    pub async fn start(&self, spec: &TorProcessSpec) -> Result<()> {
        spec.validate()?;
        tokio::time::timeout(
            std::time::Duration::from_secs(u64::from(spec.startup_timeout_seconds)),
            self.adapter.start(spec),
        )
        .await
        .map_err(|_| PeerError::Timeout("starting Tor runtime"))?
    }

    pub async fn stop(&self) -> Result<()> {
        tokio::time::timeout(PROVIDER_OPERATION_TIMEOUT, self.adapter.stop())
            .await
            .map_err(|_| PeerError::Timeout("stopping Tor runtime"))?
    }
}

#[async_trait]
impl<A: TorRuntimeAdapter> TransportProvider for TorStreamProvider<A> {
    fn kind(&self) -> ProviderKind {
        ProviderKind::TorOnion
    }

    fn capabilities(&self) -> ProviderCapabilities {
        ProviderCapabilities {
            presence: false,
            mailbox: false,
            key_packages: false,
            envelope_stream: true,
            hides_client_address_from_peer: true,
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
            detail: tokio::time::timeout(PROVIDER_OPERATION_TIMEOUT, self.adapter.health())
                .await
                .map_err(|_| PeerError::Timeout("checking Tor runtime health"))??,
        })
    }
}

fn validate_absolute_path(path: &Path, label: &str) -> Result<()> {
    if !path.is_absolute() {
        return Err(invalid(format!("{label} must be absolute")));
    }
    if path.as_os_str().is_empty() {
        return Err(invalid(format!("{label} is empty")));
    }
    if path
        .components()
        .any(|component| !matches!(component, Component::RootDir | Component::Normal(_)))
    {
        return Err(invalid(format!(
            "{label} contains non-normal path components"
        )));
    }
    if path == Path::new("/") {
        return Err(invalid(format!("{label} cannot be the filesystem root")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::{PermissionsExt as _, symlink};
    use std::sync::Mutex as StdMutex;
    use std::time::{SystemTime, UNIX_EPOCH};

    use ed25519_dalek::SigningKey;
    use sha3::{Digest as _, Sha3_256};

    use super::*;
    use crate::codec::{BoundedBytes, FrameType, read_frame, write_frame};
    use crate::identity::{
        DeviceCapabilities, DeviceId, DeviceSigner, PrincipalRootSigner, ProtocolRange,
    };
    use crate::transport::{PeerWirePacket, PeerWirePayload, SignedDeliveryAck};

    fn unix_time() -> Result<u64> {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_secs())
            .map_err(|_| invalid("system clock predates Unix epoch"))
    }

    fn valid_onion_host() -> String {
        let public_key = SigningKey::from_bytes(&[42; 32]).verifying_key().to_bytes();
        let mut checksum_input = Vec::new();
        checksum_input.extend_from_slice(b".onion checksum");
        checksum_input.extend_from_slice(&public_key);
        checksum_input.push(3);
        let checksum = Sha3_256::digest(checksum_input);
        let mut service_id = Vec::from(public_key);
        service_id.extend_from_slice(&checksum[..2]);
        service_id.push(3);
        format!("{}.onion", encode_base32(&service_id))
    }

    fn encode_base32(bytes: &[u8]) -> String {
        const ALPHABET: &[u8; 32] = b"abcdefghijklmnopqrstuvwxyz234567";
        let mut encoded = String::new();
        let mut accumulator = 0_u16;
        let mut bits = 0_u8;
        for byte in bytes {
            accumulator = (accumulator << 8) | u16::from(*byte);
            bits += 8;
            while bits >= 5 {
                bits -= 5;
                encoded.push(char::from(
                    ALPHABET[usize::from((accumulator >> bits) & 0x1f)],
                ));
                accumulator &= if bits == 0 { 0 } else { (1_u16 << bits) - 1 };
            }
        }
        encoded
    }

    async fn run_fake_socks(
        listener: TcpListener,
        data_directory: PathBuf,
        mut shutdown: tokio::sync::oneshot::Receiver<()>,
    ) -> Result<()> {
        loop {
            let (stream, _) = tokio::select! {
                result = listener.accept() => result.map_err(PeerError::Io)?,
                _ = &mut shutdown => return Ok(()),
            };
            let target_file = data_directory.join("target");
            tokio::spawn(async move {
                let _ = handle_fake_socks_connection(stream, &target_file).await;
            });
        }
    }

    async fn handle_fake_socks_connection(mut stream: TcpStream, target_file: &Path) -> Result<()> {
        let mut greeting = [0_u8; 3];
        stream.read_exact(&mut greeting).await?;
        if greeting != [5, 1, 0] {
            return Err(PeerError::Authentication(
                "fake SOCKS harness received an invalid greeting".into(),
            ));
        }
        stream.write_all(&[5, 0]).await?;
        let mut request = [0_u8; 4];
        match stream.read_exact(&mut request).await {
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(()),
            Err(error) => return Err(error.into()),
        }
        if request != [5, 1, 0, 3] {
            return Err(PeerError::Authentication(
                "fake SOCKS harness received an invalid CONNECT request".into(),
            ));
        }
        let host_length = usize::from(stream.read_u8().await?);
        let mut host = vec![0_u8; host_length];
        stream.read_exact(&mut host).await?;
        let port = stream.read_u16().await?;
        let endpoint = TorEndpoint {
            onion_host: BoundedString::new(
                String::from_utf8(host).map_err(|_| invalid("fake SOCKS hostname is not UTF-8"))?,
            )?,
            port,
        };
        endpoint.validate()?;
        let target = std::fs::read_to_string(target_file)?
            .trim()
            .parse::<SocketAddr>()
            .map_err(|_| invalid("fake Tor target address is invalid"))?;
        let mut upstream = TcpStream::connect(target).await?;
        stream.write_all(&[5, 0, 0, 1, 127, 0, 0, 1, 0, 0]).await?;
        tokio::io::copy_bidirectional(&mut stream, &mut upstream).await?;
        Ok(())
    }

    #[test]
    fn tor_process_spec_never_requires_shell_interpolation() -> Result<()> {
        let spec = TorProcessSpec {
            executable: PathBuf::from("/usr/local/bin/tor"),
            data_directory: PathBuf::from("/var/lib/forge-peer/tor"),
            arguments: vec!["--ClientOnly".into(), "1".into()],
            startup_timeout_seconds: 30,
        };
        assert!(spec.validate().is_ok());
        let command = spec.command()?;
        let arguments: Vec<_> = command.get_args().map(ToOwned::to_owned).collect();
        assert_eq!(
            arguments.last().map(std::ffi::OsString::as_os_str),
            Some(spec.data_directory.as_os_str())
        );

        let mut literal = spec.clone();
        literal
            .arguments
            .push("$(touch /tmp/forge-peer-unsafe)".into());
        assert!(literal.validate().is_ok());
        let literal_command = literal.command()?;
        assert!(
            literal_command
                .get_args()
                .any(|argument| argument == "$(touch /tmp/forge-peer-unsafe)")
        );

        let mut override_attempt = spec.clone();
        override_attempt
            .arguments
            .push("--datadirectory=/tmp/attacker".into());
        assert!(override_attempt.validate().is_err());

        let mut relative = spec;
        relative.executable = PathBuf::from("tor");
        assert!(relative.validate().is_err());
        Ok(())
    }

    #[tokio::test]
    async fn runtime_rejects_bad_config_and_symlinked_executable() -> Result<()> {
        let temporary = tempfile::tempdir()?;
        let root = std::fs::canonicalize(temporary.path())?;
        let executable = root.join("tor-real");
        std::fs::write(&executable, "#!/bin/sh\nexit 0\n")?;
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700))?;
        let linked = root.join("tor-linked");
        symlink(&executable, &linked)?;
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await?;
        let base = TorRuntimeConfig {
            executable: linked,
            data_directory: root.join("runtime"),
            socks_address: listener.local_addr()?,
            virtual_port: 443,
            startup_timeout_seconds: 1,
            restart_limit: 1,
            minimum_restart_backoff_ms: 100,
            maximum_restart_backoff_ms: 200,
        };
        assert!(matches!(
            TorRuntime::bind(base.clone()).await,
            Err(PeerError::Authorization(_))
        ));
        let mut non_loopback = base.clone();
        non_loopback.socks_address = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8)), 9050);
        assert!(non_loopback.validate().is_err());
        let mut relative = base.clone();
        relative.data_directory = PathBuf::from("relative");
        assert!(relative.validate().is_err());
        let mut reversed_backoff = base;
        reversed_backoff.minimum_restart_backoff_ms = 500;
        reversed_backoff.maximum_restart_backoff_ms = 100;
        assert!(reversed_backoff.validate().is_err());
        Ok(())
    }

    #[tokio::test]
    #[allow(clippy::too_many_lines)]
    async fn supervised_runtime_restarts_and_carries_real_peer_frames() -> Result<()> {
        let temporary = tempfile::tempdir()?;
        let root = std::fs::canonicalize(temporary.path())?;
        let executable = root.join("fake-tor");
        let data_directory = root.join("tor-data");
        let onion = valid_onion_host();
        let script = format!(
            "#!/bin/sh\n\
             data=''\n\
             hidden=''\n\
             target=''\n\
             while [ \"$#\" -gt 0 ]; do\n\
               case \"$1\" in\n\
                 --DataDirectory) data=$2; shift 2 ;;\n\
                 --HiddenServiceDir) hidden=$2; shift 2 ;;\n\
                 --HiddenServicePort) mapping=$2; target=${{mapping#* }}; shift 2 ;;\n\
                 *) shift ;;\n\
               esac\n\
             done\n\
             umask 077\n\
             printf '%s\\n' '{onion}' > \"$hidden/hostname\"\n\
             printf '%s\\n' \"$target\" > \"$data/target\"\n\
             printf x >> \"$data/launches\"\n\
             if [ ! -f \"$data/restarted\" ]; then\n\
               : > \"$data/restarted\"\n\
               /bin/sleep 1\n\
               exit 17\n\
             fi\n\
             /bin/sleep 30\n"
        );
        std::fs::write(&executable, script)?;
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700))?;
        let socks_listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await?;
        let socks_address = socks_listener.local_addr()?;
        let (socks_shutdown_tx, socks_shutdown_rx) = tokio::sync::oneshot::channel();
        let socks_data_directory = data_directory.clone();
        let socks_task = tokio::spawn(async move {
            run_fake_socks(socks_listener, socks_data_directory, socks_shutdown_rx).await
        });

        let (runtime, target_listener) = TorRuntime::bind(TorRuntimeConfig {
            executable,
            data_directory: data_directory.clone(),
            socks_address,
            virtual_port: 443,
            startup_timeout_seconds: 3,
            restart_limit: 2,
            minimum_restart_backoff_ms: 100,
            maximum_restart_backoff_ms: 200,
        })
        .await?;
        assert_eq!(runtime.endpoint_descriptor().onion_host.as_str(), onion);
        let states = Arc::new(StdMutex::new(Vec::new()));
        let observed_states = Arc::clone(&states);
        let supervised = runtime.clone();
        let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel();
        let supervisor = tokio::spawn(async move {
            supervised
                .supervise_until(
                    async move {
                        let _ = shutdown_rx.await;
                    },
                    move |ready, _| {
                        if let Ok(mut states) = observed_states.lock() {
                            states.push(ready);
                        }
                    },
                )
                .await
        });
        let restart_deadline = tokio::time::Instant::now() + Duration::from_secs(5);
        loop {
            let launches = std::fs::read(data_directory.join("launches")).unwrap_or_default();
            if launches.len() >= 2 && runtime.is_ready() {
                break;
            }
            if tokio::time::Instant::now() >= restart_deadline {
                return Err(PeerError::Timeout("waiting for fake Tor restart"));
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        assert!(
            states
                .lock()
                .map_err(|_| invalid("state lock poisoned"))?
                .contains(&false)
        );
        assert!(
            states
                .lock()
                .map_err(|_| invalid("state lock poisoned"))?
                .contains(&true)
        );

        let now = unix_time()?;
        let root_signer = PrincipalRootSigner::generate();
        let signer = DeviceSigner::generate(DeviceId::random());
        let certificate = crate::identity::DeviceCertificate::issue(
            &root_signer,
            &signer,
            DeviceCapabilities::all_known(),
            ProtocolRange::CURRENT,
            1,
            now.saturating_sub(1),
            now.saturating_add(3_600),
        )?;
        let packet = PeerWirePacket::new(
            PeerWirePayload::PairingAcceptance(BoundedBytes::new(vec![1, 2, 3])?),
            now,
            now.saturating_add(300),
        )?;
        let expected_packet = packet.clone();
        let expected_certificate = certificate.clone();
        let target = tokio::spawn(async move {
            let (mut stream, _) = target_listener.accept().await?;
            let received: PeerWirePacket = read_frame(&mut stream, FrameType::PeerEnvelope).await?;
            if received != expected_packet {
                return Err(PeerError::Authentication(
                    "Tor harness changed the peer packet".into(),
                ));
            }
            let acknowledgement =
                SignedDeliveryAck::sign(&received, expected_certificate, &signer, unix_time()?)?;
            write_frame(&mut stream, FrameType::PeerEnvelope, &acknowledgement).await
        });
        let mut stream = runtime.connect(&runtime.endpoint_descriptor()).await?;
        write_frame(&mut stream, FrameType::PeerEnvelope, &packet).await?;
        let acknowledgement: SignedDeliveryAck =
            read_frame(&mut stream, FrameType::PeerEnvelope).await?;
        acknowledgement.verify(&packet, &certificate, unix_time()?)?;
        target
            .await
            .map_err(|error| PeerError::StateConflict(format!("Tor target task: {error}")))??;

        let _ = shutdown_tx.send(());
        supervisor
            .await
            .map_err(|error| PeerError::StateConflict(format!("Tor supervisor task: {error}")))??;
        assert!(!runtime.is_ready());
        assert!(runtime.shared.child.lock().await.is_none());
        let _ = socks_shutdown_tx.send(());
        socks_task
            .await
            .map_err(|error| PeerError::StateConflict(format!("SOCKS task: {error}")))??;
        Ok(())
    }
}
