use std::collections::HashMap;
use std::sync::Mutex;

use subtle::ConstantTimeEq;

use crate::codec::Validate;
use crate::error::{PeerError, Result, invalid};
use crate::identity::DeviceId;
use crate::pairing::InviteId;

const MAX_INVITE_ATTEMPTS: u8 = 10;
const MAX_INVITE_LIFETIME_SECONDS: u64 = 15 * 60;
const BOOTSTRAP_COMMITMENT_CONTEXT: &str = "forge-peer/1 invite bootstrap proof";

pub fn bootstrap_proof_commitment(proof: &[u8; 32]) -> Result<[u8; 32]> {
    if proof == &[0; 32] {
        return Err(invalid("invite bootstrap proof is all zero"));
    }
    let mut hasher = blake3::Hasher::new_derive_key(BOOTSTRAP_COMMITMENT_CONTEXT);
    hasher.update(proof);
    Ok(*hasher.finalize().as_bytes())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingInvite {
    pub invite_id: InviteId,
    pub bootstrap_proof_commitment: [u8; 32],
    pub created_at: u64,
    pub expires_at: u64,
    pub created_monotonic: u64,
    pub expires_monotonic: u64,
    pub max_attempts: u8,
}

impl PendingInvite {
    pub fn validate(&self) -> Result<()> {
        self.invite_id.validate()?;
        if self.bootstrap_proof_commitment == [0; 32] {
            return Err(invalid("invite proof commitment is all zero"));
        }
        if self.created_at >= self.expires_at {
            return Err(invalid("invite wall-clock lifetime is empty"));
        }
        if self.expires_at - self.created_at > MAX_INVITE_LIFETIME_SECONDS
            || self.expires_monotonic - self.created_monotonic > MAX_INVITE_LIFETIME_SECONDS
        {
            return Err(invalid("invite lifetime exceeds fifteen minutes"));
        }
        if self.created_monotonic >= self.expires_monotonic {
            return Err(invalid("invite monotonic lifetime is empty"));
        }
        if self.max_attempts == 0 || self.max_attempts > MAX_INVITE_ATTEMPTS {
            return Err(invalid(format!(
                "invite max attempts must be between 1 and {MAX_INVITE_ATTEMPTS}"
            )));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InviteClaimAttempt {
    pub invite_id: InviteId,
    pub claimant_device_id: DeviceId,
    pub bootstrap_proof: [u8; 32],
    pub transcript_hash: [u8; 32],
    pub wall_time: u64,
    pub monotonic_time: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InviteClaimLease {
    pub invite_id: InviteId,
    pub claim_id: [u8; 16],
    pub claimant_device_id: DeviceId,
    pub transcript_hash: [u8; 32],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InviteStatus {
    Pending,
    Claimed,
    Consumed,
    Expired,
    Locked,
    Revoked,
}

pub trait AtomicInviteStore: Send + Sync {
    fn insert(&self, invite: PendingInvite) -> Result<()>;
    fn claim(&self, attempt: InviteClaimAttempt) -> Result<InviteClaimLease>;
    fn consume(
        &self,
        invite_id: InviteId,
        claim_id: [u8; 16],
        transcript_hash: [u8; 32],
        wall_time: u64,
        monotonic_time: u64,
    ) -> Result<()>;
    fn revoke(&self, invite_id: InviteId) -> Result<()>;
    fn status(&self, invite_id: InviteId) -> Result<Option<InviteStatus>>;
}

#[derive(Debug)]
enum StoredState {
    Pending {
        invite: PendingInvite,
        attempts: u8,
        last_wall_time: u64,
        last_monotonic_time: u64,
    },
    Claimed {
        invite: PendingInvite,
        lease: InviteClaimLease,
        last_wall_time: u64,
        last_monotonic_time: u64,
    },
    Consumed,
    Expired,
    Locked,
    Revoked,
}

impl StoredState {
    const fn status(&self) -> InviteStatus {
        match self {
            Self::Pending { .. } => InviteStatus::Pending,
            Self::Claimed { .. } => InviteStatus::Claimed,
            Self::Consumed => InviteStatus::Consumed,
            Self::Expired => InviteStatus::Expired,
            Self::Locked => InviteStatus::Locked,
            Self::Revoked => InviteStatus::Revoked,
        }
    }
}

#[derive(Debug, Default)]
pub struct MemoryAtomicInviteStore {
    states: Mutex<HashMap<InviteId, StoredState>>,
}

impl AtomicInviteStore for MemoryAtomicInviteStore {
    fn insert(&self, invite: PendingInvite) -> Result<()> {
        invite.validate()?;
        let mut states = self.lock()?;
        if states.contains_key(&invite.invite_id) {
            return Err(PeerError::InviteConflict("invite id already exists".into()));
        }
        states.insert(
            invite.invite_id,
            StoredState::Pending {
                last_wall_time: invite.created_at,
                last_monotonic_time: invite.created_monotonic,
                invite,
                attempts: 0,
            },
        );
        Ok(())
    }

    fn claim(&self, attempt: InviteClaimAttempt) -> Result<InviteClaimLease> {
        validate_claim_attempt(&attempt)?;
        let mut states = self.lock()?;
        let state = states
            .get_mut(&attempt.invite_id)
            .ok_or_else(|| PeerError::InviteConflict("unknown invite".into()))?;
        let replacement = match state {
            StoredState::Pending {
                invite,
                attempts,
                last_wall_time,
                last_monotonic_time,
            } => {
                validate_clock_progress(
                    attempt.wall_time,
                    attempt.monotonic_time,
                    *last_wall_time,
                    *last_monotonic_time,
                )?;
                *last_wall_time = attempt.wall_time;
                *last_monotonic_time = attempt.monotonic_time;
                if attempt.wall_time >= invite.expires_at
                    || attempt.monotonic_time >= invite.expires_monotonic
                {
                    Some(StoredState::Expired)
                } else if invite
                    .bootstrap_proof_commitment
                    .ct_eq(&bootstrap_proof_commitment(&attempt.bootstrap_proof)?)
                    .unwrap_u8()
                    != 1
                {
                    *attempts = attempts.saturating_add(1);
                    if *attempts >= invite.max_attempts {
                        Some(StoredState::Locked)
                    } else {
                        return Err(PeerError::Authentication(
                            "invite bootstrap proof did not verify".into(),
                        ));
                    }
                } else {
                    let claim_id = loop {
                        let candidate = rand::random();
                        if candidate != [0; 16] {
                            break candidate;
                        }
                    };
                    let lease = InviteClaimLease {
                        invite_id: attempt.invite_id,
                        claim_id,
                        claimant_device_id: attempt.claimant_device_id,
                        transcript_hash: attempt.transcript_hash,
                    };
                    let result = lease.clone();
                    *state = StoredState::Claimed {
                        invite: invite.clone(),
                        lease,
                        last_wall_time: attempt.wall_time,
                        last_monotonic_time: attempt.monotonic_time,
                    };
                    return Ok(result);
                }
            }
            other => {
                return Err(PeerError::InviteConflict(format!(
                    "invite is already {:?}",
                    other.status()
                )));
            }
        };
        if let Some(replacement) = replacement {
            let new_status = replacement.status();
            *state = replacement;
            return Err(PeerError::InviteConflict(format!(
                "invite became {new_status:?}"
            )));
        }
        Err(PeerError::InviteConflict(
            "invite claim failed without a state transition".into(),
        ))
    }

    fn consume(
        &self,
        invite_id: InviteId,
        claim_id: [u8; 16],
        transcript_hash: [u8; 32],
        wall_time: u64,
        monotonic_time: u64,
    ) -> Result<()> {
        if claim_id == [0; 16] || transcript_hash == [0; 32] {
            return Err(invalid("invite consume identifiers cannot be all zero"));
        }
        let mut states = self.lock()?;
        let state = states
            .get_mut(&invite_id)
            .ok_or_else(|| PeerError::InviteConflict("unknown invite".into()))?;
        match state {
            StoredState::Claimed {
                invite,
                lease,
                last_wall_time,
                last_monotonic_time,
            } => {
                validate_clock_progress(
                    wall_time,
                    monotonic_time,
                    *last_wall_time,
                    *last_monotonic_time,
                )?;
                if wall_time >= invite.expires_at || monotonic_time >= invite.expires_monotonic {
                    *state = StoredState::Expired;
                    return Err(PeerError::InviteConflict(
                        "invite expired before transcript consumption".into(),
                    ));
                }
                if lease.claim_id.ct_eq(&claim_id).unwrap_u8() != 1
                    || lease.transcript_hash.ct_eq(&transcript_hash).unwrap_u8() != 1
                {
                    return Err(PeerError::Authentication(
                        "invite claim or transcript commitment did not match".into(),
                    ));
                }
                *state = StoredState::Consumed;
                Ok(())
            }
            other => Err(PeerError::InviteConflict(format!(
                "invite cannot be consumed from {:?}",
                other.status()
            ))),
        }
    }

    fn revoke(&self, invite_id: InviteId) -> Result<()> {
        let mut states = self.lock()?;
        let state = states
            .get_mut(&invite_id)
            .ok_or_else(|| PeerError::InviteConflict("unknown invite".into()))?;
        if let StoredState::Consumed = state {
            Err(PeerError::InviteConflict(
                "consumed invite cannot be retroactively revoked".into(),
            ))
        } else {
            *state = StoredState::Revoked;
            Ok(())
        }
    }

    fn status(&self, invite_id: InviteId) -> Result<Option<InviteStatus>> {
        Ok(self.lock()?.get(&invite_id).map(StoredState::status))
    }
}

impl MemoryAtomicInviteStore {
    fn lock(&self) -> Result<std::sync::MutexGuard<'_, HashMap<InviteId, StoredState>>> {
        self.states
            .lock()
            .map_err(|_| PeerError::StateConflict("invite store lock poisoned".into()))
    }
}

fn validate_claim_attempt(attempt: &InviteClaimAttempt) -> Result<()> {
    attempt.invite_id.validate()?;
    attempt.claimant_device_id.validate()?;
    if attempt.bootstrap_proof == [0; 32] {
        return Err(invalid("invite bootstrap proof is all zero"));
    }
    if attempt.transcript_hash == [0; 32] {
        return Err(invalid("invite transcript hash is all zero"));
    }
    Ok(())
}

fn validate_clock_progress(
    wall_time: u64,
    monotonic_time: u64,
    previous_wall_time: u64,
    previous_monotonic_time: u64,
) -> Result<()> {
    if wall_time < previous_wall_time {
        return Err(PeerError::InviteConflict(
            "wall clock moved backwards during invite use".into(),
        ));
    }
    if monotonic_time <= previous_monotonic_time {
        return Err(PeerError::InviteConflict(
            "invite monotonic time did not advance".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Barrier};

    use super::*;

    fn pending() -> PendingInvite {
        PendingInvite {
            invite_id: InviteId::random(),
            bootstrap_proof_commitment: bootstrap_proof_commitment(&[7; 32]).unwrap_or([0; 32]),
            created_at: 1_000,
            expires_at: 1_900,
            created_monotonic: 100,
            expires_monotonic: 200,
            max_attempts: 3,
        }
    }

    #[test]
    fn concurrent_claim_has_exactly_one_winner() -> Result<()> {
        let store = Arc::new(MemoryAtomicInviteStore::default());
        let pending = pending();
        store.insert(pending.clone())?;
        let barrier = Arc::new(Barrier::new(8));
        let mut threads = Vec::new();
        for index in 0_u8..8 {
            let store = Arc::clone(&store);
            let barrier = Arc::clone(&barrier);
            let invite_id = pending.invite_id;
            threads.push(std::thread::spawn(move || {
                barrier.wait();
                store.claim(InviteClaimAttempt {
                    invite_id,
                    claimant_device_id: DeviceId([index.saturating_add(1); 16]),
                    bootstrap_proof: [7; 32],
                    transcript_hash: [8; 32],
                    wall_time: 1_100,
                    monotonic_time: 110,
                })
            }));
        }
        let mut winners = 0;
        for thread in threads {
            if thread
                .join()
                .map_err(|_| PeerError::StateConflict("claim thread panicked".into()))?
                .is_ok()
            {
                winners += 1;
            }
        }
        assert_eq!(winners, 1);
        Ok(())
    }

    #[test]
    fn monotonic_expiry_cannot_be_revived_by_wall_clock() -> Result<()> {
        let store = MemoryAtomicInviteStore::default();
        let pending = pending();
        store.insert(pending.clone())?;
        let result = store.claim(InviteClaimAttempt {
            invite_id: pending.invite_id,
            claimant_device_id: DeviceId::random(),
            bootstrap_proof: [7; 32],
            transcript_hash: [8; 32],
            wall_time: 1_500,
            monotonic_time: 201,
        });
        assert!(result.is_err());
        assert_eq!(
            store.status(pending.invite_id)?,
            Some(InviteStatus::Expired)
        );
        Ok(())
    }

    #[test]
    fn exact_expiry_and_overlong_invites_are_rejected() -> Result<()> {
        let store = MemoryAtomicInviteStore::default();
        let expiring = pending();
        store.insert(expiring.clone())?;
        assert!(
            store
                .claim(InviteClaimAttempt {
                    invite_id: expiring.invite_id,
                    claimant_device_id: DeviceId::random(),
                    bootstrap_proof: [7; 32],
                    transcript_hash: [8; 32],
                    wall_time: expiring.expires_at,
                    monotonic_time: 150,
                })
                .is_err()
        );

        let mut overlong = pending();
        overlong.expires_at = overlong.created_at + MAX_INVITE_LIFETIME_SECONDS + 1;
        assert!(overlong.validate().is_err());
        Ok(())
    }
}
