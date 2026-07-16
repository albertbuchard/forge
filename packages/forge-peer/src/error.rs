use std::io;

#[derive(Debug, thiserror::Error)]
pub enum PeerError {
    #[error("invalid protocol data: {0}")]
    InvalidData(String),
    #[error("protocol limit exceeded: {0}")]
    LimitExceeded(String),
    #[error("authentication failed: {0}")]
    Authentication(String),
    #[error("authorization failed: {0}")]
    Authorization(String),
    #[error("protocol version rejected: {0}")]
    Version(String),
    #[error("replay or sequence rejected: {0}")]
    Replay(String),
    #[error("invite state conflict: {0}")]
    InviteConflict(String),
    #[error("persisted state rollback detected: {0}")]
    Rollback(String),
    #[error("persisted state conflict: {0}")]
    StateConflict(String),
    #[error("MLS operation failed: {0}")]
    Mls(String),
    #[error("transport unavailable: {0}")]
    Transport(String),
    #[error("endpoint rejected: {0}")]
    Endpoint(String),
    #[error("manifest rejected: {0}")]
    Manifest(String),
    #[error("local IPC rejected: {0}")]
    Ipc(String),
    #[error("operation timed out: {0}")]
    Timeout(&'static str),
    #[error(transparent)]
    Io(#[from] io::Error),
}

pub type Result<T> = std::result::Result<T, PeerError>;

pub(crate) fn invalid(message: impl Into<String>) -> PeerError {
    PeerError::InvalidData(message.into())
}

pub(crate) fn limit(message: impl Into<String>) -> PeerError {
    PeerError::LimitExceeded(message.into())
}
