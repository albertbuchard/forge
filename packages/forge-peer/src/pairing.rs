use bincode::{Decode, Encode};

use crate::codec::{BoundedVec, Validate, decode_limited, encode_limited};
use crate::endpoint::{EndpointDescriptor, MAX_ENDPOINTS_PER_PEER};
use crate::error::{PeerError, Result, invalid};
use crate::identity::{
    DeviceCertificate, DeviceSigner, DeviceTrustResolver, MAX_CLOCK_SKEW_SECONDS, ProtocolRange,
    ProtocolVersion, SignatureBytes,
};
use crate::invite::bootstrap_proof_commitment;

const PAIRING_SIGNING_DOMAIN: &[u8] = b"forge-peer/1 pairing transcript\0";
const INVITE_SIGNING_DOMAIN: &[u8] = b"forge-peer/1 pairing invite\0";
const PAIRING_WIRE_LIMIT: usize = 32 * 1024;
const MAX_INVITE_LIFETIME_SECONDS: u64 = 15 * 60;
const MAX_TRANSCRIPT_LIFETIME_SECONDS: u64 = 60 * 60;
const PAIRING_QR_VERSION: u16 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Encode, Decode)]
pub struct InviteId(pub [u8; 16]);

impl InviteId {
    pub fn random() -> Self {
        Self(rand::random())
    }
}

impl Validate for InviteId {
    fn validate(&self) -> Result<()> {
        if self.0 == [0; 16] {
            return Err(invalid("invite id is all zero"));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode)]
pub struct PairingInviteBody {
    pub qr_version: u16,
    pub invite_id: InviteId,
    pub inviter_device: DeviceCertificate,
    pub protocol_range: ProtocolRange,
    pub endpoints: BoundedVec<EndpointDescriptor, MAX_ENDPOINTS_PER_PEER>,
    pub bootstrap_public_key: [u8; 32],
    pub bootstrap_secret_commitment: [u8; 32],
    pub inviter_fingerprint: [u8; 32],
    pub initial_grant_hash: [u8; 32],
    pub created_at: u64,
    pub expires_at: u64,
}

impl Validate for PairingInviteBody {
    fn validate(&self) -> Result<()> {
        if self.qr_version != 1 {
            return Err(PeerError::Version(format!(
                "unsupported pairing QR version {}",
                self.qr_version
            )));
        }
        self.invite_id.validate()?;
        self.inviter_device.validate()?;
        self.protocol_range.validate()?;
        self.endpoints.validate()?;
        if self.endpoints.is_empty() {
            return Err(invalid("pairing invite has no structured endpoint"));
        }
        validate_unique_endpoints(self.endpoints.as_slice(), "pairing invite")?;
        if !range_contains_range(self.inviter_device.body.protocol_range, self.protocol_range) {
            return Err(PeerError::Version(
                "pairing invite protocol range exceeds the certified device range".into(),
            ));
        }
        if self.bootstrap_public_key == [0; 32] {
            return Err(invalid("pairing bootstrap public key is all zero"));
        }
        if self.bootstrap_secret_commitment == [0; 32] {
            return Err(invalid("pairing bootstrap commitment is all zero"));
        }
        if self.inviter_fingerprint == [0; 32] {
            return Err(invalid("inviter fingerprint is all zero"));
        }
        if self.initial_grant_hash == [0; 32] {
            return Err(invalid("initial grant commitment is all zero"));
        }
        validate_time_window(
            self.created_at,
            self.expires_at,
            MAX_INVITE_LIFETIME_SECONDS,
            "pairing invite",
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode)]
pub struct SignedPairingInvite {
    pub body: PairingInviteBody,
    pub inviter_signature: SignatureBytes,
}

impl SignedPairingInvite {
    pub fn sign(body: PairingInviteBody, signer: &DeviceSigner) -> Result<Self> {
        body.validate()?;
        if signer.device_id != body.inviter_device.body.device_id
            || signer.verifying_key_bytes() != body.inviter_device.body.device_public_key
        {
            return Err(PeerError::Authentication(
                "invite signer does not match certified inviter device".into(),
            ));
        }
        let inviter_signature = signer.sign(INVITE_SIGNING_DOMAIN, &body)?;
        Ok(Self {
            body,
            inviter_signature,
        })
    }

    pub fn verify(&self, now: u64) -> Result<()> {
        self.validate()?;
        self.body.inviter_device.verify(now)?;
        if self.body.inviter_device.fingerprint()? != self.body.inviter_fingerprint {
            return Err(PeerError::Authentication(
                "pairing invite fingerprint does not match inviter certificate".into(),
            ));
        }
        if now.saturating_add(MAX_CLOCK_SKEW_SECONDS) < self.body.created_at {
            return Err(PeerError::Authentication(
                "pairing invite creation time is too far in the future".into(),
            ));
        }
        if now > self.body.expires_at.saturating_add(MAX_CLOCK_SKEW_SECONDS) {
            return Err(PeerError::Authentication("pairing invite expired".into()));
        }
        self.body.inviter_device.verify_device_signature(
            INVITE_SIGNING_DOMAIN,
            &self.body,
            &self.inviter_signature,
        )
    }

    pub fn to_qr_bytes(&self) -> Result<Vec<u8>> {
        encode_limited::<PAIRING_WIRE_LIMIT, _>(self)
    }

    pub fn from_qr_bytes(bytes: &[u8]) -> Result<Self> {
        decode_limited::<PAIRING_WIRE_LIMIT, _>(bytes)
    }

    pub fn commitment(&self) -> Result<[u8; 32]> {
        let bytes = encode_limited::<PAIRING_WIRE_LIMIT, _>(self)?;
        Ok(*blake3::hash(&bytes).as_bytes())
    }

    pub fn verify_trusted(&self, trust: &impl DeviceTrustResolver, now: u64) -> Result<()> {
        trust.verify_current_certificate(&self.body.inviter_device, now)?;
        self.verify(now)
    }
}

impl Validate for SignedPairingInvite {
    fn validate(&self) -> Result<()> {
        self.body.validate()?;
        self.inviter_signature.validate()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode)]
pub struct PairingQrBundle {
    pub version: u16,
    pub signed_invite: SignedPairingInvite,
    pub bootstrap_proof: [u8; 32],
}

impl PairingQrBundle {
    pub fn new(signed_invite: SignedPairingInvite, bootstrap_proof: [u8; 32]) -> Result<Self> {
        let bundle = Self {
            version: PAIRING_QR_VERSION,
            signed_invite,
            bootstrap_proof,
        };
        bundle.validate()?;
        Ok(bundle)
    }

    pub fn to_qr_bytes(&self) -> Result<Vec<u8>> {
        encode_limited::<PAIRING_WIRE_LIMIT, _>(self)
    }

    pub fn from_qr_bytes(bytes: &[u8]) -> Result<Self> {
        decode_limited::<PAIRING_WIRE_LIMIT, _>(bytes)
    }
}

impl Validate for PairingQrBundle {
    fn validate(&self) -> Result<()> {
        if self.version != PAIRING_QR_VERSION {
            return Err(PeerError::Version(
                "unsupported pairing QR bundle version".into(),
            ));
        }
        self.signed_invite.validate()?;
        if bootstrap_proof_commitment(&self.bootstrap_proof)?
            != self.signed_invite.body.bootstrap_secret_commitment
        {
            return Err(PeerError::Authentication(
                "pairing QR proof does not match the signed commitment".into(),
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode)]
pub struct PairingTranscriptBody {
    pub transcript_version: u16,
    pub invite_id: InviteId,
    pub signed_invite_commitment: [u8; 32],
    pub inviter_device: DeviceCertificate,
    pub accepter_device: DeviceCertificate,
    pub inviter_protocol_range: ProtocolRange,
    pub accepter_protocol_range: ProtocolRange,
    pub selected_protocol: ProtocolVersion,
    pub selected_endpoints: BoundedVec<EndpointDescriptor, MAX_ENDPOINTS_PER_PEER>,
    pub verification_phrase_hash: [u8; 32],
    pub initial_grant_hash: [u8; 32],
    pub created_at: u64,
    pub expires_at: u64,
}

impl PairingTranscriptBody {
    pub fn transcript_hash(&self) -> Result<[u8; 32]> {
        let bytes = encode_limited::<PAIRING_WIRE_LIMIT, _>(self)?;
        Ok(*blake3::hash(&bytes).as_bytes())
    }
}

impl Validate for PairingTranscriptBody {
    fn validate(&self) -> Result<()> {
        if self.transcript_version != 1 {
            return Err(PeerError::Version(format!(
                "unsupported pairing transcript version {}",
                self.transcript_version
            )));
        }
        self.invite_id.validate()?;
        if self.signed_invite_commitment == [0; 32] {
            return Err(invalid(
                "pairing transcript has no signed invite commitment",
            ));
        }
        self.inviter_device.validate()?;
        self.accepter_device.validate()?;
        if self.inviter_device.body.device_id == self.accepter_device.body.device_id {
            return Err(invalid("pairing transcript repeats the same device id"));
        }
        self.inviter_protocol_range.validate()?;
        self.accepter_protocol_range.validate()?;
        self.selected_protocol.validate()?;
        let negotiated = self
            .inviter_protocol_range
            .negotiate(self.accepter_protocol_range)?;
        if self.selected_protocol != negotiated {
            return Err(PeerError::Version(
                "selected pairing protocol is not the highest mutually supported version".into(),
            ));
        }
        if !range_contains(
            self.inviter_device.body.protocol_range,
            self.selected_protocol,
        ) || !range_contains(
            self.accepter_device.body.protocol_range,
            self.selected_protocol,
        ) {
            return Err(PeerError::Version(
                "selected pairing protocol is outside a certified device range".into(),
            ));
        }
        self.selected_endpoints.validate()?;
        if self.selected_endpoints.is_empty() {
            return Err(invalid("pairing transcript has no selected endpoint"));
        }
        validate_unique_endpoints(
            self.selected_endpoints.as_slice(),
            "pairing transcript selection",
        )?;
        if self.verification_phrase_hash == [0; 32] {
            return Err(invalid("verification phrase commitment is all zero"));
        }
        if self.initial_grant_hash == [0; 32] {
            return Err(invalid("initial grant commitment is all zero"));
        }
        validate_time_window(
            self.created_at,
            self.expires_at,
            MAX_TRANSCRIPT_LIFETIME_SECONDS,
            "pairing transcript",
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode)]
pub struct SignedPairingTranscript {
    pub body: PairingTranscriptBody,
    pub inviter_signature: SignatureBytes,
    pub accepter_signature: SignatureBytes,
}

impl SignedPairingTranscript {
    pub fn sign_as_inviter(
        body: &PairingTranscriptBody,
        inviter: &DeviceSigner,
    ) -> Result<SignatureBytes> {
        body.validate()?;
        ensure_signer_matches(inviter, &body.inviter_device, "inviter")?;
        inviter.sign(PAIRING_SIGNING_DOMAIN, body)
    }

    pub fn sign_as_accepter(
        body: &PairingTranscriptBody,
        accepter: &DeviceSigner,
    ) -> Result<SignatureBytes> {
        body.validate()?;
        ensure_signer_matches(accepter, &body.accepter_device, "accepter")?;
        accepter.sign(PAIRING_SIGNING_DOMAIN, body)
    }

    pub fn assemble(
        body: PairingTranscriptBody,
        inviter_signature: SignatureBytes,
        accepter_signature: SignatureBytes,
    ) -> Result<Self> {
        let transcript = Self {
            body,
            inviter_signature,
            accepter_signature,
        };
        transcript.verify(transcript.body.created_at)?;
        Ok(transcript)
    }

    pub fn sign(
        body: PairingTranscriptBody,
        inviter: &DeviceSigner,
        accepter: &DeviceSigner,
    ) -> Result<Self> {
        let inviter_signature = Self::sign_as_inviter(&body, inviter)?;
        let accepter_signature = Self::sign_as_accepter(&body, accepter)?;
        Self::assemble(body, inviter_signature, accepter_signature)
    }

    pub fn verify(&self, now: u64) -> Result<()> {
        self.validate()?;
        self.body.inviter_device.verify(now)?;
        self.body.accepter_device.verify(now)?;
        if now.saturating_add(MAX_CLOCK_SKEW_SECONDS) < self.body.created_at {
            return Err(PeerError::Authentication(
                "pairing transcript creation time is too far in the future".into(),
            ));
        }
        if now > self.body.expires_at.saturating_add(MAX_CLOCK_SKEW_SECONDS) {
            return Err(PeerError::Authentication(
                "pairing transcript expired".into(),
            ));
        }
        self.body.inviter_device.verify_device_signature(
            PAIRING_SIGNING_DOMAIN,
            &self.body,
            &self.inviter_signature,
        )?;
        self.body.accepter_device.verify_device_signature(
            PAIRING_SIGNING_DOMAIN,
            &self.body,
            &self.accepter_signature,
        )
    }

    pub fn verify_against_invite(&self, invite: &SignedPairingInvite, now: u64) -> Result<()> {
        invite.verify(now)?;
        self.verify(now)?;
        if self.body.signed_invite_commitment != invite.commitment()?
            || self.body.invite_id != invite.body.invite_id
            || self.body.inviter_device != invite.body.inviter_device
            || self.body.inviter_protocol_range != invite.body.protocol_range
            || self.body.initial_grant_hash != invite.body.initial_grant_hash
        {
            return Err(PeerError::Authentication(
                "pairing transcript does not bind the exact signed invite".into(),
            ));
        }
        if self.body.created_at < invite.body.created_at
            || self.body.expires_at > invite.body.expires_at
        {
            return Err(PeerError::Authentication(
                "pairing transcript validity is not contained by the signed invite".into(),
            ));
        }
        for selected in self.body.selected_endpoints.as_slice() {
            if !invite.body.endpoints.as_slice().contains(selected) {
                return Err(PeerError::Authentication(
                    "pairing transcript selected an endpoint absent from the signed invite".into(),
                ));
            }
        }
        Ok(())
    }

    pub fn verify_trusted_against_invite(
        &self,
        invite: &SignedPairingInvite,
        trust: &impl DeviceTrustResolver,
        now: u64,
    ) -> Result<()> {
        trust.verify_current_certificate(&self.body.inviter_device, now)?;
        trust.verify_current_certificate(&self.body.accepter_device, now)?;
        self.verify_against_invite(invite, now)
    }
}

impl Validate for SignedPairingTranscript {
    fn validate(&self) -> Result<()> {
        self.body.validate()?;
        self.inviter_signature.validate()?;
        self.accepter_signature.validate()
    }
}

fn ensure_signer_matches(
    signer: &DeviceSigner,
    certificate: &DeviceCertificate,
    role: &str,
) -> Result<()> {
    if signer.device_id != certificate.body.device_id
        || signer.verifying_key_bytes() != certificate.body.device_public_key
    {
        return Err(PeerError::Authentication(format!(
            "{role} signer does not match its certified device"
        )));
    }
    Ok(())
}

const fn range_contains(range: ProtocolRange, version: ProtocolVersion) -> bool {
    version.major == range.minimum.major
        && (version.minor >= range.minimum.minor && version.minor <= range.maximum.minor)
}

const fn range_contains_range(outer: ProtocolRange, inner: ProtocolRange) -> bool {
    outer.minimum.major == inner.minimum.major
        && inner.minimum.minor >= outer.minimum.minor
        && inner.maximum.minor <= outer.maximum.minor
}

fn validate_time_window(start: u64, end: u64, maximum: u64, label: &str) -> Result<()> {
    if start >= end {
        return Err(invalid(format!("{label} has an empty time window")));
    }
    if end - start > maximum {
        return Err(invalid(format!("{label} exceeds its maximum lifetime")));
    }
    Ok(())
}

fn validate_unique_endpoints(endpoints: &[EndpointDescriptor], label: &str) -> Result<()> {
    for (index, endpoint) in endpoints.iter().enumerate() {
        if endpoints[index + 1..].contains(endpoint) {
            return Err(invalid(format!("{label} contains duplicate endpoints")));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::endpoint::{DirectEndpoint, IpAddress};
    use crate::identity::{DeviceCapabilities, DeviceCertificate, DeviceId, PrincipalRootSigner};

    fn certified_device(
        now: u64,
    ) -> Result<(PrincipalRootSigner, DeviceSigner, DeviceCertificate)> {
        let root = PrincipalRootSigner::generate();
        let device = DeviceSigner::generate(DeviceId::random());
        let certificate = DeviceCertificate::issue(
            &root,
            &device,
            DeviceCapabilities::new(DeviceCapabilities::DIRECT_STREAM)?,
            ProtocolRange::CURRENT,
            1,
            now - 10,
            now + 3_600,
        )?;
        Ok((root, device, certificate))
    }

    fn endpoint() -> EndpointDescriptor {
        EndpointDescriptor::Direct(DirectEndpoint {
            address: IpAddress::V4([192, 168, 1, 10]),
            port: 4_317,
        })
    }

    #[test]
    fn signed_pairing_transcript_binds_both_devices() -> Result<()> {
        let now = 10_000;
        let (_, inviter, inviter_certificate) = certified_device(now)?;
        let (_, accepter, accepter_certificate) = certified_device(now)?;
        let transcript = SignedPairingTranscript::sign(
            PairingTranscriptBody {
                transcript_version: 1,
                invite_id: InviteId::random(),
                signed_invite_commitment: [9; 32],
                inviter_device: inviter_certificate,
                accepter_device: accepter_certificate,
                inviter_protocol_range: ProtocolRange::CURRENT,
                accepter_protocol_range: ProtocolRange::CURRENT,
                selected_protocol: ProtocolVersion::CURRENT,
                selected_endpoints: BoundedVec::new(vec![endpoint()])?,
                verification_phrase_hash: [7; 32],
                initial_grant_hash: [8; 32],
                created_at: now,
                expires_at: now + 300,
            },
            &inviter,
            &accepter,
        )?;
        transcript.verify(now + 1)?;
        Ok(())
    }

    #[test]
    fn transcript_signatures_can_be_produced_on_separate_devices() -> Result<()> {
        let now = 10_000;
        let (_, inviter, inviter_certificate) = certified_device(now)?;
        let (_, accepter, accepter_certificate) = certified_device(now)?;
        let body = PairingTranscriptBody {
            transcript_version: 1,
            invite_id: InviteId::random(),
            signed_invite_commitment: [9; 32],
            inviter_device: inviter_certificate,
            accepter_device: accepter_certificate,
            inviter_protocol_range: ProtocolRange::CURRENT,
            accepter_protocol_range: ProtocolRange::CURRENT,
            selected_protocol: ProtocolVersion::CURRENT,
            selected_endpoints: BoundedVec::new(vec![endpoint()])?,
            verification_phrase_hash: [7; 32],
            initial_grant_hash: [8; 32],
            created_at: now,
            expires_at: now + 300,
        };
        let accepter_signature = SignedPairingTranscript::sign_as_accepter(&body, &accepter)?;
        let inviter_signature = SignedPairingTranscript::sign_as_inviter(&body, &inviter)?;
        SignedPairingTranscript::assemble(body, inviter_signature, accepter_signature)?;
        Ok(())
    }

    #[test]
    fn qr_bundle_binds_the_one_time_bootstrap_proof() -> Result<()> {
        let now = 10_000;
        let (_, signer, certificate) = certified_device(now)?;
        let proof = [21; 32];
        let body = PairingInviteBody {
            qr_version: 1,
            invite_id: InviteId::random(),
            inviter_device: certificate.clone(),
            protocol_range: ProtocolRange::CURRENT,
            endpoints: BoundedVec::new(vec![endpoint()])?,
            bootstrap_public_key: [22; 32],
            bootstrap_secret_commitment: bootstrap_proof_commitment(&proof)?,
            inviter_fingerprint: certificate.fingerprint()?,
            initial_grant_hash: [23; 32],
            created_at: now,
            expires_at: now + 300,
        };
        let invite = SignedPairingInvite::sign(body, &signer)?;
        let encoded = PairingQrBundle::new(invite, proof)?.to_qr_bytes()?;
        PairingQrBundle::from_qr_bytes(&encoded)?.validate()?;
        let mut tampered = PairingQrBundle::from_qr_bytes(&encoded)?;
        tampered.bootstrap_proof[0] ^= 1;
        assert!(tampered.validate().is_err());
        Ok(())
    }

    #[test]
    fn transcript_rejects_downgraded_selected_version() -> Result<()> {
        let now = 10_000;
        let (_, inviter, inviter_certificate) = certified_device(now)?;
        let (_, accepter, accepter_certificate) = certified_device(now)?;
        let body = PairingTranscriptBody {
            transcript_version: 1,
            invite_id: InviteId::random(),
            signed_invite_commitment: [9; 32],
            inviter_device: inviter_certificate,
            accepter_device: accepter_certificate,
            inviter_protocol_range: ProtocolRange {
                minimum: ProtocolVersion { major: 1, minor: 0 },
                maximum: ProtocolVersion { major: 1, minor: 1 },
            },
            accepter_protocol_range: ProtocolRange {
                minimum: ProtocolVersion { major: 1, minor: 0 },
                maximum: ProtocolVersion { major: 1, minor: 1 },
            },
            selected_protocol: ProtocolVersion { major: 1, minor: 0 },
            selected_endpoints: BoundedVec::new(vec![endpoint()])?,
            verification_phrase_hash: [7; 32],
            initial_grant_hash: [8; 32],
            created_at: now,
            expires_at: now + 300,
        };
        assert!(SignedPairingTranscript::sign(body, &inviter, &accepter).is_err());
        Ok(())
    }

    #[test]
    fn transcript_binds_exact_invite_and_offered_endpoints() -> Result<()> {
        let now = 10_000;
        let (_, inviter, inviter_certificate) = certified_device(now)?;
        let (_, accepter, accepter_certificate) = certified_device(now)?;
        let offered = endpoint();
        let invite = SignedPairingInvite::sign(
            PairingInviteBody {
                qr_version: 1,
                invite_id: InviteId::random(),
                inviter_device: inviter_certificate.clone(),
                protocol_range: ProtocolRange::CURRENT,
                endpoints: BoundedVec::new(vec![offered.clone()])?,
                bootstrap_public_key: inviter.key_agreement_public_key_bytes(),
                bootstrap_secret_commitment: [6; 32],
                inviter_fingerprint: inviter_certificate.fingerprint()?,
                initial_grant_hash: [8; 32],
                created_at: now,
                expires_at: now + 300,
            },
            &inviter,
        )?;
        let transcript_body = PairingTranscriptBody {
            transcript_version: 1,
            invite_id: invite.body.invite_id,
            signed_invite_commitment: invite.commitment()?,
            inviter_device: inviter_certificate,
            accepter_device: accepter_certificate,
            inviter_protocol_range: ProtocolRange::CURRENT,
            accepter_protocol_range: ProtocolRange::CURRENT,
            selected_protocol: ProtocolVersion::CURRENT,
            selected_endpoints: BoundedVec::new(vec![offered])?,
            verification_phrase_hash: [7; 32],
            initial_grant_hash: [8; 32],
            created_at: now + 1,
            expires_at: now + 200,
        };
        let transcript =
            SignedPairingTranscript::sign(transcript_body.clone(), &inviter, &accepter)?;
        transcript.verify_against_invite(&invite, now + 2)?;

        let mut unoffered = transcript_body.clone();
        unoffered.selected_endpoints =
            BoundedVec::new(vec![EndpointDescriptor::Direct(DirectEndpoint {
                address: IpAddress::V4([192, 168, 1, 11]),
                port: 4_317,
            })])?;
        let unoffered = SignedPairingTranscript::sign(unoffered, &inviter, &accepter)?;
        assert!(unoffered.verify_against_invite(&invite, now + 2).is_err());

        let mut overlong = transcript_body;
        overlong.expires_at = invite.body.expires_at + 1;
        let overlong = SignedPairingTranscript::sign(overlong, &inviter, &accepter)?;
        assert!(overlong.verify_against_invite(&invite, now + 2).is_err());
        Ok(())
    }

    #[test]
    fn future_dated_pairing_material_is_rejected() -> Result<()> {
        let now = 10_000;
        let (_, inviter, inviter_certificate) = certified_device(now + 10_000)?;
        let invite = SignedPairingInvite::sign(
            PairingInviteBody {
                qr_version: 1,
                invite_id: InviteId::random(),
                inviter_fingerprint: inviter_certificate.fingerprint()?,
                inviter_device: inviter_certificate,
                protocol_range: ProtocolRange::CURRENT,
                endpoints: BoundedVec::new(vec![endpoint()])?,
                bootstrap_public_key: inviter.key_agreement_public_key_bytes(),
                bootstrap_secret_commitment: [6; 32],
                initial_grant_hash: [8; 32],
                created_at: now + MAX_CLOCK_SKEW_SECONDS + 1,
                expires_at: now + MAX_CLOCK_SKEW_SECONDS + 301,
            },
            &inviter,
        )?;
        assert!(invite.verify(now).is_err());
        Ok(())
    }
}
