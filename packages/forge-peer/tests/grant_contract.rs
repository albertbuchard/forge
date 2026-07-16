use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use ed25519_dalek::{Signature, Verifier as _, VerifyingKey};
use forge_peer::codec::Validate as _;
use forge_peer::grant::{
    GrantParty, GrantSignatureAlgorithm, GrantSignerMetadata, GrantStatus, MemoryGrantTrustStore,
    PeerShareGrantVersion, TrustedGrantSigner, sign_grant_consent, verify_active_grant,
};
use forge_peer::identity::{
    DeviceCapabilities, DeviceCertificate, DeviceId, DeviceSigner, PrincipalRootSigner,
    ProtocolRange,
};
use serde::Deserialize;

const VECTOR_JSON: &[u8] = include_bytes!("vectors/grant-canonical-v1.json");
const VECTOR_NOW: u64 = 1_784_116_800;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GrantVector {
    grant: serde_json::Value,
    verified_grant_hash: String,
    signers: Vec<VectorSigner>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VectorSigner {
    device_id: String,
    public_key_base64url: String,
}

fn vector() -> forge_peer::Result<(GrantVector, PeerShareGrantVersion)> {
    let vector: GrantVector = serde_json::from_slice(VECTOR_JSON)
        .map_err(|error| forge_peer::PeerError::InvalidData(error.to_string()))?;
    let grant_json = serde_json::to_vec(&vector.grant)
        .map_err(|error| forge_peer::PeerError::InvalidData(error.to_string()))?;
    let grant = PeerShareGrantVersion::from_json(&grant_json)?;
    Ok((vector, grant))
}

#[test]
fn node_vector_matches_rust_canonical_hash_and_signatures() -> forge_peer::Result<()> {
    let (vector, grant) = vector()?;
    assert_eq!(grant.version_hash_hex()?, vector.verified_grant_hash);

    let consent: serde_json::Value = serde_json::from_slice(&grant.canonical_consent_json()?)
        .map_err(|error| forge_peer::PeerError::InvalidData(error.to_string()))?;
    assert!(consent.get("status").is_none());
    assert!(consent.get("revokedAt").is_none());
    assert!(consent.get("signatures").is_none());
    assert_eq!(consent["rules"][0]["id"], "a_availability");
    assert_eq!(consent["rules"][1]["fields"]["include"][0], "endsAt");
    assert_eq!(
        consent["rules"][1]["entitySelector"]["entityIds"][0],
        "event_a"
    );

    for signer in vector.signers {
        let signed = grant
            .signatures
            .iter()
            .find(|value| value.device_id == signer.device_id)
            .ok_or_else(|| forge_peer::PeerError::InvalidData("vector signer missing".into()))?;
        let public_key: [u8; 32] = URL_SAFE_NO_PAD
            .decode(signer.public_key_base64url)
            .map_err(|error| forge_peer::PeerError::InvalidData(error.to_string()))?
            .try_into()
            .map_err(|_| forge_peer::PeerError::InvalidData("vector key length".into()))?;
        let signature: [u8; 64] = URL_SAFE_NO_PAD
            .decode(&signed.signature)
            .map_err(|error| forge_peer::PeerError::InvalidData(error.to_string()))?
            .try_into()
            .map_err(|_| forge_peer::PeerError::InvalidData("vector signature length".into()))?;
        VerifyingKey::from_bytes(&public_key)
            .map_err(|error| forge_peer::PeerError::InvalidData(error.to_string()))?
            .verify(
                &grant.signature_payload(&signed.metadata())?,
                &Signature::from_bytes(&signature),
            )
            .map_err(|error| forge_peer::PeerError::Authentication(error.to_string()))?;
    }
    Ok(())
}

#[test]
fn certificate_backed_evidence_binds_hash_parties_and_distinct_devices() -> forge_peer::Result<()> {
    let (_, mut grant) = vector()?;
    grant.status = GrantStatus::Proposed;
    grant.signatures.clear();

    let root = PrincipalRootSigner::from_secret_bytes([90; 32]);
    let grantor = DeviceSigner::from_secret_bytes(DeviceId([1; 16]), [11; 32]);
    let grantee = DeviceSigner::from_secret_bytes(DeviceId([2; 16]), [22; 32]);
    let capabilities =
        DeviceCapabilities::new(DeviceCapabilities::QUERY | DeviceCapabilities::PROJECTION)?;
    let grantor_certificate = DeviceCertificate::issue(
        &root,
        &grantor,
        capabilities,
        ProtocolRange::CURRENT,
        1,
        1_784_000_000,
        1_785_000_000,
    )?;
    let grantee_certificate = DeviceCertificate::issue(
        &root,
        &grantee,
        capabilities,
        ProtocolRange::CURRENT,
        2,
        1_784_000_000,
        1_785_000_000,
    )?;
    let grantor_signature = sign_grant_consent(
        &grant,
        GrantSignerMetadata {
            device_id: "owner_mac".into(),
            party: GrantParty::Grantor,
            algorithm: GrantSignatureAlgorithm::Ed25519,
            signed_at: "2026-07-15T09:01:00.000Z".into(),
        },
        &grantor,
        &grantor_certificate,
    )?;
    let grantee_signature = sign_grant_consent(
        &grant,
        GrantSignerMetadata {
            device_id: "peer_phone".into(),
            party: GrantParty::Grantee,
            algorithm: GrantSignatureAlgorithm::Ed25519,
            signed_at: "2026-07-15T09:02:00.000Z".into(),
        },
        &grantee,
        &grantee_certificate,
    )?;
    grant.signatures = vec![grantee_signature, grantor_signature];
    grant.status = GrantStatus::Active;
    grant.validate()?;

    let trust = MemoryGrantTrustStore::default();
    trust.insert(TrustedGrantSigner::new(
        grant.relationship_id.clone(),
        "owner_mac".into(),
        GrantParty::Grantor,
        grantor_certificate,
    )?)?;
    trust.insert(TrustedGrantSigner::new(
        grant.relationship_id.clone(),
        "peer_phone".into(),
        GrantParty::Grantee,
        grantee_certificate,
    )?)?;

    let evidence = verify_active_grant(&grant, &trust, VECTOR_NOW)?;
    assert_eq!(evidence.verified_grant_hash(), grant.version_hash_hex()?);
    assert_eq!(
        evidence.verified_signer_device_ids(),
        &["owner_mac".to_owned(), "peer_phone".to_owned()]
    );
    assert_eq!(evidence.verified_signers().len(), 2);
    assert_eq!(evidence.verified_signers()[0].party(), GrantParty::Grantee);
    assert_eq!(evidence.verified_signers()[1].party(), GrantParty::Grantor);

    let mut expired = grant.clone();
    expired.expires_at = Some("2026-07-15T11:59:59Z".into());
    assert!(matches!(
        verify_active_grant(&expired, &trust, VECTOR_NOW),
        Err(forge_peer::PeerError::Authorization(_))
    ));

    trust.revoke(&grant.relationship_id, "owner_mac", GrantParty::Grantor)?;
    assert!(matches!(
        verify_active_grant(&grant, &trust, VECTOR_NOW),
        Err(forge_peer::PeerError::Authorization(_))
    ));

    let mut tampered = grant;
    tampered.rules[0].maximum_result_count -= 1;
    assert!(verify_active_grant(&tampered, &trust, VECTOR_NOW).is_err());
    Ok(())
}

#[test]
fn revoked_successor_retains_original_effective_window() -> forge_peer::Result<()> {
    let (_, original) = vector()?;
    let mut revoked = original.clone();
    revoked.sequence = 2;
    revoked.previous_version_hash = Some(original.version_hash_hex()?);
    revoked.status = GrantStatus::Revoked;
    revoked.issued_at = "2026-07-15T10:00:00Z".into();
    revoked.revoked_at = Some(revoked.issued_at.clone());
    revoked.signatures.clear();
    revoked.validate()?;

    let mut invalid_origin = revoked;
    invalid_origin.sequence = 1;
    invalid_origin.previous_version_hash = None;
    assert!(invalid_origin.validate().is_err());
    Ok(())
}
