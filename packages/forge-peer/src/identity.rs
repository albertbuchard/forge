use std::collections::HashMap;
use std::sync::Mutex;

use bincode::{Decode, Encode};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use x25519_dalek::{PublicKey as X25519PublicKey, StaticSecret};
use zeroize::Zeroizing;

use crate::codec::{Validate, encode_limited};
use crate::error::{PeerError, Result, invalid};
use crate::{PROTOCOL_MAJOR, PROTOCOL_MINOR};

const IDENTITY_SIGNING_LIMIT: usize = 64 * 1024;
const DEVICE_CERT_DOMAIN: &[u8] = b"forge-peer/1 device certificate\0";
const DEVICE_REVOCATION_DOMAIN: &[u8] = b"forge-peer/1 device revocation\0";
const PRINCIPAL_ID_DOMAIN: &str = "forge-peer/1 principal id";
const DERIVED_AGREEMENT_KEY_DOMAIN: &str = "forge-peer/1 derived X25519 device key";
const MAX_CERTIFICATE_LIFETIME_SECONDS: u64 = 5 * 366 * 24 * 60 * 60;
pub const MAX_CLOCK_SKEW_SECONDS: u64 = 300;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Encode, Decode)]
pub struct PrincipalId(pub [u8; 32]);

impl PrincipalId {
    pub fn from_root_public_key(root_public_key: &[u8; 32]) -> Self {
        let mut hasher = blake3::Hasher::new_derive_key(PRINCIPAL_ID_DOMAIN);
        hasher.update(root_public_key);
        Self(*hasher.finalize().as_bytes())
    }
}

impl Validate for PrincipalId {
    fn validate(&self) -> Result<()> {
        if self.0 == [0; 32] {
            return Err(invalid("principal id is all zero"));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Encode, Decode)]
pub struct DeviceId(pub [u8; 16]);

impl DeviceId {
    pub fn random() -> Self {
        Self(rand::random())
    }
}

impl Validate for DeviceId {
    fn validate(&self) -> Result<()> {
        if self.0 == [0; 16] {
            return Err(invalid("device id is all zero"));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Encode, Decode)]
pub struct ProtocolVersion {
    pub major: u16,
    pub minor: u16,
}

impl ProtocolVersion {
    pub const CURRENT: Self = Self {
        major: PROTOCOL_MAJOR,
        minor: PROTOCOL_MINOR,
    };
}

impl Ord for ProtocolVersion {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        (self.major, self.minor).cmp(&(other.major, other.minor))
    }
}

impl PartialOrd for ProtocolVersion {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Validate for ProtocolVersion {
    fn validate(&self) -> Result<()> {
        if self.major == 0 {
            return Err(invalid("protocol major version must be non-zero"));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Encode, Decode)]
pub struct ProtocolRange {
    pub minimum: ProtocolVersion,
    pub maximum: ProtocolVersion,
}

impl ProtocolRange {
    pub const CURRENT: Self = Self {
        minimum: ProtocolVersion::CURRENT,
        maximum: ProtocolVersion::CURRENT,
    };

    pub fn negotiate(self, remote: Self) -> Result<ProtocolVersion> {
        self.validate()?;
        remote.validate()?;
        let minimum = self.minimum.max(remote.minimum);
        let maximum = self.maximum.min(remote.maximum);
        if minimum > maximum {
            return Err(PeerError::Version(
                "no mutually supported protocol version".into(),
            ));
        }
        Ok(maximum)
    }
}

impl Validate for ProtocolRange {
    fn validate(&self) -> Result<()> {
        self.minimum.validate()?;
        self.maximum.validate()?;
        if self.minimum > self.maximum {
            return Err(invalid("protocol range minimum exceeds maximum"));
        }
        if self.minimum.major != self.maximum.major {
            return Err(invalid("protocol range cannot span protocol families"));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Encode, Decode)]
pub struct DeviceCapabilities(u64);

impl DeviceCapabilities {
    pub const DIRECT_STREAM: u64 = 1 << 0;
    pub const IROH: u64 = 1 << 1;
    pub const TOR: u64 = 1 << 2;
    pub const HTTP_MAILBOX: u64 = 1 << 3;
    pub const QUERY: u64 = 1 << 4;
    pub const PROJECTION: u64 = 1 << 5;
    pub const KEY_PACKAGE: u64 = 1 << 6;
    const KNOWN: u64 = Self::DIRECT_STREAM
        | Self::IROH
        | Self::TOR
        | Self::HTTP_MAILBOX
        | Self::QUERY
        | Self::PROJECTION
        | Self::KEY_PACKAGE;

    pub fn new(bits: u64) -> Result<Self> {
        let capabilities = Self(bits);
        capabilities.validate()?;
        Ok(capabilities)
    }

    pub const fn bits(self) -> u64 {
        self.0
    }

    pub const fn all_known() -> Self {
        Self(Self::KNOWN)
    }

    pub const fn contains(self, capability: u64) -> bool {
        self.0 & capability == capability
    }
}

impl Validate for DeviceCapabilities {
    fn validate(&self) -> Result<()> {
        if self.0 & !Self::KNOWN != 0 {
            return Err(invalid(
                "device certificate contains unknown critical capabilities",
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Encode, Decode)]
pub struct SignatureBytes(pub [u8; 64]);

impl Validate for SignatureBytes {
    fn validate(&self) -> Result<()> {
        if self.0 == [0; 64] {
            return Err(invalid("signature is all zero"));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode)]
pub struct DeviceCertificateBody {
    pub certificate_version: u16,
    pub principal_id: PrincipalId,
    pub device_id: DeviceId,
    pub device_public_key: [u8; 32],
    pub device_key_agreement_public_key: [u8; 32],
    pub capabilities: DeviceCapabilities,
    pub protocol_range: ProtocolRange,
    pub serial: u64,
    pub not_before: u64,
    pub not_after: u64,
}

impl Validate for DeviceCertificateBody {
    fn validate(&self) -> Result<()> {
        if self.certificate_version != 1 {
            return Err(PeerError::Version(format!(
                "unsupported device certificate version {}",
                self.certificate_version
            )));
        }
        self.principal_id.validate()?;
        self.device_id.validate()?;
        self.capabilities.validate()?;
        self.protocol_range.validate()?;
        VerifyingKey::from_bytes(&self.device_public_key)
            .map_err(|_| invalid("device public key is invalid"))?;
        if self.device_key_agreement_public_key == [0; 32] {
            return Err(invalid("device X25519 public key is all zero"));
        }
        if self.serial == 0 {
            return Err(invalid("device certificate serial must be non-zero"));
        }
        if self.not_before >= self.not_after {
            return Err(invalid("device certificate validity interval is empty"));
        }
        if self.not_after - self.not_before > MAX_CERTIFICATE_LIFETIME_SECONDS {
            return Err(invalid("device certificate lifetime exceeds policy"));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode)]
pub struct DeviceCertificate {
    pub body: DeviceCertificateBody,
    pub root_public_key: [u8; 32],
    pub root_signature: SignatureBytes,
}

impl DeviceCertificate {
    pub fn issue(
        root: &PrincipalRootSigner,
        device: &DeviceSigner,
        capabilities: DeviceCapabilities,
        protocol_range: ProtocolRange,
        serial: u64,
        not_before: u64,
        not_after: u64,
    ) -> Result<Self> {
        let body = DeviceCertificateBody {
            certificate_version: 1,
            principal_id: root.principal_id(),
            device_id: device.device_id,
            device_public_key: device.verifying_key_bytes(),
            device_key_agreement_public_key: device.key_agreement_public_key_bytes(),
            capabilities,
            protocol_range,
            serial,
            not_before,
            not_after,
        };
        body.validate()?;
        let signature = root.sign_domain(DEVICE_CERT_DOMAIN, &body)?;
        Ok(Self {
            body,
            root_public_key: root.verifying_key_bytes(),
            root_signature: signature,
        })
    }

    pub fn verify(&self, now: u64) -> Result<()> {
        self.validate()?;
        let expected_principal = PrincipalId::from_root_public_key(&self.root_public_key);
        if self.body.principal_id != expected_principal {
            return Err(PeerError::Authentication(
                "principal id does not match root public key".into(),
            ));
        }
        verify_domain_signature(
            &self.root_public_key,
            DEVICE_CERT_DOMAIN,
            &self.body,
            &self.root_signature,
        )?;
        if now.saturating_add(MAX_CLOCK_SKEW_SECONDS) < self.body.not_before {
            return Err(PeerError::Authentication(
                "device certificate is not yet valid".into(),
            ));
        }
        if now > self.body.not_after.saturating_add(MAX_CLOCK_SKEW_SECONDS) {
            return Err(PeerError::Authentication(
                "device certificate expired".into(),
            ));
        }
        Ok(())
    }

    pub fn fingerprint(&self) -> Result<[u8; 32]> {
        let bytes = encode_limited::<IDENTITY_SIGNING_LIMIT, _>(self)?;
        Ok(*blake3::hash(&bytes).as_bytes())
    }

    pub fn verify_device_signature<T: Encode + Validate>(
        &self,
        domain: &[u8],
        value: &T,
        signature: &SignatureBytes,
    ) -> Result<()> {
        verify_domain_signature(&self.body.device_public_key, domain, value, signature)
    }

    pub fn rotate(
        root: &PrincipalRootSigner,
        previous: &Self,
        replacement: &DeviceSigner,
        capabilities: DeviceCapabilities,
        protocol_range: ProtocolRange,
        not_before: u64,
        not_after: u64,
    ) -> Result<Self> {
        previous.verify(previous.body.not_before)?;
        if previous.body.principal_id != root.principal_id()
            || previous.root_public_key != root.verifying_key_bytes()
            || previous.body.device_id != replacement.device_id
        {
            return Err(PeerError::Authentication(
                "device rotation does not preserve the certified principal and device id".into(),
            ));
        }
        if not_before < previous.body.not_before {
            return Err(PeerError::Replay(
                "device rotation validity start moved backward".into(),
            ));
        }
        if previous.body.device_public_key == replacement.verifying_key_bytes()
            || previous.body.device_key_agreement_public_key
                == replacement.key_agreement_public_key_bytes()
        {
            return Err(PeerError::Authentication(
                "device rotation must replace both signing and key-agreement keys".into(),
            ));
        }
        let serial =
            previous.body.serial.checked_add(1).ok_or_else(|| {
                PeerError::StateConflict("device certificate serial overflow".into())
            })?;
        Self::issue(
            root,
            replacement,
            capabilities,
            protocol_range,
            serial,
            not_before,
            not_after,
        )
    }
}

impl Validate for DeviceCertificate {
    fn validate(&self) -> Result<()> {
        self.body.validate()?;
        VerifyingKey::from_bytes(&self.root_public_key)
            .map_err(|_| invalid("root public key is invalid"))?;
        self.root_signature.validate()
    }
}

pub struct PrincipalRootSigner {
    signing_key: SigningKey,
}

impl PrincipalRootSigner {
    pub fn generate() -> Self {
        Self {
            signing_key: SigningKey::from_bytes(&rand::random()),
        }
    }

    pub fn from_secret_bytes(secret: [u8; 32]) -> Self {
        Self {
            signing_key: SigningKey::from_bytes(&secret),
        }
    }

    pub fn verifying_key_bytes(&self) -> [u8; 32] {
        self.signing_key.verifying_key().to_bytes()
    }

    pub fn principal_id(&self) -> PrincipalId {
        PrincipalId::from_root_public_key(&self.verifying_key_bytes())
    }

    pub(crate) fn secret_bytes(&self) -> Zeroizing<[u8; 32]> {
        Zeroizing::new(self.signing_key.to_bytes())
    }

    fn sign_domain<T: Encode + Validate>(
        &self,
        domain: &[u8],
        value: &T,
    ) -> Result<SignatureBytes> {
        sign_domain(&self.signing_key, domain, value)
    }
}

pub struct DeviceSigner {
    pub device_id: DeviceId,
    signing_key: SigningKey,
    key_agreement_secret: StaticSecret,
}

impl DeviceSigner {
    pub fn generate(device_id: DeviceId) -> Self {
        Self {
            device_id,
            signing_key: SigningKey::from_bytes(&rand::random()),
            key_agreement_secret: StaticSecret::from(rand::random::<[u8; 32]>()),
        }
    }

    pub fn from_secret_bytes(device_id: DeviceId, secret: [u8; 32]) -> Self {
        let agreement_secret = blake3::derive_key(DERIVED_AGREEMENT_KEY_DOMAIN, &secret);
        Self::from_secret_material(device_id, secret, agreement_secret)
    }

    pub fn from_secret_material(
        device_id: DeviceId,
        signing_secret: [u8; 32],
        key_agreement_secret: [u8; 32],
    ) -> Self {
        Self {
            device_id,
            signing_key: SigningKey::from_bytes(&signing_secret),
            key_agreement_secret: StaticSecret::from(key_agreement_secret),
        }
    }

    pub fn verifying_key_bytes(&self) -> [u8; 32] {
        self.signing_key.verifying_key().to_bytes()
    }

    pub fn key_agreement_public_key_bytes(&self) -> [u8; 32] {
        X25519PublicKey::from(&self.key_agreement_secret).to_bytes()
    }

    pub fn agree(&self, peer_public_key: [u8; 32]) -> Result<Zeroizing<[u8; 32]>> {
        if peer_public_key == [0; 32] {
            return Err(invalid("peer X25519 public key is all zero"));
        }
        let shared = self
            .key_agreement_secret
            .diffie_hellman(&X25519PublicKey::from(peer_public_key))
            .to_bytes();
        if shared == [0; 32] {
            return Err(PeerError::Authentication(
                "X25519 key agreement produced a non-contributory shared secret".into(),
            ));
        }
        Ok(Zeroizing::new(shared))
    }

    pub fn sign<T: Encode + Validate>(&self, domain: &[u8], value: &T) -> Result<SignatureBytes> {
        sign_domain(&self.signing_key, domain, value)
    }

    pub(crate) fn sign_raw(&self, payload: &[u8]) -> SignatureBytes {
        SignatureBytes(self.signing_key.sign(payload).to_bytes())
    }

    pub(crate) fn signing_secret_bytes(&self) -> Zeroizing<[u8; 32]> {
        Zeroizing::new(self.signing_key.to_bytes())
    }

    pub(crate) fn key_agreement_secret_bytes(&self) -> Zeroizing<[u8; 32]> {
        Zeroizing::new(self.key_agreement_secret.to_bytes())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode)]
pub struct DeviceRevocationBody {
    pub revocation_version: u16,
    pub principal_id: PrincipalId,
    pub device_id: DeviceId,
    pub revoked_through_serial: u64,
    pub sequence: u64,
    pub previous_revocation_hash: [u8; 32],
    pub revoked_at: u64,
    pub permanent: bool,
}

impl Validate for DeviceRevocationBody {
    fn validate(&self) -> Result<()> {
        if self.revocation_version != 1 {
            return Err(PeerError::Version(format!(
                "unsupported device revocation version {}",
                self.revocation_version
            )));
        }
        self.principal_id.validate()?;
        self.device_id.validate()?;
        if self.revoked_through_serial == 0 || self.sequence == 0 || self.revoked_at == 0 {
            return Err(invalid(
                "device revocation has a zero serial, sequence, or timestamp",
            ));
        }
        if self.sequence == 1 && self.previous_revocation_hash != [0; 32] {
            return Err(invalid("first device revocation has a predecessor hash"));
        }
        if self.sequence > 1 && self.previous_revocation_hash == [0; 32] {
            return Err(invalid(
                "later device revocation is missing its predecessor hash",
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode)]
pub struct SignedDeviceRevocation {
    pub body: DeviceRevocationBody,
    pub root_public_key: [u8; 32],
    pub root_signature: SignatureBytes,
}

impl SignedDeviceRevocation {
    pub fn issue(root: &PrincipalRootSigner, body: DeviceRevocationBody) -> Result<Self> {
        body.validate()?;
        if body.principal_id != root.principal_id() {
            return Err(PeerError::Authentication(
                "revocation principal does not match root signer".into(),
            ));
        }
        Ok(Self {
            root_signature: root.sign_domain(DEVICE_REVOCATION_DOMAIN, &body)?,
            root_public_key: root.verifying_key_bytes(),
            body,
        })
    }

    pub fn verify(&self, now: u64) -> Result<()> {
        self.validate()?;
        if PrincipalId::from_root_public_key(&self.root_public_key) != self.body.principal_id {
            return Err(PeerError::Authentication(
                "revocation principal does not match root public key".into(),
            ));
        }
        if self.body.revoked_at > now.saturating_add(MAX_CLOCK_SKEW_SECONDS) {
            return Err(PeerError::Authentication(
                "device revocation timestamp is too far in the future".into(),
            ));
        }
        verify_domain_signature(
            &self.root_public_key,
            DEVICE_REVOCATION_DOMAIN,
            &self.body,
            &self.root_signature,
        )
    }

    pub fn hash(&self) -> Result<[u8; 32]> {
        let bytes = encode_limited::<IDENTITY_SIGNING_LIMIT, _>(self)?;
        Ok(*blake3::hash(&bytes).as_bytes())
    }
}

impl Validate for SignedDeviceRevocation {
    fn validate(&self) -> Result<()> {
        self.body.validate()?;
        VerifyingKey::from_bytes(&self.root_public_key)
            .map_err(|_| invalid("revocation root public key is invalid"))?;
        self.root_signature.validate()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct TrustedDeviceVersion {
    serial: u64,
    fingerprint: [u8; 32],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct TrustedDeviceState {
    current: TrustedDeviceVersion,
    previous: Option<TrustedDeviceVersion>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
struct RevokedDeviceState {
    revoked_through_serial: u64,
    permanent: bool,
}

#[derive(Debug, Default)]
struct DeviceTrustState {
    roots: HashMap<PrincipalId, [u8; 32]>,
    devices: HashMap<(PrincipalId, DeviceId), TrustedDeviceState>,
    revocations: HashMap<(PrincipalId, DeviceId), RevokedDeviceState>,
    revocation_heads: HashMap<(PrincipalId, DeviceId), (u64, [u8; 32])>,
}

pub trait DeviceTrustResolver: Send + Sync {
    fn verify_current_certificate(&self, certificate: &DeviceCertificate, now: u64) -> Result<()>;

    fn verify_certificate_transition(
        &self,
        previous: &DeviceCertificate,
        replacement: &DeviceCertificate,
        now: u64,
    ) -> Result<()>;
}

#[derive(Debug, Default)]
pub struct MemoryDeviceTrustStore {
    state: Mutex<DeviceTrustState>,
}

impl MemoryDeviceTrustStore {
    pub fn trust_principal(&self, root_public_key: [u8; 32]) -> Result<PrincipalId> {
        VerifyingKey::from_bytes(&root_public_key)
            .map_err(|_| invalid("trusted root public key is invalid"))?;
        let principal_id = PrincipalId::from_root_public_key(&root_public_key);
        let mut state = self.lock()?;
        match state.roots.get(&principal_id) {
            Some(existing) if *existing != root_public_key => Err(PeerError::Authentication(
                "trusted principal id collides with another root key".into(),
            )),
            Some(_) => Ok(principal_id),
            None => {
                state.roots.insert(principal_id, root_public_key);
                Ok(principal_id)
            }
        }
    }

    pub fn admit_certificate(&self, certificate: &DeviceCertificate, now: u64) -> Result<()> {
        certificate.verify(now)?;
        let key = (certificate.body.principal_id, certificate.body.device_id);
        let fingerprint = certificate.fingerprint()?;
        let mut state = self.lock()?;
        let trusted_root = state
            .roots
            .get(&certificate.body.principal_id)
            .ok_or_else(|| {
                PeerError::Authentication("device principal root is not locally trusted".into())
            })?;
        if trusted_root != &certificate.root_public_key {
            return Err(PeerError::Authentication(
                "device certificate root does not match the trusted principal".into(),
            ));
        }
        if let Some(revoked) = state.revocations.get(&key)
            && (revoked.permanent || certificate.body.serial <= revoked.revoked_through_serial)
        {
            return Err(PeerError::Authentication(
                "device certificate is covered by a root-signed revocation".into(),
            ));
        }
        let next = match state.devices.get(&key).copied() {
            Some(state) if certificate.body.serial < state.current.serial => {
                return Err(PeerError::Replay(
                    "device certificate serial rolled back".into(),
                ));
            }
            Some(state)
                if certificate.body.serial == state.current.serial
                    && fingerprint != state.current.fingerprint =>
            {
                return Err(PeerError::StateConflict(
                    "device certificate serial fork detected".into(),
                ));
            }
            Some(state) if certificate.body.serial > state.current.serial.saturating_add(1) => {
                return Err(PeerError::Replay(
                    "device certificate rotation skipped a serial".into(),
                ));
            }
            Some(state) if certificate.body.serial == state.current.serial => state,
            Some(state) => TrustedDeviceState {
                previous: Some(state.current),
                current: TrustedDeviceVersion {
                    serial: certificate.body.serial,
                    fingerprint,
                },
            },
            None => TrustedDeviceState {
                previous: None,
                current: TrustedDeviceVersion {
                    serial: certificate.body.serial,
                    fingerprint,
                },
            },
        };
        state.devices.insert(key, next);
        Ok(())
    }

    pub fn current_serial(
        &self,
        principal_id: PrincipalId,
        device_id: DeviceId,
    ) -> Result<Option<u64>> {
        Ok(self
            .lock()?
            .devices
            .get(&(principal_id, device_id))
            .map(|state| state.current.serial))
    }

    fn verify_replacement_state(
        state: &DeviceTrustState,
        certificate: &DeviceCertificate,
        fingerprint: [u8; 32],
    ) -> Result<TrustedDeviceState> {
        let key = (certificate.body.principal_id, certificate.body.device_id);
        if let Some(revoked) = state.revocations.get(&key)
            && (revoked.permanent || certificate.body.serial <= revoked.revoked_through_serial)
        {
            return Err(PeerError::Authentication(
                "device certificate is covered by a root-signed revocation".into(),
            ));
        }
        let current = state.devices.get(&key).copied().ok_or_else(|| {
            PeerError::Authentication("device certificate has not been admitted locally".into())
        })?;
        if current.current.serial != certificate.body.serial
            || current.current.fingerprint != fingerprint
        {
            return Err(PeerError::Replay(
                "device certificate is not the current admitted rotation".into(),
            ));
        }
        Ok(current)
    }

    pub fn apply_revocation(&self, revocation: &SignedDeviceRevocation, now: u64) -> Result<()> {
        revocation.verify(now)?;
        let mut state = self.lock()?;
        let trusted_root = state
            .roots
            .get(&revocation.body.principal_id)
            .ok_or_else(|| {
                PeerError::Authentication("revocation principal root is not locally trusted".into())
            })?;
        if trusted_root != &revocation.root_public_key {
            return Err(PeerError::Authentication(
                "revocation root does not match the trusted principal".into(),
            ));
        }
        let key = (revocation.body.principal_id, revocation.body.device_id);
        let (expected_sequence, expected_hash) = state.revocation_heads.get(&key).copied().map_or(
            Ok((1, [0; 32])),
            |(sequence, hash)| {
                sequence
                    .checked_add(1)
                    .map(|next| (next, hash))
                    .ok_or_else(|| {
                        PeerError::StateConflict("device revocation sequence overflow".into())
                    })
            },
        )?;
        if revocation.body.sequence != expected_sequence
            || revocation.body.previous_revocation_hash != expected_hash
        {
            return Err(PeerError::Replay(
                "device revocation hash chain is not contiguous".into(),
            ));
        }
        let current = state.revocations.get(&key).copied().unwrap_or_default();
        if revocation.body.revoked_through_serial < current.revoked_through_serial
            || (current.permanent && !revocation.body.permanent)
        {
            return Err(PeerError::Replay(
                "device revocation attempts to weaken existing revocation state".into(),
            ));
        }
        state.revocations.insert(
            key,
            RevokedDeviceState {
                revoked_through_serial: revocation.body.revoked_through_serial,
                permanent: revocation.body.permanent,
            },
        );
        state
            .revocation_heads
            .insert(key, (revocation.body.sequence, revocation.hash()?));
        Ok(())
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, DeviceTrustState>> {
        self.state
            .lock()
            .map_err(|_| PeerError::StateConflict("device trust store lock poisoned".into()))
    }
}

impl DeviceTrustResolver for MemoryDeviceTrustStore {
    fn verify_current_certificate(&self, certificate: &DeviceCertificate, now: u64) -> Result<()> {
        certificate.verify(now)?;
        let state = self.lock()?;
        let trusted_root = state
            .roots
            .get(&certificate.body.principal_id)
            .ok_or_else(|| {
                PeerError::Authentication("device principal root is not locally trusted".into())
            })?;
        if trusted_root != &certificate.root_public_key {
            return Err(PeerError::Authentication(
                "device certificate root does not match the trusted principal".into(),
            ));
        }
        Self::verify_replacement_state(&state, certificate, certificate.fingerprint()?)?;
        Ok(())
    }

    fn verify_certificate_transition(
        &self,
        previous: &DeviceCertificate,
        replacement: &DeviceCertificate,
        now: u64,
    ) -> Result<()> {
        previous.verify(previous.body.not_before)?;
        replacement.verify(now)?;
        if previous.body.principal_id != replacement.body.principal_id
            || previous.body.device_id != replacement.body.device_id
            || previous.root_public_key != replacement.root_public_key
            || replacement.body.serial
                != previous
                    .body
                    .serial
                    .checked_add(1)
                    .ok_or_else(|| PeerError::StateConflict("device serial overflow".into()))?
        {
            return Err(PeerError::Authentication(
                "device certificate transition is not a contiguous root-signed rotation".into(),
            ));
        }
        let state = self.lock()?;
        let trusted_root = state
            .roots
            .get(&replacement.body.principal_id)
            .ok_or_else(|| {
                PeerError::Authentication("device principal root is not locally trusted".into())
            })?;
        if trusted_root != &replacement.root_public_key {
            return Err(PeerError::Authentication(
                "device transition root does not match the trusted principal".into(),
            ));
        }
        let current =
            Self::verify_replacement_state(&state, replacement, replacement.fingerprint()?)?;
        let admitted_previous = current.previous.ok_or_else(|| {
            PeerError::Authentication("device transition has no admitted predecessor".into())
        })?;
        if admitted_previous.serial != previous.body.serial
            || admitted_previous.fingerprint != previous.fingerprint()?
        {
            return Err(PeerError::Replay(
                "device transition predecessor is not the immediately previous admission".into(),
            ));
        }
        Ok(())
    }
}

fn sign_domain<T: Encode + Validate>(
    signing_key: &SigningKey,
    domain: &[u8],
    value: &T,
) -> Result<SignatureBytes> {
    let body = encode_limited::<IDENTITY_SIGNING_LIMIT, _>(value)?;
    let mut signed = Vec::with_capacity(domain.len() + body.len());
    signed.extend_from_slice(domain);
    signed.extend_from_slice(&body);
    Ok(SignatureBytes(signing_key.sign(&signed).to_bytes()))
}

pub fn verify_domain_signature<T: Encode + Validate>(
    public_key: &[u8; 32],
    domain: &[u8],
    value: &T,
    signature: &SignatureBytes,
) -> Result<()> {
    signature.validate()?;
    let verifying_key = VerifyingKey::from_bytes(public_key)
        .map_err(|_| PeerError::Authentication("invalid Ed25519 public key".into()))?;
    let body = encode_limited::<IDENTITY_SIGNING_LIMIT, _>(value)?;
    let mut signed = Vec::with_capacity(domain.len() + body.len());
    signed.extend_from_slice(domain);
    signed.extend_from_slice(&body);
    verifying_key
        .verify(&signed, &Signature::from_bytes(&signature.0))
        .map_err(|_| PeerError::Authentication("Ed25519 signature verification failed".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn capabilities() -> Result<DeviceCapabilities> {
        DeviceCapabilities::new(DeviceCapabilities::DIRECT_STREAM | DeviceCapabilities::QUERY)
    }

    #[test]
    fn root_certifies_device_and_binds_principal() -> Result<()> {
        let root = PrincipalRootSigner::generate();
        let device = DeviceSigner::generate(DeviceId::random());
        let certificate = DeviceCertificate::issue(
            &root,
            &device,
            capabilities()?,
            ProtocolRange::CURRENT,
            1,
            1_000,
            2_000,
        )?;
        certificate.verify(1_500)?;
        assert_eq!(certificate.body.principal_id, root.principal_id());
        Ok(())
    }

    #[test]
    fn modified_device_certificate_is_rejected() -> Result<()> {
        let root = PrincipalRootSigner::generate();
        let device = DeviceSigner::generate(DeviceId::random());
        let mut certificate = DeviceCertificate::issue(
            &root,
            &device,
            capabilities()?,
            ProtocolRange::CURRENT,
            1,
            1_000,
            2_000,
        )?;
        certificate.body.serial = 2;
        assert!(certificate.verify(1_500).is_err());
        Ok(())
    }

    #[test]
    fn negotiation_chooses_highest_overlap_and_rejects_gap() -> Result<()> {
        let local = ProtocolRange {
            minimum: ProtocolVersion { major: 1, minor: 0 },
            maximum: ProtocolVersion { major: 1, minor: 3 },
        };
        let remote = ProtocolRange {
            minimum: ProtocolVersion { major: 1, minor: 1 },
            maximum: ProtocolVersion { major: 1, minor: 2 },
        };
        assert_eq!(
            local.negotiate(remote)?,
            ProtocolVersion { major: 1, minor: 2 }
        );
        let incompatible = ProtocolRange {
            minimum: ProtocolVersion { major: 2, minor: 0 },
            maximum: ProtocolVersion { major: 2, minor: 0 },
        };
        assert!(local.negotiate(incompatible).is_err());
        Ok(())
    }

    #[test]
    fn x25519_agreement_is_symmetric_and_rejects_zero_peer_keys() -> Result<()> {
        let alice = DeviceSigner::from_secret_material(DeviceId([1; 16]), [2; 32], [3; 32]);
        let bob = DeviceSigner::from_secret_material(DeviceId([4; 16]), [5; 32], [6; 32]);
        let alice_shared = alice.agree(bob.key_agreement_public_key_bytes())?;
        let bob_shared = bob.agree(alice.key_agreement_public_key_bytes())?;
        assert_eq!(alice_shared.as_ref(), bob_shared.as_ref());
        assert!(alice.agree([0; 32]).is_err());
        Ok(())
    }

    #[test]
    fn trust_store_rejects_rotation_rollback_and_root_signed_revocation() -> Result<()> {
        let now = 10_000;
        let root = PrincipalRootSigner::generate();
        let first_signer = DeviceSigner::from_secret_material(DeviceId([7; 16]), [8; 32], [9; 32]);
        let first = DeviceCertificate::issue(
            &root,
            &first_signer,
            capabilities()?,
            ProtocolRange::CURRENT,
            1,
            now - 10,
            now + 3_600,
        )?;
        let trust = MemoryDeviceTrustStore::default();
        trust.trust_principal(root.verifying_key_bytes())?;
        trust.admit_certificate(&first, now)?;

        let replacement =
            DeviceSigner::from_secret_material(first.body.device_id, [10; 32], [11; 32]);
        let second = DeviceCertificate::rotate(
            &root,
            &first,
            &replacement,
            capabilities()?,
            ProtocolRange::CURRENT,
            now,
            now + 3_600,
        )?;
        trust.admit_certificate(&second, now)?;
        assert!(trust.verify_current_certificate(&first, now).is_err());
        trust.verify_current_certificate(&second, now)?;
        trust.verify_certificate_transition(&first, &second, now)?;

        let revocation = SignedDeviceRevocation::issue(
            &root,
            DeviceRevocationBody {
                revocation_version: 1,
                principal_id: root.principal_id(),
                device_id: second.body.device_id,
                revoked_through_serial: second.body.serial,
                sequence: 1,
                previous_revocation_hash: [0; 32],
                revoked_at: now,
                permanent: true,
            },
        )?;
        trust.apply_revocation(&revocation, now)?;
        assert!(trust.verify_current_certificate(&second, now).is_err());
        assert!(trust.admit_certificate(&second, now).is_err());
        Ok(())
    }

    #[test]
    fn trust_store_rejects_skipped_rotation_serials_and_revocation_forks() -> Result<()> {
        let now = 10_000;
        let root = PrincipalRootSigner::generate();
        let signer = DeviceSigner::generate(DeviceId::random());
        let first = DeviceCertificate::issue(
            &root,
            &signer,
            capabilities()?,
            ProtocolRange::CURRENT,
            1,
            now - 1,
            now + 3_600,
        )?;
        let trust = MemoryDeviceTrustStore::default();
        trust.trust_principal(root.verifying_key_bytes())?;
        trust.admit_certificate(&first, now)?;
        let skipped_signer = DeviceSigner::generate(first.body.device_id);
        let skipped = DeviceCertificate::issue(
            &root,
            &skipped_signer,
            capabilities()?,
            ProtocolRange::CURRENT,
            3,
            now,
            now + 3_600,
        )?;
        assert!(trust.admit_certificate(&skipped, now).is_err());

        let fork = SignedDeviceRevocation::issue(
            &root,
            DeviceRevocationBody {
                revocation_version: 1,
                principal_id: root.principal_id(),
                device_id: first.body.device_id,
                revoked_through_serial: 1,
                sequence: 2,
                previous_revocation_hash: [7; 32],
                revoked_at: now,
                permanent: false,
            },
        )?;
        assert!(trust.apply_revocation(&fork, now).is_err());
        Ok(())
    }
}
