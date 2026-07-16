use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use bincode::{Decode, Encode};
use chacha20poly1305::aead::{Aead, Payload};
use chacha20poly1305::{KeyInit, XChaCha20Poly1305, XNonce};
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

use crate::codec::{Validate, decode_limited, encode_limited};
use crate::error::{PeerError, Result, invalid, limit};
use crate::secure_fs::{SecureDirectory, SecureFileLock};

const SEALED_STATE_VERSION: u8 = 1;
const XCHACHA_NONCE_BYTES: usize = 24;
const POLY1305_TAG_BYTES: usize = 16;
const MAX_PERSISTED_STATE_BYTES: usize = 16 * 1024 * 1024;
const MAX_SEALED_STATE_BYTES: usize =
    MAX_PERSISTED_STATE_BYTES + 1 + XCHACHA_NONCE_BYTES + POLY1305_TAG_BYTES;
const STATE_AAD_DOMAIN: &[u8] = b"forge-peer/1 persisted OpenMLS state\0";
const DURABLE_MLS_STATE_FILE: &str = "mls-state.bin";
const DURABLE_MLS_LOCK_FILE: &str = "mls-state.lock";
const DURABLE_MLS_VERSION: u16 = 1;
const MAX_DURABLE_MLS_GROUPS: usize = 256;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Encode, Decode)]
pub struct StateId(pub [u8; 32]);

impl StateId {
    pub fn validate(self) -> Result<()> {
        if self.0 == [0; 32] {
            return Err(invalid("persisted state id is all zero"));
        }
        Ok(())
    }
}

#[derive(Zeroize, ZeroizeOnDrop)]
pub struct StateEncryptionKey([u8; 32]);

impl StateEncryptionKey {
    pub fn new(key: [u8; 32]) -> Result<Self> {
        if key == [0; 32] {
            return Err(invalid("state encryption key is all zero"));
        }
        Ok(Self(key))
    }
}

pub trait StateSealer: Send + Sync {
    fn seal(
        &self,
        state_id: StateId,
        checkpoint_counter: u64,
        mls_epoch: u64,
        plaintext: &[u8],
    ) -> Result<Vec<u8>>;

    fn open(
        &self,
        state_id: StateId,
        checkpoint_counter: u64,
        mls_epoch: u64,
        sealed: &[u8],
    ) -> Result<Zeroizing<Vec<u8>>>;
}

pub struct XChaChaStateSealer {
    key: StateEncryptionKey,
}

impl XChaChaStateSealer {
    pub const fn new(key: StateEncryptionKey) -> Self {
        Self { key }
    }

    fn cipher(&self) -> XChaCha20Poly1305 {
        XChaCha20Poly1305::new((&self.key.0).into())
    }
}

impl StateSealer for XChaChaStateSealer {
    fn seal(
        &self,
        state_id: StateId,
        checkpoint_counter: u64,
        mls_epoch: u64,
        plaintext: &[u8],
    ) -> Result<Vec<u8>> {
        validate_plaintext_shape(state_id, checkpoint_counter, plaintext.len())?;
        let nonce_bytes: [u8; XCHACHA_NONCE_BYTES] = rand::random();
        let aad = state_aad(state_id, checkpoint_counter, mls_epoch);
        let ciphertext = self
            .cipher()
            .encrypt(
                XNonce::from_slice(&nonce_bytes),
                Payload {
                    msg: plaintext,
                    aad: &aad,
                },
            )
            .map_err(|_| PeerError::Authentication("sealing MLS state failed".into()))?;
        let mut sealed = Vec::with_capacity(1 + XCHACHA_NONCE_BYTES + ciphertext.len());
        sealed.push(SEALED_STATE_VERSION);
        sealed.extend_from_slice(&nonce_bytes);
        sealed.extend_from_slice(&ciphertext);
        Ok(sealed)
    }

    fn open(
        &self,
        state_id: StateId,
        checkpoint_counter: u64,
        mls_epoch: u64,
        sealed: &[u8],
    ) -> Result<Zeroizing<Vec<u8>>> {
        state_id.validate()?;
        if checkpoint_counter == 0 {
            return Err(invalid("checkpoint counter must be non-zero"));
        }
        if sealed.len() > MAX_SEALED_STATE_BYTES {
            return Err(limit("sealed MLS state exceeds persistence limit"));
        }
        if sealed.len() <= 1 + XCHACHA_NONCE_BYTES || sealed[0] != SEALED_STATE_VERSION {
            return Err(PeerError::Authentication(
                "sealed MLS state has an invalid format".into(),
            ));
        }
        let nonce = XNonce::from_slice(&sealed[1..=XCHACHA_NONCE_BYTES]);
        let aad = state_aad(state_id, checkpoint_counter, mls_epoch);
        let plaintext = self
            .cipher()
            .decrypt(
                nonce,
                Payload {
                    msg: &sealed[1 + XCHACHA_NONCE_BYTES..],
                    aad: &aad,
                },
            )
            .map_err(|_| PeerError::Authentication("opening MLS state failed".into()))?;
        if plaintext.len() > MAX_PERSISTED_STATE_BYTES {
            return Err(limit("opened MLS state exceeds persistence limit"));
        }
        Ok(Zeroizing::new(plaintext))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode)]
pub struct PersistedMlsState {
    pub store_revision: u64,
    pub checkpoint_counter: u64,
    pub mls_epoch: u64,
    pub sealed_blob_hash: [u8; 32],
    pub sealed_blob: Vec<u8>,
}

impl PersistedMlsState {
    pub(crate) fn validate(&self) -> Result<()> {
        if self.store_revision == 0 || self.checkpoint_counter == 0 {
            return Err(invalid("persisted MLS state revisions must be non-zero"));
        }
        if self.sealed_blob.is_empty() || self.sealed_blob.len() > MAX_SEALED_STATE_BYTES {
            return Err(limit("persisted MLS state blob is empty or oversized"));
        }
        if *blake3::hash(&self.sealed_blob).as_bytes() != self.sealed_blob_hash {
            return Err(PeerError::Authentication(
                "persisted MLS state hash does not match its blob".into(),
            ));
        }
        Ok(())
    }
}

pub trait MlsStateStore: Send + Sync {
    fn load(&self, state_id: StateId) -> Result<Option<PersistedMlsState>>;

    fn compare_and_swap(
        &self,
        state_id: StateId,
        expected_store_revision: u64,
        next: PersistedMlsState,
    ) -> Result<bool>;
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode)]
pub struct PendingCheckpoint {
    pub counter: u64,
    pub mls_epoch: u64,
    pub sealed_blob_hash: [u8; 32],
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Encode, Decode)]
pub struct CheckpointRecord {
    pub secure_revision: u64,
    pub committed_counter: u64,
    pub committed_mls_epoch: u64,
    pub committed_blob_hash: [u8; 32],
    pub pending: Option<PendingCheckpoint>,
}

impl CheckpointRecord {
    pub(crate) fn validate(&self) -> Result<()> {
        if self.committed_counter == 0 {
            if self.committed_mls_epoch != 0 || self.committed_blob_hash != [0; 32] {
                return Err(invalid("empty checkpoint has committed state metadata"));
            }
        } else if self.committed_blob_hash == [0; 32] {
            return Err(invalid("committed checkpoint has an all-zero blob hash"));
        }
        if let Some(pending) = &self.pending
            && (pending.counter
                != self.committed_counter.checked_add(1).ok_or_else(|| {
                    PeerError::StateConflict("checkpoint counter overflow".into())
                })?
                || pending.sealed_blob_hash == [0; 32])
        {
            return Err(invalid("pending checkpoint is not the next bounded state"));
        }
        Ok(())
    }
}

pub trait AntiRollbackCheckpointStore: Send + Sync {
    fn load(&self, state_id: StateId) -> Result<CheckpointRecord>;

    fn compare_and_swap(
        &self,
        state_id: StateId,
        expected_secure_revision: u64,
        next: CheckpointRecord,
    ) -> Result<bool>;
}

#[derive(Debug, Default)]
pub struct MemoryMlsStateStore {
    states: Mutex<HashMap<StateId, PersistedMlsState>>,
}

impl MlsStateStore for MemoryMlsStateStore {
    fn load(&self, state_id: StateId) -> Result<Option<PersistedMlsState>> {
        state_id.validate()?;
        Ok(self.lock()?.get(&state_id).cloned())
    }

    fn compare_and_swap(
        &self,
        state_id: StateId,
        expected_store_revision: u64,
        mut next: PersistedMlsState,
    ) -> Result<bool> {
        state_id.validate()?;
        next.validate()?;
        let mut states = self.lock()?;
        let revision = states
            .get(&state_id)
            .map_or(0, |state| state.store_revision);
        if revision != expected_store_revision {
            return Ok(false);
        }
        next.store_revision = expected_store_revision
            .checked_add(1)
            .ok_or_else(|| PeerError::StateConflict("MLS state revision overflow".into()))?;
        states.insert(state_id, next);
        Ok(true)
    }
}

impl MemoryMlsStateStore {
    fn lock(&self) -> Result<std::sync::MutexGuard<'_, HashMap<StateId, PersistedMlsState>>> {
        self.states
            .lock()
            .map_err(|_| PeerError::StateConflict("MLS state store lock poisoned".into()))
    }
}

#[derive(Debug, Default)]
pub struct MemoryCheckpointStore {
    checkpoints: Mutex<HashMap<StateId, CheckpointRecord>>,
}

impl AntiRollbackCheckpointStore for MemoryCheckpointStore {
    fn load(&self, state_id: StateId) -> Result<CheckpointRecord> {
        state_id.validate()?;
        Ok(self.lock()?.get(&state_id).cloned().unwrap_or_default())
    }

    fn compare_and_swap(
        &self,
        state_id: StateId,
        expected_secure_revision: u64,
        mut next: CheckpointRecord,
    ) -> Result<bool> {
        state_id.validate()?;
        next.validate()?;
        let mut checkpoints = self.lock()?;
        let revision = checkpoints
            .get(&state_id)
            .map_or(0, |record| record.secure_revision);
        if revision != expected_secure_revision {
            return Ok(false);
        }
        next.secure_revision = expected_secure_revision
            .checked_add(1)
            .ok_or_else(|| PeerError::StateConflict("checkpoint revision overflow".into()))?;
        checkpoints.insert(state_id, next);
        Ok(true)
    }
}

impl MemoryCheckpointStore {
    fn lock(&self) -> Result<std::sync::MutexGuard<'_, HashMap<StateId, CheckpointRecord>>> {
        self.checkpoints
            .lock()
            .map_err(|_| PeerError::StateConflict("checkpoint store lock poisoned".into()))
    }
}

#[derive(Debug, Clone, Encode, Decode)]
struct DurableMlsFile {
    version: u16,
    generation: u64,
    states: Vec<(StateId, PersistedMlsState)>,
    checkpoints: Vec<(StateId, CheckpointRecord)>,
}

impl Default for DurableMlsFile {
    fn default() -> Self {
        Self {
            version: DURABLE_MLS_VERSION,
            generation: 0,
            states: Vec::new(),
            checkpoints: Vec::new(),
        }
    }
}

impl Validate for DurableMlsFile {
    fn validate(&self) -> Result<()> {
        if self.version != DURABLE_MLS_VERSION {
            return Err(PeerError::Version(
                "unsupported durable MLS state version".into(),
            ));
        }
        if self.states.len() > MAX_DURABLE_MLS_GROUPS
            || self.checkpoints.len() > MAX_DURABLE_MLS_GROUPS
        {
            return Err(limit("durable MLS state exceeds 256 groups"));
        }
        validate_sorted_unique(&self.states, "durable MLS states")?;
        validate_sorted_unique(&self.checkpoints, "durable MLS checkpoints")?;
        for (state_id, state) in &self.states {
            state_id.validate()?;
            state.validate()?;
        }
        for (state_id, checkpoint) in &self.checkpoints {
            state_id.validate()?;
            checkpoint.validate()?;
        }
        Ok(())
    }
}

pub struct DurableMlsBackend {
    directory: Arc<SecureDirectory>,
    state: Mutex<DurableMlsFile>,
    _lock: SecureFileLock,
}

impl DurableMlsBackend {
    pub fn open(directory: Arc<SecureDirectory>) -> Result<Self> {
        let lock = directory.try_lock_exclusive(DURABLE_MLS_LOCK_FILE)?;
        let state = match directory.read_secret(DURABLE_MLS_STATE_FILE) {
            Ok(bytes) => decode_limited::<MAX_PERSISTED_STATE_BYTES, DurableMlsFile>(&bytes)?,
            Err(PeerError::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => {
                DurableMlsFile::default()
            }
            Err(error) => return Err(error),
        };
        state.validate()?;
        Ok(Self {
            directory,
            state: Mutex::new(state),
            _lock: lock,
        })
    }

    pub fn generation(&self) -> Result<u64> {
        Ok(self.lock()?.generation)
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, DurableMlsFile>> {
        self.state
            .lock()
            .map_err(|_| PeerError::StateConflict("durable MLS store lock poisoned".into()))
    }

    fn commit(&self, current: &mut DurableMlsFile, mut next: DurableMlsFile) -> Result<()> {
        next.generation = current
            .generation
            .checked_add(1)
            .ok_or_else(|| PeerError::StateConflict("durable MLS generation overflow".into()))?;
        next.validate()?;
        let encoded = encode_limited::<MAX_PERSISTED_STATE_BYTES, _>(&next)?;
        self.directory
            .atomic_write_secret(DURABLE_MLS_STATE_FILE, &encoded)?;
        *current = next;
        Ok(())
    }
}

impl MlsStateStore for Arc<DurableMlsBackend> {
    fn load(&self, state_id: StateId) -> Result<Option<PersistedMlsState>> {
        state_id.validate()?;
        let state = self.lock()?;
        Ok(state
            .states
            .binary_search_by_key(&state_id, |(id, _)| *id)
            .ok()
            .map(|index| state.states[index].1.clone()))
    }

    fn compare_and_swap(
        &self,
        state_id: StateId,
        expected_store_revision: u64,
        mut next_state: PersistedMlsState,
    ) -> Result<bool> {
        state_id.validate()?;
        next_state.validate()?;
        let mut current = self.lock()?;
        let mut next = current.clone();
        let position = next.states.binary_search_by_key(&state_id, |(id, _)| *id);
        let revision = position
            .as_ref()
            .ok()
            .map_or(0, |index| next.states[*index].1.store_revision);
        if revision != expected_store_revision {
            return Ok(false);
        }
        next_state.store_revision = expected_store_revision
            .checked_add(1)
            .ok_or_else(|| PeerError::StateConflict("MLS state revision overflow".into()))?;
        match position {
            Ok(index) => next.states[index] = (state_id, next_state),
            Err(index) => {
                if next.states.len() >= MAX_DURABLE_MLS_GROUPS {
                    return Err(limit("durable MLS state exceeds 256 groups"));
                }
                next.states.insert(index, (state_id, next_state));
            }
        }
        self.commit(&mut current, next)?;
        Ok(true)
    }
}

impl AntiRollbackCheckpointStore for Arc<DurableMlsBackend> {
    fn load(&self, state_id: StateId) -> Result<CheckpointRecord> {
        state_id.validate()?;
        let state = self.lock()?;
        Ok(state
            .checkpoints
            .binary_search_by_key(&state_id, |(id, _)| *id)
            .ok()
            .map_or_else(CheckpointRecord::default, |index| {
                state.checkpoints[index].1.clone()
            }))
    }

    fn compare_and_swap(
        &self,
        state_id: StateId,
        expected_secure_revision: u64,
        mut next_checkpoint: CheckpointRecord,
    ) -> Result<bool> {
        state_id.validate()?;
        next_checkpoint.validate()?;
        let mut current = self.lock()?;
        let mut next = current.clone();
        let position = next
            .checkpoints
            .binary_search_by_key(&state_id, |(id, _)| *id);
        let revision = position
            .as_ref()
            .ok()
            .map_or(0, |index| next.checkpoints[*index].1.secure_revision);
        if revision != expected_secure_revision {
            return Ok(false);
        }
        next_checkpoint.secure_revision = expected_secure_revision
            .checked_add(1)
            .ok_or_else(|| PeerError::StateConflict("checkpoint revision overflow".into()))?;
        match position {
            Ok(index) => next.checkpoints[index] = (state_id, next_checkpoint),
            Err(index) => {
                if next.checkpoints.len() >= MAX_DURABLE_MLS_GROUPS {
                    return Err(limit("durable MLS checkpoints exceed 256 groups"));
                }
                next.checkpoints.insert(index, (state_id, next_checkpoint));
            }
        }
        self.commit(&mut current, next)?;
        Ok(true)
    }
}

fn validate_sorted_unique<T>(entries: &[(StateId, T)], label: &str) -> Result<()> {
    if entries.windows(2).any(|pair| pair[0].0 >= pair[1].0) {
        return Err(invalid(format!("{label} are not uniquely sorted")));
    }
    Ok(())
}

pub struct PersistedStateCoordinator<S, C, E> {
    state_store: S,
    checkpoint_store: C,
    sealer: E,
    operation_lock: Mutex<()>,
}

impl<S, C, E> PersistedStateCoordinator<S, C, E>
where
    S: MlsStateStore,
    C: AntiRollbackCheckpointStore,
    E: StateSealer,
{
    pub const fn new(state_store: S, checkpoint_store: C, sealer: E) -> Self {
        Self {
            state_store,
            checkpoint_store,
            sealer,
            operation_lock: Mutex::new(()),
        }
    }

    pub fn persist(
        &self,
        state_id: StateId,
        expected_store_revision: u64,
        mls_epoch: u64,
        plaintext: &[u8],
    ) -> Result<PersistedMlsState> {
        let _operation = self.lock_operations()?;
        validate_plaintext_shape(state_id, 1, plaintext.len())?;
        let checkpoint = self.reconcile(state_id)?;
        let counter = checkpoint
            .committed_counter
            .checked_add(1)
            .ok_or_else(|| PeerError::StateConflict("checkpoint counter overflow".into()))?;
        let sealed_blob = self.sealer.seal(state_id, counter, mls_epoch, plaintext)?;
        let sealed_blob_hash = *blake3::hash(&sealed_blob).as_bytes();
        let pending = PendingCheckpoint {
            counter,
            mls_epoch,
            sealed_blob_hash,
        };
        let mut intent = checkpoint.clone();
        intent.pending = Some(pending.clone());
        if !self.checkpoint_store.compare_and_swap(
            state_id,
            checkpoint.secure_revision,
            intent.clone(),
        )? {
            return Err(PeerError::StateConflict(
                "checkpoint changed before persistence intent".into(),
            ));
        }
        intent.secure_revision = intent
            .secure_revision
            .checked_add(1)
            .ok_or_else(|| PeerError::StateConflict("checkpoint revision overflow".into()))?;

        let next_store_revision = expected_store_revision
            .checked_add(1)
            .ok_or_else(|| PeerError::StateConflict("MLS state revision overflow".into()))?;

        let state = PersistedMlsState {
            store_revision: next_store_revision,
            checkpoint_counter: counter,
            mls_epoch,
            sealed_blob_hash,
            sealed_blob,
        };
        if !self
            .state_store
            .compare_and_swap(state_id, expected_store_revision, state.clone())?
        {
            let mut aborted = intent.clone();
            aborted.pending = None;
            let _ =
                self.checkpoint_store
                    .compare_and_swap(state_id, intent.secure_revision, aborted);
            return Err(PeerError::StateConflict(
                "MLS state changed before persistence commit".into(),
            ));
        }

        let mut committed = intent.clone();
        committed.committed_counter = pending.counter;
        committed.committed_mls_epoch = pending.mls_epoch;
        committed.committed_blob_hash = pending.sealed_blob_hash;
        committed.pending = None;
        if !self
            .checkpoint_store
            .compare_and_swap(state_id, intent.secure_revision, committed)?
        {
            return Err(PeerError::StateConflict(
                "MLS state persisted but secure checkpoint finalization needs recovery".into(),
            ));
        }
        Ok(state)
    }

    pub fn load(
        &self,
        state_id: StateId,
    ) -> Result<Option<(PersistedMlsState, Zeroizing<Vec<u8>>)>> {
        let _operation = self.lock_operations()?;
        let checkpoint = self.reconcile(state_id)?;
        let Some(state) = self.state_store.load(state_id)? else {
            if checkpoint.committed_counter != 0 {
                return Err(PeerError::Rollback(
                    "secure checkpoint exists but persisted MLS state is missing".into(),
                ));
            }
            return Ok(None);
        };
        state.validate()?;
        require_committed_match(&state, &checkpoint)?;
        let plaintext = self.sealer.open(
            state_id,
            state.checkpoint_counter,
            state.mls_epoch,
            &state.sealed_blob,
        )?;
        Ok(Some((state, plaintext)))
    }

    pub fn assert_current(
        &self,
        state_id: StateId,
        expected_counter: u64,
        expected_blob_hash: [u8; 32],
    ) -> Result<()> {
        let _operation = self.lock_operations()?;
        let checkpoint = self.reconcile(state_id)?;
        let state = self
            .state_store
            .load(state_id)?
            .ok_or_else(|| PeerError::Rollback("persisted MLS state disappeared".into()))?;
        state.validate()?;
        require_committed_match(&state, &checkpoint)?;
        if state.checkpoint_counter != expected_counter
            || state.sealed_blob_hash != expected_blob_hash
        {
            return Err(PeerError::Rollback(
                "in-memory MLS state is not bound to the current checkpoint".into(),
            ));
        }
        Ok(())
    }

    fn reconcile(&self, state_id: StateId) -> Result<CheckpointRecord> {
        state_id.validate()?;
        let mut checkpoint = self.checkpoint_store.load(state_id)?;
        checkpoint.validate()?;
        let state = self.state_store.load(state_id)?;
        if let Some(state) = &state {
            state.validate()?;
        }
        let Some(pending) = checkpoint.pending.clone() else {
            if let Some(state) = state {
                if checkpoint.committed_counter == 0 {
                    return Err(PeerError::Rollback(
                        "persisted MLS state has no secure checkpoint".into(),
                    ));
                }
                require_committed_match(&state, &checkpoint)?;
            }
            return Ok(checkpoint);
        };

        let next = match state {
            Some(state)
                if state.checkpoint_counter == pending.counter
                    && state.mls_epoch == pending.mls_epoch
                    && state.sealed_blob_hash == pending.sealed_blob_hash =>
            {
                checkpoint.committed_counter = pending.counter;
                checkpoint.committed_mls_epoch = pending.mls_epoch;
                checkpoint.committed_blob_hash = pending.sealed_blob_hash;
                checkpoint.pending = None;
                checkpoint.clone()
            }
            Some(state)
                if state.checkpoint_counter == checkpoint.committed_counter
                    && state.mls_epoch == checkpoint.committed_mls_epoch
                    && state.sealed_blob_hash == checkpoint.committed_blob_hash =>
            {
                checkpoint.pending = None;
                checkpoint.clone()
            }
            None if checkpoint.committed_counter == 0 => {
                checkpoint.pending = None;
                checkpoint.clone()
            }
            _ => {
                return Err(PeerError::Rollback(
                    "persisted MLS state matches neither committed nor pending checkpoint".into(),
                ));
            }
        };
        if !self.checkpoint_store.compare_and_swap(
            state_id,
            checkpoint.secure_revision,
            next.clone(),
        )? {
            return Err(PeerError::StateConflict(
                "checkpoint changed during crash recovery".into(),
            ));
        }
        let mut reconciled = next;
        reconciled.secure_revision = reconciled
            .secure_revision
            .checked_add(1)
            .ok_or_else(|| PeerError::StateConflict("checkpoint revision overflow".into()))?;
        Ok(reconciled)
    }

    fn lock_operations(&self) -> Result<std::sync::MutexGuard<'_, ()>> {
        self.operation_lock
            .lock()
            .map_err(|_| PeerError::StateConflict("persistence coordinator lock poisoned".into()))
    }
}

fn require_committed_match(state: &PersistedMlsState, checkpoint: &CheckpointRecord) -> Result<()> {
    if state.checkpoint_counter < checkpoint.committed_counter {
        return Err(PeerError::Rollback(format!(
            "persisted checkpoint {} is behind secure checkpoint {}",
            state.checkpoint_counter, checkpoint.committed_counter
        )));
    }
    if state.checkpoint_counter != checkpoint.committed_counter
        || state.mls_epoch != checkpoint.committed_mls_epoch
        || state.sealed_blob_hash != checkpoint.committed_blob_hash
    {
        return Err(PeerError::Rollback(
            "persisted MLS state does not match the secure checkpoint".into(),
        ));
    }
    Ok(())
}

fn validate_plaintext_shape(state_id: StateId, checkpoint_counter: u64, size: usize) -> Result<()> {
    state_id.validate()?;
    if checkpoint_counter == 0 {
        return Err(invalid("checkpoint counter must be non-zero"));
    }
    if size == 0 || size > MAX_PERSISTED_STATE_BYTES {
        return Err(limit(format!(
            "persisted state size {size} is outside 1..={MAX_PERSISTED_STATE_BYTES}"
        )));
    }
    Ok(())
}

fn state_aad(state_id: StateId, checkpoint_counter: u64, mls_epoch: u64) -> Vec<u8> {
    let mut aad = Vec::with_capacity(STATE_AAD_DOMAIN.len() + 32 + 16);
    aad.extend_from_slice(STATE_AAD_DOMAIN);
    aad.extend_from_slice(&state_id.0);
    aad.extend_from_slice(&checkpoint_counter.to_be_bytes());
    aad.extend_from_slice(&mls_epoch.to_be_bytes());
    aad
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Barrier};

    use super::*;

    fn coordinator() -> Result<
        PersistedStateCoordinator<MemoryMlsStateStore, MemoryCheckpointStore, XChaChaStateSealer>,
    > {
        Ok(PersistedStateCoordinator::new(
            MemoryMlsStateStore::default(),
            MemoryCheckpointStore::default(),
            XChaChaStateSealer::new(StateEncryptionKey::new([7; 32])?),
        ))
    }

    #[test]
    fn sealed_state_round_trip_and_checkpoint_binding() -> Result<()> {
        let coordinator = coordinator()?;
        let id = StateId([1; 32]);
        let state = coordinator.persist(id, 0, 4, b"openmls state")?;
        coordinator.assert_current(id, state.checkpoint_counter, state.sealed_blob_hash)?;
        let (_, opened) = coordinator
            .load(id)?
            .ok_or_else(|| PeerError::StateConflict("state was not persisted".into()))?;
        assert_eq!(opened.as_slice(), b"openmls state");
        Ok(())
    }

    #[test]
    fn sealed_state_aad_rejects_epoch_substitution() -> Result<()> {
        let sealer = XChaChaStateSealer::new(StateEncryptionKey::new([7; 32])?);
        let id = StateId([1; 32]);
        let sealed_state = sealer.seal(id, 1, 4, b"state")?;
        assert!(sealer.open(id, 1, 3, &sealed_state).is_err());
        Ok(())
    }

    #[test]
    fn secure_checkpoint_detects_persisted_state_rollback() -> Result<()> {
        let coordinator = coordinator()?;
        let id = StateId([2; 32]);
        let old = coordinator.persist(id, 0, 1, b"old MLS state")?;
        let _current = coordinator.persist(id, old.store_revision, 2, b"current MLS state")?;
        coordinator.state_store.lock()?.insert(id, old);
        assert!(matches!(coordinator.load(id), Err(PeerError::Rollback(_))));
        Ok(())
    }

    #[test]
    fn concurrent_persists_are_serialized_and_leave_one_loadable_winner() -> Result<()> {
        let coordinator = Arc::new(coordinator()?);
        let id = StateId([3; 32]);
        let barrier = Arc::new(Barrier::new(8));
        let mut threads = Vec::new();
        for index in 0_u8..8 {
            let coordinator = Arc::clone(&coordinator);
            let barrier = Arc::clone(&barrier);
            threads.push(std::thread::spawn(move || {
                barrier.wait();
                coordinator.persist(id, 0, 1, &[index.saturating_add(1)])
            }));
        }
        let mut successes = 0;
        for thread in threads {
            if thread
                .join()
                .map_err(|_| PeerError::StateConflict("persistence thread panicked".into()))?
                .is_ok()
            {
                successes += 1;
            }
        }
        assert_eq!(successes, 1);
        let (_, opened) = coordinator
            .load(id)?
            .ok_or_else(|| PeerError::StateConflict("winning state disappeared".into()))?;
        assert_eq!(opened.len(), 1);
        Ok(())
    }

    #[test]
    fn crash_recovery_commits_a_state_matching_the_pending_checkpoint() -> Result<()> {
        let coordinator = coordinator()?;
        let id = StateId([4; 32]);
        let first = coordinator.persist(id, 0, 1, b"first")?;
        let sealed_blob = coordinator.sealer.seal(id, 2, 2, b"second")?;
        let sealed_blob_hash = *blake3::hash(&sealed_blob).as_bytes();
        let current_checkpoint = coordinator.checkpoint_store.load(id)?;
        let pending = CheckpointRecord {
            secure_revision: current_checkpoint.secure_revision,
            committed_counter: 1,
            committed_mls_epoch: 1,
            committed_blob_hash: first.sealed_blob_hash,
            pending: Some(PendingCheckpoint {
                counter: 2,
                mls_epoch: 2,
                sealed_blob_hash,
            }),
        };
        assert!(coordinator.checkpoint_store.compare_and_swap(
            id,
            current_checkpoint.secure_revision,
            pending,
        )?);
        assert!(coordinator.state_store.compare_and_swap(
            id,
            first.store_revision,
            PersistedMlsState {
                store_revision: first.store_revision + 1,
                checkpoint_counter: 2,
                mls_epoch: 2,
                sealed_blob_hash,
                sealed_blob,
            },
        )?);
        let (recovered, plaintext) = coordinator
            .load(id)?
            .ok_or_else(|| PeerError::StateConflict("recovered state disappeared".into()))?;
        assert_eq!(recovered.checkpoint_counter, 2);
        assert_eq!(plaintext.as_slice(), b"second");
        Ok(())
    }

    #[test]
    fn plaintext_and_sealed_size_limits_include_aead_overhead() -> Result<()> {
        let sealer = XChaChaStateSealer::new(StateEncryptionKey::new([8; 32])?);
        let id = StateId([5; 32]);
        assert!(validate_plaintext_shape(id, 1, MAX_PERSISTED_STATE_BYTES + 1).is_err());
        let sealed_state = sealer.seal(id, 1, 0, &[9; 32])?;
        assert_eq!(
            sealed_state.len(),
            32 + 1 + XCHACHA_NONCE_BYTES + POLY1305_TAG_BYTES
        );
        assert_eq!(sealer.open(id, 1, 0, &sealed_state)?.as_slice(), &[9; 32]);
        Ok(())
    }

    #[test]
    fn durable_backend_survives_restart_and_enforces_single_writer() -> Result<()> {
        let temporary = tempfile::tempdir()?;
        let directory_path = std::fs::canonicalize(temporary.path())?.join("peer-state");
        let directory = Arc::new(SecureDirectory::open_or_create(&directory_path)?);
        let backend = Arc::new(DurableMlsBackend::open(Arc::clone(&directory))?);
        assert!(DurableMlsBackend::open(Arc::clone(&directory)).is_err());
        let coordinator = PersistedStateCoordinator::new(
            Arc::clone(&backend),
            Arc::clone(&backend),
            XChaChaStateSealer::new(StateEncryptionKey::new([19; 32])?),
        );
        let id = StateId([20; 32]);
        coordinator.persist(id, 0, 7, b"durable MLS snapshot")?;
        assert!(backend.generation()? >= 3);
        drop(coordinator);
        drop(backend);

        let reopened = Arc::new(DurableMlsBackend::open(directory)?);
        let coordinator = PersistedStateCoordinator::new(
            Arc::clone(&reopened),
            reopened,
            XChaChaStateSealer::new(StateEncryptionKey::new([19; 32])?),
        );
        let (_, plaintext) = coordinator
            .load(id)?
            .ok_or_else(|| PeerError::StateConflict("durable state disappeared".into()))?;
        assert_eq!(plaintext.as_slice(), b"durable MLS snapshot");
        Ok(())
    }
}
