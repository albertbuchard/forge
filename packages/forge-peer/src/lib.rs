#![forbid(unsafe_code)]

pub mod codec;
#[cfg(feature = "full-peer")]
pub mod command_auth;
#[cfg(feature = "full-peer")]
pub mod daemon;
#[cfg(feature = "full-peer")]
pub mod endpoint;
#[cfg(feature = "full-peer")]
pub mod envelope;
pub mod error;
#[cfg(feature = "full-peer")]
pub mod ffi;
#[cfg(feature = "full-peer")]
pub mod grant;
#[cfg(feature = "full-peer")]
pub mod identity;
#[cfg(feature = "full-peer")]
pub mod invite;
#[cfg(feature = "full-peer")]
pub mod ipc;
#[cfg(feature = "full-peer")]
pub mod local_identity;
#[cfg(feature = "full-peer")]
pub mod manifest;
#[cfg(feature = "full-peer")]
pub mod message;
#[cfg(feature = "full-peer")]
pub mod mls;
pub mod owner_broker;
#[cfg(feature = "full-peer")]
pub mod pairing;
#[cfg(feature = "full-peer")]
pub mod persistence;
#[cfg(feature = "full-peer")]
pub mod provider;
#[cfg(feature = "full-peer")]
pub mod replay;
pub mod secure_fs;
#[cfg(feature = "full-peer")]
pub mod transport;

pub use error::{PeerError, Result};

pub const PROTOCOL_NAME: &str = "forge-peer/1";
pub const PEER_ALPN: &[u8] = b"forge-peer/1";
pub const PROTOCOL_MAJOR: u16 = 1;
pub const PROTOCOL_MINOR: u16 = 0;

#[cfg(feature = "full-peer")]
uniffi::setup_scaffolding!();
