use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::{Cursor, Read};
use std::sync::{Arc, RwLock};

use openmls::prelude::tls_codec::{Deserialize, Serialize};
use openmls::prelude::{
    BasicCredential, Ciphersuite, Credential, CredentialWithKey, GroupId, KeyPackage, KeyPackageIn,
    LeafNode, LeafNodeIndex, LeafNodeParameters, MlsGroup, MlsGroupCreateConfig,
    MlsGroupJoinConfig, MlsMessageBodyIn, MlsMessageIn, NewSignerBundle, ProcessedMessageContent,
    ProtocolMessage, ProtocolVersion as MlsProtocolVersion, SenderRatchetConfiguration,
    StagedCommit, StagedWelcome,
};
use openmls_memory_storage::MemoryStorage;
use openmls_rust_crypto::RustCrypto;
use openmls_traits::OpenMlsProvider;
use openmls_traits::signatures::{Signer as OpenMlsSigner, SignerError};
use openmls_traits::types::SignatureScheme;
use zeroize::Zeroizing;

use crate::codec::{MAX_APPLICATION_BYTES, Validate, decode_limited, encode_limited};
use crate::error::{PeerError, Result, invalid, limit};
use crate::identity::{DeviceCapabilities, DeviceCertificate, DeviceSigner, DeviceTrustResolver};
use crate::persistence::{
    AntiRollbackCheckpointStore, MlsStateStore, PersistedStateCoordinator, StateId, StateSealer,
};

const MLS_CIPHERSUITE: Ciphersuite = Ciphersuite::MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519;
const MAX_MLS_WIRE_BYTES: usize = 192 * 1024;
const MAX_MLS_STORAGE_ENTRIES: usize = 16_384;
const MAX_MLS_STORAGE_KEY_BYTES: usize = 64 * 1024;
const MAX_MLS_STORAGE_VALUE_BYTES: usize = 8 * 1024 * 1024;
const MAX_MLS_SNAPSHOT_BYTES: usize = 16 * 1024 * 1024;
const SNAPSHOT_MAGIC: &[u8; 5] = b"FMLS1";
const CLIENT_SNAPSHOT_MAGIC: &[u8; 5] = b"FMLC1";
const STATE_ID_DOMAIN: &str = "forge-peer/1 OpenMLS state id";
const MLS_CREDENTIAL_DOMAIN: &[u8] = b"forge-peer/1 certified OpenMLS credential\0";
const MAX_MLS_CREDENTIAL_BYTES: usize = 8 * 1024;
const MAX_MLS_GROUP_MEMBERS: usize = 256;

#[derive(Debug, Default)]
pub struct ForgeMlsProvider {
    crypto: RustCrypto,
    storage: MemoryStorage,
}

impl OpenMlsProvider for ForgeMlsProvider {
    type CryptoProvider = RustCrypto;
    type RandProvider = RustCrypto;
    type StorageProvider = MemoryStorage;

    fn storage(&self) -> &Self::StorageProvider {
        &self.storage
    }

    fn crypto(&self) -> &Self::CryptoProvider {
        &self.crypto
    }

    fn rand(&self) -> &Self::RandProvider {
        &self.crypto
    }
}

#[derive(Clone)]
pub struct MlsDeviceIdentity {
    pub certificate: DeviceCertificate,
    credential: CredentialWithKey,
    signer: CertifiedMlsSigner,
}

#[derive(Clone)]
struct CertifiedMlsSigner(Arc<DeviceSigner>);

impl OpenMlsSigner for CertifiedMlsSigner {
    fn sign(&self, payload: &[u8]) -> std::result::Result<Vec<u8>, SignerError> {
        Ok(self.0.sign_raw(payload).0.to_vec())
    }

    fn signature_scheme(&self) -> SignatureScheme {
        SignatureScheme::ED25519
    }
}

impl MlsDeviceIdentity {
    pub fn new(
        certificate: DeviceCertificate,
        device_signer: Arc<DeviceSigner>,
        now: u64,
    ) -> Result<Self> {
        certificate.verify(now)?;
        if certificate.body.device_id != device_signer.device_id
            || certificate.body.device_public_key != device_signer.verifying_key_bytes()
        {
            return Err(PeerError::Authentication(
                "MLS signer does not match the certified device".into(),
            ));
        }
        if !certificate
            .body
            .capabilities
            .contains(DeviceCapabilities::KEY_PACKAGE)
        {
            return Err(PeerError::Authorization(
                "MLS device certificate lacks the key-package capability".into(),
            ));
        }
        let signer = CertifiedMlsSigner(device_signer);
        let identity = encode_mls_credential(&certificate)?;
        let credential = CredentialWithKey {
            credential: BasicCredential::new(identity).into(),
            signature_key: certificate.body.device_public_key.to_vec().into(),
        };
        Ok(Self {
            certificate,
            credential,
            signer,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CertifiedKeyPackage {
    certificate: DeviceCertificate,
    bytes: Vec<u8>,
}

impl CertifiedKeyPackage {
    pub(crate) fn from_parts(certificate: DeviceCertificate, bytes: Vec<u8>) -> Result<Self> {
        certificate.validate()?;
        enforce_wire_limit(&bytes, "key package")?;
        if bytes.is_empty() {
            return Err(invalid("key package is empty"));
        }
        Ok(Self { certificate, bytes })
    }

    pub fn certificate(&self) -> &DeviceCertificate {
        &self.certificate
    }

    pub fn as_bytes(&self) -> &[u8] {
        &self.bytes
    }
}

pub struct MlsClient {
    provider: ForgeMlsProvider,
    identity: MlsDeviceIdentity,
}

impl MlsClient {
    pub fn new(identity: MlsDeviceIdentity) -> Self {
        Self {
            provider: ForgeMlsProvider {
                crypto: RustCrypto::default(),
                storage: MemoryStorage {
                    values: RwLock::new(HashMap::new()),
                },
            },
            identity,
        }
    }

    pub fn generate_key_package(&self) -> Result<CertifiedKeyPackage> {
        let bundle = KeyPackage::builder()
            .build(
                MLS_CIPHERSUITE,
                &self.provider,
                &self.identity.signer,
                self.identity.credential.clone(),
            )
            .map_err(|error| PeerError::Mls(format!("creating key package: {error}")))?;
        let bytes = bundle
            .key_package()
            .tls_serialize_detached()
            .map_err(|error| PeerError::Mls(format!("serializing key package: {error}")))?;
        enforce_wire_limit(&bytes, "key package")?;
        Ok(CertifiedKeyPackage {
            certificate: self.identity.certificate.clone(),
            bytes,
        })
    }

    pub fn export_pending_key_package_state(&self) -> Result<Vec<u8>> {
        encode_provider_snapshot(*CLIENT_SNAPSHOT_MAGIC, &[], false, &self.provider)
    }

    pub fn restore_pending_key_package_state(
        identity: MlsDeviceIdentity,
        snapshot: &[u8],
    ) -> Result<Self> {
        let (binding, provider) =
            decode_provider_snapshot(snapshot, *CLIENT_SNAPSHOT_MAGIC, false)?;
        if !binding.is_empty() {
            return Err(invalid(
                "pending OpenMLS key-package snapshot has a group binding",
            ));
        }
        Ok(Self { provider, identity })
    }

    pub fn create_group<S, C, E>(
        self,
        group_id: Option<[u8; 32]>,
        trust: &impl DeviceTrustResolver,
        now: u64,
        coordinator: &PersistedStateCoordinator<S, C, E>,
    ) -> Result<MlsSession>
    where
        S: MlsStateStore,
        C: AntiRollbackCheckpointStore,
        E: StateSealer,
    {
        let group_id = group_id.unwrap_or_else(rand::random);
        if group_id == [0; 32] {
            return Err(invalid("MLS group id is all zero"));
        }
        let group_id = GroupId::from_slice(&group_id);
        let group = MlsGroup::new_with_group_id(
            &self.provider,
            &self.identity.signer,
            &group_create_config(),
            group_id,
            self.identity.credential.clone(),
        )
        .map_err(|error| PeerError::Mls(format!("creating MLS group: {error}")))?;
        verify_group_members(&group, trust, now)?;
        let mut session = MlsSession::unpersisted(self.provider, self.identity, group)?;
        session.persist_initial(coordinator)?;
        Ok(session)
    }

    pub fn join_group<S, C, E>(
        self,
        welcome_bytes: &[u8],
        trust: &impl DeviceTrustResolver,
        now: u64,
        coordinator: &PersistedStateCoordinator<S, C, E>,
    ) -> Result<MlsSession>
    where
        S: MlsStateStore,
        C: AntiRollbackCheckpointStore,
        E: StateSealer,
    {
        enforce_wire_limit(welcome_bytes, "welcome")?;
        let message = MlsMessageIn::tls_deserialize_exact(welcome_bytes)
            .map_err(|error| PeerError::Mls(format!("decoding welcome: {error}")))?;
        let MlsMessageBodyIn::Welcome(welcome) = message.extract() else {
            return Err(PeerError::Mls("expected an MLS Welcome message".into()));
        };
        let staged =
            StagedWelcome::new_from_welcome(&self.provider, &group_join_config(), welcome, None)
                .map_err(|error| PeerError::Mls(format!("staging MLS Welcome: {error}")))?;
        let group = staged
            .into_group(&self.provider)
            .map_err(|error| PeerError::Mls(format!("joining MLS group: {error}")))?;
        verify_group_members(&group, trust, now)?;
        let mut session = MlsSession::unpersisted(self.provider, self.identity, group)?;
        session.persist_initial(coordinator)?;
        Ok(session)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct StateBinding {
    store_revision: u64,
    checkpoint_counter: u64,
    sealed_blob_hash: [u8; 32],
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AddMemberOutput {
    pub commit: Vec<u8>,
    pub welcome: Vec<u8>,
    pub epoch: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProcessedMlsMessage {
    Application(Vec<u8>),
    Commit { epoch: u64 },
}

pub struct MlsSession {
    provider: ForgeMlsProvider,
    identity: MlsDeviceIdentity,
    group: MlsGroup,
    state_id: StateId,
    binding: Option<StateBinding>,
    poisoned: bool,
}

impl MlsSession {
    fn unpersisted(
        provider: ForgeMlsProvider,
        identity: MlsDeviceIdentity,
        group: MlsGroup,
    ) -> Result<Self> {
        verify_own_leaf(&group, &identity)?;
        let state_id = state_id_for_group(group.group_id().as_slice());
        Ok(Self {
            provider,
            identity,
            group,
            state_id,
            binding: None,
            poisoned: false,
        })
    }

    pub fn load<S, C, E>(
        state_id: StateId,
        identity: MlsDeviceIdentity,
        trust: &impl DeviceTrustResolver,
        now: u64,
        coordinator: &PersistedStateCoordinator<S, C, E>,
    ) -> Result<Self>
    where
        S: MlsStateStore,
        C: AntiRollbackCheckpointStore,
        E: StateSealer,
    {
        let (persisted, snapshot) = coordinator
            .load(state_id)?
            .ok_or_else(|| PeerError::StateConflict("MLS state was not found".into()))?;
        let (group_id, provider) = decode_snapshot(&snapshot)?;
        if state_id_for_group(group_id.as_slice()) != state_id {
            return Err(PeerError::Authentication(
                "MLS snapshot group id does not match requested state id".into(),
            ));
        }
        let group = MlsGroup::load(provider.storage(), &group_id)
            .map_err(|error| PeerError::Mls(format!("loading MLS group: {error}")))?
            .ok_or_else(|| PeerError::Mls("MLS snapshot does not contain the group".into()))?;
        verify_own_leaf(&group, &identity)?;
        verify_group_members(&group, trust, now)?;
        Ok(Self {
            provider,
            identity,
            group,
            state_id,
            binding: Some(StateBinding {
                store_revision: persisted.store_revision,
                checkpoint_counter: persisted.checkpoint_counter,
                sealed_blob_hash: persisted.sealed_blob_hash,
            }),
            poisoned: false,
        })
    }

    pub const fn state_id(&self) -> StateId {
        self.state_id
    }

    pub fn epoch(&self) -> u64 {
        self.group.epoch().as_u64()
    }

    pub fn epoch_authenticator(&self) -> [u8; 32] {
        let mut hasher = blake3::Hasher::new_derive_key("forge-peer/1 MLS epoch authenticator");
        hasher.update(self.group.epoch_authenticator().as_slice());
        *hasher.finalize().as_bytes()
    }

    pub fn add_member<S, C, E>(
        &mut self,
        certified_key_package: &CertifiedKeyPackage,
        trust: &impl DeviceTrustResolver,
        now: u64,
        coordinator: &PersistedStateCoordinator<S, C, E>,
    ) -> Result<AddMemberOutput>
    where
        S: MlsStateStore,
        C: AntiRollbackCheckpointStore,
        E: StateSealer,
    {
        self.assert_ready(coordinator)?;
        verify_group_members(&self.group, trust, now)?;
        if self.group.members().count() >= MAX_MLS_GROUP_MEMBERS {
            return Err(limit("MLS group member count exceeds 256"));
        }
        trust.verify_current_certificate(&certified_key_package.certificate, now)?;
        reject_existing_member(&self.group, &certified_key_package.certificate)?;
        let key_package_bytes = certified_key_package.as_bytes();
        enforce_wire_limit(key_package_bytes, "key package")?;
        let key_package_in = KeyPackageIn::tls_deserialize_exact(key_package_bytes)
            .map_err(|error| PeerError::Mls(format!("decoding key package: {error}")))?;
        let key_package = key_package_in
            .validate(self.provider.crypto(), MlsProtocolVersion::Mls10)
            .map_err(|error| PeerError::Mls(format!("validating key package: {error}")))?;
        verify_key_package_identity(&key_package, &certified_key_package.certificate, trust, now)?;
        let (commit, welcome, _) = self
            .group
            .add_members(
                &self.provider,
                &self.identity.signer,
                std::slice::from_ref(&key_package),
            )
            .map_err(|error| PeerError::Mls(format!("adding MLS member: {error}")))?;
        let commit = match commit.to_bytes() {
            Ok(bytes) => bytes,
            Err(error) => {
                return self.fail_after_mutation(PeerError::Mls(format!(
                    "serializing add commit: {error}"
                )));
            }
        };
        let welcome = match welcome.to_bytes() {
            Ok(bytes) => bytes,
            Err(error) => {
                return self
                    .fail_after_mutation(PeerError::Mls(format!("serializing Welcome: {error}")));
            }
        };
        if let Err(error) = enforce_wire_limit(&commit, "add commit") {
            return self.fail_after_mutation(error);
        }
        if let Err(error) = enforce_wire_limit(&welcome, "Welcome") {
            return self.fail_after_mutation(error);
        }
        if let Err(error) = self.group.merge_pending_commit(&self.provider) {
            return self
                .fail_after_mutation(PeerError::Mls(format!("merging add commit: {error}")));
        }
        self.persist_after_mutation(coordinator)?;
        Ok(AddMemberOutput {
            commit,
            welcome,
            epoch: self.epoch(),
        })
    }

    pub fn encrypt_application<S, C, E>(
        &mut self,
        plaintext: &[u8],
        trust: &impl DeviceTrustResolver,
        now: u64,
        coordinator: &PersistedStateCoordinator<S, C, E>,
    ) -> Result<Vec<u8>>
    where
        S: MlsStateStore,
        C: AntiRollbackCheckpointStore,
        E: StateSealer,
    {
        self.assert_ready(coordinator)?;
        verify_group_members(&self.group, trust, now)?;
        if plaintext.is_empty() || plaintext.len() > MAX_APPLICATION_BYTES {
            return Err(limit("MLS application plaintext is empty or oversized"));
        }
        let message = self
            .group
            .create_message(&self.provider, &self.identity.signer, plaintext)
            .map_err(|error| PeerError::Mls(format!("encrypting application message: {error}")))?;
        let ciphertext = match message.to_bytes() {
            Ok(bytes) => bytes,
            Err(error) => {
                return self.fail_after_mutation(PeerError::Mls(format!(
                    "serializing application message: {error}"
                )));
            }
        };
        if let Err(error) = enforce_wire_limit(&ciphertext, "application ciphertext") {
            return self.fail_after_mutation(error);
        }
        self.persist_after_mutation(coordinator)?;
        Ok(ciphertext)
    }

    pub fn process_message<S, C, E>(
        &mut self,
        wire_bytes: &[u8],
        trust: &impl DeviceTrustResolver,
        now: u64,
        coordinator: &PersistedStateCoordinator<S, C, E>,
    ) -> Result<ProcessedMlsMessage>
    where
        S: MlsStateStore,
        C: AntiRollbackCheckpointStore,
        E: StateSealer,
    {
        self.assert_ready(coordinator)?;
        enforce_wire_limit(wire_bytes, "MLS message")?;
        let message = MlsMessageIn::tls_deserialize_exact(wire_bytes)
            .map_err(|error| PeerError::Mls(format!("decoding MLS message: {error}")))?;
        let protocol_message: ProtocolMessage = message
            .try_into_protocol_message()
            .map_err(|_| PeerError::Mls("expected an MLS protocol message".into()))?;
        let processed = self
            .group
            .process_message(&self.provider, protocol_message)
            .map_err(|error| PeerError::Mls(format!("processing MLS message: {error}")))?;
        let sender_certificate = match decode_member_credential(processed.credential(), None) {
            Ok(certificate) => certificate,
            Err(error) => return self.reject_processed_message(coordinator, error),
        };
        let output = match processed.into_content() {
            ProcessedMessageContent::ApplicationMessage(application) => {
                if let Err(error) = trust.verify_current_certificate(&sender_certificate, now) {
                    return self.reject_processed_message(coordinator, error);
                }
                let plaintext = application.into_bytes();
                if plaintext.is_empty() || plaintext.len() > MAX_APPLICATION_BYTES {
                    return self.reject_processed_message(
                        coordinator,
                        limit("received MLS application plaintext is empty or oversized"),
                    );
                }
                ProcessedMlsMessage::Application(plaintext)
            }
            ProcessedMessageContent::StagedCommitMessage(commit) => {
                if trust
                    .verify_current_certificate(&sender_certificate, now)
                    .is_err()
                    && let Err(error) =
                        verify_rotation_commit_sender(&sender_certificate, &commit, trust, now)
                {
                    return self.reject_processed_message(coordinator, error);
                }
                if let Err(error) = verify_staged_commit(&commit, trust, now) {
                    return self.reject_processed_message(coordinator, error);
                }
                if let Err(error) = self.group.merge_staged_commit(&self.provider, *commit) {
                    return self.fail_after_mutation(PeerError::Mls(format!(
                        "merging remote commit: {error}"
                    )));
                }
                if let Err(error) = verify_group_members(&self.group, trust, now) {
                    return self.fail_after_mutation(error);
                }
                ProcessedMlsMessage::Commit {
                    epoch: self.epoch(),
                }
            }
            ProcessedMessageContent::ProposalMessage(_)
            | ProcessedMessageContent::ExternalJoinProposalMessage(_) => {
                if let Err(error) = trust.verify_current_certificate(&sender_certificate, now) {
                    return self.reject_processed_message(coordinator, error);
                }
                self.persist_after_mutation(coordinator)?;
                return Err(PeerError::Mls(
                    "standalone MLS proposals are not accepted by forge-peer/1".into(),
                ));
            }
            ProcessedMessageContent::OwnPendingCommit
            | ProcessedMessageContent::OwnPrivateMessage => {
                return self.reject_processed_message(
                    coordinator,
                    PeerError::Mls(
                        "reflected local MLS messages are not accepted by forge-peer/1".into(),
                    ),
                );
            }
        };
        self.persist_after_mutation(coordinator)?;
        Ok(output)
    }

    pub fn self_update<S, C, E>(
        &mut self,
        trust: &impl DeviceTrustResolver,
        now: u64,
        coordinator: &PersistedStateCoordinator<S, C, E>,
    ) -> Result<Vec<u8>>
    where
        S: MlsStateStore,
        C: AntiRollbackCheckpointStore,
        E: StateSealer,
    {
        self.assert_ready(coordinator)?;
        verify_group_members(&self.group, trust, now)?;
        let (commit, _, _) = self
            .group
            .self_update(
                &self.provider,
                &self.identity.signer,
                LeafNodeParameters::default(),
            )
            .map_err(|error| PeerError::Mls(format!("creating self update: {error}")))?
            .into_contents();
        let bytes = match commit.to_bytes() {
            Ok(bytes) => bytes,
            Err(error) => {
                return self.fail_after_mutation(PeerError::Mls(format!(
                    "serializing self update: {error}"
                )));
            }
        };
        if let Err(error) = enforce_wire_limit(&bytes, "self-update commit") {
            return self.fail_after_mutation(error);
        }
        if let Err(error) = self.group.merge_pending_commit(&self.provider) {
            return self
                .fail_after_mutation(PeerError::Mls(format!("merging self update: {error}")));
        }
        self.persist_after_mutation(coordinator)?;
        Ok(bytes)
    }

    pub fn rotate_identity<S, C, E>(
        &mut self,
        replacement: MlsDeviceIdentity,
        trust: &impl DeviceTrustResolver,
        now: u64,
        coordinator: &PersistedStateCoordinator<S, C, E>,
    ) -> Result<Vec<u8>>
    where
        S: MlsStateStore,
        C: AntiRollbackCheckpointStore,
        E: StateSealer,
    {
        self.assert_ready(coordinator)?;
        let previous = &self.identity.certificate;
        if replacement.certificate.body.principal_id != previous.body.principal_id
            || replacement.certificate.body.device_id != previous.body.device_id
            || replacement.certificate.body.serial
                != previous.body.serial.checked_add(1).ok_or_else(|| {
                    PeerError::StateConflict("device certificate serial overflow".into())
                })?
        {
            return Err(PeerError::Authentication(
                "MLS identity rotation is not a contiguous certificate rotation".into(),
            ));
        }
        verify_group_members_for_rotation(&self.group, previous, trust, now)?;
        trust.verify_certificate_transition(previous, &replacement.certificate, now)?;
        let new_signer = NewSignerBundle {
            signer: &replacement.signer,
            credential_with_key: replacement.credential.clone(),
        };
        let (commit, _, _) = self
            .group
            .self_update_with_new_signer(
                &self.provider,
                &self.identity.signer,
                new_signer,
                LeafNodeParameters::default(),
            )
            .map_err(|error| PeerError::Mls(format!("creating identity rotation: {error}")))?
            .into_contents();
        let bytes = match commit.to_bytes() {
            Ok(bytes) => bytes,
            Err(error) => {
                return self.fail_after_mutation(PeerError::Mls(format!(
                    "serializing identity rotation: {error}"
                )));
            }
        };
        if let Err(error) = enforce_wire_limit(&bytes, "identity-rotation commit") {
            return self.fail_after_mutation(error);
        }
        if let Err(error) = self.group.merge_pending_commit(&self.provider) {
            return self.fail_after_mutation(PeerError::Mls(format!(
                "merging identity rotation: {error}"
            )));
        }
        self.identity = replacement;
        if let Err(error) = verify_group_members(&self.group, trust, now) {
            return self.fail_after_mutation(error);
        }
        self.persist_after_mutation(coordinator)?;
        Ok(bytes)
    }

    pub fn remove_member<S, C, E>(
        &mut self,
        leaf_index: u32,
        trust: &impl DeviceTrustResolver,
        now: u64,
        coordinator: &PersistedStateCoordinator<S, C, E>,
    ) -> Result<Vec<u8>>
    where
        S: MlsStateStore,
        C: AntiRollbackCheckpointStore,
        E: StateSealer,
    {
        self.assert_ready(coordinator)?;
        trust.verify_current_certificate(&self.identity.certificate, now)?;
        let index = LeafNodeIndex::new(leaf_index);
        if index == self.group.own_leaf_index() {
            return Err(PeerError::Authorization(
                "remove_member cannot remove the local device".into(),
            ));
        }
        let (commit, _, _) = self
            .group
            .remove_members(&self.provider, &self.identity.signer, &[index])
            .map_err(|error| PeerError::Mls(format!("removing MLS member: {error}")))?;
        let bytes = match commit.to_bytes() {
            Ok(bytes) => bytes,
            Err(error) => {
                return self.fail_after_mutation(PeerError::Mls(format!(
                    "serializing remove commit: {error}"
                )));
            }
        };
        if let Err(error) = enforce_wire_limit(&bytes, "remove commit") {
            return self.fail_after_mutation(error);
        }
        if let Err(error) = self.group.merge_pending_commit(&self.provider) {
            return self
                .fail_after_mutation(PeerError::Mls(format!("merging remove commit: {error}")));
        }
        self.persist_after_mutation(coordinator)?;
        Ok(bytes)
    }

    fn persist_initial<S, C, E>(
        &mut self,
        coordinator: &PersistedStateCoordinator<S, C, E>,
    ) -> Result<()>
    where
        S: MlsStateStore,
        C: AntiRollbackCheckpointStore,
        E: StateSealer,
    {
        self.persist_after_mutation(coordinator)
    }

    fn assert_ready<S, C, E>(&self, coordinator: &PersistedStateCoordinator<S, C, E>) -> Result<()>
    where
        S: MlsStateStore,
        C: AntiRollbackCheckpointStore,
        E: StateSealer,
    {
        if self.poisoned {
            return Err(PeerError::Rollback(
                "MLS session is fail-closed after an unpersisted mutation".into(),
            ));
        }
        let binding = self.binding.ok_or_else(|| {
            PeerError::Rollback("MLS session has no anti-rollback checkpoint binding".into())
        })?;
        coordinator.assert_current(
            self.state_id,
            binding.checkpoint_counter,
            binding.sealed_blob_hash,
        )
    }

    fn persist_after_mutation<S, C, E>(
        &mut self,
        coordinator: &PersistedStateCoordinator<S, C, E>,
    ) -> Result<()>
    where
        S: MlsStateStore,
        C: AntiRollbackCheckpointStore,
        E: StateSealer,
    {
        let snapshot = match encode_snapshot(self.group.group_id(), &self.provider) {
            Ok(snapshot) => Zeroizing::new(snapshot),
            Err(error) => {
                self.poisoned = true;
                return Err(error);
            }
        };
        let expected_revision = self.binding.map_or(0, |binding| binding.store_revision);
        match coordinator.persist(self.state_id, expected_revision, self.epoch(), &snapshot) {
            Ok(state) => {
                self.binding = Some(StateBinding {
                    store_revision: state.store_revision,
                    checkpoint_counter: state.checkpoint_counter,
                    sealed_blob_hash: state.sealed_blob_hash,
                });
                Ok(())
            }
            Err(error) => {
                self.poisoned = true;
                Err(error)
            }
        }
    }

    fn fail_after_mutation<T>(&mut self, error: PeerError) -> Result<T> {
        self.poisoned = true;
        Err(error)
    }

    fn reject_processed_message<S, C, E, T>(
        &mut self,
        coordinator: &PersistedStateCoordinator<S, C, E>,
        error: PeerError,
    ) -> Result<T>
    where
        S: MlsStateStore,
        C: AntiRollbackCheckpointStore,
        E: StateSealer,
    {
        self.persist_after_mutation(coordinator)?;
        Err(error)
    }
}

fn group_create_config() -> MlsGroupCreateConfig {
    MlsGroupCreateConfig::builder()
        .ciphersuite(MLS_CIPHERSUITE)
        .padding_size(128)
        .sender_ratchet_configuration(SenderRatchetConfiguration::new(32, 1_024))
        .use_ratchet_tree_extension(true)
        .build()
}

fn group_join_config() -> MlsGroupJoinConfig {
    MlsGroupJoinConfig::builder()
        .padding_size(128)
        .sender_ratchet_configuration(SenderRatchetConfiguration::new(32, 1_024))
        .use_ratchet_tree_extension(true)
        .build()
}

pub(crate) fn state_id_for_group(group_id: &[u8]) -> StateId {
    let mut hasher = blake3::Hasher::new_derive_key(STATE_ID_DOMAIN);
    hasher.update(group_id);
    StateId(*hasher.finalize().as_bytes())
}

fn verify_own_leaf(group: &MlsGroup, identity: &MlsDeviceIdentity) -> Result<()> {
    let own_leaf = group
        .own_leaf()
        .ok_or_else(|| PeerError::Mls("MLS group has no local leaf".into()))?;
    if own_leaf.signature_key().as_slice() != identity.certificate.body.device_public_key {
        return Err(PeerError::Authentication(
            "MLS local leaf does not match the certified device signer".into(),
        ));
    }
    let embedded = decode_mls_credential(own_leaf.credential())?;
    if embedded != identity.certificate {
        return Err(PeerError::Authentication(
            "MLS local leaf credential does not contain the local device certificate".into(),
        ));
    }
    Ok(())
}

fn encode_mls_credential(certificate: &DeviceCertificate) -> Result<Vec<u8>> {
    let encoded = encode_limited::<MAX_MLS_CREDENTIAL_BYTES, _>(certificate)?;
    let total = MLS_CREDENTIAL_DOMAIN
        .len()
        .checked_add(encoded.len())
        .ok_or_else(|| limit("MLS credential length overflow"))?;
    if total > MAX_MLS_CREDENTIAL_BYTES {
        return Err(limit("certified MLS credential exceeds its bound"));
    }
    let mut credential = Vec::with_capacity(total);
    credential.extend_from_slice(MLS_CREDENTIAL_DOMAIN);
    credential.extend_from_slice(&encoded);
    Ok(credential)
}

fn decode_mls_credential(credential: &Credential) -> Result<DeviceCertificate> {
    let basic = BasicCredential::try_from(credential.clone())
        .map_err(|_| PeerError::Authentication("MLS credential is not basic".into()))?;
    let identity = basic.identity();
    let encoded = identity
        .strip_prefix(MLS_CREDENTIAL_DOMAIN)
        .ok_or_else(|| {
            PeerError::Authentication("MLS credential lacks the Forge certificate domain".into())
        })?;
    decode_limited::<MAX_MLS_CREDENTIAL_BYTES, _>(encoded)
        .map_err(|_| PeerError::Authentication("MLS credential certificate is invalid".into()))
}

fn verify_member_credential(
    credential: &Credential,
    signature_key: Option<&[u8]>,
    trust: &impl DeviceTrustResolver,
    now: u64,
) -> Result<DeviceCertificate> {
    let certificate = decode_member_credential(credential, signature_key)?;
    trust.verify_current_certificate(&certificate, now)?;
    Ok(certificate)
}

fn decode_member_credential(
    credential: &Credential,
    signature_key: Option<&[u8]>,
) -> Result<DeviceCertificate> {
    let certificate = decode_mls_credential(credential)?;
    if let Some(signature_key) = signature_key
        && signature_key != certificate.body.device_public_key
    {
        return Err(PeerError::Authentication(
            "MLS leaf signature key is not the certified device key".into(),
        ));
    }
    if !certificate
        .body
        .capabilities
        .contains(DeviceCapabilities::KEY_PACKAGE)
    {
        return Err(PeerError::Authorization(
            "MLS member certificate lacks the key-package capability".into(),
        ));
    }
    Ok(certificate)
}

fn verify_leaf_node(
    leaf: &LeafNode,
    trust: &impl DeviceTrustResolver,
    now: u64,
) -> Result<DeviceCertificate> {
    verify_member_credential(
        leaf.credential(),
        Some(leaf.signature_key().as_slice()),
        trust,
        now,
    )
}

fn verify_key_package_identity(
    key_package: &KeyPackage,
    expected_certificate: &DeviceCertificate,
    trust: &impl DeviceTrustResolver,
    now: u64,
) -> Result<()> {
    let certificate = verify_leaf_node(key_package.leaf_node(), trust, now)?;
    if &certificate != expected_certificate {
        return Err(PeerError::Authentication(
            "key package credential does not match the supplied certified device".into(),
        ));
    }
    Ok(())
}

fn verify_group_members(
    group: &MlsGroup,
    trust: &impl DeviceTrustResolver,
    now: u64,
) -> Result<()> {
    let mut identities = HashSet::new();
    let mut count = 0_usize;
    for member in group.members() {
        count = count
            .checked_add(1)
            .ok_or_else(|| limit("MLS group member count overflow"))?;
        if count > MAX_MLS_GROUP_MEMBERS {
            return Err(limit("MLS group member count exceeds 256"));
        }
        let certificate =
            verify_member_credential(&member.credential, Some(&member.signature_key), trust, now)?;
        if !identities.insert((certificate.body.principal_id, certificate.body.device_id)) {
            return Err(PeerError::Authentication(
                "MLS group contains duplicate certified device identities".into(),
            ));
        }
    }
    Ok(())
}

fn verify_group_members_for_rotation(
    group: &MlsGroup,
    previous: &DeviceCertificate,
    trust: &impl DeviceTrustResolver,
    now: u64,
) -> Result<()> {
    let mut found_previous = false;
    let mut count = 0_usize;
    for member in group.members() {
        count = count
            .checked_add(1)
            .ok_or_else(|| limit("MLS group member count overflow"))?;
        if count > MAX_MLS_GROUP_MEMBERS {
            return Err(limit("MLS group member count exceeds 256"));
        }
        let certificate =
            decode_member_credential(&member.credential, Some(&member.signature_key))?;
        if certificate == *previous {
            if found_previous {
                return Err(PeerError::Authentication(
                    "MLS group contains the rotating device more than once".into(),
                ));
            }
            found_previous = true;
        } else {
            trust.verify_current_certificate(&certificate, now)?;
        }
    }
    if !found_previous {
        return Err(PeerError::Authentication(
            "MLS group does not contain the previous rotating identity".into(),
        ));
    }
    Ok(())
}

fn reject_existing_member(group: &MlsGroup, candidate: &DeviceCertificate) -> Result<()> {
    for member in group.members() {
        let existing = decode_member_credential(&member.credential, Some(&member.signature_key))?;
        if existing.body.principal_id == candidate.body.principal_id
            && existing.body.device_id == candidate.body.device_id
        {
            return Err(PeerError::StateConflict(
                "MLS group already contains this certified device".into(),
            ));
        }
    }
    Ok(())
}

fn verify_rotation_commit_sender(
    previous: &DeviceCertificate,
    commit: &StagedCommit,
    trust: &impl DeviceTrustResolver,
    now: u64,
) -> Result<()> {
    if commit.queued_proposals().next().is_some() {
        return Err(PeerError::Authorization(
            "previous device certificate may authenticate only a pure identity rotation".into(),
        ));
    }
    let replacement_leaf = commit.update_path_leaf_node().ok_or_else(|| {
        PeerError::Authentication("identity rotation commit has no replacement leaf".into())
    })?;
    let replacement = decode_member_credential(
        replacement_leaf.credential(),
        Some(replacement_leaf.signature_key().as_slice()),
    )?;
    trust.verify_certificate_transition(previous, &replacement, now)
}

fn verify_staged_commit(
    commit: &StagedCommit,
    trust: &impl DeviceTrustResolver,
    now: u64,
) -> Result<()> {
    for add in commit.add_proposals() {
        verify_leaf_node(add.add_proposal().key_package().leaf_node(), trust, now)?;
    }
    for update in commit.update_proposals() {
        verify_leaf_node(update.update_proposal().leaf_node(), trust, now)?;
    }
    if let Some(leaf) = commit.update_path_leaf_node() {
        verify_leaf_node(leaf, trust, now)?;
    }
    Ok(())
}

fn enforce_wire_limit(bytes: &[u8], label: &str) -> Result<()> {
    if bytes.is_empty() || bytes.len() > MAX_MLS_WIRE_BYTES {
        return Err(limit(format!(
            "{label} is empty or exceeds {MAX_MLS_WIRE_BYTES}"
        )));
    }
    Ok(())
}

fn encode_snapshot(group_id: &GroupId, provider: &ForgeMlsProvider) -> Result<Vec<u8>> {
    encode_provider_snapshot(*SNAPSHOT_MAGIC, group_id.as_slice(), true, provider)
}

fn encode_provider_snapshot(
    magic: [u8; 5],
    binding: &[u8],
    binding_required: bool,
    provider: &ForgeMlsProvider,
) -> Result<Vec<u8>> {
    let values = provider
        .storage
        .values
        .read()
        .map_err(|_| PeerError::StateConflict("OpenMLS storage lock poisoned".into()))?;
    if values.len() > MAX_MLS_STORAGE_ENTRIES {
        return Err(limit("OpenMLS storage has too many entries"));
    }
    let ordered: BTreeMap<&Vec<u8>, &Vec<u8>> = values.iter().collect();
    if (binding_required && binding.is_empty()) || binding.len() > usize::from(u16::MAX) {
        return Err(invalid("OpenMLS snapshot binding is empty or oversized"));
    }
    let mut output = Vec::new();
    output.extend_from_slice(&magic);
    output.extend_from_slice(
        &u16::try_from(binding.len())
            .map_err(|_| limit("OpenMLS snapshot binding does not fit u16"))?
            .to_be_bytes(),
    );
    output.extend_from_slice(binding);
    output.extend_from_slice(
        &u32::try_from(ordered.len())
            .map_err(|_| limit("OpenMLS storage count does not fit u32"))?
            .to_be_bytes(),
    );
    for (key, value) in ordered {
        if key.len() > MAX_MLS_STORAGE_KEY_BYTES || value.len() > MAX_MLS_STORAGE_VALUE_BYTES {
            return Err(limit("OpenMLS storage entry exceeds snapshot bounds"));
        }
        output.extend_from_slice(
            &u32::try_from(key.len())
                .map_err(|_| limit("OpenMLS storage key does not fit u32"))?
                .to_be_bytes(),
        );
        output.extend_from_slice(
            &u32::try_from(value.len())
                .map_err(|_| limit("OpenMLS storage value does not fit u32"))?
                .to_be_bytes(),
        );
        output.extend_from_slice(key);
        output.extend_from_slice(value);
        if output.len() > MAX_MLS_SNAPSHOT_BYTES {
            return Err(limit("OpenMLS snapshot exceeds persistence bound"));
        }
    }
    Ok(output)
}

fn decode_snapshot(bytes: &[u8]) -> Result<(GroupId, ForgeMlsProvider)> {
    let (group_id, provider) = decode_provider_snapshot(bytes, *SNAPSHOT_MAGIC, true)?;
    Ok((GroupId::from_slice(&group_id), provider))
}

fn decode_provider_snapshot(
    bytes: &[u8],
    expected_magic: [u8; 5],
    binding_required: bool,
) -> Result<(Vec<u8>, ForgeMlsProvider)> {
    if bytes.len() > MAX_MLS_SNAPSHOT_BYTES || bytes.len() < SNAPSHOT_MAGIC.len() + 6 {
        return Err(limit("OpenMLS snapshot is truncated or oversized"));
    }
    let mut cursor = Cursor::new(bytes);
    let mut magic = [0_u8; 5];
    cursor.read_exact(&mut magic)?;
    if magic != expected_magic {
        return Err(invalid("OpenMLS snapshot magic is invalid"));
    }
    let binding_len = usize::from(read_u16(&mut cursor)?);
    if (binding_required && binding_len == 0) || binding_len > bytes.len().saturating_sub(11) {
        return Err(invalid("OpenMLS snapshot binding length is invalid"));
    }
    let binding = read_exact_vec(&mut cursor, binding_len)?;
    let count = usize::try_from(read_u32(&mut cursor)?)
        .map_err(|_| limit("OpenMLS snapshot entry count does not fit usize"))?;
    if count > MAX_MLS_STORAGE_ENTRIES {
        return Err(limit("OpenMLS snapshot entry count exceeds limit"));
    }
    let mut values = HashMap::with_capacity(count.min(1_024));
    for _ in 0..count {
        let key_len = usize::try_from(read_u32(&mut cursor)?)
            .map_err(|_| limit("OpenMLS snapshot key length does not fit usize"))?;
        let value_len = usize::try_from(read_u32(&mut cursor)?)
            .map_err(|_| limit("OpenMLS snapshot value length does not fit usize"))?;
        if key_len > MAX_MLS_STORAGE_KEY_BYTES || value_len > MAX_MLS_STORAGE_VALUE_BYTES {
            return Err(limit("OpenMLS snapshot entry exceeds bounds"));
        }
        let key = read_exact_vec(&mut cursor, key_len)?;
        let value = read_exact_vec(&mut cursor, value_len)?;
        if values.insert(key, value).is_some() {
            return Err(invalid("OpenMLS snapshot repeats a storage key"));
        }
    }
    if cursor.position()
        != u64::try_from(bytes.len())
            .map_err(|_| limit("OpenMLS snapshot length does not fit u64"))?
    {
        return Err(invalid("OpenMLS snapshot has trailing bytes"));
    }
    Ok((
        binding,
        ForgeMlsProvider {
            crypto: RustCrypto::default(),
            storage: MemoryStorage {
                values: RwLock::new(values),
            },
        },
    ))
}

fn read_u16(cursor: &mut Cursor<&[u8]>) -> Result<u16> {
    let mut bytes = [0_u8; 2];
    cursor.read_exact(&mut bytes)?;
    Ok(u16::from_be_bytes(bytes))
}

fn read_u32(cursor: &mut Cursor<&[u8]>) -> Result<u32> {
    let mut bytes = [0_u8; 4];
    cursor.read_exact(&mut bytes)?;
    Ok(u32::from_be_bytes(bytes))
}

fn read_exact_vec(cursor: &mut Cursor<&[u8]>, size: usize) -> Result<Vec<u8>> {
    let position = usize::try_from(cursor.position())
        .map_err(|_| limit("OpenMLS snapshot cursor position exceeds usize"))?;
    let remaining = cursor.get_ref().len().saturating_sub(position);
    if size > remaining {
        return Err(invalid("OpenMLS snapshot entry is truncated"));
    }
    let mut bytes = vec![0_u8; size];
    cursor.read_exact(&mut bytes)?;
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::identity::{
        DeviceCapabilities, DeviceId, MemoryDeviceTrustStore, PrincipalRootSigner, ProtocolRange,
    };
    use crate::persistence::{
        MemoryCheckpointStore, MemoryMlsStateStore, StateEncryptionKey, XChaChaStateSealer,
    };

    fn identity(now: u64, trust: &MemoryDeviceTrustStore) -> Result<MlsDeviceIdentity> {
        let root = PrincipalRootSigner::generate();
        let signer = Arc::new(DeviceSigner::generate(DeviceId::random()));
        let certificate = DeviceCertificate::issue(
            &root,
            signer.as_ref(),
            DeviceCapabilities::new(
                DeviceCapabilities::KEY_PACKAGE | DeviceCapabilities::PROJECTION,
            )?,
            ProtocolRange::CURRENT,
            1,
            now - 1,
            now + 3_600,
        )?;
        trust.trust_principal(root.verifying_key_bytes())?;
        trust.admit_certificate(&certificate, now)?;
        MlsDeviceIdentity::new(certificate, signer, now)
    }

    fn coordinator() -> Result<
        PersistedStateCoordinator<MemoryMlsStateStore, MemoryCheckpointStore, XChaChaStateSealer>,
    > {
        Ok(PersistedStateCoordinator::new(
            MemoryMlsStateStore::default(),
            MemoryCheckpointStore::default(),
            XChaChaStateSealer::new(StateEncryptionKey::new(rand::random())?),
        ))
    }

    #[test]
    fn openmls_encrypts_and_persists_application_messages() -> Result<()> {
        let now = 10_000;
        let alice_coordinator = coordinator()?;
        let bob_coordinator = coordinator()?;
        let trust = MemoryDeviceTrustStore::default();
        let alice_client = MlsClient::new(identity(now, &trust)?);
        let bob_client = MlsClient::new(identity(now, &trust)?);
        let bob_key_package = bob_client.generate_key_package()?;
        let mut alice = alice_client.create_group(None, &trust, now, &alice_coordinator)?;
        let add = alice.add_member(&bob_key_package, &trust, now, &alice_coordinator)?;
        let mut bob = bob_client.join_group(&add.welcome, &trust, now, &bob_coordinator)?;
        let ciphertext =
            alice.encrypt_application(b"encrypted hello", &trust, now, &alice_coordinator)?;
        let plaintext = bob.process_message(&ciphertext, &trust, now, &bob_coordinator)?;
        assert_eq!(
            plaintext,
            ProcessedMlsMessage::Application(b"encrypted hello".to_vec())
        );
        assert_eq!(alice.epoch(), bob.epoch());
        Ok(())
    }

    #[test]
    fn reflected_local_messages_are_rejected_without_breaking_the_session() -> Result<()> {
        let now = 10_000;
        let alice_coordinator = coordinator()?;
        let bob_coordinator = coordinator()?;
        let trust = MemoryDeviceTrustStore::default();
        let alice_client = MlsClient::new(identity(now, &trust)?);
        let bob_client = MlsClient::new(identity(now, &trust)?);
        let bob_key_package = bob_client.generate_key_package()?;
        let mut alice = alice_client.create_group(None, &trust, now, &alice_coordinator)?;
        let add = alice.add_member(&bob_key_package, &trust, now, &alice_coordinator)?;
        let mut bob = bob_client.join_group(&add.welcome, &trust, now, &bob_coordinator)?;

        let private_message =
            alice.encrypt_application(b"local reflection", &trust, now, &alice_coordinator)?;
        assert!(matches!(
            alice.process_message(&private_message, &trust, now, &alice_coordinator),
            Err(PeerError::Mls(message)) if message.contains("reflected local MLS")
        ));
        assert_eq!(
            bob.process_message(&private_message, &trust, now, &bob_coordinator)?,
            ProcessedMlsMessage::Application(b"local reflection".to_vec())
        );

        let (pending_commit, _, _) = alice
            .group
            .self_update(
                &alice.provider,
                &alice.identity.signer,
                LeafNodeParameters::default(),
            )
            .map_err(|error| PeerError::Mls(format!("creating reflected update: {error}")))?
            .into_contents();
        let pending_commit = pending_commit
            .to_bytes()
            .map_err(|error| PeerError::Mls(format!("serializing reflected update: {error}")))?;
        let reflected_commit =
            alice.process_message(&pending_commit, &trust, now + 1, &alice_coordinator);
        assert!(
            matches!(
                &reflected_commit,
                Err(PeerError::Mls(message)) if message.contains("reflected local MLS")
            ),
            "{reflected_commit:?}"
        );
        alice
            .group
            .merge_pending_commit(&alice.provider)
            .map_err(|error| PeerError::Mls(format!("merging reflected update: {error}")))?;
        alice.persist_after_mutation(&alice_coordinator)?;
        assert!(matches!(
            bob.process_message(&pending_commit, &trust, now + 1, &bob_coordinator)?,
            ProcessedMlsMessage::Commit { .. }
        ));
        let follow_up =
            alice.encrypt_application(b"still usable", &trust, now + 2, &alice_coordinator)?;
        assert_eq!(
            bob.process_message(&follow_up, &trust, now + 2, &bob_coordinator)?,
            ProcessedMlsMessage::Application(b"still usable".to_vec())
        );
        Ok(())
    }

    #[test]
    fn pending_key_package_survives_a_process_boundary_snapshot() -> Result<()> {
        let now = 10_000;
        let alice_coordinator = coordinator()?;
        let bob_coordinator = coordinator()?;
        let trust = MemoryDeviceTrustStore::default();
        let alice_client = MlsClient::new(identity(now, &trust)?);
        let bob_identity = identity(now, &trust)?;
        let bob_client = MlsClient::new(bob_identity.clone());
        let bob_key_package = bob_client.generate_key_package()?;
        let pending_snapshot = bob_client.export_pending_key_package_state()?;
        drop(bob_client);

        let restored =
            MlsClient::restore_pending_key_package_state(bob_identity, &pending_snapshot)?;
        let mut alice = alice_client.create_group(None, &trust, now, &alice_coordinator)?;
        let add = alice.add_member(&bob_key_package, &trust, now, &alice_coordinator)?;
        let bob = restored.join_group(&add.welcome, &trust, now, &bob_coordinator)?;
        assert_eq!(alice.epoch_authenticator(), bob.epoch_authenticator());
        Ok(())
    }

    #[test]
    fn openmls_self_update_advances_both_peers() -> Result<()> {
        let now = 10_000;
        let alice_coordinator = coordinator()?;
        let bob_coordinator = coordinator()?;
        let trust = MemoryDeviceTrustStore::default();
        let alice_client = MlsClient::new(identity(now, &trust)?);
        let bob_client = MlsClient::new(identity(now, &trust)?);
        let bob_key_package = bob_client.generate_key_package()?;
        let mut alice = alice_client.create_group(None, &trust, now, &alice_coordinator)?;
        let add = alice.add_member(&bob_key_package, &trust, now, &alice_coordinator)?;
        let mut bob = bob_client.join_group(&add.welcome, &trust, now, &bob_coordinator)?;
        let update = alice.self_update(&trust, now, &alice_coordinator)?;
        assert!(matches!(
            bob.process_message(&update, &trust, now, &bob_coordinator)?,
            ProcessedMlsMessage::Commit { .. }
        ));
        assert_eq!(alice.epoch_authenticator(), bob.epoch_authenticator());
        Ok(())
    }

    #[test]
    fn certified_device_rotation_advances_trust_and_mls_atomically() -> Result<()> {
        let now = 10_000;
        let trust = MemoryDeviceTrustStore::default();
        let alice_root = PrincipalRootSigner::generate();
        let alice_signer = Arc::new(DeviceSigner::generate(DeviceId::random()));
        let alice_certificate = DeviceCertificate::issue(
            &alice_root,
            alice_signer.as_ref(),
            DeviceCapabilities::new(
                DeviceCapabilities::KEY_PACKAGE | DeviceCapabilities::PROJECTION,
            )?,
            ProtocolRange::CURRENT,
            1,
            now - 1,
            now + 3_600,
        )?;
        trust.trust_principal(alice_root.verifying_key_bytes())?;
        trust.admit_certificate(&alice_certificate, now)?;
        let alice_identity =
            MlsDeviceIdentity::new(alice_certificate.clone(), Arc::clone(&alice_signer), now)?;
        let bob_client = MlsClient::new(identity(now, &trust)?);
        let bob_key_package = bob_client.generate_key_package()?;
        let alice_coordinator = coordinator()?;
        let bob_coordinator = coordinator()?;
        let mut alice =
            MlsClient::new(alice_identity).create_group(None, &trust, now, &alice_coordinator)?;
        let add = alice.add_member(&bob_key_package, &trust, now, &alice_coordinator)?;
        let mut bob = bob_client.join_group(&add.welcome, &trust, now, &bob_coordinator)?;

        let replacement_signer = Arc::new(DeviceSigner::generate(alice_signer.device_id));
        let replacement_certificate = DeviceCertificate::rotate(
            &alice_root,
            &alice_certificate,
            replacement_signer.as_ref(),
            alice_certificate.body.capabilities,
            alice_certificate.body.protocol_range,
            now + 1,
            now + 3_601,
        )?;
        trust.admit_certificate(&replacement_certificate, now + 1)?;
        let replacement_identity =
            MlsDeviceIdentity::new(replacement_certificate, replacement_signer, now + 1)?;
        let rotation =
            alice.rotate_identity(replacement_identity, &trust, now + 1, &alice_coordinator)?;
        assert!(matches!(
            bob.process_message(&rotation, &trust, now + 1, &bob_coordinator)?,
            ProcessedMlsMessage::Commit { .. }
        ));
        assert_eq!(alice.epoch_authenticator(), bob.epoch_authenticator());

        let ciphertext = alice.encrypt_application(
            b"after certified rotation",
            &trust,
            now + 2,
            &alice_coordinator,
        )?;
        assert_eq!(
            bob.process_message(&ciphertext, &trust, now + 2, &bob_coordinator)?,
            ProcessedMlsMessage::Application(b"after certified rotation".to_vec())
        );
        Ok(())
    }

    #[test]
    fn openmls_session_restores_from_sealed_checkpointed_snapshot() -> Result<()> {
        let now = 10_000;
        let alice_root = PrincipalRootSigner::from_secret_bytes([31; 32]);
        let alice_signer = Arc::new(DeviceSigner::from_secret_bytes(DeviceId([3; 16]), [32; 32]));
        let alice_certificate = DeviceCertificate::issue(
            &alice_root,
            alice_signer.as_ref(),
            DeviceCapabilities::new(
                DeviceCapabilities::KEY_PACKAGE | DeviceCapabilities::PROJECTION,
            )?,
            ProtocolRange::CURRENT,
            1,
            now - 1,
            now + 3_600,
        )?;
        let trust = MemoryDeviceTrustStore::default();
        trust.trust_principal(alice_root.verifying_key_bytes())?;
        trust.admit_certificate(&alice_certificate, now)?;
        let alice_identity =
            MlsDeviceIdentity::new(alice_certificate.clone(), Arc::clone(&alice_signer), now)?;
        let alice_coordinator = coordinator()?;
        let bob_coordinator = coordinator()?;
        let bob_client = MlsClient::new(identity(now, &trust)?);
        let bob_key_package = bob_client.generate_key_package()?;
        let mut alice =
            MlsClient::new(alice_identity).create_group(None, &trust, now, &alice_coordinator)?;
        let add = alice.add_member(&bob_key_package, &trust, now, &alice_coordinator)?;
        let mut bob = bob_client.join_group(&add.welcome, &trust, now, &bob_coordinator)?;
        let state_id = alice.state_id();
        drop(alice);

        let restored_identity = MlsDeviceIdentity::new(alice_certificate, alice_signer, now)?;
        let mut restored =
            MlsSession::load(state_id, restored_identity, &trust, now, &alice_coordinator)?;
        let ciphertext =
            restored.encrypt_application(b"after restart", &trust, now, &alice_coordinator)?;
        assert_eq!(
            bob.process_message(&ciphertext, &trust, now, &bob_coordinator)?,
            ProcessedMlsMessage::Application(b"after restart".to_vec())
        );
        Ok(())
    }
}
