use bincode::{Decode, Encode};

use crate::codec::{
    BoundedBytes, MAX_APPLICATION_BYTES, MAX_MLS_CIPHERTEXT_BYTES, Validate, decode_limited,
    encode_limited,
};
use crate::error::{PeerError, Result, invalid};
use crate::identity::{
    DeviceCertificate, DeviceId, DeviceSigner, DeviceTrustResolver, ProtocolVersion, SignatureBytes,
};
use crate::message::{ApplicationMessage, MessageKind};

const ENVELOPE_SIGNING_DOMAIN: &[u8] = b"forge-peer/1 outer envelope\0";
const MAX_ENVELOPE_LIFETIME_SECONDS: u64 = 7 * 24 * 60 * 60;
const MAX_ENVELOPE_CLOCK_SKEW_SECONDS: u64 = 5 * 60;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Encode, Decode)]
pub struct ChannelId(pub [u8; 32]);

impl ChannelId {
    pub fn random() -> Self {
        Self(rand::random())
    }
}

impl Validate for ChannelId {
    fn validate(&self) -> Result<()> {
        if self.0 == [0; 32] {
            return Err(invalid("channel id is all zero"));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Encode, Decode)]
pub struct EnvelopeMessageId(pub [u8; 16]);

impl EnvelopeMessageId {
    pub fn random() -> Self {
        Self(rand::random())
    }
}

impl Validate for EnvelopeMessageId {
    fn validate(&self) -> Result<()> {
        if self.0 == [0; 16] {
            return Err(invalid("envelope message id is all zero"));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Encode, Decode)]
pub struct PreviousAcknowledgement {
    pub highest_contiguous_sequence: u64,
    pub received_bitmap: u64,
}

impl Validate for PreviousAcknowledgement {
    fn validate(&self) -> Result<()> {
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode)]
pub struct EnvelopeBody {
    pub protocol: ProtocolVersion,
    pub channel_id: ChannelId,
    pub message_id: EnvelopeMessageId,
    pub sender_device_id: DeviceId,
    pub sequence: u64,
    pub previous_acknowledgement: PreviousAcknowledgement,
    pub message_kind: MessageKind,
    pub created_at: u64,
    pub expires_at: u64,
    pub mls_group_epoch: u64,
    pub mls_ciphertext: BoundedBytes<MAX_MLS_CIPHERTEXT_BYTES>,
}

impl EnvelopeBody {
    pub fn validate_at(&self, now: u64) -> Result<()> {
        self.validate()?;
        if now.saturating_add(MAX_ENVELOPE_CLOCK_SKEW_SECONDS) < self.created_at {
            return Err(PeerError::Authentication(
                "envelope creation time is too far in the future".into(),
            ));
        }
        if now
            > self
                .expires_at
                .saturating_add(MAX_ENVELOPE_CLOCK_SKEW_SECONDS)
        {
            return Err(PeerError::Authentication("envelope expired".into()));
        }
        Ok(())
    }

    fn signing_digest(&self) -> Result<EnvelopeSigningDigest> {
        let bytes = encode_limited::<{ 256 * 1024 }, _>(self)?;
        Ok(EnvelopeSigningDigest(*blake3::hash(&bytes).as_bytes()))
    }
}

impl Validate for EnvelopeBody {
    fn validate(&self) -> Result<()> {
        self.protocol.validate()?;
        self.channel_id.validate()?;
        self.message_id.validate()?;
        self.sender_device_id.validate()?;
        if self.sequence == 0 {
            return Err(invalid("envelope sequence must be non-zero"));
        }
        self.previous_acknowledgement.validate()?;
        self.message_kind.validate()?;
        if self.created_at >= self.expires_at {
            return Err(invalid("envelope lifetime is empty"));
        }
        if self.expires_at - self.created_at > MAX_ENVELOPE_LIFETIME_SECONDS {
            return Err(invalid("envelope lifetime exceeds seven days"));
        }
        self.mls_ciphertext.validate()?;
        if self.mls_ciphertext.is_empty() {
            return Err(invalid("MLS ciphertext is empty"));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Encode, Decode)]
struct EnvelopeSigningDigest([u8; 32]);

impl Validate for EnvelopeSigningDigest {
    fn validate(&self) -> Result<()> {
        if self.0 == [0; 32] {
            return Err(invalid("envelope signing digest is all zero"));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode)]
pub struct SignedEnvelope {
    pub body: EnvelopeBody,
    pub device_signature: SignatureBytes,
}

impl SignedEnvelope {
    pub fn sign(body: EnvelopeBody, signer: &DeviceSigner) -> Result<Self> {
        body.validate()?;
        if signer.device_id != body.sender_device_id {
            return Err(PeerError::Authentication(
                "envelope signer does not match sender device id".into(),
            ));
        }
        let digest = body.signing_digest()?;
        Ok(Self {
            device_signature: signer.sign(ENVELOPE_SIGNING_DOMAIN, &digest)?,
            body,
        })
    }

    pub fn verify(&self, certificate: &DeviceCertificate, now: u64) -> Result<()> {
        self.validate()?;
        self.body.validate_at(now)?;
        certificate.verify(now)?;
        if certificate.body.device_id != self.body.sender_device_id {
            return Err(PeerError::Authentication(
                "envelope sender does not match certified device".into(),
            ));
        }
        certificate.verify_device_signature(
            ENVELOPE_SIGNING_DOMAIN,
            &self.body.signing_digest()?,
            &self.device_signature,
        )
    }

    pub fn verify_trusted(
        &self,
        certificate: &DeviceCertificate,
        trust: &impl DeviceTrustResolver,
        now: u64,
    ) -> Result<()> {
        trust.verify_current_certificate(certificate, now)?;
        self.verify(certificate, now)
    }

    pub fn verify_application_kind(&self, message: &ApplicationMessage) -> Result<()> {
        message.validate()?;
        if message.kind() != self.body.message_kind {
            return Err(PeerError::Authentication(
                "decrypted application kind does not match authenticated envelope header".into(),
            ));
        }
        Ok(())
    }
}

impl Validate for SignedEnvelope {
    fn validate(&self) -> Result<()> {
        self.body.validate()?;
        self.device_signature.validate()
    }
}

pub fn encode_application(message: &ApplicationMessage) -> Result<Vec<u8>> {
    encode_limited::<MAX_APPLICATION_BYTES, _>(message)
}

pub fn decode_application(bytes: &[u8]) -> Result<ApplicationMessage> {
    decode_limited::<MAX_APPLICATION_BYTES, _>(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::identity::{DeviceCapabilities, DeviceId, PrincipalRootSigner, ProtocolRange};

    #[test]
    fn signed_envelope_rejects_ciphertext_mutation() -> Result<()> {
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
        let mut envelope = SignedEnvelope::sign(
            EnvelopeBody {
                protocol: ProtocolVersion::CURRENT,
                channel_id: ChannelId::random(),
                message_id: EnvelopeMessageId::random(),
                sender_device_id: signer.device_id,
                sequence: 1,
                previous_acknowledgement: PreviousAcknowledgement {
                    highest_contiguous_sequence: 0,
                    received_bitmap: 0,
                },
                message_kind: MessageKind::Acknowledgement,
                created_at: now,
                expires_at: now + 300,
                mls_group_epoch: 0,
                mls_ciphertext: BoundedBytes::new(vec![1, 2, 3])?,
            },
            &signer,
        )?;
        envelope.verify(&certificate, now)?;
        envelope.body.mls_ciphertext = BoundedBytes::new(vec![1, 2, 4])?;
        assert!(envelope.verify(&certificate, now).is_err());
        Ok(())
    }
}
