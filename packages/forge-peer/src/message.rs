use bincode::{Decode, Encode};

use crate::codec::{BoundedBytes, BoundedString, BoundedVec, Validate};
use crate::endpoint::{EndpointDescriptor, MAX_ENDPOINTS_PER_PEER};
use crate::error::{Result, invalid};
use crate::grant::{GrantStatus, PeerShareGrantVersion};
use crate::identity::{
    DeviceCapabilities, DeviceCertificate, DeviceId, PrincipalId, ProtocolRange,
};
use crate::pairing::SignedPairingTranscript;

const MAX_QUERY_WINDOW_SECONDS: u64 = 366 * 24 * 60 * 60;
const MAX_QUERY_LIFETIME_SECONDS: u64 = 5 * 60;
const MAX_SELECTED_RECORDS: usize = 256;
const MAX_FIELDS_PER_RULE: usize = 64;
const MAX_PROJECTION_RECORDS: usize = 64;
const MAX_REDACTIONS: usize = 64;
const MAX_QUERY_RESPONSE_BYTES: u32 = 48 * 1024;

macro_rules! opaque_id {
    ($name:ident, $size:expr, $label:literal) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Encode, Decode)]
        pub struct $name(pub [u8; $size]);

        impl $name {
            pub fn random() -> Self {
                Self(rand::random())
            }
        }

        impl Validate for $name {
            fn validate(&self) -> Result<()> {
                if self.0 == [0; $size] {
                    return Err(invalid(concat!($label, " is all zero")));
                }
                Ok(())
            }
        }
    };
}

opaque_id!(RelationshipId, 16, "relationship id");
opaque_id!(GrantId, 16, "grant id");
opaque_id!(QueryId, 16, "query id");
opaque_id!(OpaqueRecordId, 32, "opaque record id");

#[derive(Debug, Clone, Copy, PartialEq, Eq, Encode, Decode)]
pub enum ProjectionId {
    CalendarAvailabilityV1,
    CalendarSelectedEventsV1,
    GoalsHorizonSummaryV1,
    HealthCyclingAggregateV1,
    PersonProfileV1,
    LifeEventsSelectedV1,
    MovementAggregateV1,
    CustomSelectedEntitiesV1,
}

impl Validate for ProjectionId {
    fn validate(&self) -> Result<()> {
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Encode, Decode)]
pub enum ProjectionField {
    Start,
    End,
    Timezone,
    BusyState,
    EventTitle,
    EventLocation,
    GoalTitle,
    GoalSummary,
    GoalState,
    GoalProgress,
    Duration,
    Distance,
    ActivityCount,
    Energy,
    DisplayName,
    PreferredName,
    Pronouns,
    RelationshipLabel,
    ShortDescription,
    LifeEventTitle,
    LifeEventType,
    LifeEventPlace,
    MovementDuration,
    MovementDistance,
    CustomTitle,
    CustomSummary,
    CustomState,
}

impl Validate for ProjectionField {
    fn validate(&self) -> Result<()> {
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Encode, Decode)]
pub enum Precision {
    Exact,
    FifteenMinutes,
    Hour,
    Day,
    Week,
    Month,
    AggregateOnly,
}

impl Validate for Precision {
    fn validate(&self) -> Result<()> {
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Encode, Decode)]
pub enum Granularity {
    Day,
    Week,
    Month,
}

impl Validate for Granularity {
    fn validate(&self) -> Result<()> {
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Encode, Decode)]
pub struct TimeRange {
    pub start: u64,
    pub end: u64,
}

impl Validate for TimeRange {
    fn validate(&self) -> Result<()> {
        if self.start >= self.end {
            return Err(invalid("time range is empty"));
        }
        if self.end - self.start > MAX_QUERY_WINDOW_SECONDS {
            return Err(invalid("time range exceeds one year"));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode)]
pub enum TypedQuery {
    CalendarAvailability {
        range: TimeRange,
        timezone: BoundedString<64>,
        precision: Precision,
    },
    CalendarSelectedEvents {
        range: TimeRange,
        record_ids: BoundedVec<OpaqueRecordId, MAX_SELECTED_RECORDS>,
    },
    GoalsHorizonSummary {
        horizon: TimeRange,
    },
    HealthCyclingAggregate {
        range: TimeRange,
        granularity: Granularity,
        units: BoundedString<16>,
    },
    PersonProfile {
        fields: BoundedVec<ProjectionField, MAX_FIELDS_PER_RULE>,
    },
    LifeEventsSelected {
        range: TimeRange,
        record_ids: BoundedVec<OpaqueRecordId, MAX_SELECTED_RECORDS>,
    },
    MovementAggregate {
        range: TimeRange,
        granularity: Granularity,
    },
    CustomSelectedEntities {
        record_ids: BoundedVec<OpaqueRecordId, MAX_SELECTED_RECORDS>,
        fields: BoundedVec<ProjectionField, MAX_FIELDS_PER_RULE>,
    },
}

impl TypedQuery {
    pub const fn projection(&self) -> ProjectionId {
        match self {
            Self::CalendarAvailability { .. } => ProjectionId::CalendarAvailabilityV1,
            Self::CalendarSelectedEvents { .. } => ProjectionId::CalendarSelectedEventsV1,
            Self::GoalsHorizonSummary { .. } => ProjectionId::GoalsHorizonSummaryV1,
            Self::HealthCyclingAggregate { .. } => ProjectionId::HealthCyclingAggregateV1,
            Self::PersonProfile { .. } => ProjectionId::PersonProfileV1,
            Self::LifeEventsSelected { .. } => ProjectionId::LifeEventsSelectedV1,
            Self::MovementAggregate { .. } => ProjectionId::MovementAggregateV1,
            Self::CustomSelectedEntities { .. } => ProjectionId::CustomSelectedEntitiesV1,
        }
    }
}

impl Validate for TypedQuery {
    fn validate(&self) -> Result<()> {
        match self {
            Self::CalendarAvailability {
                range,
                timezone,
                precision,
            } => {
                range.validate()?;
                validate_non_empty_string(timezone, "timezone")?;
                precision.validate()
            }
            Self::CalendarSelectedEvents { range, record_ids }
            | Self::LifeEventsSelected { range, record_ids } => {
                range.validate()?;
                record_ids.validate()?;
                if record_ids.is_empty() {
                    return Err(invalid("selected-record query has no record ids"));
                }
                Ok(())
            }
            Self::GoalsHorizonSummary { horizon }
            | Self::MovementAggregate { range: horizon, .. } => horizon.validate(),
            Self::HealthCyclingAggregate {
                range,
                granularity,
                units,
            } => {
                range.validate()?;
                granularity.validate()?;
                validate_non_empty_string(units, "units")
            }
            Self::PersonProfile { fields } => {
                fields.validate()?;
                if fields.is_empty() {
                    return Err(invalid("person profile query has no selected fields"));
                }
                Ok(())
            }
            Self::CustomSelectedEntities { record_ids, fields } => {
                record_ids.validate()?;
                fields.validate()?;
                if record_ids.is_empty() || fields.is_empty() {
                    return Err(invalid(
                        "custom selected-entity query needs explicit records and fields",
                    ));
                }
                Ok(())
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode)]
pub struct QueryRequest {
    pub query_id: QueryId,
    pub relationship_id: RelationshipId,
    pub grant_id: GrantId,
    pub grant_sequence: u64,
    pub requested_at: u64,
    pub expires_at: u64,
    pub query: TypedQuery,
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode)]
pub struct QueryRequestV2 {
    pub request: QueryRequest,
    pub requested_fields: BoundedVec<ProjectionField, MAX_FIELDS_PER_RULE>,
    pub maximum_result_count: u16,
    pub maximum_payload_bytes: u32,
}

impl Validate for QueryRequestV2 {
    fn validate(&self) -> Result<()> {
        self.request.validate()?;
        self.requested_fields.validate()?;
        if self.requested_fields.is_empty()
            || self
                .requested_fields
                .as_slice()
                .iter()
                .enumerate()
                .any(|(index, field)| self.requested_fields.as_slice()[..index].contains(field))
        {
            return Err(invalid(
                "V2 query request fields must be nonempty and unique",
            ));
        }
        if self.maximum_result_count == 0 || self.maximum_result_count > 64 {
            return Err(invalid(
                "V2 query maximum result count must be within 1..=64",
            ));
        }
        if !(256..=MAX_QUERY_RESPONSE_BYTES).contains(&self.maximum_payload_bytes) {
            return Err(invalid(
                "V2 query maximum payload bytes must be within 256..=49152",
            ));
        }
        let embedded_fields = match &self.request.query {
            TypedQuery::PersonProfile { fields }
            | TypedQuery::CustomSelectedEntities { fields, .. } => Some(fields.as_slice()),
            _ => None,
        };
        if embedded_fields.is_some_and(|fields| fields != self.requested_fields.as_slice()) {
            return Err(invalid(
                "V2 query requested fields differ from its typed query fields",
            ));
        }
        Ok(())
    }
}

impl Validate for QueryRequest {
    fn validate(&self) -> Result<()> {
        self.query_id.validate()?;
        self.relationship_id.validate()?;
        self.grant_id.validate()?;
        if self.grant_sequence == 0 {
            return Err(invalid("query grant sequence must be non-zero"));
        }
        if self.requested_at >= self.expires_at
            || self.expires_at - self.requested_at > MAX_QUERY_LIFETIME_SECONDS
        {
            return Err(invalid("query lifetime is empty or too long"));
        }
        self.query.validate()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Encode, Decode)]
pub enum RecordOperation {
    Upsert,
    Tombstone,
    GrantWithdrawal,
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode)]
pub struct ProjectionRecord {
    pub record_id: OpaqueRecordId,
    pub version: u64,
    pub operation: RecordOperation,
    pub source_timestamp: u64,
    pub valid_until: u64,
    pub payload: BoundedBytes<{ 16 * 1024 }>,
}

impl Validate for ProjectionRecord {
    fn validate(&self) -> Result<()> {
        self.record_id.validate()?;
        if self.version == 0 {
            return Err(invalid("projection record version must be non-zero"));
        }
        if self.source_timestamp > self.valid_until {
            return Err(invalid(
                "projection record validity precedes its source timestamp",
            ));
        }
        self.payload.validate()?;
        if matches!(
            self.operation,
            RecordOperation::Tombstone | RecordOperation::GrantWithdrawal
        ) && !self.payload.is_empty()
        {
            return Err(invalid("projection tombstones cannot carry record payload"));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode)]
pub struct ProjectionDelta {
    pub relationship_id: RelationshipId,
    pub projection: ProjectionId,
    pub grant_id: GrantId,
    pub grant_sequence: u64,
    pub projection_sequence: u64,
    pub previous_delta_hash: [u8; 32],
    pub records: BoundedVec<ProjectionRecord, MAX_PROJECTION_RECORDS>,
}

impl Validate for ProjectionDelta {
    fn validate(&self) -> Result<()> {
        self.relationship_id.validate()?;
        self.projection.validate()?;
        self.grant_id.validate()?;
        if self.grant_sequence == 0 || self.projection_sequence == 0 {
            return Err(invalid("projection sequences must be non-zero"));
        }
        if self.projection_sequence == 1 && self.previous_delta_hash != [0; 32] {
            return Err(invalid("first projection delta cannot link a predecessor"));
        }
        if self.projection_sequence > 1 && self.previous_delta_hash == [0; 32] {
            return Err(invalid("projection delta is missing its predecessor hash"));
        }
        self.records.validate()?;
        if self.records.is_empty() {
            return Err(invalid("projection delta has no records"));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Encode, Decode)]
pub enum Completeness {
    Complete,
    Partial,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Encode, Decode)]
pub enum FreshnessState {
    Live,
    Cached,
    Stale,
    Revoked,
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode)]
pub struct ResponseMetadata {
    pub source_principal: PrincipalId,
    pub source_device: DeviceId,
    pub as_of: u64,
    pub received_at: u64,
    pub valid_until: u64,
    pub grant_id: GrantId,
    pub grant_sequence: u64,
    pub projection: ProjectionId,
    pub completeness: Completeness,
    pub precision: Precision,
    pub freshness: FreshnessState,
    pub redactions: BoundedVec<ProjectionField, MAX_REDACTIONS>,
}

impl Validate for ResponseMetadata {
    fn validate(&self) -> Result<()> {
        self.source_principal.validate()?;
        self.source_device.validate()?;
        if self.as_of > self.received_at || self.received_at > self.valid_until {
            return Err(invalid("response freshness timestamps are not ordered"));
        }
        self.grant_id.validate()?;
        if self.grant_sequence == 0 {
            return Err(invalid("response grant sequence must be non-zero"));
        }
        self.projection.validate()?;
        self.precision.validate()?;
        self.redactions.validate()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Encode, Decode)]
pub enum UnavailableReason {
    Offline,
    NotGranted,
    Expired,
    Revoked,
    RateLimited,
    PrivacyBudgetExhausted,
    Unsupported,
    ResyncRequired,
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode)]
pub enum QueryOutcome {
    Records(BoundedVec<ProjectionRecord, MAX_PROJECTION_RECORDS>),
    Unavailable(UnavailableReason),
}

impl Validate for QueryOutcome {
    fn validate(&self) -> Result<()> {
        match self {
            Self::Records(records) => {
                records.validate()?;
                Ok(())
            }
            Self::Unavailable(_) => Ok(()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode)]
pub struct QueryResponse {
    pub query_id: QueryId,
    pub metadata: ResponseMetadata,
    pub outcome: QueryOutcome,
}

impl Validate for QueryResponse {
    fn validate(&self) -> Result<()> {
        self.query_id.validate()?;
        self.metadata.validate()?;
        self.outcome.validate()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode)]
pub struct PairingFinalization {
    pub relationship_id: RelationshipId,
    pub transcript: SignedPairingTranscript,
}

impl Validate for PairingFinalization {
    fn validate(&self) -> Result<()> {
        self.relationship_id.validate()?;
        self.transcript.validate()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode)]
pub struct Acknowledgement {
    pub highest_contiguous_sequence: u64,
    pub received_bitmap: u64,
}

impl Validate for Acknowledgement {
    fn validate(&self) -> Result<()> {
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode)]
pub struct DeviceUpdate {
    pub certificate: DeviceCertificate,
    pub endpoints: BoundedVec<EndpointDescriptor, MAX_ENDPOINTS_PER_PEER>,
    pub previous_update_hash: [u8; 32],
    pub sequence: u64,
}

impl Validate for DeviceUpdate {
    fn validate(&self) -> Result<()> {
        self.certificate.validate()?;
        self.endpoints.validate()?;
        if self.endpoints.is_empty() || self.sequence == 0 {
            return Err(invalid("device update requires endpoints and a sequence"));
        }
        if self.sequence > 1 && self.previous_update_hash == [0; 32] {
            return Err(invalid("later device update is missing its previous hash"));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode)]
pub struct DeviceRemoval {
    pub device_id: DeviceId,
    pub removal_sequence: u64,
    pub previous_update_hash: [u8; 32],
    pub removed_at: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode)]
pub struct RelationshipRevocation {
    pub relationship_id: RelationshipId,
    pub revoked_at: u64,
    pub reason: BoundedString<1024>,
}

impl Validate for RelationshipRevocation {
    fn validate(&self) -> Result<()> {
        self.relationship_id.validate()?;
        if self.revoked_at == 0 {
            return Err(invalid("relationship revocation timestamp is zero"));
        }
        self.reason.validate()?;
        if self.reason.as_str().is_empty() || self.reason.as_str().trim() != self.reason.as_str() {
            return Err(invalid(
                "relationship revocation reason is empty or untrimmed",
            ));
        }
        Ok(())
    }
}

impl Validate for DeviceRemoval {
    fn validate(&self) -> Result<()> {
        self.device_id.validate()?;
        if self.removal_sequence == 0
            || self.previous_update_hash == [0; 32]
            || self.removed_at == 0
        {
            return Err(invalid("device removal is missing sequence chain data"));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode)]
pub struct KeyPackageDelivery {
    pub device_id: DeviceId,
    pub expires_at: u64,
    pub openmls_key_package: BoundedBytes<{ 64 * 1024 }>,
}

impl Validate for KeyPackageDelivery {
    fn validate(&self) -> Result<()> {
        self.device_id.validate()?;
        self.openmls_key_package.validate()?;
        if self.openmls_key_package.is_empty() {
            return Err(invalid("OpenMLS key package is empty"));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode)]
pub struct ResyncRequest {
    pub relationship_id: RelationshipId,
    pub projection: ProjectionId,
    pub last_good_epoch: u64,
    pub last_good_sequence: u64,
    pub state_authenticator: [u8; 32],
}

impl Validate for ResyncRequest {
    fn validate(&self) -> Result<()> {
        self.relationship_id.validate()?;
        self.projection.validate()?;
        if self.state_authenticator == [0; 32] {
            return Err(invalid("resync state authenticator is all zero"));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Encode, Decode)]
pub enum ProtocolErrorCode {
    InvalidMessage,
    Unauthorized,
    GrantRejected,
    ReplayRejected,
    VersionRejected,
    Expired,
    RateLimited,
    ResyncRequired,
    TemporarilyUnavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode)]
pub struct ProtocolErrorMessage {
    pub code: ProtocolErrorCode,
    pub retryable: bool,
    pub related_id: Option<[u8; 16]>,
    pub detail: BoundedString<256>,
}

impl Validate for ProtocolErrorMessage {
    fn validate(&self) -> Result<()> {
        self.detail.validate()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode)]
pub struct CapabilityUpdate {
    pub device_id: DeviceId,
    pub protocol_range: ProtocolRange,
    pub capabilities: DeviceCapabilities,
    pub sequence: u64,
    pub previous_update_hash: [u8; 32],
}

impl Validate for CapabilityUpdate {
    fn validate(&self) -> Result<()> {
        self.device_id.validate()?;
        self.protocol_range.validate()?;
        self.capabilities.validate()?;
        if self.sequence == 0 {
            return Err(invalid("capability update sequence must be non-zero"));
        }
        if self.sequence > 1 && self.previous_update_hash == [0; 32] {
            return Err(invalid("capability update is missing its predecessor hash"));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Encode, Decode)]
pub enum MessageKind {
    PairingFinalization,
    GrantProposal,
    GrantAcceptance,
    GrantRevocation,
    ProjectionDelta,
    QueryRequest,
    QueryResponse,
    Acknowledgement,
    DeviceUpdate,
    DeviceRemoval,
    KeyPackageDelivery,
    ResyncRequest,
    Error,
    CapabilityUpdate,
    RelationshipRevocation,
}

impl Validate for MessageKind {
    fn validate(&self) -> Result<()> {
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Encode, Decode)]
pub enum ApplicationMessage {
    PairingFinalization(Box<PairingFinalization>),
    GrantProposal(Box<PeerShareGrantVersion>),
    GrantAcceptance(Box<PeerShareGrantVersion>),
    GrantRevocation(Box<PeerShareGrantVersion>),
    ProjectionDelta(ProjectionDelta),
    QueryRequest(QueryRequest),
    QueryResponse(QueryResponse),
    Acknowledgement(Acknowledgement),
    DeviceUpdate(DeviceUpdate),
    DeviceRemoval(DeviceRemoval),
    KeyPackageDelivery(KeyPackageDelivery),
    ResyncRequest(ResyncRequest),
    Error(ProtocolErrorMessage),
    CapabilityUpdate(CapabilityUpdate),
    RelationshipRevocation(RelationshipRevocation),
    QueryRequestV2(QueryRequestV2),
}

impl ApplicationMessage {
    pub const fn kind(&self) -> MessageKind {
        match self {
            Self::PairingFinalization(_) => MessageKind::PairingFinalization,
            Self::GrantProposal(_) => MessageKind::GrantProposal,
            Self::GrantAcceptance(_) => MessageKind::GrantAcceptance,
            Self::GrantRevocation(_) => MessageKind::GrantRevocation,
            Self::ProjectionDelta(_) => MessageKind::ProjectionDelta,
            Self::QueryRequest(_) | Self::QueryRequestV2(_) => MessageKind::QueryRequest,
            Self::QueryResponse(_) => MessageKind::QueryResponse,
            Self::Acknowledgement(_) => MessageKind::Acknowledgement,
            Self::DeviceUpdate(_) => MessageKind::DeviceUpdate,
            Self::DeviceRemoval(_) => MessageKind::DeviceRemoval,
            Self::KeyPackageDelivery(_) => MessageKind::KeyPackageDelivery,
            Self::ResyncRequest(_) => MessageKind::ResyncRequest,
            Self::Error(_) => MessageKind::Error,
            Self::CapabilityUpdate(_) => MessageKind::CapabilityUpdate,
            Self::RelationshipRevocation(_) => MessageKind::RelationshipRevocation,
        }
    }
}

impl Validate for ApplicationMessage {
    fn validate(&self) -> Result<()> {
        match self {
            Self::PairingFinalization(value) => value.validate(),
            Self::GrantProposal(value) => {
                value.validate()?;
                if !matches!(value.status, GrantStatus::Proposed | GrantStatus::Countered) {
                    return Err(invalid("grant proposal message has a non-proposed state"));
                }
                Ok(())
            }
            Self::GrantAcceptance(value) => {
                value.validate()?;
                if value.status != GrantStatus::Active {
                    return Err(invalid("grant acceptance message has a non-accepted state"));
                }
                Ok(())
            }
            Self::GrantRevocation(value) => {
                value.validate()?;
                if value.status != GrantStatus::Revoked {
                    return Err(invalid("grant revocation message has a non-revoked state"));
                }
                Ok(())
            }
            Self::ProjectionDelta(value) => value.validate(),
            Self::QueryRequest(value) => value.validate(),
            Self::QueryResponse(value) => value.validate(),
            Self::Acknowledgement(value) => value.validate(),
            Self::DeviceUpdate(value) => value.validate(),
            Self::DeviceRemoval(value) => value.validate(),
            Self::KeyPackageDelivery(value) => value.validate(),
            Self::ResyncRequest(value) => value.validate(),
            Self::Error(value) => value.validate(),
            Self::CapabilityUpdate(value) => value.validate(),
            Self::RelationshipRevocation(value) => value.validate(),
            Self::QueryRequestV2(value) => value.validate(),
        }
    }
}

fn validate_non_empty_string<const N: usize>(value: &BoundedString<N>, label: &str) -> Result<()> {
    value.validate()?;
    if value.as_str().trim().is_empty() {
        return Err(invalid(format!("{label} is empty")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn typed_query_projection_cannot_be_substituted() -> Result<()> {
        let query = TypedQuery::HealthCyclingAggregate {
            range: TimeRange {
                start: 100,
                end: 200,
            },
            granularity: Granularity::Week,
            units: BoundedString::new("metric")?,
        };
        query.validate()?;
        assert_eq!(query.projection(), ProjectionId::HealthCyclingAggregateV1);
        Ok(())
    }
}
