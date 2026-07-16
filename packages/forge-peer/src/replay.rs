use std::collections::HashMap;
use std::sync::Mutex;

use bincode::{Decode, Encode};

use crate::codec::Validate;
use crate::envelope::{ChannelId, EnvelopeMessageId, SignedEnvelope};
use crate::error::{PeerError, Result};
use crate::grant::PeerShareGrantVersion;
use crate::identity::{
    DeviceCertificate, DeviceId, DeviceTrustResolver, ProtocolRange, ProtocolVersion,
};
use crate::message::CapabilityUpdate;

const REPLAY_WINDOW_BITS: u64 = 64;
const MAX_FORWARD_SEQUENCE_GAP: u64 = 1_024;
const RECENT_MESSAGE_IDS: usize = 128;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct ReplayKey {
    pub channel_id: ChannelId,
    pub sender_device_id: DeviceId,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Encode, Decode)]
pub struct ReplayState {
    pub revision: u64,
    pub highest_sequence: u64,
    pub received_bitmap: u64,
    pub highest_mls_epoch: u64,
    pub recent_message_ids: Vec<EnvelopeMessageId>,
}

impl ReplayState {
    pub(crate) fn admit(
        &mut self,
        sequence: u64,
        message_id: EnvelopeMessageId,
        epoch: u64,
    ) -> Result<()> {
        if sequence == 0 {
            return Err(PeerError::Replay("sequence zero is invalid".into()));
        }
        if epoch < self.highest_mls_epoch {
            return Err(PeerError::Replay(format!(
                "old MLS epoch {epoch} is below {}",
                self.highest_mls_epoch
            )));
        }
        if self.recent_message_ids.contains(&message_id) {
            return Err(PeerError::Replay("duplicate envelope message id".into()));
        }

        if self.highest_sequence == 0 {
            if sequence > MAX_FORWARD_SEQUENCE_GAP {
                return Err(PeerError::Replay(
                    "initial sequence is unreasonably high".into(),
                ));
            }
            self.highest_sequence = sequence;
            self.received_bitmap = 1;
        } else if sequence > self.highest_sequence {
            let gap = sequence - self.highest_sequence;
            if gap > MAX_FORWARD_SEQUENCE_GAP {
                return Err(PeerError::Replay(format!(
                    "sequence gap {gap} exceeds {MAX_FORWARD_SEQUENCE_GAP}"
                )));
            }
            self.received_bitmap = if gap >= REPLAY_WINDOW_BITS {
                1
            } else {
                (self.received_bitmap << gap) | 1
            };
            self.highest_sequence = sequence;
        } else {
            let offset = self.highest_sequence - sequence;
            if offset >= REPLAY_WINDOW_BITS {
                return Err(PeerError::Replay(
                    "sequence is outside the replay window".into(),
                ));
            }
            let bit = 1_u64 << offset;
            if self.received_bitmap & bit != 0 {
                return Err(PeerError::Replay("sequence was already received".into()));
            }
            self.received_bitmap |= bit;
        }

        self.highest_mls_epoch = self.highest_mls_epoch.max(epoch);
        self.recent_message_ids.push(message_id);
        if self.recent_message_ids.len() > RECENT_MESSAGE_IDS {
            self.recent_message_ids.remove(0);
        }
        Ok(())
    }
}

impl Validate for ReplayState {
    fn validate(&self) -> Result<()> {
        if (self.highest_sequence == 0 && self.received_bitmap != 0)
            || (self.highest_sequence != 0 && self.received_bitmap & 1 == 0)
        {
            return Err(PeerError::Replay(
                "replay bitmap is inconsistent with its highest sequence".into(),
            ));
        }
        if self.recent_message_ids.len() > RECENT_MESSAGE_IDS {
            return Err(PeerError::LimitExceeded(
                "replay message-id history exceeds 128 entries".into(),
            ));
        }
        let mut unique = std::collections::HashSet::with_capacity(self.recent_message_ids.len());
        for message_id in &self.recent_message_ids {
            message_id.validate()?;
            if !unique.insert(*message_id) {
                return Err(PeerError::Replay(
                    "replay state contains duplicate message ids".into(),
                ));
            }
        }
        Ok(())
    }
}

pub trait ReplayStateStore: Send + Sync {
    fn load(&self, key: ReplayKey) -> Result<ReplayState>;
    fn compare_and_swap(
        &self,
        key: ReplayKey,
        expected_revision: u64,
        next: ReplayState,
    ) -> Result<bool>;
}

#[derive(Debug, Default)]
pub struct MemoryReplayStateStore {
    states: Mutex<HashMap<ReplayKey, ReplayState>>,
}

impl ReplayStateStore for MemoryReplayStateStore {
    fn load(&self, key: ReplayKey) -> Result<ReplayState> {
        Ok(self.lock()?.get(&key).cloned().unwrap_or_default())
    }

    fn compare_and_swap(
        &self,
        key: ReplayKey,
        expected_revision: u64,
        mut next: ReplayState,
    ) -> Result<bool> {
        next.validate()?;
        if next.revision != expected_revision {
            return Err(PeerError::StateConflict(
                "replay compare-and-swap input revision is inconsistent".into(),
            ));
        }
        let mut states = self.lock()?;
        let current_revision = states.get(&key).map_or(0, |state| state.revision);
        if current_revision != expected_revision {
            return Ok(false);
        }
        next.revision = expected_revision
            .checked_add(1)
            .ok_or_else(|| PeerError::StateConflict("replay revision overflow".into()))?;
        states.insert(key, next);
        Ok(true)
    }
}

impl MemoryReplayStateStore {
    fn lock(&self) -> Result<std::sync::MutexGuard<'_, HashMap<ReplayKey, ReplayState>>> {
        self.states
            .lock()
            .map_err(|_| PeerError::StateConflict("replay store lock poisoned".into()))
    }
}

pub struct InboundGuard<S> {
    store: S,
    negotiated_protocol: ProtocolVersion,
}

impl<S: ReplayStateStore> InboundGuard<S> {
    pub const fn new(store: S, negotiated_protocol: ProtocolVersion) -> Self {
        Self {
            store,
            negotiated_protocol,
        }
    }

    pub fn admit(
        &self,
        envelope: &SignedEnvelope,
        certificate: &DeviceCertificate,
        trust: &impl DeviceTrustResolver,
        now: u64,
    ) -> Result<()> {
        envelope.verify_trusted(certificate, trust, now)?;
        if envelope.body.protocol != self.negotiated_protocol {
            return Err(PeerError::Version(format!(
                "envelope protocol {:?} does not match pinned {:?}",
                envelope.body.protocol, self.negotiated_protocol
            )));
        }
        let key = ReplayKey {
            channel_id: envelope.body.channel_id,
            sender_device_id: envelope.body.sender_device_id,
        };
        for _ in 0..3 {
            let current = self.store.load(key)?;
            current.validate()?;
            let expected_revision = current.revision;
            let mut next = current;
            next.admit(
                envelope.body.sequence,
                envelope.body.message_id,
                envelope.body.mls_group_epoch,
            )?;
            if self.store.compare_and_swap(key, expected_revision, next)? {
                return Ok(());
            }
        }
        Err(PeerError::StateConflict(
            "replay state changed concurrently too many times".into(),
        ))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GrantChainDecision {
    Accepted,
    PendingConflict,
}

#[derive(Debug, Default)]
pub struct GrantVersionGuard {
    states: Mutex<HashMap<String, (u64, [u8; 32])>>,
}

impl GrantVersionGuard {
    pub fn admit(&self, grant: &PeerShareGrantVersion) -> Result<GrantChainDecision> {
        grant.validate()?;
        let hash = grant.version_hash()?;
        let mut states = self
            .states
            .lock()
            .map_err(|_| PeerError::StateConflict("grant guard lock poisoned".into()))?;
        match states.get(&grant.id).copied() {
            None if grant.sequence == 1 && grant.previous_version_hash.is_none() => {
                states.insert(grant.id.clone(), (1, hash));
                Ok(GrantChainDecision::Accepted)
            }
            Some((sequence, previous_hash)) if sequence.checked_add(1) == Some(grant.sequence) => {
                let expected_hash = hex::encode(previous_hash);
                if grant.previous_version_hash.as_deref() != Some(expected_hash.as_str()) {
                    return Ok(GrantChainDecision::PendingConflict);
                }
                states.insert(grant.id.clone(), (grant.sequence, hash));
                Ok(GrantChainDecision::Accepted)
            }
            Some((sequence, existing_hash)) if grant.sequence == sequence => {
                if hash == existing_hash {
                    Err(PeerError::Replay("grant version replayed".into()))
                } else {
                    Ok(GrantChainDecision::PendingConflict)
                }
            }
            Some((sequence, _)) if grant.sequence < sequence => Err(PeerError::Replay(
                "grant sequence rollback or stale-device replay".into(),
            )),
            _ => Err(PeerError::Replay(
                "grant version skipped a required sequence".into(),
            )),
        }
    }
}

#[derive(Debug, Clone)]
pub struct DowngradeGuard {
    selected: ProtocolVersion,
    remote_range: ProtocolRange,
    capability_sequence: u64,
    capability_hash: [u8; 32],
}

impl DowngradeGuard {
    pub fn new(selected: ProtocolVersion, remote_range: ProtocolRange) -> Result<Self> {
        remote_range.validate()?;
        if selected < remote_range.minimum || selected > remote_range.maximum {
            return Err(PeerError::Version(
                "selected protocol is outside the remote certified range".into(),
            ));
        }
        Ok(Self {
            selected,
            remote_range,
            capability_sequence: 0,
            capability_hash: [0; 32],
        })
    }

    pub fn apply(&mut self, update: &CapabilityUpdate) -> Result<()> {
        update.validate()?;
        if self.capability_sequence.checked_add(1) != Some(update.sequence) {
            return Err(PeerError::Replay(
                "capability update sequence is not contiguous".into(),
            ));
        }
        if update.previous_update_hash != self.capability_hash {
            return Err(PeerError::Replay(
                "capability update hash chain does not match".into(),
            ));
        }
        if self.selected < update.protocol_range.minimum
            || self.selected > update.protocol_range.maximum
        {
            return Err(PeerError::Version(
                "capability update attempts to remove the pinned protocol".into(),
            ));
        }
        let bytes = crate::codec::encode_limited::<{ 8 * 1024 }, _>(update)?;
        self.capability_hash = *blake3::hash(&bytes).as_bytes();
        self.capability_sequence = update.sequence;
        self.remote_range = update.protocol_range;
        Ok(())
    }

    pub const fn selected(&self) -> ProtocolVersion {
        self.selected
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replay_window_accepts_bounded_reordering_once() -> Result<()> {
        let mut state = ReplayState::default();
        state.admit(2, EnvelopeMessageId([2; 16]), 4)?;
        state.admit(1, EnvelopeMessageId([1; 16]), 4)?;
        assert!(state.admit(1, EnvelopeMessageId([3; 16]), 4).is_err());
        assert!(state.admit(3, EnvelopeMessageId([2; 16]), 4).is_err());
        assert!(state.admit(3, EnvelopeMessageId([3; 16]), 3).is_err());
        Ok(())
    }

    #[test]
    fn downgrade_guard_rejects_loss_of_pinned_version() -> Result<()> {
        let mut guard = DowngradeGuard::new(
            ProtocolVersion { major: 1, minor: 1 },
            ProtocolRange {
                minimum: ProtocolVersion { major: 1, minor: 0 },
                maximum: ProtocolVersion { major: 1, minor: 2 },
            },
        )?;
        let update = CapabilityUpdate {
            device_id: DeviceId::random(),
            protocol_range: ProtocolRange {
                minimum: ProtocolVersion { major: 1, minor: 0 },
                maximum: ProtocolVersion { major: 1, minor: 0 },
            },
            capabilities: crate::identity::DeviceCapabilities::new(0)?,
            sequence: 1,
            previous_update_hash: [0; 32],
        };
        assert!(guard.apply(&update).is_err());
        Ok(())
    }

    #[test]
    fn grant_chain_accepts_exact_hash_and_marks_forks_as_pending_conflict() -> Result<()> {
        let guard = GrantVersionGuard::default();
        let vector = include_bytes!("../tests/vectors/grant-canonical-v1.json");
        let value: serde_json::Value = serde_json::from_slice(vector)
            .map_err(|error| PeerError::InvalidData(error.to_string()))?;
        let grant_json = serde_json::to_vec(&value["grant"])
            .map_err(|error| PeerError::InvalidData(error.to_string()))?;
        let mut first = PeerShareGrantVersion::from_json(&grant_json)?;
        first.sequence = 1;
        first.previous_version_hash = None;
        first.status = crate::grant::GrantStatus::Proposed;
        first.signatures.clear();
        assert_eq!(guard.admit(&first)?, GrantChainDecision::Accepted);

        let mut next = first.clone();
        next.sequence = 2;
        next.previous_version_hash = Some(first.version_hash_hex()?);
        next.label = "next exact version".into();
        assert_eq!(guard.admit(&next)?, GrantChainDecision::Accepted);

        let mut fork = next;
        fork.sequence = 3;
        fork.previous_version_hash = Some("f".repeat(64));
        assert_eq!(guard.admit(&fork)?, GrantChainDecision::PendingConflict);
        Ok(())
    }

    #[test]
    fn zero_message_id_is_invalid() {
        assert!(EnvelopeMessageId([0; 16]).validate().is_err());
    }

    #[test]
    fn malformed_replay_state_and_sequence_overflow_fail_closed() -> Result<()> {
        let malformed = ReplayState {
            highest_sequence: 1,
            received_bitmap: 0,
            ..ReplayState::default()
        };
        assert!(malformed.validate().is_err());

        let mut downgrade = DowngradeGuard::new(ProtocolVersion::CURRENT, ProtocolRange::CURRENT)?;
        downgrade.capability_sequence = u64::MAX;
        let update = CapabilityUpdate {
            device_id: DeviceId::random(),
            protocol_range: ProtocolRange::CURRENT,
            capabilities: crate::identity::DeviceCapabilities::new(0)?,
            sequence: 0,
            previous_update_hash: [0; 32],
        };
        assert!(downgrade.apply(&update).is_err());
        Ok(())
    }
}
