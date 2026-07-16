use bincode::{Decode, Encode};
use subtle::ConstantTimeEq as _;
use zeroize::{Zeroize as _, Zeroizing};

use crate::codec::{Validate, decode_limited, encode_limited};
use crate::error::{PeerError, Result, invalid, limit};
use crate::identity::{
    DeviceCapabilities, DeviceCertificate, DeviceId, DeviceRevocationBody, DeviceSigner,
    MemoryDeviceTrustStore, PrincipalRootSigner, ProtocolRange, SignedDeviceRevocation,
};

const LOCAL_IDENTITY_MAGIC: [u8; 8] = *b"FGPIDST1";
const LOCAL_IDENTITY_HASH_DOMAIN: &str = "forge-peer/1 local identity file";
const LOCAL_IDENTITY_VERSION: u16 = 1;
const MAX_LOCAL_IDENTITY_BODY_BYTES: usize = 256 * 1024;
const MAX_REVOCATIONS: usize = 1_024;
const LENGTH_PREFIX_BYTES: usize = 4;
const CHECKSUM_BYTES: usize = 32;

pub struct LocalIdentityState {
    root: PrincipalRootSigner,
    device: DeviceSigner,
    certificate: DeviceCertificate,
    revocations: Vec<SignedDeviceRevocation>,
}

#[derive(Encode, Decode)]
struct LocalIdentityBody {
    version: u16,
    root_secret: [u8; 32],
    device_id: DeviceId,
    device_signing_secret: [u8; 32],
    device_key_agreement_secret: [u8; 32],
    certificate: DeviceCertificate,
    revocations: Vec<SignedDeviceRevocation>,
}

impl Drop for LocalIdentityBody {
    fn drop(&mut self) {
        self.root_secret.zeroize();
        self.device_signing_secret.zeroize();
        self.device_key_agreement_secret.zeroize();
    }
}

impl Validate for LocalIdentityBody {
    fn validate(&self) -> Result<()> {
        if self.version != LOCAL_IDENTITY_VERSION {
            return Err(PeerError::Version(format!(
                "unsupported local identity state version {}",
                self.version
            )));
        }
        self.device_id.validate()?;
        if self.root_secret == [0; 32]
            || self.device_signing_secret == [0; 32]
            || self.device_key_agreement_secret == [0; 32]
        {
            return Err(invalid("local identity state contains an all-zero secret"));
        }
        if self.revocations.len() > MAX_REVOCATIONS {
            return Err(limit(
                "local identity revocation history exceeds 1024 entries",
            ));
        }
        self.certificate.validate()?;
        for revocation in &self.revocations {
            revocation.validate()?;
        }
        Ok(())
    }
}

impl LocalIdentityState {
    pub(crate) fn derive_storage_key(&self, context: &str) -> Result<Zeroizing<[u8; 32]>> {
        if context.is_empty() || context.len() > 128 || context.contains('\0') {
            return Err(invalid("storage key context is empty or invalid"));
        }
        let root_secret = self.root.secret_bytes();
        let mut material = Zeroizing::new(Vec::with_capacity(root_secret.len() + context.len()));
        material.extend_from_slice(&root_secret[..]);
        material.extend_from_slice(context.as_bytes());
        Ok(Zeroizing::new(blake3::derive_key(
            "forge-peer/1 local storage key",
            &material,
        )))
    }

    pub(crate) fn ensure_operational(&self, now: u64) -> Result<()> {
        self.certificate.verify(now)?;
        if current_revocation_state(&self.revocations).is_some_and(|revocation| {
            revocation.permanent
                || self.certificate.body.serial <= revocation.revoked_through_serial
        }) {
            return Err(PeerError::Authorization(
                "current local device certificate is root-revoked".into(),
            ));
        }
        Ok(())
    }

    pub fn generate(now: u64, valid_for_seconds: u64) -> Result<Self> {
        let not_after = now
            .checked_add(valid_for_seconds)
            .ok_or_else(|| invalid("identity certificate expiry overflows u64"))?;
        let root = PrincipalRootSigner::generate();
        let device_id = loop {
            let candidate = DeviceId::random();
            if candidate.validate().is_ok() {
                break candidate;
            }
        };
        let device = DeviceSigner::generate(device_id);
        let certificate = DeviceCertificate::issue(
            &root,
            &device,
            DeviceCapabilities::all_known(),
            ProtocolRange::CURRENT,
            1,
            now,
            not_after,
        )?;
        Ok(Self {
            root,
            device,
            certificate,
            revocations: Vec::new(),
        })
    }

    pub fn decode_secret(bytes: &[u8]) -> Result<Self> {
        let minimum_length = LOCAL_IDENTITY_MAGIC.len() + LENGTH_PREFIX_BYTES + CHECKSUM_BYTES;
        if bytes.len() < minimum_length
            || bytes.len() > MAX_LOCAL_IDENTITY_BODY_BYTES + minimum_length
        {
            return Err(limit(
                "local identity file is empty, truncated, or oversized",
            ));
        }
        if bytes.get(..LOCAL_IDENTITY_MAGIC.len()) != Some(LOCAL_IDENTITY_MAGIC.as_slice()) {
            return Err(invalid("local identity file magic is invalid"));
        }
        let length_start = LOCAL_IDENTITY_MAGIC.len();
        let length_end = length_start + LENGTH_PREFIX_BYTES;
        let encoded_length = u32::from_be_bytes(
            bytes
                .get(length_start..length_end)
                .ok_or_else(|| invalid("local identity length prefix is truncated"))?
                .try_into()
                .map_err(|_| invalid("local identity length prefix is invalid"))?,
        );
        let body_length = usize::try_from(encoded_length)
            .map_err(|_| limit("local identity length does not fit memory size"))?;
        if body_length == 0 || body_length > MAX_LOCAL_IDENTITY_BODY_BYTES {
            return Err(limit("local identity body length is invalid"));
        }
        let body_end = length_end
            .checked_add(body_length)
            .ok_or_else(|| limit("local identity body length overflows"))?;
        let expected_total = body_end
            .checked_add(CHECKSUM_BYTES)
            .ok_or_else(|| limit("local identity file length overflows"))?;
        if bytes.len() != expected_total {
            return Err(invalid(
                "local identity file length does not match its prefix",
            ));
        }
        let body_bytes = bytes
            .get(length_end..body_end)
            .ok_or_else(|| invalid("local identity body is truncated"))?;
        let supplied_checksum = bytes
            .get(body_end..expected_total)
            .ok_or_else(|| invalid("local identity checksum is truncated"))?;
        let expected_checksum = local_identity_checksum(body_bytes);
        if expected_checksum
            .as_slice()
            .ct_eq(supplied_checksum)
            .unwrap_u8()
            != 1
        {
            return Err(PeerError::Authentication(
                "local identity file checksum does not match".into(),
            ));
        }
        let body: LocalIdentityBody =
            decode_limited::<MAX_LOCAL_IDENTITY_BODY_BYTES, _>(body_bytes)?;
        Self::from_body(&body)
    }

    pub fn encode_secret(&self) -> Result<Zeroizing<Vec<u8>>> {
        self.validate_consistency()?;
        let root_secret = self.root.secret_bytes();
        let signing_secret = self.device.signing_secret_bytes();
        let agreement_secret = self.device.key_agreement_secret_bytes();
        let body = LocalIdentityBody {
            version: LOCAL_IDENTITY_VERSION,
            root_secret: *root_secret,
            device_id: self.device.device_id,
            device_signing_secret: *signing_secret,
            device_key_agreement_secret: *agreement_secret,
            certificate: self.certificate.clone(),
            revocations: self.revocations.clone(),
        };
        let encoded_body =
            Zeroizing::new(encode_limited::<MAX_LOCAL_IDENTITY_BODY_BYTES, _>(&body)?);
        let body_length = u32::try_from(encoded_body.len())
            .map_err(|_| limit("local identity body length does not fit u32"))?;
        let checksum = local_identity_checksum(&encoded_body);
        let mut encoded = Zeroizing::new(Vec::with_capacity(
            LOCAL_IDENTITY_MAGIC.len() + LENGTH_PREFIX_BYTES + encoded_body.len() + CHECKSUM_BYTES,
        ));
        encoded.extend_from_slice(&LOCAL_IDENTITY_MAGIC);
        encoded.extend_from_slice(&body_length.to_be_bytes());
        encoded.extend_from_slice(&encoded_body);
        encoded.extend_from_slice(&checksum);
        Ok(encoded)
    }

    pub fn rotate(self, now: u64, valid_for_seconds: u64) -> Result<Self> {
        let revoked = current_revocation_state(&self.revocations);
        if revoked.is_some_and(|state| state.permanent) {
            return Err(PeerError::Authorization(
                "permanently revoked device identity cannot rotate".into(),
            ));
        }
        let next_serial = self
            .certificate
            .body
            .serial
            .checked_add(1)
            .ok_or_else(|| PeerError::StateConflict("device serial overflow".into()))?;
        if revoked.is_some_and(|state| next_serial <= state.revoked_through_serial) {
            return Err(PeerError::Authorization(
                "next device serial is still covered by local revocation history".into(),
            ));
        }
        let not_after = now
            .checked_add(valid_for_seconds)
            .ok_or_else(|| invalid("identity certificate expiry overflows u64"))?;
        let replacement = DeviceSigner::generate(self.device.device_id);
        let certificate = DeviceCertificate::rotate(
            &self.root,
            &self.certificate,
            &replacement,
            self.certificate.body.capabilities,
            self.certificate.body.protocol_range,
            now,
            not_after,
        )?;
        Ok(Self {
            root: self.root,
            device: replacement,
            certificate,
            revocations: self.revocations,
        })
    }

    pub fn revoke_current(
        &mut self,
        revoked_at: u64,
        permanent: bool,
    ) -> Result<SignedDeviceRevocation> {
        if let Some(last) = self.revocations.last()
            && last.body.revoked_through_serial >= self.certificate.body.serial
            && (!permanent || last.body.permanent)
        {
            return Ok(last.clone());
        }
        let (sequence, previous_revocation_hash) = match self.revocations.last() {
            Some(previous) => (
                previous.body.sequence.checked_add(1).ok_or_else(|| {
                    PeerError::StateConflict("revocation sequence overflow".into())
                })?,
                previous.hash()?,
            ),
            None => (1, [0; 32]),
        };
        if sequence
            > u64::try_from(MAX_REVOCATIONS)
                .map_err(|_| limit("revocation limit does not fit u64"))?
        {
            return Err(limit(
                "local identity revocation history exceeds 1024 entries",
            ));
        }
        if self
            .revocations
            .last()
            .is_some_and(|previous| revoked_at < previous.body.revoked_at)
        {
            return Err(PeerError::Replay(
                "device revocation time rolled backward".into(),
            ));
        }
        let revocation = SignedDeviceRevocation::issue(
            &self.root,
            DeviceRevocationBody {
                revocation_version: 1,
                principal_id: self.certificate.body.principal_id,
                device_id: self.certificate.body.device_id,
                revoked_through_serial: self.certificate.body.serial,
                sequence,
                previous_revocation_hash,
                revoked_at,
                permanent,
            },
        )?;
        self.revocations.push(revocation.clone());
        Ok(revocation)
    }

    pub fn certificate(&self) -> &DeviceCertificate {
        &self.certificate
    }

    pub fn revocations(&self) -> &[SignedDeviceRevocation] {
        &self.revocations
    }

    pub fn device_signer(&self) -> &DeviceSigner {
        &self.device
    }

    fn from_body(body: &LocalIdentityBody) -> Result<Self> {
        body.validate()?;
        let state = Self {
            root: PrincipalRootSigner::from_secret_bytes(body.root_secret),
            device: DeviceSigner::from_secret_material(
                body.device_id,
                body.device_signing_secret,
                body.device_key_agreement_secret,
            ),
            certificate: body.certificate.clone(),
            revocations: body.revocations.clone(),
        };
        state.validate_consistency()?;
        Ok(state)
    }

    fn validate_consistency(&self) -> Result<()> {
        self.certificate.verify(self.certificate.body.not_before)?;
        if self.certificate.root_public_key != self.root.verifying_key_bytes()
            || self.certificate.body.principal_id != self.root.principal_id()
            || self.certificate.body.device_id != self.device.device_id
            || self.certificate.body.device_public_key != self.device.verifying_key_bytes()
            || self.certificate.body.device_key_agreement_public_key
                != self.device.key_agreement_public_key_bytes()
        {
            return Err(PeerError::Authentication(
                "local identity secrets do not match the certified identity".into(),
            ));
        }
        let trust = MemoryDeviceTrustStore::default();
        trust.trust_principal(self.root.verifying_key_bytes())?;
        trust.admit_certificate(&self.certificate, self.certificate.body.not_before)?;
        let mut previous_time = 0;
        for revocation in &self.revocations {
            if revocation.body.device_id != self.certificate.body.device_id
                || revocation.body.revoked_at < previous_time
            {
                return Err(PeerError::Replay(
                    "local identity revocation history changed device or rolled back time".into(),
                ));
            }
            trust.apply_revocation(revocation, revocation.body.revoked_at)?;
            previous_time = revocation.body.revoked_at;
        }
        Ok(())
    }
}

#[derive(Clone, Copy)]
struct CurrentRevocationState {
    revoked_through_serial: u64,
    permanent: bool,
}

fn current_revocation_state(
    revocations: &[SignedDeviceRevocation],
) -> Option<CurrentRevocationState> {
    revocations.last().map(|revocation| CurrentRevocationState {
        revoked_through_serial: revocation.body.revoked_through_serial,
        permanent: revocation.body.permanent,
    })
}

fn local_identity_checksum(body: &[u8]) -> [u8; 32] {
    let mut hasher = blake3::Hasher::new_derive_key(LOCAL_IDENTITY_HASH_DOMAIN);
    hasher.update(body);
    *hasher.finalize().as_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identity_state_round_trips_rotates_and_revokes_idempotently() -> Result<()> {
        let now = 10_000;
        let initial = LocalIdentityState::generate(now, 3_600)?;
        let principal = initial.certificate().body.principal_id;
        let device = initial.certificate().body.device_id;
        let encoded = initial.encode_secret()?;
        let restored = LocalIdentityState::decode_secret(&encoded)?;
        assert_eq!(restored.certificate().body.principal_id, principal);
        assert_eq!(restored.certificate().body.device_id, device);

        let mut rotated = restored.rotate(now + 60, 3_600)?;
        assert_eq!(rotated.certificate().body.serial, 2);
        let first = rotated.revoke_current(now + 61, false)?;
        let repeated = rotated.revoke_current(now + 62, false)?;
        assert_eq!(first, repeated);
        assert_eq!(rotated.revocations().len(), 1);
        let permanent = rotated.revoke_current(now + 63, true)?;
        assert!(permanent.body.permanent);
        assert_eq!(rotated.revocations().len(), 2);
        assert!(rotated.rotate(now + 64, 3_600).is_err());
        Ok(())
    }

    #[test]
    fn identity_state_rejects_corruption_secret_substitution_and_trailing_data() -> Result<()> {
        let now = 10_000;
        let state = LocalIdentityState::generate(now, 3_600)?;
        let encoded = state.encode_secret()?;

        let mut corrupt = encoded.to_vec();
        let middle = corrupt.len() / 2;
        corrupt[middle] ^= 0x80;
        assert!(LocalIdentityState::decode_secret(&corrupt).is_err());

        let other = LocalIdentityState::generate(now, 3_600)?;
        let other_encoded = other.encode_secret()?;
        let mut substituted = encoded.to_vec();
        let secret_offset = LOCAL_IDENTITY_MAGIC.len() + LENGTH_PREFIX_BYTES + 2;
        substituted[secret_offset..secret_offset + 32]
            .copy_from_slice(&other_encoded[secret_offset..secret_offset + 32]);
        let body_end = substituted.len() - CHECKSUM_BYTES;
        let checksum = local_identity_checksum(
            &substituted[LOCAL_IDENTITY_MAGIC.len() + LENGTH_PREFIX_BYTES..body_end],
        );
        substituted[body_end..].copy_from_slice(&checksum);
        assert!(LocalIdentityState::decode_secret(&substituted).is_err());

        let mut trailing = encoded.to_vec();
        trailing.push(0);
        assert!(LocalIdentityState::decode_secret(&trailing).is_err());
        Ok(())
    }

    #[test]
    fn operational_gate_rejects_revoked_or_expired_current_certificate() -> Result<()> {
        let now = 10_000;
        let mut state = LocalIdentityState::generate(now, 3_600)?;
        state.ensure_operational(now + 1)?;
        state.revoke_current(now + 2, false)?;
        assert!(state.ensure_operational(now + 2).is_err());

        let rotated = state.rotate(now + 3, 3_600)?;
        rotated.ensure_operational(now + 4)?;
        assert!(rotated.ensure_operational(now + 4_000).is_err());
        Ok(())
    }
}
