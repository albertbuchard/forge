use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use ed25519_dalek::{Signature, Verifier as _, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};
use subtle::ConstantTimeEq as _;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use crate::error::{PeerError, Result, invalid, limit};

pub const COMMAND_AUTHORIZATION_PROTOCOL: &str = "forge-peer-command-authorization/v1";
pub const COMMAND_AUTHORITY_STATE_PROTOCOL: &str = "forge-peer-command-authority-state/v1";
pub const COMMAND_AUTHORITY_STATE_FILE: &str = "command-authorization-state.json";
pub const MAX_COMMAND_AUTHORITY_STATE_BYTES: usize = 256 * 1024;

const COMMAND_AUTHORIZATION_DOMAIN: &[u8] = b"forge-peer/node-command-authorization/v1\0";
const COMMAND_AUTHORITY_STATE_DOMAIN: &[u8] = b"forge-peer/node-command-authority-state/v1\0";
const COMMAND_AUTHORITY_KEY_ID_DOMAIN: &[u8] = b"forge-peer/node-command-authority-key-id/v1\0";
const MAX_AUTHORIZATION_ID_BYTES: usize = 240;
const MAX_ACTOR_ID_BYTES: usize = 240;
const MAX_SESSION_ID_BYTES: usize = 240;
const MAX_CAPABILITY_ID_BYTES: usize = 240;
const MAX_OWNER_ID_BYTES: usize = 240;
const MAX_REVOKED_IDENTIFIERS: usize = 128;
const MAX_AUTHORIZATION_WINDOW_SECONDS: u64 = 24 * 60 * 60;
const MAX_CLOCK_SKEW_SECONDS: u64 = 300;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CommandActorClass {
    OperatorSession,
    CompanionConsent,
    ServiceWorker,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommandActor {
    pub class: CommandActorClass,
    pub actor_id: String,
    pub session_id: String,
    pub device_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CommandCapabilityKind {
    HumanApproval,
    QueryWorker,
    RevocationConsumer,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CommandCapabilityState {
    Consumed,
    Active,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NodeCommandCapability {
    pub kind: CommandCapabilityKind,
    pub capability_id: String,
    pub action_digest: String,
    pub state: CommandCapabilityState,
    pub issued_at: String,
    pub expires_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommandAuthorization {
    pub protocol: String,
    pub authority_key_id: String,
    pub authorization_id: String,
    pub owner_user_id: String,
    pub actor: CommandActor,
    pub capability: NodeCommandCapability,
    pub action: String,
    pub command_id: String,
    pub command_digest: String,
    pub approval_deadline: String,
    pub issued_at: String,
    pub invalidation_epoch: String,
    pub signature: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommandAuthorityState {
    pub protocol: String,
    pub authority_key_id: String,
    pub owner_user_id: String,
    pub epoch: String,
    pub invalidated_before: String,
    pub revoked_authorization_ids: Vec<String>,
    pub revoked_session_ids: Vec<String>,
    pub revoked_device_ids: Vec<String>,
    pub signature: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedCommandAuthorityState {
    pub epoch: u64,
    pub state_hash: [u8; 32],
    pub invalidated_before: u64,
    revoked_authorization_ids: Vec<String>,
    revoked_session_ids: Vec<String>,
    revoked_device_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommandAuthorizationProvenance {
    pub authority_key_id: String,
    pub authorization_id: Option<String>,
    pub actor_class: Option<CommandActorClass>,
    pub actor_id: Option<String>,
    pub actor_device_id: Option<String>,
    pub session_id: Option<String>,
    pub capability_id: Option<String>,
    pub action_digest: Option<String>,
    pub invalidation_epoch: String,
    pub authority_state_hash: String,
    pub verified_at: String,
}

#[derive(Debug, Clone)]
pub struct CommandAuthorizationExpectation<'a> {
    pub owner_user_id: &'a str,
    pub action: &'a str,
    pub command_id: &'a str,
    pub command_digest: &'a str,
    pub approval_deadline: &'a str,
    pub capability_kind: CommandCapabilityKind,
    pub capability_state: CommandCapabilityState,
    pub now: u64,
}

#[derive(Debug, Clone)]
pub struct NodeCommandAuthority {
    verifying_key: VerifyingKey,
    key_id: String,
}

impl NodeCommandAuthority {
    pub fn from_base64url_public_key(encoded: &str) -> Result<Self> {
        let bytes = decode_canonical_base64url::<32>(encoded, "command authority public key")?;
        if bytes == [0; 32] {
            return Err(invalid("command authority public key is all zero"));
        }
        let verifying_key = VerifyingKey::from_bytes(&bytes).map_err(|_| {
            PeerError::Authentication("command authority public key is invalid".into())
        })?;
        let key_id = command_authority_key_id(&bytes);
        Ok(Self {
            verifying_key,
            key_id,
        })
    }

    pub fn key_id(&self) -> &str {
        &self.key_id
    }

    pub fn public_key_base64url(&self) -> String {
        URL_SAFE_NO_PAD.encode(self.verifying_key.to_bytes())
    }

    pub fn verify_state(
        &self,
        state: &CommandAuthorityState,
        expected_owner_user_id: &str,
    ) -> Result<VerifiedCommandAuthorityState> {
        validate_authority_state(state)?;
        if state.authority_key_id != self.key_id {
            return Err(PeerError::Authentication(
                "command authority state was signed for another key".into(),
            ));
        }
        if state.owner_user_id != expected_owner_user_id {
            return Err(PeerError::Authorization(
                "command authority state belongs to another Forge owner".into(),
            ));
        }
        verify_signature(
            &self.verifying_key,
            &authority_state_signing_bytes(state)?,
            &state.signature,
            "command authority state",
        )?;
        let epoch = parse_canonical_u64(&state.epoch, "command authority epoch")?;
        let invalidated_before = parse_timestamp(
            &state.invalidated_before,
            "command authority invalidatedBefore",
        )?;
        Ok(VerifiedCommandAuthorityState {
            epoch,
            state_hash: authority_state_hash(state)?,
            invalidated_before,
            revoked_authorization_ids: state.revoked_authorization_ids.clone(),
            revoked_session_ids: state.revoked_session_ids.clone(),
            revoked_device_ids: state.revoked_device_ids.clone(),
        })
    }

    pub fn verify_authorization(
        &self,
        authorization: &CommandAuthorization,
        state: &VerifiedCommandAuthorityState,
        expected: &CommandAuthorizationExpectation<'_>,
    ) -> Result<CommandAuthorizationProvenance> {
        self.verify_authorization_binding(authorization, expected)?;
        let invalidation_epoch = parse_canonical_u64(
            &authorization.invalidation_epoch,
            "command authorization invalidationEpoch",
        )?;
        if invalidation_epoch != state.epoch {
            return Err(PeerError::Authorization(
                "command authorization does not match the current invalidation epoch".into(),
            ));
        }
        let (_, _, authorization_issued_at, approval_deadline) =
            authorization_timestamps(authorization)?;
        if authorization_issued_at > expected.now.saturating_add(MAX_CLOCK_SKEW_SECONDS) {
            return Err(PeerError::Authorization(
                "command authorization was issued too far in the future".into(),
            ));
        }
        if expected.now > approval_deadline {
            return Err(PeerError::Authorization(
                "command authorization expired before dispatch".into(),
            ));
        }
        if authorization_issued_at < state.invalidated_before
            || state
                .revoked_authorization_ids
                .binary_search(&authorization.authorization_id)
                .is_ok()
            || state
                .revoked_session_ids
                .binary_search(&authorization.actor.session_id)
                .is_ok()
            || authorization
                .actor
                .device_id
                .as_ref()
                .is_some_and(|device_id| state.revoked_device_ids.binary_search(device_id).is_ok())
        {
            return Err(PeerError::Authorization(
                "command authorization or actor session was invalidated".into(),
            ));
        }

        Ok(CommandAuthorizationProvenance {
            authority_key_id: self.key_id.clone(),
            authorization_id: Some(authorization.authorization_id.clone()),
            actor_class: Some(authorization.actor.class),
            actor_id: Some(authorization.actor.actor_id.clone()),
            actor_device_id: authorization.actor.device_id.clone(),
            session_id: Some(authorization.actor.session_id.clone()),
            capability_id: Some(authorization.capability.capability_id.clone()),
            action_digest: Some(authorization.capability.action_digest.clone()),
            invalidation_epoch: state.epoch.to_string(),
            authority_state_hash: hex::encode(state.state_hash),
            verified_at: format_timestamp(expected.now)?,
        })
    }

    pub fn verify_authorization_for_replay(
        &self,
        authorization: &CommandAuthorization,
        expected: &CommandAuthorizationExpectation<'_>,
    ) -> Result<()> {
        self.verify_authorization_binding(authorization, expected)?;
        authorization_timestamps(authorization).map(|_| ())
    }

    pub fn authenticate_authorization_document(
        &self,
        authorization: &CommandAuthorization,
    ) -> Result<()> {
        validate_authorization(authorization)?;
        if authorization.authority_key_id != self.key_id {
            return Err(PeerError::Authentication(
                "command authorization was signed for another authority key".into(),
            ));
        }
        verify_signature(
            &self.verifying_key,
            &command_authorization_signing_bytes(authorization)?,
            &authorization.signature,
            "command authorization",
        )
    }

    fn verify_authorization_binding(
        &self,
        authorization: &CommandAuthorization,
        expected: &CommandAuthorizationExpectation<'_>,
    ) -> Result<()> {
        self.authenticate_authorization_document(authorization)?;
        if authorization.owner_user_id != expected.owner_user_id {
            return Err(PeerError::Authorization(
                "command authorization belongs to another Forge owner".into(),
            ));
        }
        if authorization.action != expected.action
            || authorization.command_id != expected.command_id
            || authorization.approval_deadline != expected.approval_deadline
            || authorization
                .command_digest
                .as_bytes()
                .ct_eq(expected.command_digest.as_bytes())
                .unwrap_u8()
                != 1
        {
            return Err(PeerError::Authorization(
                "command authorization is not bound to the exact IPC action".into(),
            ));
        }
        if authorization.capability.kind != expected.capability_kind
            || authorization.capability.state != expected.capability_state
        {
            return Err(PeerError::Authorization(
                "command authorization capability class or state is not permitted for this action"
                    .into(),
            ));
        }
        let actor_class_matches = match expected.capability_kind {
            CommandCapabilityKind::HumanApproval => matches!(
                authorization.actor.class,
                CommandActorClass::OperatorSession | CommandActorClass::CompanionConsent
            ),
            CommandCapabilityKind::QueryWorker | CommandCapabilityKind::RevocationConsumer => {
                authorization.actor.class == CommandActorClass::ServiceWorker
            }
        };
        if !actor_class_matches {
            return Err(PeerError::Authorization(
                "command authorization actor class does not match its capability".into(),
            ));
        }
        Ok(())
    }

    pub fn state_provenance(
        &self,
        state: &VerifiedCommandAuthorityState,
        verified_at: u64,
    ) -> Result<CommandAuthorizationProvenance> {
        Ok(CommandAuthorizationProvenance {
            authority_key_id: self.key_id.clone(),
            authorization_id: None,
            actor_class: None,
            actor_id: None,
            actor_device_id: None,
            session_id: None,
            capability_id: None,
            action_digest: None,
            invalidation_epoch: state.epoch.to_string(),
            authority_state_hash: hex::encode(state.state_hash),
            verified_at: format_timestamp(verified_at)?,
        })
    }
}

pub fn command_authorization_signing_bytes(
    authorization: &CommandAuthorization,
) -> Result<Vec<u8>> {
    canonical_signing_bytes(authorization, "signature", COMMAND_AUTHORIZATION_DOMAIN)
}

pub fn authority_state_signing_bytes(state: &CommandAuthorityState) -> Result<Vec<u8>> {
    canonical_signing_bytes(state, "signature", COMMAND_AUTHORITY_STATE_DOMAIN)
}

pub fn command_authorization_hash(authorization: &CommandAuthorization) -> Result<[u8; 32]> {
    validate_authorization(authorization)?;
    let canonical = serde_json_canonicalizer::to_vec(authorization)
        .map_err(|error| invalid(format!("canonicalizing command authorization: {error}")))?;
    if canonical.len() > MAX_COMMAND_AUTHORITY_STATE_BYTES {
        return Err(limit("command authorization exceeds 256 KiB"));
    }
    let mut hasher = Sha256::new();
    hasher.update(COMMAND_AUTHORIZATION_DOMAIN);
    hasher.update(canonical);
    Ok(hasher.finalize().into())
}

fn authorization_timestamps(authorization: &CommandAuthorization) -> Result<(u64, u64, u64, u64)> {
    let capability_issued_at = parse_timestamp(
        &authorization.capability.issued_at,
        "command capability issuedAt",
    )?;
    let capability_expires_at = parse_timestamp(
        &authorization.capability.expires_at,
        "command capability expiresAt",
    )?;
    let authorization_issued_at =
        parse_timestamp(&authorization.issued_at, "command authorization issuedAt")?;
    let approval_deadline = parse_timestamp(
        &authorization.approval_deadline,
        "command authorization approvalDeadline",
    )?;
    if capability_issued_at > authorization_issued_at
        || authorization_issued_at > approval_deadline
        || approval_deadline > capability_expires_at
        || capability_expires_at.saturating_sub(capability_issued_at)
            > MAX_AUTHORIZATION_WINDOW_SECONDS
    {
        return Err(PeerError::Authorization(
            "command authorization timestamps are not bound to the capability window".into(),
        ));
    }
    Ok((
        capability_issued_at,
        capability_expires_at,
        authorization_issued_at,
        approval_deadline,
    ))
}

fn authority_state_hash(state: &CommandAuthorityState) -> Result<[u8; 32]> {
    let canonical = serde_json_canonicalizer::to_vec(state)
        .map_err(|error| invalid(format!("canonicalizing command authority state: {error}")))?;
    if canonical.len() > MAX_COMMAND_AUTHORITY_STATE_BYTES {
        return Err(limit("command authority state exceeds 256 KiB"));
    }
    let mut hasher = Sha256::new();
    hasher.update(COMMAND_AUTHORITY_STATE_DOMAIN);
    hasher.update(&canonical);
    Ok(hasher.finalize().into())
}

fn canonical_signing_bytes<T: Serialize>(
    value: &T,
    signature_field: &str,
    domain: &[u8],
) -> Result<Vec<u8>> {
    let mut value = serde_json::to_value(value)
        .map_err(|error| invalid(format!("serializing signed command document: {error}")))?;
    value
        .as_object_mut()
        .ok_or_else(|| invalid("signed command document is not an object"))?
        .remove(signature_field)
        .ok_or_else(|| invalid("signed command document is missing its signature field"))?;
    let canonical = serde_json_canonicalizer::to_vec(&value)
        .map_err(|error| invalid(format!("canonicalizing signed command document: {error}")))?;
    if canonical.len() > MAX_COMMAND_AUTHORITY_STATE_BYTES {
        return Err(limit("signed command document exceeds 256 KiB"));
    }
    let mut bytes = Vec::with_capacity(domain.len() + canonical.len());
    bytes.extend_from_slice(domain);
    bytes.extend_from_slice(&canonical);
    Ok(bytes)
}

fn verify_signature(
    verifying_key: &VerifyingKey,
    message: &[u8],
    encoded_signature: &str,
    label: &str,
) -> Result<()> {
    let bytes = decode_canonical_base64url::<64>(encoded_signature, label)?;
    let signature = Signature::from_bytes(&bytes);
    verifying_key
        .verify(message, &signature)
        .map_err(|_| PeerError::Authentication(format!("{label} signature is invalid")))
}

fn command_authority_key_id(public_key: &[u8; 32]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(COMMAND_AUTHORITY_KEY_ID_DOMAIN);
    hasher.update(public_key);
    URL_SAFE_NO_PAD.encode(hasher.finalize())
}

fn validate_authorization(authorization: &CommandAuthorization) -> Result<()> {
    if authorization.protocol != COMMAND_AUTHORIZATION_PROTOCOL {
        return Err(invalid("command authorization protocol is unsupported"));
    }
    validate_base64url_len(&authorization.authority_key_id, 32, "authorityKeyId")?;
    validate_identifier(
        &authorization.authorization_id,
        MAX_AUTHORIZATION_ID_BYTES,
        "authorizationId",
    )?;
    validate_text(
        &authorization.owner_user_id,
        MAX_OWNER_ID_BYTES,
        "ownerUserId",
    )?;
    validate_identifier(&authorization.actor.actor_id, MAX_ACTOR_ID_BYTES, "actorId")?;
    validate_identifier(
        &authorization.actor.session_id,
        MAX_SESSION_ID_BYTES,
        "sessionId",
    )?;
    if let Some(device_id) = &authorization.actor.device_id {
        validate_identifier(device_id, MAX_ACTOR_ID_BYTES, "deviceId")?;
    }
    if authorization.actor.class == CommandActorClass::CompanionConsent
        && authorization.actor.device_id.is_none()
    {
        return Err(invalid(
            "companion command authorization requires its companion deviceId",
        ));
    }
    validate_identifier(
        &authorization.capability.capability_id,
        MAX_CAPABILITY_ID_BYTES,
        "capabilityId",
    )?;
    validate_lower_hex_32(
        &authorization.capability.action_digest,
        "human approval actionDigest",
    )?;
    validate_action(&authorization.action)?;
    validate_text(&authorization.command_id, 240, "commandId")?;
    validate_lower_hex_32(&authorization.command_digest, "commandDigest")?;
    parse_timestamp(
        &authorization.capability.issued_at,
        "human approval capability issuedAt",
    )?;
    parse_timestamp(
        &authorization.capability.expires_at,
        "human approval capability expiresAt",
    )?;
    parse_timestamp(&authorization.issued_at, "command authorization issuedAt")?;
    parse_timestamp(
        &authorization.approval_deadline,
        "command authorization approvalDeadline",
    )?;
    parse_canonical_u64(
        &authorization.invalidation_epoch,
        "command authorization invalidationEpoch",
    )?;
    validate_base64url_len(
        &authorization.signature,
        64,
        "command authorization signature",
    )
}

fn validate_authority_state(state: &CommandAuthorityState) -> Result<()> {
    if state.protocol != COMMAND_AUTHORITY_STATE_PROTOCOL {
        return Err(invalid("command authority state protocol is unsupported"));
    }
    validate_base64url_len(&state.authority_key_id, 32, "authorityKeyId")?;
    validate_text(&state.owner_user_id, MAX_OWNER_ID_BYTES, "ownerUserId")?;
    parse_canonical_u64(&state.epoch, "command authority epoch")?;
    parse_timestamp(
        &state.invalidated_before,
        "command authority invalidatedBefore",
    )?;
    validate_sorted_identifiers(&state.revoked_authorization_ids, "revokedAuthorizationIds")?;
    validate_sorted_identifiers(&state.revoked_session_ids, "revokedSessionIds")?;
    validate_sorted_identifiers(&state.revoked_device_ids, "revokedDeviceIds")?;
    validate_base64url_len(&state.signature, 64, "command authority state signature")
}

fn validate_sorted_identifiers(values: &[String], label: &str) -> Result<()> {
    if values.len() > MAX_REVOKED_IDENTIFIERS {
        return Err(limit(format!(
            "{label} exceeds {MAX_REVOKED_IDENTIFIERS} entries"
        )));
    }
    if values.windows(2).any(|pair| pair[0] >= pair[1]) {
        return Err(invalid(format!(
            "{label} must be unique and in canonical ascending order"
        )));
    }
    for value in values {
        validate_identifier(value, MAX_AUTHORIZATION_ID_BYTES, label)?;
    }
    Ok(())
}

fn validate_action(value: &str) -> Result<()> {
    if value.is_empty()
        || value.len() > 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte == b'_')
    {
        return Err(invalid("command authorization action is invalid"));
    }
    Ok(())
}

fn validate_identifier(value: &str, maximum: usize, label: &str) -> Result<()> {
    if value.is_empty()
        || value.len() > maximum
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
    {
        return Err(invalid(format!("command authorization {label} is invalid")));
    }
    Ok(())
}

fn validate_text(value: &str, maximum: usize, label: &str) -> Result<()> {
    if value.is_empty()
        || value.len() > maximum
        || value.trim() != value
        || value.chars().any(char::is_control)
    {
        return Err(invalid(format!("command authorization {label} is invalid")));
    }
    Ok(())
}

fn validate_lower_hex_32(value: &str, label: &str) -> Result<()> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(invalid(format!("{label} must be 32-byte lowercase hex")));
    }
    Ok(())
}

fn validate_base64url_len(value: &str, expected_bytes: usize, label: &str) -> Result<()> {
    match expected_bytes {
        32 => {
            let _ = decode_canonical_base64url::<32>(value, label)?;
        }
        64 => {
            let _ = decode_canonical_base64url::<64>(value, label)?;
        }
        _ => return Err(invalid("unsupported canonical base64url validation length")),
    }
    Ok(())
}

fn decode_canonical_base64url<const N: usize>(value: &str, label: &str) -> Result<[u8; N]> {
    let decoded = URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| invalid(format!("{label} is not canonical base64url")))?;
    let bytes: [u8; N] = decoded
        .try_into()
        .map_err(|_| invalid(format!("{label} has the wrong decoded length")))?;
    if URL_SAFE_NO_PAD.encode(bytes) != value {
        return Err(invalid(format!("{label} is not canonical base64url")));
    }
    Ok(bytes)
}

fn parse_canonical_u64(value: &str, label: &str) -> Result<u64> {
    if value.is_empty()
        || !value.bytes().all(|byte| byte.is_ascii_digit())
        || (value.len() > 1 && value.starts_with('0'))
    {
        return Err(invalid(format!(
            "{label} is not canonical unsigned decimal"
        )));
    }
    value
        .parse::<u64>()
        .map_err(|_| invalid(format!("{label} exceeds u64")))
}

fn parse_timestamp(value: &str, label: &str) -> Result<u64> {
    if value.len() < 20 || value.len() > 40 || !value.is_ascii() {
        return Err(invalid(format!(
            "{label} is not a bounded RFC3339 timestamp"
        )));
    }
    let timestamp = OffsetDateTime::parse(value, &Rfc3339)
        .map_err(|_| invalid(format!("{label} is not a valid RFC3339 timestamp")))?
        .unix_timestamp();
    u64::try_from(timestamp).map_err(|_| invalid(format!("{label} predates Unix epoch")))
}

fn format_timestamp(value: u64) -> Result<String> {
    let timestamp = i64::try_from(value).map_err(|_| limit("timestamp does not fit i64"))?;
    OffsetDateTime::from_unix_timestamp(timestamp)
        .map_err(|_| invalid("verified command timestamp is invalid"))?
        .format(&Rfc3339)
        .map_err(|_| invalid("formatting verified command timestamp failed"))
}

#[cfg(test)]
mod tests {
    use ed25519_dalek::{Signer as _, SigningKey};

    use super::*;

    fn signed_state(signing_key: &SigningKey) -> Result<CommandAuthorityState> {
        let authority = NodeCommandAuthority::from_base64url_public_key(
            &URL_SAFE_NO_PAD.encode(signing_key.verifying_key().to_bytes()),
        )?;
        let mut state = CommandAuthorityState {
            protocol: COMMAND_AUTHORITY_STATE_PROTOCOL.into(),
            authority_key_id: authority.key_id().into(),
            owner_user_id: "owner_alpha".into(),
            epoch: "7".into(),
            invalidated_before: "2026-07-16T08:00:00Z".into(),
            revoked_authorization_ids: vec!["authorization_revoked_0001".into()],
            revoked_session_ids: vec!["session_revoked_000000001".into()],
            revoked_device_ids: vec!["device_revoked_0000000001".into()],
            signature: URL_SAFE_NO_PAD.encode([0_u8; 64]),
        };
        state.signature = URL_SAFE_NO_PAD.encode(
            signing_key
                .sign(&authority_state_signing_bytes(&state)?)
                .to_bytes(),
        );
        Ok(state)
    }

    #[test]
    fn signed_state_and_action_are_exactly_bound() -> Result<()> {
        let signing_key = SigningKey::from_bytes(&[29_u8; 32]);
        let authority = NodeCommandAuthority::from_base64url_public_key(
            &URL_SAFE_NO_PAD.encode(signing_key.verifying_key().to_bytes()),
        )?;
        let state = authority.verify_state(&signed_state(&signing_key)?, "owner_alpha")?;
        let mut authorization = CommandAuthorization {
            protocol: COMMAND_AUTHORIZATION_PROTOCOL.into(),
            authority_key_id: authority.key_id().into(),
            authorization_id: "authorization_valid_000001".into(),
            owner_user_id: "owner_alpha".into(),
            actor: CommandActor {
                class: CommandActorClass::OperatorSession,
                actor_id: "operator_session_00000001".into(),
                session_id: "operator_session_00000001".into(),
                device_id: None,
            },
            capability: NodeCommandCapability {
                kind: CommandCapabilityKind::HumanApproval,
                capability_id: "presence_capability_000001".into(),
                action_digest: "11".repeat(32),
                state: CommandCapabilityState::Consumed,
                issued_at: "2026-07-16T08:00:00Z".into(),
                expires_at: "2026-07-16T08:05:00Z".into(),
            },
            action: "create_invitation".into(),
            command_id: "command_authorized_000001".into(),
            command_digest: "22".repeat(32),
            approval_deadline: "2026-07-16T08:05:00Z".into(),
            issued_at: "2026-07-16T08:01:00Z".into(),
            invalidation_epoch: "7".into(),
            signature: URL_SAFE_NO_PAD.encode([0_u8; 64]),
        };
        authorization.signature = URL_SAFE_NO_PAD.encode(
            signing_key
                .sign(&command_authorization_signing_bytes(&authorization)?)
                .to_bytes(),
        );
        let expected = CommandAuthorizationExpectation {
            owner_user_id: "owner_alpha",
            action: "create_invitation",
            command_id: "command_authorized_000001",
            command_digest: &"22".repeat(32),
            approval_deadline: "2026-07-16T08:05:00Z",
            capability_kind: CommandCapabilityKind::HumanApproval,
            capability_state: CommandCapabilityState::Consumed,
            now: parse_timestamp("2026-07-16T08:02:00Z", "test now")?,
        };
        let provenance = authority.verify_authorization(&authorization, &state, &expected)?;
        assert_eq!(
            provenance.authorization_id.as_deref(),
            Some("authorization_valid_000001")
        );

        authorization.command_id = "command_tampered_0000001".into();
        assert!(
            authority
                .verify_authorization(&authorization, &state, &expected)
                .is_err()
        );
        Ok(())
    }

    #[test]
    fn invalidation_lists_are_canonical_and_effective() -> Result<()> {
        let signing_key = SigningKey::from_bytes(&[31_u8; 32]);
        let authority = NodeCommandAuthority::from_base64url_public_key(
            &URL_SAFE_NO_PAD.encode(signing_key.verifying_key().to_bytes()),
        )?;
        let mut state = signed_state(&signing_key)?;
        state.revoked_session_ids = vec!["z_session".into(), "a_session".into()];
        state.signature = URL_SAFE_NO_PAD.encode(
            signing_key
                .sign(&authority_state_signing_bytes(&state)?)
                .to_bytes(),
        );
        assert!(authority.verify_state(&state, "owner_alpha").is_err());
        Ok(())
    }
}
