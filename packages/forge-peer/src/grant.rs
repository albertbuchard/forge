use std::collections::{HashMap, HashSet};
use std::sync::RwLock;

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use bincode::{Decode, Encode};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use crate::PROTOCOL_NAME;
use crate::codec::Validate;
use crate::error::{PeerError, Result, invalid, limit};
use crate::identity::{DeviceCertificate, DeviceSigner, MAX_CLOCK_SKEW_SECONDS};

pub const GRANT_SIGNATURE_DOMAIN: &[u8] = b"forge-peer/grant-signature/v1\0";
pub const MAX_GRANT_JSON_BYTES: usize = 64 * 1024;
const MAX_RULES: usize = 256;
const MAX_SIGNATURES: usize = 16;
const MAX_ENTITY_IDS: usize = 5_000;
const MAX_FIELDS: usize = 256;
const MAX_APPROVED_DEVICES: usize = 128;
const MAX_SAFE_JSON_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Encode, Decode)]
#[serde(rename_all = "snake_case")]
pub enum GrantParty {
    Grantor,
    Grantee,
}

impl GrantParty {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Grantor => "grantor",
            Self::Grantee => "grantee",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Encode, Decode)]
#[serde(rename_all = "snake_case")]
pub enum GrantStatus {
    Draft,
    Proposed,
    Active,
    Countered,
    Rejected,
    Revoked,
    Superseded,
    Expired,
    Conflicted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Encode, Decode)]
#[serde(rename_all = "snake_case")]
pub enum ShareDirection {
    LocalToRemote,
    RemoteToLocal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Encode, Decode)]
#[serde(rename_all = "snake_case")]
pub enum RuleEffect {
    Allow,
    Deny,
}

impl RuleEffect {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Allow => "allow",
            Self::Deny => "deny",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Encode, Decode)]
pub enum ProjectionId {
    #[serde(rename = "calendar.availability.v1")]
    CalendarAvailabilityV1,
    #[serde(rename = "calendar.selected_events.v1")]
    CalendarSelectedEventsV1,
    #[serde(rename = "goals.horizon_summary.v1")]
    GoalsHorizonSummaryV1,
    #[serde(rename = "health.cycling.aggregate.v1")]
    HealthCyclingAggregateV1,
    #[serde(rename = "person.profile.v1")]
    PersonProfileV1,
    #[serde(rename = "life_events.selected.v1")]
    LifeEventsSelectedV1,
    #[serde(rename = "movement.aggregate.v1")]
    MovementAggregateV1,
    #[serde(rename = "custom.selected_entities.v1")]
    CustomSelectedEntitiesV1,
}

impl ProjectionId {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::CalendarAvailabilityV1 => "calendar.availability.v1",
            Self::CalendarSelectedEventsV1 => "calendar.selected_events.v1",
            Self::GoalsHorizonSummaryV1 => "goals.horizon_summary.v1",
            Self::HealthCyclingAggregateV1 => "health.cycling.aggregate.v1",
            Self::PersonProfileV1 => "person.profile.v1",
            Self::LifeEventsSelectedV1 => "life_events.selected.v1",
            Self::MovementAggregateV1 => "movement.aggregate.v1",
            Self::CustomSelectedEntitiesV1 => "custom.selected_entities.v1",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Encode, Decode)]
#[serde(rename_all = "snake_case")]
pub enum CacheMode {
    None,
    UntilExpiry,
    UntilRevoked,
    Duration,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Encode, Decode)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CachePolicy {
    pub mode: CacheMode,
    pub maximum_retention_seconds: u32,
    #[serde(default = "default_true")]
    pub purge_on_revocation: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Encode, Decode)]
#[serde(rename_all = "snake_case")]
pub enum EntitySelectorMode {
    AllShareable,
    Selected,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Encode, Decode)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EntitySelector {
    pub mode: EntitySelectorMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub entity_type: Option<String>,
    #[serde(default)]
    pub entity_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Encode, Decode)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FieldPolicy {
    #[serde(default)]
    pub include: Vec<String>,
    #[serde(default)]
    pub exclude: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Encode, Decode)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TimePolicy {
    #[serde(default)]
    pub starts_at: Option<String>,
    #[serde(default)]
    pub ends_at: Option<String>,
    #[serde(default)]
    pub rolling_past_days: Option<u16>,
    #[serde(default)]
    pub rolling_future_days: Option<u16>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Encode, Decode)]
#[serde(rename_all = "snake_case")]
pub enum AggregationGranularity {
    Day,
    Week,
    Month,
    Quarter,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Encode, Decode)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AggregationPolicy {
    #[serde(default = "default_minimum_records")]
    pub minimum_records: u16,
    #[serde(default = "default_granularity")]
    pub granularity: AggregationGranularity,
    #[serde(default = "default_privacy_budget")]
    pub privacy_budget: f64,
    #[serde(default = "default_maximum_queries")]
    pub maximum_queries_per_day: u16,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Encode, Decode)]
#[serde(rename_all = "snake_case")]
pub enum DevicePolicy {
    Explicit,
    ApprovedCurrentDevices,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Encode, Decode)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ShareRule {
    pub id: String,
    pub effect: RuleEffect,
    pub projection_id: ProjectionId,
    #[serde(default)]
    pub entity_selector: Option<EntitySelector>,
    pub fields: FieldPolicy,
    pub time: TimePolicy,
    pub precision: String,
    #[serde(default)]
    pub aggregation: Option<AggregationPolicy>,
    #[serde(default)]
    pub approved_device_ids: Vec<String>,
    #[serde(default = "default_device_policy")]
    pub device_policy: DevicePolicy,
    #[serde(default = "default_maximum_result_count")]
    pub maximum_result_count: u16,
    #[serde(default = "default_maximum_payload_bytes")]
    pub maximum_payload_bytes: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Encode, Decode)]
#[serde(rename_all = "lowercase")]
pub enum GrantSignatureAlgorithm {
    Ed25519,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Encode, Decode)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GrantSignerMetadata {
    pub device_id: String,
    pub party: GrantParty,
    pub algorithm: GrantSignatureAlgorithm,
    pub signed_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Encode, Decode)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GrantSignature {
    pub device_id: String,
    pub party: GrantParty,
    pub algorithm: GrantSignatureAlgorithm,
    pub signed_at: String,
    pub signature: String,
}

impl GrantSignature {
    pub fn metadata(&self) -> GrantSignerMetadata {
        GrantSignerMetadata {
            device_id: self.device_id.clone(),
            party: self.party,
            algorithm: self.algorithm,
            signed_at: self.signed_at.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Encode, Decode)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PeerShareGrantVersion {
    pub id: String,
    pub owner_user_id: String,
    pub relationship_id: String,
    pub direction: ShareDirection,
    pub sequence: u64,
    pub previous_version_hash: Option<String>,
    pub status: GrantStatus,
    pub label: String,
    #[serde(default)]
    pub purpose: String,
    pub issued_at: String,
    #[serde(default)]
    pub effective_at: Option<String>,
    #[serde(default)]
    pub expires_at: Option<String>,
    #[serde(default)]
    pub revoked_at: Option<String>,
    pub cache_policy: CachePolicy,
    pub rules: Vec<ShareRule>,
    #[serde(default)]
    pub signatures: Vec<GrantSignature>,
    pub protocol_version: String,
    pub schema_version: u8,
}

impl PeerShareGrantVersion {
    pub fn from_json(bytes: &[u8]) -> Result<Self> {
        if bytes.len() > MAX_GRANT_JSON_BYTES {
            return Err(limit("grant JSON exceeds 64 KiB"));
        }
        let mut deserializer = serde_json::Deserializer::from_slice(bytes);
        let grant = Self::deserialize(&mut deserializer)
            .map_err(|error| invalid(format!("invalid grant JSON: {error}")))?;
        deserializer
            .end()
            .map_err(|error| invalid(format!("trailing grant JSON: {error}")))?;
        grant.validate()?;
        Ok(grant)
    }

    pub fn canonical_json(&self) -> Result<Vec<u8>> {
        let canonical = self.canonical_value()?;
        canonicalize_json(&canonical)
    }

    pub fn canonical_consent_json(&self) -> Result<Vec<u8>> {
        let canonical = self.canonical_value()?;
        let mut value = serde_json::to_value(canonical)
            .map_err(|error| invalid(format!("serializing grant consent: {error}")))?;
        let object = value
            .as_object_mut()
            .ok_or_else(|| invalid("grant canonical value is not an object"))?;
        object.remove("status");
        object.remove("revokedAt");
        object.remove("signatures");
        canonicalize_json(&value)
    }

    pub fn signature_payload(&self, signer: &GrantSignerMetadata) -> Result<Vec<u8>> {
        signer.validate()?;
        let consent = self.canonical_consent_json()?;
        let metadata = canonicalize_json(signer)?;
        let total = GRANT_SIGNATURE_DOMAIN.len() + consent.len() + 1 + metadata.len();
        if total > MAX_GRANT_JSON_BYTES {
            return Err(limit("grant signature payload exceeds 64 KiB"));
        }
        let mut payload = Vec::with_capacity(total);
        payload.extend_from_slice(GRANT_SIGNATURE_DOMAIN);
        payload.extend_from_slice(&consent);
        payload.push(0);
        payload.extend_from_slice(&metadata);
        Ok(payload)
    }

    pub fn version_hash(&self) -> Result<[u8; 32]> {
        Ok(Sha256::digest(self.canonical_json()?).into())
    }

    pub fn version_hash_hex(&self) -> Result<String> {
        Ok(hex::encode(self.version_hash()?))
    }

    fn canonical_value(&self) -> Result<Self> {
        self.validate()?;
        let mut canonical = self.clone();
        for rule in &mut canonical.rules {
            if let Some(selector) = &mut rule.entity_selector {
                selector
                    .entity_ids
                    .sort_by(|left, right| js_string_cmp(left, right));
            }
            rule.fields
                .include
                .sort_by(|left, right| js_string_cmp(left, right));
            rule.fields
                .exclude
                .sort_by(|left, right| js_string_cmp(left, right));
            rule.approved_device_ids
                .sort_by(|left, right| js_string_cmp(left, right));
        }
        canonical.rules.sort_by(|left, right| {
            let left = format!(
                "{}:{}:{}",
                left.projection_id.as_str(),
                left.effect.as_str(),
                left.id
            );
            let right = format!(
                "{}:{}:{}",
                right.projection_id.as_str(),
                right.effect.as_str(),
                right.id
            );
            js_string_cmp(&left, &right)
        });
        canonical.signatures.sort_by(|left, right| {
            let left = format!("{}:{}", left.party.as_str(), left.device_id);
            let right = format!("{}:{}", right.party.as_str(), right.device_id);
            js_string_cmp(&left, &right)
        });
        Ok(canonical)
    }
}

impl Validate for PeerShareGrantVersion {
    fn validate(&self) -> Result<()> {
        validate_text(&self.id, 1, 240, "grant id")?;
        validate_ascii_sort_key(&self.id, "grant id")?;
        validate_text(&self.owner_user_id, 1, 240, "owner user id")?;
        validate_text(&self.relationship_id, 1, 240, "relationship id")?;
        if self.sequence == 0 || self.sequence > MAX_SAFE_JSON_INTEGER {
            return Err(invalid(
                "grant sequence must be a positive JavaScript-safe integer",
            ));
        }
        match (self.sequence, &self.previous_version_hash) {
            (1, None) => {}
            (1, Some(_)) => return Err(invalid("first grant version has a previous hash")),
            (_, None) => return Err(invalid("later grant version is missing its previous hash")),
            (_, Some(hash)) => validate_hash(hash, "previous grant hash")?,
        }
        validate_text(&self.label, 1, 160, "grant label")?;
        validate_text(&self.purpose, 0, 2_000, "grant purpose")?;
        let issued = parse_timestamp(&self.issued_at, "grant issuedAt")?;
        let effective = parse_optional_timestamp(self.effective_at.as_ref(), "grant effectiveAt")?;
        let expires = parse_optional_timestamp(self.expires_at.as_ref(), "grant expiresAt")?;
        let revoked = parse_optional_timestamp(self.revoked_at.as_ref(), "grant revokedAt")?;
        if self.sequence == 1 && effective.is_some_and(|value| value < issued) {
            return Err(invalid("grant effectiveAt precedes issuedAt"));
        }
        if self.sequence == 1 && expires.is_some_and(|value| value <= issued) {
            return Err(invalid("grant expiresAt does not follow issuedAt"));
        }
        if effective
            .zip(expires)
            .is_some_and(|(start, end)| start >= end)
        {
            return Err(invalid("grant expiresAt does not follow effectiveAt"));
        }
        if revoked.is_some_and(|value| value < issued) {
            return Err(invalid("grant revokedAt precedes issuedAt"));
        }
        match (self.status, revoked) {
            (GrantStatus::Active, Some(_)) => return Err(invalid("active grant is revoked")),
            (GrantStatus::Revoked, None) => {
                return Err(invalid("revoked grant has no revokedAt timestamp"));
            }
            _ => {}
        }
        self.cache_policy.validate()?;
        if self.rules.is_empty() || self.rules.len() > MAX_RULES {
            return Err(limit("grant rule count must be within 1..=256"));
        }
        let mut rule_ids = HashSet::with_capacity(self.rules.len());
        for rule in &self.rules {
            rule.validate()?;
            if !rule_ids.insert(rule.id.as_str()) {
                return Err(invalid("grant rule ids are not unique"));
            }
        }
        if self.signatures.len() > MAX_SIGNATURES {
            return Err(limit("grant has more than 16 signatures"));
        }
        let mut device_ids = HashSet::with_capacity(self.signatures.len());
        let mut parties = HashSet::with_capacity(2);
        for signature in &self.signatures {
            signature.validate()?;
            if !device_ids.insert(signature.device_id.as_str()) {
                return Err(invalid("a device signed the grant more than once"));
            }
            parties.insert(signature.party);
            let signed_at = parse_timestamp(&signature.signed_at, "grant signature signedAt")?;
            if signed_at < issued {
                return Err(invalid("grant signature predates the grant"));
            }
            if expires.is_some_and(|value| signed_at >= value) {
                return Err(invalid("grant signature is not within the grant lifetime"));
            }
        }
        if self.status == GrantStatus::Active
            && (!parties.contains(&GrantParty::Grantor) || !parties.contains(&GrantParty::Grantee))
        {
            return Err(invalid("active grant lacks signatures from both parties"));
        }
        if self.protocol_version != PROTOCOL_NAME {
            return Err(PeerError::Version(
                "grant protocolVersion is not forge-peer/1".into(),
            ));
        }
        if self.schema_version != 1 {
            return Err(PeerError::Version("grant schemaVersion is not 1".into()));
        }
        if self.canonical_json_unchecked_len()? > MAX_GRANT_JSON_BYTES {
            return Err(limit("canonical grant JSON exceeds 64 KiB"));
        }
        Ok(())
    }
}

impl PeerShareGrantVersion {
    fn canonical_json_unchecked_len(&self) -> Result<usize> {
        serde_json::to_vec(self)
            .map(|bytes| bytes.len())
            .map_err(|error| invalid(format!("serializing grant for size check: {error}")))
    }
}

impl Validate for CachePolicy {
    fn validate(&self) -> Result<()> {
        if self.maximum_retention_seconds > 31_536_000 {
            return Err(limit("cache retention exceeds one year"));
        }
        if self.mode == CacheMode::None && self.maximum_retention_seconds != 0 {
            return Err(invalid("no-cache policy has nonzero retention"));
        }
        if self.mode == CacheMode::Duration && self.maximum_retention_seconds == 0 {
            return Err(invalid("duration cache policy has zero retention"));
        }
        Ok(())
    }
}

impl Validate for ShareRule {
    fn validate(&self) -> Result<()> {
        validate_text(&self.id, 1, 240, "rule id")?;
        validate_ascii_sort_key(&self.id, "rule id")?;
        if let Some(selector) = &self.entity_selector {
            selector.validate()?;
        }
        self.fields.validate()?;
        self.time.validate()?;
        validate_text(&self.precision, 1, 80, "rule precision")?;
        if let Some(aggregation) = &self.aggregation {
            aggregation.validate()?;
        }
        validate_unique_texts(
            &self.approved_device_ids,
            MAX_APPROVED_DEVICES,
            240,
            "approved device id",
        )?;
        for device_id in &self.approved_device_ids {
            validate_ascii_sort_key(device_id, "approved device id")?;
        }
        if self.effect == RuleEffect::Allow
            && self.device_policy == DevicePolicy::Explicit
            && self.approved_device_ids.is_empty()
        {
            return Err(invalid("explicit allow rule has no approved device"));
        }
        if !(1..=10_000).contains(&self.maximum_result_count) {
            return Err(invalid("maximumResultCount is outside 1..=10000"));
        }
        if !(256..=10_485_760).contains(&self.maximum_payload_bytes) {
            return Err(invalid("maximumPayloadBytes is outside 256..=10485760"));
        }
        Ok(())
    }
}

impl Validate for EntitySelector {
    fn validate(&self) -> Result<()> {
        if let Some(entity_type) = &self.entity_type {
            validate_text(entity_type, 1, 80, "entity type")?;
        }
        validate_unique_texts(&self.entity_ids, MAX_ENTITY_IDS, 240, "entity id")?;
        match self.mode {
            EntitySelectorMode::Selected
                if self.entity_type.is_none() || self.entity_ids.is_empty() =>
            {
                Err(invalid("selected entity selector is incomplete"))
            }
            EntitySelectorMode::AllShareable if !self.entity_ids.is_empty() => {
                Err(invalid("all-shareable selector lists entity ids"))
            }
            _ => Ok(()),
        }
    }
}

impl Validate for FieldPolicy {
    fn validate(&self) -> Result<()> {
        validate_unique_field_paths(&self.include, "included field")?;
        validate_unique_field_paths(&self.exclude, "excluded field")?;
        let included: HashSet<&str> = self.include.iter().map(String::as_str).collect();
        if self
            .exclude
            .iter()
            .any(|field| included.contains(field.as_str()))
        {
            return Err(invalid("field appears in both include and exclude"));
        }
        Ok(())
    }
}

impl Validate for TimePolicy {
    fn validate(&self) -> Result<()> {
        let starts = parse_optional_timestamp(self.starts_at.as_ref(), "time policy startsAt")?;
        let ends = parse_optional_timestamp(self.ends_at.as_ref(), "time policy endsAt")?;
        if starts.zip(ends).is_some_and(|(start, end)| start >= end) {
            return Err(invalid("time policy endsAt does not follow startsAt"));
        }
        if self.rolling_past_days.is_some_and(|days| days > 3_650)
            || self.rolling_future_days.is_some_and(|days| days > 3_650)
        {
            return Err(invalid("rolling day limit exceeds 3650"));
        }
        Ok(())
    }
}

impl Validate for AggregationPolicy {
    fn validate(&self) -> Result<()> {
        if !(1..=10_000).contains(&self.minimum_records)
            || !(1..=10_000).contains(&self.maximum_queries_per_day)
            || !self.privacy_budget.is_finite()
            || !(0.0..=10_000.0).contains(&self.privacy_budget)
        {
            return Err(invalid("aggregation policy value is outside its bound"));
        }
        Ok(())
    }
}

impl Validate for GrantSignerMetadata {
    fn validate(&self) -> Result<()> {
        validate_text(&self.device_id, 1, 240, "signer device id")?;
        validate_ascii_sort_key(&self.device_id, "signer device id")?;
        parse_timestamp(&self.signed_at, "signer signedAt")?;
        Ok(())
    }
}

impl Validate for GrantSignature {
    fn validate(&self) -> Result<()> {
        self.metadata().validate()?;
        decode_signature(&self.signature).map(|_| ())
    }
}

#[derive(Debug, Clone)]
pub struct TrustedGrantSigner {
    relationship_id: String,
    external_device_id: String,
    party: GrantParty,
    certificate: DeviceCertificate,
    revoked: bool,
    historical: bool,
}

impl TrustedGrantSigner {
    pub fn new(
        relationship_id: String,
        external_device_id: String,
        party: GrantParty,
        certificate: DeviceCertificate,
    ) -> Result<Self> {
        validate_text(&relationship_id, 1, 240, "trusted relationship id")?;
        validate_text(&external_device_id, 1, 240, "trusted device id")?;
        certificate.verify(certificate.body.not_before)?;
        Ok(Self {
            relationship_id,
            external_device_id,
            party,
            certificate,
            revoked: false,
            historical: false,
        })
    }

    pub fn new_historical(
        relationship_id: String,
        external_device_id: String,
        party: GrantParty,
        certificate: DeviceCertificate,
    ) -> Result<Self> {
        let mut signer = Self::new(relationship_id, external_device_id, party, certificate)?;
        signer.historical = true;
        Ok(signer)
    }
}

pub trait GrantTrustResolver: Send + Sync {
    fn resolve(
        &self,
        relationship_id: &str,
        device_id: &str,
        party: GrantParty,
    ) -> Result<Option<TrustedGrantSigner>>;
}

#[derive(Debug, Default)]
pub struct MemoryGrantTrustStore {
    entries: RwLock<HashMap<(String, String, GrantParty), TrustedGrantSigner>>,
}

impl MemoryGrantTrustStore {
    pub fn insert(&self, signer: TrustedGrantSigner) -> Result<()> {
        let key = (
            signer.relationship_id.clone(),
            signer.external_device_id.clone(),
            signer.party,
        );
        let mut entries = self
            .entries
            .write()
            .map_err(|_| PeerError::StateConflict("grant trust store lock poisoned".into()))?;
        if let Some(current) = entries.get(&key) {
            if current.certificate.body.principal_id != signer.certificate.body.principal_id
                || current.certificate.body.device_id != signer.certificate.body.device_id
            {
                return Err(PeerError::Authentication(
                    "grant signer rotation changes the trusted principal or device".into(),
                ));
            }
            if signer.certificate.body.serial < current.certificate.body.serial {
                return Err(PeerError::Replay(
                    "grant signer certificate serial rolled back".into(),
                ));
            }
            if signer.certificate.body.serial == current.certificate.body.serial
                && signer.certificate.fingerprint()? != current.certificate.fingerprint()?
            {
                return Err(PeerError::StateConflict(
                    "grant signer certificate serial fork detected".into(),
                ));
            }
            if signer.certificate.body.serial > current.certificate.body.serial.saturating_add(1) {
                return Err(PeerError::Replay(
                    "grant signer certificate rotation skipped a serial".into(),
                ));
            }
            if current.revoked {
                return Err(PeerError::Authorization(
                    "revoked grant signer cannot be reactivated in place".into(),
                ));
            }
        }
        entries.insert(key, signer);
        Ok(())
    }

    pub fn revoke(
        &self,
        relationship_id: &str,
        external_device_id: &str,
        party: GrantParty,
    ) -> Result<()> {
        let mut entries = self
            .entries
            .write()
            .map_err(|_| PeerError::StateConflict("grant trust store lock poisoned".into()))?;
        let signer = entries
            .get_mut(&(
                relationship_id.to_owned(),
                external_device_id.to_owned(),
                party,
            ))
            .ok_or_else(|| PeerError::Authorization("grant signer is not trusted".into()))?;
        signer.revoked = true;
        Ok(())
    }
}

impl GrantTrustResolver for MemoryGrantTrustStore {
    fn resolve(
        &self,
        relationship_id: &str,
        device_id: &str,
        party: GrantParty,
    ) -> Result<Option<TrustedGrantSigner>> {
        self.entries
            .read()
            .map_err(|_| PeerError::StateConflict("grant trust store lock poisoned".into()))
            .map(|entries| {
                entries
                    .get(&(relationship_id.to_owned(), device_id.to_owned(), party))
                    .cloned()
            })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VerifiedGrantSigner {
    device_id: String,
    party: GrantParty,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VerifiedGrantEvidence {
    #[serde(rename = "verifiedGrantHash")]
    grant_hash: String,
    #[serde(rename = "verifiedSignerDeviceIds")]
    signer_device_ids: Vec<String>,
    #[serde(rename = "verifiedSigners")]
    signers: Vec<VerifiedGrantSigner>,
}

impl VerifiedGrantEvidence {
    pub fn verified_grant_hash(&self) -> &str {
        &self.grant_hash
    }

    pub fn verified_signer_device_ids(&self) -> &[String] {
        &self.signer_device_ids
    }

    pub fn verified_signers(&self) -> &[VerifiedGrantSigner] {
        &self.signers
    }
}

impl VerifiedGrantSigner {
    pub fn device_id(&self) -> &str {
        &self.device_id
    }

    pub const fn party(&self) -> GrantParty {
        self.party
    }
}

pub fn sign_grant_consent(
    grant: &PeerShareGrantVersion,
    metadata: GrantSignerMetadata,
    signer: &DeviceSigner,
    certificate: &DeviceCertificate,
) -> Result<GrantSignature> {
    metadata.validate()?;
    if certificate.body.device_id != signer.device_id
        || certificate.body.device_public_key != signer.verifying_key_bytes()
    {
        return Err(PeerError::Authentication(
            "grant signer does not match its certified device key".into(),
        ));
    }
    let signed_at = parse_timestamp(&metadata.signed_at, "signer signedAt")?;
    let signed_at_u64 = u64::try_from(signed_at)
        .map_err(|_| PeerError::Authentication("signature timestamp predates Unix epoch".into()))?;
    certificate.verify(signed_at_u64)?;
    let signature = signer.sign_raw(&grant.signature_payload(&metadata)?);
    Ok(GrantSignature {
        device_id: metadata.device_id,
        party: metadata.party,
        algorithm: metadata.algorithm,
        signed_at: metadata.signed_at,
        signature: URL_SAFE_NO_PAD.encode(signature.0),
    })
}

pub fn verify_grant_consent_signature<R: GrantTrustResolver>(
    grant: &PeerShareGrantVersion,
    signed: &GrantSignature,
    resolver: &R,
    now: u64,
) -> Result<()> {
    grant.validate()?;
    signed.validate()?;
    let trusted = resolver
        .resolve(&grant.relationship_id, &signed.device_id, signed.party)?
        .ok_or_else(|| {
            PeerError::Authentication(format!(
                "grant signer {} is not trusted for the relationship party",
                signed.device_id
            ))
        })?;
    if trusted.relationship_id != grant.relationship_id
        || trusted.external_device_id != signed.device_id
        || trusted.party != signed.party
    {
        return Err(PeerError::Authentication(
            "grant trust resolver returned a mismatched binding".into(),
        ));
    }
    if trusted.revoked {
        return Err(PeerError::Authorization(
            "grant signer is locally revoked".into(),
        ));
    }
    if !trusted.historical {
        trusted.certificate.verify(now)?;
    }
    let now_i64 = i64::try_from(now)
        .map_err(|_| PeerError::Authorization("current time exceeds grant time domain".into()))?;
    let skew = i64::try_from(MAX_CLOCK_SKEW_SECONDS)
        .map_err(|_| PeerError::StateConflict("clock skew does not fit i64".into()))?;
    let signed_at = parse_timestamp(&signed.signed_at, "signature signedAt")?;
    if signed_at > now_i64.saturating_add(skew) {
        return Err(PeerError::Authentication(
            "grant signature timestamp is too far in the future".into(),
        ));
    }
    verify_certificate_at(&trusted.certificate, signed_at)?;
    let key = VerifyingKey::from_bytes(&trusted.certificate.body.device_public_key)
        .map_err(|_| PeerError::Authentication("invalid grant signer public key".into()))?;
    let signature = decode_signature(&signed.signature)?;
    key.verify(
        &grant.signature_payload(&signed.metadata())?,
        &Signature::from_bytes(&signature),
    )
    .map_err(|_| PeerError::Authentication("grant consent signature failed".into()))
}

pub fn verify_active_grant<R: GrantTrustResolver>(
    grant: &PeerShareGrantVersion,
    resolver: &R,
    now: u64,
) -> Result<VerifiedGrantEvidence> {
    grant.validate()?;
    if grant.status != GrantStatus::Active {
        return Err(PeerError::Authorization(
            "exact-grant evidence is issued only for active grants".into(),
        ));
    }
    let now_i64 = i64::try_from(now).map_err(|_| {
        PeerError::Authorization("current time exceeds the grant time domain".into())
    })?;
    let skew = i64::try_from(MAX_CLOCK_SKEW_SECONDS)
        .map_err(|_| PeerError::StateConflict("clock skew does not fit i64".into()))?;
    let issued_at = parse_timestamp(&grant.issued_at, "grant issuedAt")?;
    let effective_at = parse_optional_timestamp(grant.effective_at.as_ref(), "grant effectiveAt")?
        .unwrap_or(issued_at);
    if effective_at > now_i64.saturating_add(skew) {
        return Err(PeerError::Authorization(
            "active grant is not yet effective".into(),
        ));
    }
    if parse_optional_timestamp(grant.expires_at.as_ref(), "grant expiresAt")?
        .is_some_and(|expires_at| now_i64 >= expires_at)
    {
        return Err(PeerError::Authorization("active grant has expired".into()));
    }
    let mut verified_signers = Vec::with_capacity(grant.signatures.len());
    for signed in &grant.signatures {
        let trusted = resolver
            .resolve(&grant.relationship_id, &signed.device_id, signed.party)?
            .ok_or_else(|| {
                PeerError::Authentication(format!(
                    "grant signer {} is not trusted for the relationship party",
                    signed.device_id
                ))
            })?;
        if trusted.relationship_id != grant.relationship_id
            || trusted.external_device_id != signed.device_id
            || trusted.party != signed.party
        {
            return Err(PeerError::Authentication(
                "grant trust resolver returned a mismatched binding".into(),
            ));
        }
        if trusted.revoked {
            return Err(PeerError::Authorization(
                "grant signer is locally revoked".into(),
            ));
        }
        trusted.certificate.verify(now)?;
        let signed_at = parse_timestamp(&signed.signed_at, "signature signedAt")?;
        if signed_at > now_i64.saturating_add(skew) {
            return Err(PeerError::Authentication(
                "grant signature timestamp is too far in the future".into(),
            ));
        }
        verify_certificate_at(&trusted.certificate, signed_at)?;
        let key = VerifyingKey::from_bytes(&trusted.certificate.body.device_public_key)
            .map_err(|_| PeerError::Authentication("invalid grant signer public key".into()))?;
        let signature = decode_signature(&signed.signature)?;
        key.verify(
            &grant.signature_payload(&signed.metadata())?,
            &Signature::from_bytes(&signature),
        )
        .map_err(|_| PeerError::Authentication("grant consent signature failed".into()))?;
        verified_signers.push(VerifiedGrantSigner {
            device_id: signed.device_id.clone(),
            party: signed.party,
        });
    }
    let parties: HashSet<GrantParty> = verified_signers.iter().map(|value| value.party).collect();
    let devices: HashSet<&str> = verified_signers
        .iter()
        .map(|value| value.device_id.as_str())
        .collect();
    if !parties.contains(&GrantParty::Grantor)
        || !parties.contains(&GrantParty::Grantee)
        || devices.len() < 2
    {
        return Err(PeerError::Authentication(
            "active grant does not have distinct verified parties and devices".into(),
        ));
    }
    verified_signers.sort_by(|left, right| {
        js_string_cmp(
            &format!("{}:{}", left.party.as_str(), left.device_id),
            &format!("{}:{}", right.party.as_str(), right.device_id),
        )
    });
    let mut verified_signer_device_ids: Vec<String> = verified_signers
        .iter()
        .map(|value| value.device_id.clone())
        .collect();
    verified_signer_device_ids.sort_by(|left, right| js_string_cmp(left, right));
    Ok(VerifiedGrantEvidence {
        grant_hash: grant.version_hash_hex()?,
        signer_device_ids: verified_signer_device_ids,
        signers: verified_signers,
    })
}

fn canonicalize_json(value: &impl Serialize) -> Result<Vec<u8>> {
    serde_json_canonicalizer::to_vec(value)
        .map_err(|error| invalid(format!("canonical JSON serialization failed: {error}")))
}

fn decode_signature(value: &str) -> Result<[u8; 64]> {
    if !(64..=256).contains(&value.len())
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    {
        return Err(invalid("grant signature is not unpadded base64url"));
    }
    let bytes = URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| invalid("grant signature base64url is invalid"))?;
    if URL_SAFE_NO_PAD.encode(&bytes) != value {
        return Err(invalid("grant signature base64url is not canonical"));
    }
    bytes
        .try_into()
        .map_err(|_| invalid("grant Ed25519 signature is not 64 bytes"))
}

fn verify_certificate_at(certificate: &DeviceCertificate, timestamp: i64) -> Result<()> {
    let timestamp = u64::try_from(timestamp)
        .map_err(|_| PeerError::Authentication("signature timestamp predates Unix epoch".into()))?;
    if timestamp.saturating_add(MAX_CLOCK_SKEW_SECONDS) < certificate.body.not_before
        || timestamp
            > certificate
                .body
                .not_after
                .saturating_add(MAX_CLOCK_SKEW_SECONDS)
    {
        return Err(PeerError::Authentication(
            "grant signature timestamp is outside certificate validity".into(),
        ));
    }
    Ok(())
}

fn parse_timestamp(value: &str, label: &str) -> Result<i64> {
    OffsetDateTime::parse(value, &Rfc3339)
        .map(OffsetDateTime::unix_timestamp)
        .map_err(|_| invalid(format!("{label} is not RFC 3339 with an offset")))
}

fn parse_optional_timestamp(value: Option<&String>, label: &str) -> Result<Option<i64>> {
    value
        .map(String::as_str)
        .map(|value| parse_timestamp(value, label))
        .transpose()
}

fn validate_hash(value: &str, label: &str) -> Result<()> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err(invalid(format!("{label} is not lowercase SHA-256 hex")));
    }
    Ok(())
}

fn validate_text(value: &str, minimum: usize, maximum: usize, label: &str) -> Result<()> {
    if value != value.trim() || value.chars().count() < minimum || value.chars().count() > maximum {
        return Err(invalid(format!(
            "{label} is empty, untrimmed, or oversized"
        )));
    }
    if value.contains('\0') {
        return Err(invalid(format!("{label} contains NUL")));
    }
    Ok(())
}

fn validate_ascii_sort_key(value: &str, label: &str) -> Result<()> {
    if !value.is_ascii() {
        return Err(invalid(format!(
            "{label} must be ASCII because the TypeScript localeCompare contract is otherwise locale-dependent"
        )));
    }
    Ok(())
}

fn validate_unique_texts(
    values: &[String],
    maximum: usize,
    text_maximum: usize,
    label: &str,
) -> Result<()> {
    if values.len() > maximum {
        return Err(limit(format!("{label} list exceeds {maximum}")));
    }
    let mut unique = HashSet::with_capacity(values.len());
    for value in values {
        validate_text(value, 1, text_maximum, label)?;
        if !unique.insert(value.as_str()) {
            return Err(invalid(format!("{label} list contains duplicates")));
        }
    }
    Ok(())
}

fn validate_unique_field_paths(values: &[String], label: &str) -> Result<()> {
    validate_unique_texts(values, MAX_FIELDS, 120, label)?;
    for value in values {
        if !is_field_path(value) {
            return Err(invalid(format!("{label} is not a structured dotted path")));
        }
    }
    Ok(())
}

fn is_field_path(value: &str) -> bool {
    value.split('.').all(|segment| {
        let mut bytes = segment.bytes();
        bytes.next().is_some_and(|byte| byte.is_ascii_alphabetic())
            && bytes.all(|byte| byte.is_ascii_alphanumeric())
    })
}

fn js_string_cmp(left: &str, right: &str) -> std::cmp::Ordering {
    left.encode_utf16().cmp(right.encode_utf16())
}

const fn default_true() -> bool {
    true
}

const fn default_minimum_records() -> u16 {
    3
}

const fn default_granularity() -> AggregationGranularity {
    AggregationGranularity::Week
}

fn default_privacy_budget() -> f64 {
    30.0
}

const fn default_maximum_queries() -> u16 {
    30
}

const fn default_device_policy() -> DevicePolicy {
    DevicePolicy::Explicit
}

const fn default_maximum_result_count() -> u16 {
    100
}

const fn default_maximum_payload_bytes() -> u32 {
    262_144
}
