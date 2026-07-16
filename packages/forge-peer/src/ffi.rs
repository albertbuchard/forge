use subtle::ConstantTimeEq as _;

use crate::codec::{
    FrameType, MAX_IPC_FRAME_BYTES, MAX_PEER_FRAME_BYTES, decode_frame, decode_limited,
};
use crate::envelope::SignedEnvelope;
use crate::error::PeerError;
use crate::identity::DeviceCertificate;
use crate::message::MessageKind;

const MAX_FFI_CERTIFICATE_BYTES: usize = 64 * 1024;
const FRAME_HEADER_BYTES: usize = crate::codec::FRAME_HEADER_BYTES;

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct FfiProtocolInfo {
    pub name: String,
    pub major: u16,
    pub minor: u16,
    pub max_peer_frame_bytes: u32,
    pub max_local_ipc_frame_bytes: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct FfiVerifiedEnvelopeMetadata {
    pub protocol_major: u16,
    pub protocol_minor: u16,
    pub channel_id_hex: String,
    pub message_id_hex: String,
    pub sender_device_id_hex: String,
    pub sequence: u64,
    pub message_kind: String,
    pub created_at: u64,
    pub expires_at: u64,
    pub mls_group_epoch: u64,
    pub opaque_ciphertext_bytes: u32,
    pub opaque_ciphertext_blake3_hex: String,
    pub pinned_certificate_blake3_hex: String,
}

#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum FfiBoundaryError {
    #[error("FFI input exceeded its fixed protocol bound")]
    LimitExceeded,
    #[error("FFI input was malformed or used an unsupported protocol version")]
    InvalidInput,
    #[error("FFI envelope or pinned certificate authentication failed")]
    AuthenticationFailed,
}

#[uniffi::export]
pub fn ffi_protocol_info() -> FfiProtocolInfo {
    FfiProtocolInfo {
        name: crate::PROTOCOL_NAME.to_owned(),
        major: crate::PROTOCOL_MAJOR,
        minor: crate::PROTOCOL_MINOR,
        max_peer_frame_bytes: u32::try_from(MAX_PEER_FRAME_BYTES + FRAME_HEADER_BYTES)
            .unwrap_or(u32::MAX),
        max_local_ipc_frame_bytes: u32::try_from(MAX_IPC_FRAME_BYTES + FRAME_HEADER_BYTES)
            .unwrap_or(u32::MAX),
    }
}

#[uniffi::export]
#[allow(clippy::needless_pass_by_value)] // UniFFI byte buffers are owned across the ABI.
pub fn ffi_verify_pinned_envelope(
    peer_frame: Vec<u8>,
    device_certificate: Vec<u8>,
    pinned_certificate_blake3: Vec<u8>,
    now_unix_seconds: u64,
) -> std::result::Result<FfiVerifiedEnvelopeMetadata, FfiBoundaryError> {
    if peer_frame.len() > MAX_PEER_FRAME_BYTES + FRAME_HEADER_BYTES
        || device_certificate.len() > MAX_FFI_CERTIFICATE_BYTES
    {
        return Err(FfiBoundaryError::LimitExceeded);
    }
    if pinned_certificate_blake3.len() != 32 {
        return Err(FfiBoundaryError::InvalidInput);
    }
    let certificate: DeviceCertificate =
        decode_limited::<MAX_FFI_CERTIFICATE_BYTES, _>(&device_certificate)
            .map_err(|error| map_error(&error))?;
    let certificate_fingerprint = certificate
        .fingerprint()
        .map_err(|error| map_error(&error))?;
    if certificate_fingerprint
        .ct_eq(pinned_certificate_blake3.as_slice())
        .unwrap_u8()
        != 1
    {
        return Err(FfiBoundaryError::AuthenticationFailed);
    }
    let envelope: SignedEnvelope =
        decode_frame(FrameType::PeerEnvelope, &peer_frame).map_err(|error| map_error(&error))?;
    envelope
        .verify(&certificate, now_unix_seconds)
        .map_err(|error| map_error(&error))?;
    let ciphertext = envelope.body.mls_ciphertext.as_slice();
    Ok(FfiVerifiedEnvelopeMetadata {
        protocol_major: envelope.body.protocol.major,
        protocol_minor: envelope.body.protocol.minor,
        channel_id_hex: hex::encode(envelope.body.channel_id.0),
        message_id_hex: hex::encode(envelope.body.message_id.0),
        sender_device_id_hex: hex::encode(envelope.body.sender_device_id.0),
        sequence: envelope.body.sequence,
        message_kind: message_kind_name(envelope.body.message_kind).to_owned(),
        created_at: envelope.body.created_at,
        expires_at: envelope.body.expires_at,
        mls_group_epoch: envelope.body.mls_group_epoch,
        opaque_ciphertext_bytes: u32::try_from(ciphertext.len())
            .map_err(|_| FfiBoundaryError::LimitExceeded)?,
        opaque_ciphertext_blake3_hex: blake3::hash(ciphertext).to_hex().to_string(),
        pinned_certificate_blake3_hex: hex::encode(certificate_fingerprint),
    })
}

const fn message_kind_name(kind: MessageKind) -> &'static str {
    match kind {
        MessageKind::PairingFinalization => "pairing_finalization",
        MessageKind::GrantProposal => "grant_proposal",
        MessageKind::GrantAcceptance => "grant_acceptance",
        MessageKind::GrantRevocation => "grant_revocation",
        MessageKind::ProjectionDelta => "projection_delta",
        MessageKind::QueryRequest => "query_request",
        MessageKind::QueryResponse => "query_response",
        MessageKind::Acknowledgement => "acknowledgement",
        MessageKind::DeviceUpdate => "device_update",
        MessageKind::DeviceRemoval => "device_removal",
        MessageKind::KeyPackageDelivery => "key_package_delivery",
        MessageKind::ResyncRequest => "resync_request",
        MessageKind::Error => "error",
        MessageKind::CapabilityUpdate => "capability_update",
        MessageKind::RelationshipRevocation => "relationship_revocation",
    }
}

const fn map_error(error: &PeerError) -> FfiBoundaryError {
    match error {
        PeerError::LimitExceeded(_) => FfiBoundaryError::LimitExceeded,
        PeerError::Authentication(_) | PeerError::Replay(_) | PeerError::Rollback(_) => {
            FfiBoundaryError::AuthenticationFailed
        }
        _ => FfiBoundaryError::InvalidInput,
    }
}

#[cfg(test)]
mod tests {
    use proptest::prelude::*;

    use super::*;
    use crate::codec::{BoundedBytes, encode_frame, encode_limited};
    use crate::envelope::{ChannelId, EnvelopeBody, EnvelopeMessageId, PreviousAcknowledgement};
    use crate::identity::{
        DeviceCapabilities, DeviceId, DeviceSigner, PrincipalRootSigner, ProtocolRange,
        ProtocolVersion,
    };

    #[test]
    fn ffi_verifies_a_pinned_outer_envelope_without_returning_ciphertext() -> crate::Result<()> {
        let now = 10_000;
        let root = PrincipalRootSigner::generate();
        let signer = DeviceSigner::generate(DeviceId::random());
        let certificate = DeviceCertificate::issue(
            &root,
            &signer,
            DeviceCapabilities::new(DeviceCapabilities::DIRECT_STREAM)?,
            ProtocolRange::CURRENT,
            1,
            now - 1,
            now + 3_600,
        )?;
        let envelope = SignedEnvelope::sign(
            EnvelopeBody {
                protocol: ProtocolVersion::CURRENT,
                channel_id: ChannelId([1; 32]),
                message_id: EnvelopeMessageId([2; 16]),
                sender_device_id: signer.device_id,
                sequence: 1,
                previous_acknowledgement: PreviousAcknowledgement {
                    highest_contiguous_sequence: 0,
                    received_bitmap: 0,
                },
                message_kind: MessageKind::Acknowledgement,
                created_at: now,
                expires_at: now + 60,
                mls_group_epoch: 7,
                mls_ciphertext: BoundedBytes::new(b"opaque-mls-ciphertext".to_vec())?,
            },
            &signer,
        )?;
        let frame = encode_frame(FrameType::PeerEnvelope, &envelope)?;
        let certificate_bytes = encode_limited::<MAX_FFI_CERTIFICATE_BYTES, _>(&certificate)?;
        let metadata = ffi_verify_pinned_envelope(
            frame,
            certificate_bytes,
            certificate.fingerprint()?.to_vec(),
            now,
        )
        .map_err(|error| PeerError::Authentication(error.to_string()))?;
        assert_eq!(metadata.sequence, 1);
        assert_eq!(metadata.opaque_ciphertext_bytes, 21);
        assert_eq!(metadata.message_kind, "acknowledgement");
        assert!(!metadata.opaque_ciphertext_blake3_hex.contains("opaque"));
        Ok(())
    }

    proptest! {
        #[test]
        fn arbitrary_ffi_buffers_fail_closed_without_panicking(
            frame in proptest::collection::vec(any::<u8>(), 0..4096),
            certificate in proptest::collection::vec(any::<u8>(), 0..2048),
            fingerprint in proptest::collection::vec(any::<u8>(), 0..64),
        ) {
            let _result = ffi_verify_pinned_envelope(frame, certificate, fingerprint, 10_000);
        }
    }
}
