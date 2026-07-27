use std::os::unix::fs::{FileTypeExt as _, MetadataExt as _, PermissionsExt as _};
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::net::{UnixListener, UnixStream};

use crate::codec::{Validate, read_json_frame, write_json_frame};
use crate::error::{PeerError, Result, invalid};
use crate::secure_fs::SecureDirectory;

pub const OWNER_BROKER_PROTOCOL: &str = "forge-owner-broker/1";
const OWNER_CONNECTION_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OwnerBrokerRequest {
    pub protocol: String,
    pub request_id: String,
    pub transaction_id: String,
    pub install_id: String,
    pub browser_origin: String,
    pub browser_nonce: String,
}

impl Validate for OwnerBrokerRequest {
    fn validate(&self) -> Result<()> {
        if self.protocol != OWNER_BROKER_PROTOCOL {
            return Err(invalid("owner broker protocol version is not supported"));
        }
        validate_ascii_identifier("requestId", &self.request_id, 16, 128)?;
        validate_ascii_identifier("transactionId", &self.transaction_id, 16, 160)?;
        validate_ascii_identifier("installId", &self.install_id, 1, 128)?;
        validate_loopback_origin(&self.browser_origin)?;
        if !(43..=128).contains(&self.browser_nonce.len())
            || !self
                .browser_nonce
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
        {
            return Err(invalid("browserNonce must be 43-128 base64url characters"));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum OwnerBrokerResponse {
    Accepted {
        #[serde(rename = "requestId")]
        request_id: String,
    },
    Rejected {
        #[serde(rename = "requestId")]
        request_id: String,
        reason: String,
    },
}

impl Validate for OwnerBrokerResponse {
    fn validate(&self) -> Result<()> {
        let (request_id, reason) = match self {
            Self::Accepted { request_id } => (request_id, None),
            Self::Rejected { request_id, reason } => (request_id, Some(reason)),
        };
        validate_ascii_identifier("requestId", request_id, 16, 128)?;
        if let Some(reason) = reason
            && (reason.is_empty() || reason.len() > 160 || reason.contains('\0'))
        {
            return Err(invalid("owner broker rejection reason is not bounded"));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedOwnerBrokerRequest {
    pub request: OwnerBrokerRequest,
    pub peer_uid: u32,
}

pub struct OwnerBrokerServer {
    listener: UnixListener,
    socket_path: PathBuf,
    socket_device: u64,
    socket_inode: u64,
    owner_uid: u32,
}

impl OwnerBrokerServer {
    pub fn bind(socket_path: impl AsRef<Path>) -> Result<Self> {
        let socket_path = socket_path.as_ref();
        validate_socket_path(socket_path)?;
        let parent = socket_path
            .parent()
            .ok_or_else(|| invalid("owner broker socket has no parent"))?;
        let _secure_parent = SecureDirectory::open_or_create(parent)?;
        match std::fs::symlink_metadata(socket_path) {
            Ok(_) => {
                return Err(PeerError::Ipc(
                    "owner broker socket already exists; refusing replacement".into(),
                ));
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
        let listener = UnixListener::bind(socket_path)?;
        std::fs::set_permissions(socket_path, std::fs::Permissions::from_mode(0o600))?;
        let metadata = std::fs::symlink_metadata(socket_path)?;
        let owner_uid = rustix::process::geteuid().as_raw();
        if !metadata.file_type().is_socket()
            || metadata.uid() != owner_uid
            || metadata.mode() & 0o7777 != 0o600
        {
            return Err(PeerError::Authorization(
                "owner broker endpoint is not an owner-only Unix socket".into(),
            ));
        }
        Ok(Self {
            listener,
            socket_path: socket_path.to_owned(),
            socket_device: metadata.dev(),
            socket_inode: metadata.ino(),
            owner_uid,
        })
    }

    pub async fn serve_once(
        self,
        expected: &OwnerBrokerRequest,
    ) -> Result<VerifiedOwnerBrokerRequest> {
        expected.validate()?;
        let accepted = tokio::time::timeout(OWNER_CONNECTION_TIMEOUT, self.listener.accept())
            .await
            .map_err(|_| PeerError::Timeout("accepting owner broker connection"))?;
        let (stream, _) = accepted?;
        let verified = authenticate_owner_stream(stream, self.owner_uid, expected).await?;
        self.remove_owned_socket()?;
        Ok(verified)
    }

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
            return Err(PeerError::StateConflict(
                "owner broker socket path changed while active".into(),
            ));
        }
        std::fs::remove_file(&self.socket_path)?;
        Ok(())
    }
}

impl Drop for OwnerBrokerServer {
    fn drop(&mut self) {
        let _result = self.remove_owned_socket();
    }
}

pub async fn approve_owner_request(
    socket_path: impl AsRef<Path>,
    request: &OwnerBrokerRequest,
) -> Result<()> {
    request.validate()?;
    let socket_path = socket_path.as_ref();
    validate_socket_path(socket_path)?;
    let expected_socket = validate_owner_socket_endpoint(socket_path)?;
    let mut stream = UnixStream::connect(socket_path).await?;
    let peer = stream
        .peer_cred()
        .map_err(|error| PeerError::Ipc(format!("reading broker server credentials: {error}")))?;
    let owner_uid = rustix::process::geteuid().as_raw();
    if peer.uid() != owner_uid {
        return Err(PeerError::Authentication(
            "owner broker server uid does not match the local owner".into(),
        ));
    }
    let connected_socket = std::fs::symlink_metadata(socket_path)?;
    if !connected_socket.file_type().is_socket()
        || connected_socket.file_type().is_symlink()
        || connected_socket.uid() != owner_uid
        || connected_socket.mode() & 0o7777 != 0o600
        || connected_socket.dev() != expected_socket.dev()
        || connected_socket.ino() != expected_socket.ino()
    {
        return Err(PeerError::StateConflict(
            "owner broker socket changed while the client connected".into(),
        ));
    }
    write_json_frame(&mut stream, request).await?;
    let response: OwnerBrokerResponse = read_json_frame(&mut stream).await?;
    match response {
        OwnerBrokerResponse::Accepted { request_id } if request_id == request.request_id => Ok(()),
        _ => Err(PeerError::Authentication(
            "owner broker did not accept the exact request".into(),
        )),
    }
}

fn validate_owner_socket_endpoint(socket_path: &Path) -> Result<std::fs::Metadata> {
    let parent = socket_path
        .parent()
        .ok_or_else(|| invalid("owner broker socket has no parent"))?;
    let _secure_parent = SecureDirectory::open_or_create(parent)?;
    let metadata = std::fs::symlink_metadata(socket_path)?;
    let owner_uid = rustix::process::geteuid().as_raw();
    if !metadata.file_type().is_socket()
        || metadata.file_type().is_symlink()
        || metadata.uid() != owner_uid
        || metadata.mode() & 0o7777 != 0o600
    {
        return Err(PeerError::Authorization(
            "owner broker endpoint is not an owner-only Unix socket".into(),
        ));
    }
    Ok(metadata)
}

async fn authenticate_owner_stream(
    mut stream: UnixStream,
    expected_uid: u32,
    expected: &OwnerBrokerRequest,
) -> Result<VerifiedOwnerBrokerRequest> {
    let peer = stream
        .peer_cred()
        .map_err(|error| PeerError::Ipc(format!("reading owner peer credentials: {error}")))?;
    if peer.uid() != expected_uid {
        return Err(PeerError::Authentication(
            "owner broker peer uid does not match the socket owner".into(),
        ));
    }
    let request: OwnerBrokerRequest = read_json_frame(&mut stream).await?;
    if &request != expected {
        let response = OwnerBrokerResponse::Rejected {
            request_id: request.request_id,
            reason: "request binding mismatch".into(),
        };
        write_json_frame(&mut stream, &response).await?;
        return Err(PeerError::Authentication(
            "owner broker request does not match the pending local transaction".into(),
        ));
    }
    write_json_frame(
        &mut stream,
        &OwnerBrokerResponse::Accepted {
            request_id: request.request_id.clone(),
        },
    )
    .await?;
    Ok(VerifiedOwnerBrokerRequest {
        request,
        peer_uid: peer.uid(),
    })
}

fn validate_socket_path(path: &Path) -> Result<()> {
    if !path.is_absolute() {
        return Err(invalid("owner broker socket path must be absolute"));
    }
    let leaf = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| invalid("owner broker socket needs a UTF-8 leaf name"))?;
    if leaf.is_empty()
        || leaf.len() > 100
        || !leaf
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
    {
        return Err(invalid("owner broker socket leaf name is invalid"));
    }
    Ok(())
}

fn validate_ascii_identifier(
    field: &str,
    value: &str,
    minimum: usize,
    maximum: usize,
) -> Result<()> {
    if !(minimum..=maximum).contains(&value.len())
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
    {
        return Err(invalid(format!(
            "{field} is not a bounded ASCII identifier"
        )));
    }
    Ok(())
}

fn validate_loopback_origin(value: &str) -> Result<()> {
    let parsed =
        url::Url::parse(value).map_err(|_| invalid("browserOrigin is not an absolute URL"))?;
    let loopback = matches!(parsed.host_str(), Some("localhost" | "127.0.0.1" | "::1"));
    if parsed.scheme() != "http"
        || !loopback
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.path() != "/"
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || parsed.origin().ascii_serialization() != value
    {
        return Err(invalid(
            "browserOrigin must be an exact loopback HTTP origin",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::PermissionsExt as _;

    use proptest::prelude::*;

    use super::*;

    fn request() -> OwnerBrokerRequest {
        OwnerBrokerRequest {
            protocol: OWNER_BROKER_PROTOCOL.into(),
            request_id: "request_12345678".into(),
            transaction_id: "local_transaction_12345678".into(),
            install_id: "forge-local-install".into(),
            browser_origin: "http://127.0.0.1:3027".into(),
            browser_nonce: "A".repeat(43),
        }
    }

    #[tokio::test]
    async fn kernel_peer_credentials_accept_the_owner_and_reject_a_wrong_uid() -> Result<()> {
        let directory = tempfile::tempdir()?;
        std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o700))?;
        let root = std::fs::canonicalize(directory.path())?;

        let accepted_socket = root.join("accepted.sock");
        let accepted_server = OwnerBrokerServer::bind(&accepted_socket)?;
        let accepted_request = request();
        let accepted_client = approve_owner_request(&accepted_socket, &accepted_request);
        let (verified, approval) = tokio::join!(
            accepted_server.serve_once(&accepted_request),
            accepted_client
        );
        approval?;
        let verified = verified?;
        assert_eq!(verified.peer_uid, rustix::process::geteuid().as_raw());
        assert_eq!(verified.request, accepted_request);

        let rejected_socket = root.join("rejected.sock");
        let rejected_server = OwnerBrokerServer::bind(&rejected_socket)?;
        let stream = UnixStream::connect(&rejected_socket).await?;
        let wrong_uid = rustix::process::geteuid().as_raw().wrapping_add(1);
        let rejected = authenticate_owner_stream(stream, wrong_uid, &request()).await;
        assert!(matches!(rejected, Err(PeerError::Authentication(_))));
        drop(rejected_server);
        Ok(())
    }

    proptest! {
        #[test]
        fn broker_request_validation_rejects_unbounded_or_non_base64url_nonce(
            suffix in "\\PC{0,200}"
        ) {
            let mut candidate = request();
            candidate.browser_nonce = format!("{}{}", "A".repeat(43), suffix);
            let valid_suffix = suffix.len() <= 85
                && suffix.bytes().all(|byte| {
                    byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-')
                });
            prop_assert_eq!(candidate.validate().is_ok(), valid_suffix);
        }
    }
}
