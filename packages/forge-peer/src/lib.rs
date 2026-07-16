#![forbid(unsafe_code)]

pub mod codec;
pub mod command_auth;
pub mod daemon;
pub mod endpoint;
pub mod envelope;
pub mod error;
pub mod ffi;
pub mod grant;
pub mod identity;
pub mod invite;
pub mod ipc;
pub mod local_identity;
pub mod manifest;
pub mod message;
pub mod mls;
pub mod pairing;
pub mod persistence;
pub mod provider;
pub mod replay;
pub mod secure_fs;
pub mod transport;

pub use error::{PeerError, Result};

pub const PROTOCOL_NAME: &str = "forge-peer/1";
pub const PEER_ALPN: &[u8] = b"forge-peer/1";
pub const PROTOCOL_MAJOR: u16 = 1;
pub const PROTOCOL_MINOR: u16 = 0;

uniffi::setup_scaffolding!();
