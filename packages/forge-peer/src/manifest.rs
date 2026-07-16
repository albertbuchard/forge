use std::collections::HashSet;
use std::fs::File;
use std::io::{BufReader, Read};
use std::os::unix::fs::{MetadataExt as _, PermissionsExt as _};
use std::path::{Component, Path, PathBuf};

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use ed25519_dalek::{Signature, Verifier as _, VerifyingKey};
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use crate::error::{PeerError, Result, invalid, limit};

pub const MANIFEST_SIGNATURE_DOMAIN: &[u8] = b"forge-peer/release-manifest/v1\0";
pub const MANIFEST_FORMAT: &str = "forge-peer-signed-manifest/v1";
pub const TRUSTED_KEYS_FORMAT: &str = "forge-peer-trusted-keys/v1";
pub const FORGE_REPOSITORY: &str = "https://github.com/albertbuchard/forge";
const MAX_MANIFEST_BYTES: usize = 256 * 1024;
const MAX_ARTIFACTS: usize = 256;
const MAX_BUNDLE_ENTRIES: usize = 1_024;
const MAX_BUNDLE_DEPTH: usize = 16;
const MAX_ARTIFACT_BYTES: u64 = 4 * 1024 * 1024 * 1024;
const MAX_BUNDLE_BYTES: u64 = 8 * 1024 * 1024 * 1024;
const MAX_MANIFEST_LIFETIME_SECONDS: i64 = 30 * 24 * 60 * 60;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManifestArtifact {
    pub path: String,
    pub sha256: String,
    pub size: u64,
    pub executable: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReleaseManifest {
    pub format: String,
    pub repository: String,
    pub package: String,
    pub protocol: String,
    pub version: String,
    pub release_target: String,
    pub created_at: String,
    pub expires_at: String,
    pub signing_key_id: String,
    pub artifacts: Vec<ManifestArtifact>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManifestSignature {
    pub key_id: String,
    pub algorithm: ManifestSignatureAlgorithm,
    pub signature: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ManifestSignatureAlgorithm {
    Ed25519,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SignedReleaseManifest {
    pub manifest: ReleaseManifest,
    pub signature: ManifestSignature,
}

impl SignedReleaseManifest {
    pub fn from_json(bytes: &[u8]) -> Result<Self> {
        strict_json(bytes, "signed manifest")
    }

    pub fn verify(
        &self,
        trusted_keys: &TrustedManifestKeyring,
        bundle_root: &Path,
        now: i64,
    ) -> Result<VerifiedReleaseManifest> {
        self.manifest.validate(now)?;
        if self.signature.key_id != self.manifest.signing_key_id {
            return Err(PeerError::Manifest(
                "signature key id does not match signed manifest".into(),
            ));
        }
        let key = trusted_keys.active_key(&self.signature.key_id, now)?;
        let public_key = decode_fixed::<32>(&key.public_key, "manifest public key")?;
        let verifying_key = VerifyingKey::from_bytes(&public_key)
            .map_err(|_| PeerError::Manifest("trusted Ed25519 key is invalid".into()))?;
        let signature = decode_fixed::<64>(&self.signature.signature, "manifest signature")?;
        let canonical = serde_json_canonicalizer::to_vec(&self.manifest)
            .map_err(|error| PeerError::Manifest(format!("canonicalizing manifest: {error}")))?;
        let mut payload = Vec::with_capacity(MANIFEST_SIGNATURE_DOMAIN.len() + canonical.len());
        payload.extend_from_slice(MANIFEST_SIGNATURE_DOMAIN);
        payload.extend_from_slice(&canonical);
        verifying_key
            .verify(&payload, &Signature::from_bytes(&signature))
            .map_err(|_| PeerError::Manifest("manifest signature verification failed".into()))?;
        verify_bundle(bundle_root, &self.manifest.artifacts)?;
        Ok(VerifiedReleaseManifest {
            version: self.manifest.version.clone(),
            release_target: self.manifest.release_target.clone(),
            manifest_sha256: hex::encode(Sha256::digest(canonical)),
        })
    }
}

impl ReleaseManifest {
    fn validate(&self, now: i64) -> Result<()> {
        if self.format != MANIFEST_FORMAT
            || self.repository != FORGE_REPOSITORY
            || self.package != "forge-peer"
            || self.protocol != crate::PROTOCOL_NAME
        {
            return Err(PeerError::Manifest(
                "manifest identity is not the Forge peer release contract".into(),
            ));
        }
        Version::parse(&self.version)
            .map_err(|_| PeerError::Manifest("manifest version is not SemVer".into()))?;
        validate_token(&self.release_target, 128, "release target")?;
        validate_token(&self.signing_key_id, 128, "signing key id")?;
        let created = parse_time(&self.created_at, "manifest createdAt")?;
        let expires = parse_time(&self.expires_at, "manifest expiresAt")?;
        if created >= expires
            || expires - created > MAX_MANIFEST_LIFETIME_SECONDS
            || now < created
            || now >= expires
        {
            return Err(PeerError::Manifest(
                "manifest is not within its bounded signed validity window".into(),
            ));
        }
        if self.artifacts.is_empty() || self.artifacts.len() > MAX_ARTIFACTS {
            return Err(limit("manifest artifact count must be within 1..=256"));
        }
        let mut previous: Option<&str> = None;
        let mut total_size = 0_u64;
        for artifact in &self.artifacts {
            artifact.validate()?;
            total_size = total_size
                .checked_add(artifact.size)
                .ok_or_else(|| limit("manifest artifact sizes overflow"))?;
            if total_size > MAX_BUNDLE_BYTES {
                return Err(limit("manifest artifacts exceed 8 GiB in total"));
            }
            if previous.is_some_and(|value| value >= artifact.path.as_str()) {
                return Err(PeerError::Manifest(
                    "manifest artifacts are not uniquely sorted by path".into(),
                ));
            }
            previous = Some(&artifact.path);
        }
        Ok(())
    }
}

impl ManifestArtifact {
    fn validate(&self) -> Result<()> {
        validate_relative_path(&self.path)?;
        validate_sha256(&self.sha256)?;
        if self.size > MAX_ARTIFACT_BYTES {
            return Err(limit("manifest artifact exceeds 4 GiB"));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TrustedManifestKey {
    pub key_id: String,
    pub algorithm: ManifestSignatureAlgorithm,
    pub public_key: String,
    pub not_before: String,
    pub not_after: String,
    #[serde(default)]
    pub revoked: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TrustedManifestKeyring {
    pub format: String,
    pub keys: Vec<TrustedManifestKey>,
}

impl TrustedManifestKeyring {
    pub fn from_json(bytes: &[u8]) -> Result<Self> {
        let keyring: Self = strict_json(bytes, "trusted keyring")?;
        keyring.validate()?;
        Ok(keyring)
    }

    fn validate(&self) -> Result<()> {
        if self.format != TRUSTED_KEYS_FORMAT || self.keys.is_empty() || self.keys.len() > 16 {
            return Err(PeerError::Manifest(
                "trusted keyring format or key count is invalid".into(),
            ));
        }
        let mut ids = HashSet::with_capacity(self.keys.len());
        for key in &self.keys {
            validate_token(&key.key_id, 128, "trusted key id")?;
            decode_fixed::<32>(&key.public_key, "trusted public key")?;
            if parse_time(&key.not_before, "trusted key notBefore")?
                >= parse_time(&key.not_after, "trusted key notAfter")?
            {
                return Err(PeerError::Manifest(
                    "trusted key validity interval is empty".into(),
                ));
            }
            if !ids.insert(key.key_id.as_str()) {
                return Err(PeerError::Manifest("trusted key ids are duplicated".into()));
            }
        }
        Ok(())
    }

    fn active_key(&self, key_id: &str, now: i64) -> Result<&TrustedManifestKey> {
        self.validate()?;
        let key = self
            .keys
            .iter()
            .find(|key| key.key_id == key_id)
            .ok_or_else(|| PeerError::Manifest("manifest signing key is not trusted".into()))?;
        if key.revoked
            || now < parse_time(&key.not_before, "trusted key notBefore")?
            || now >= parse_time(&key.not_after, "trusted key notAfter")?
        {
            return Err(PeerError::Manifest(
                "manifest signing key is revoked or outside its validity window".into(),
            ));
        }
        Ok(key)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedReleaseManifest {
    version: String,
    release_target: String,
    manifest_sha256: String,
}

impl VerifiedReleaseManifest {
    pub fn version(&self) -> &str {
        &self.version
    }

    pub fn release_target(&self) -> &str {
        &self.release_target
    }

    pub fn manifest_sha256(&self) -> &str {
        &self.manifest_sha256
    }
}

fn verify_bundle(root: &Path, expected: &[ManifestArtifact]) -> Result<()> {
    let root_metadata = std::fs::symlink_metadata(root)
        .map_err(|error| PeerError::Manifest(format!("reading bundle root: {error}")))?;
    if !root_metadata.is_dir()
        || root_metadata.file_type().is_symlink()
        || root_metadata.permissions().mode() & 0o7022 != 0
    {
        return Err(PeerError::Manifest(
            "bundle root must be a real directory with a safe mode".into(),
        ));
    }
    let root_descriptor = File::from(
        rustix::fs::open(
            root,
            rustix::fs::OFlags::RDONLY
                | rustix::fs::OFlags::DIRECTORY
                | rustix::fs::OFlags::NOFOLLOW
                | rustix::fs::OFlags::CLOEXEC,
            rustix::fs::Mode::empty(),
        )
        .map_err(|error| PeerError::Manifest(format!("opening bundle root: {error}")))?,
    );
    let opened_root_metadata = root_descriptor.metadata()?;
    if opened_root_metadata.dev() != root_metadata.dev()
        || opened_root_metadata.ino() != root_metadata.ino()
    {
        return Err(PeerError::Manifest(
            "bundle root changed between validation and open".into(),
        ));
    }
    let mut found = Vec::new();
    let mut entry_count = 0;
    collect_bundle_files(root, root, 0, &mut found, &mut entry_count)?;
    found.sort();
    let expected_paths: Vec<PathBuf> = expected
        .iter()
        .map(|item| PathBuf::from(&item.path))
        .collect();
    if found != expected_paths {
        return Err(PeerError::Manifest(
            "bundle contains missing, unlisted, or non-regular artifacts".into(),
        ));
    }
    for artifact in expected {
        let path = root.join(&artifact.path);
        let metadata = std::fs::symlink_metadata(&path)
            .map_err(|error| PeerError::Manifest(format!("reading artifact metadata: {error}")))?;
        if !metadata.is_file()
            || metadata.file_type().is_symlink()
            || metadata.len() != artifact.size
        {
            return Err(PeerError::Manifest(format!(
                "artifact {} type or size does not match manifest",
                artifact.path
            )));
        }
        let expected_mode = artifact_mode(artifact.executable);
        if metadata.permissions().mode() & 0o7777 != expected_mode {
            return Err(PeerError::Manifest(format!(
                "artifact {} permission mode does not match manifest",
                artifact.path
            )));
        }
        let actual = hash_file(
            &root_descriptor,
            Path::new(&artifact.path),
            &metadata,
            artifact.size,
            artifact.executable,
        )?;
        if actual != artifact.sha256 {
            return Err(PeerError::Manifest(format!(
                "artifact {} SHA-256 does not match manifest",
                artifact.path
            )));
        }
    }
    let final_root_metadata = std::fs::symlink_metadata(root)?;
    if final_root_metadata.dev() != root_metadata.dev()
        || final_root_metadata.ino() != root_metadata.ino()
        || final_root_metadata.file_type().is_symlink()
    {
        return Err(PeerError::Manifest(
            "bundle root changed during verification".into(),
        ));
    }
    Ok(())
}

fn collect_bundle_files(
    root: &Path,
    directory: &Path,
    depth: usize,
    found: &mut Vec<PathBuf>,
    entry_count: &mut usize,
) -> Result<()> {
    if depth > MAX_BUNDLE_DEPTH {
        return Err(limit("release bundle directory depth exceeds 16"));
    }
    for entry in std::fs::read_dir(directory)? {
        let entry = entry?;
        *entry_count = entry_count
            .checked_add(1)
            .ok_or_else(|| limit("release bundle entry count overflow"))?;
        if *entry_count > MAX_BUNDLE_ENTRIES {
            return Err(limit("release bundle contains more than 1024 entries"));
        }
        let metadata = std::fs::symlink_metadata(entry.path())?;
        if metadata.file_type().is_symlink() {
            return Err(PeerError::Manifest(
                "release bundle contains a symlink".into(),
            ));
        }
        if metadata.is_dir() {
            if metadata.permissions().mode() & 0o7022 != 0 {
                return Err(PeerError::Manifest(
                    "release bundle contains an unsafe directory mode".into(),
                ));
            }
            collect_bundle_files(root, &entry.path(), depth + 1, found, entry_count)?;
        } else if metadata.is_file() {
            let relative = entry
                .path()
                .strip_prefix(root)
                .map_err(|_| PeerError::Manifest("artifact escaped bundle root".into()))?
                .to_owned();
            found.push(relative);
        } else {
            return Err(PeerError::Manifest(
                "release bundle contains a special file".into(),
            ));
        }
    }
    Ok(())
}

fn hash_file(
    root: &File,
    relative_path: &Path,
    expected_metadata: &std::fs::Metadata,
    expected_size: u64,
    expected_executable: bool,
) -> Result<String> {
    let file = open_relative_nofollow(root, relative_path)?;
    let opened_metadata = file.metadata()?;
    if !opened_metadata.is_file()
        || opened_metadata.dev() != expected_metadata.dev()
        || opened_metadata.ino() != expected_metadata.ino()
        || opened_metadata.len() != expected_size
        || opened_metadata.nlink() != 1
        || opened_metadata.permissions().mode() & 0o7777 != artifact_mode(expected_executable)
    {
        return Err(PeerError::Manifest(
            "artifact changed between validation and open".into(),
        ));
    }
    let initial_modified = (
        opened_metadata.mtime(),
        opened_metadata.mtime_nsec(),
        opened_metadata.ctime(),
        opened_metadata.ctime_nsec(),
    );
    let mut reader = BufReader::new(file).take(expected_size + 1);
    let mut hasher = Sha256::new();
    let copied = std::io::copy(&mut reader, &mut hasher)?;
    if copied != expected_size {
        return Err(PeerError::Manifest("artifact changed while hashing".into()));
    }
    let final_metadata = reader.get_ref().get_ref().metadata()?;
    let final_modified = (
        final_metadata.mtime(),
        final_metadata.mtime_nsec(),
        final_metadata.ctime(),
        final_metadata.ctime_nsec(),
    );
    if final_metadata.dev() != opened_metadata.dev()
        || final_metadata.ino() != opened_metadata.ino()
        || final_metadata.len() != opened_metadata.len()
        || final_metadata.mode() != opened_metadata.mode()
        || final_modified != initial_modified
    {
        return Err(PeerError::Manifest(
            "artifact metadata changed while hashing".into(),
        ));
    }
    Ok(hex::encode(hasher.finalize()))
}

const fn artifact_mode(executable: bool) -> u32 {
    if executable { 0o755 } else { 0o644 }
}

fn open_relative_nofollow(root: &File, path: &Path) -> Result<File> {
    let mut current = root.try_clone()?;
    let mut components = path.components().peekable();
    while let Some(component) = components.next() {
        let Component::Normal(name) = component else {
            return Err(PeerError::Manifest(
                "artifact path is not a strict relative path".into(),
            ));
        };
        let mut flags =
            rustix::fs::OFlags::RDONLY | rustix::fs::OFlags::NOFOLLOW | rustix::fs::OFlags::CLOEXEC;
        if components.peek().is_some() {
            flags |= rustix::fs::OFlags::DIRECTORY;
        }
        let descriptor = rustix::fs::openat(&current, name, flags, rustix::fs::Mode::empty())
            .map_err(|error| {
                PeerError::Manifest(format!("opening signed artifact path: {error}"))
            })?;
        current = File::from(descriptor);
    }
    Ok(current)
}

fn strict_json<T: for<'de> Deserialize<'de>>(bytes: &[u8], label: &str) -> Result<T> {
    if bytes.is_empty() || bytes.len() > MAX_MANIFEST_BYTES {
        return Err(limit(format!("{label} exceeds its JSON bound")));
    }
    let mut deserializer = serde_json::Deserializer::from_slice(bytes);
    let value = T::deserialize(&mut deserializer)
        .map_err(|error| PeerError::Manifest(format!("parsing {label}: {error}")))?;
    deserializer
        .end()
        .map_err(|error| PeerError::Manifest(format!("trailing data in {label}: {error}")))?;
    Ok(value)
}

fn validate_relative_path(value: &str) -> Result<()> {
    if value.is_empty() || value.len() > 512 || value.contains('\\') || value.contains('\0') {
        return Err(PeerError::Manifest(
            "artifact path syntax is invalid".into(),
        ));
    }
    let path = Path::new(value);
    if path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(PeerError::Manifest(
            "artifact path is not a strict relative path".into(),
        ));
    }
    Ok(())
}

fn validate_sha256(value: &str) -> Result<()> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(PeerError::Manifest(
            "artifact SHA-256 is not lowercase hexadecimal".into(),
        ));
    }
    Ok(())
}

fn decode_fixed<const N: usize>(value: &str, label: &str) -> Result<[u8; N]> {
    let bytes = URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| PeerError::Manifest(format!("{label} is not unpadded base64url")))?;
    if URL_SAFE_NO_PAD.encode(&bytes) != value {
        return Err(PeerError::Manifest(format!(
            "{label} is not canonical unpadded base64url"
        )));
    }
    bytes
        .try_into()
        .map_err(|_| PeerError::Manifest(format!("{label} has the wrong length")))
}

fn validate_token(value: &str, maximum: usize, label: &str) -> Result<()> {
    if value.is_empty()
        || value.len() > maximum
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    {
        return Err(invalid(format!("{label} is invalid")));
    }
    Ok(())
}

fn parse_time(value: &str, label: &str) -> Result<i64> {
    OffsetDateTime::parse(value, &Rfc3339)
        .map(OffsetDateTime::unix_timestamp)
        .map_err(|_| PeerError::Manifest(format!("{label} is not RFC 3339")))
}

#[cfg(test)]
mod tests {
    use base64::Engine as _;
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use ed25519_dalek::{Signer as _, SigningKey};
    use sha2::{Digest as _, Sha256};

    use super::*;

    const NOW: i64 = 1_784_116_800;

    fn signed_bundle(root: &Path) -> Result<(SignedReleaseManifest, TrustedManifestKeyring)> {
        let artifact_path = root.join("bin/forge-peer");
        std::fs::create_dir_all(
            artifact_path
                .parent()
                .ok_or_else(|| invalid("test artifact has no parent"))?,
        )?;
        std::fs::set_permissions(
            artifact_path
                .parent()
                .ok_or_else(|| invalid("test artifact has no parent"))?,
            std::fs::Permissions::from_mode(0o755),
        )?;
        std::fs::write(&artifact_path, b"verified executable")?;
        std::fs::set_permissions(&artifact_path, std::fs::Permissions::from_mode(0o755))?;
        let manifest = ReleaseManifest {
            format: MANIFEST_FORMAT.into(),
            repository: FORGE_REPOSITORY.into(),
            package: "forge-peer".into(),
            protocol: crate::PROTOCOL_NAME.into(),
            version: "0.1.0".into(),
            release_target: "aarch64-apple-darwin".into(),
            created_at: "2026-07-15T08:00:00Z".into(),
            expires_at: "2026-07-16T08:00:00Z".into(),
            signing_key_id: "test-release-1".into(),
            artifacts: vec![ManifestArtifact {
                path: "bin/forge-peer".into(),
                sha256: hex::encode(Sha256::digest(b"verified executable")),
                size: 19,
                executable: true,
            }],
        };
        let signing_key = SigningKey::from_bytes(&[42; 32]);
        let canonical = serde_json_canonicalizer::to_vec(&manifest)
            .map_err(|error| invalid(error.to_string()))?;
        let mut payload = MANIFEST_SIGNATURE_DOMAIN.to_vec();
        payload.extend_from_slice(&canonical);
        let signed = SignedReleaseManifest {
            signature: ManifestSignature {
                key_id: "test-release-1".into(),
                algorithm: ManifestSignatureAlgorithm::Ed25519,
                signature: URL_SAFE_NO_PAD.encode(signing_key.sign(&payload).to_bytes()),
            },
            manifest,
        };
        let keyring = TrustedManifestKeyring {
            format: TRUSTED_KEYS_FORMAT.into(),
            keys: vec![TrustedManifestKey {
                key_id: "test-release-1".into(),
                algorithm: ManifestSignatureAlgorithm::Ed25519,
                public_key: URL_SAFE_NO_PAD.encode(signing_key.verifying_key().to_bytes()),
                not_before: "2026-07-01T00:00:00Z".into(),
                not_after: "2027-07-01T00:00:00Z".into(),
                revoked: false,
            }],
        };
        Ok((signed, keyring))
    }

    #[test]
    fn signed_manifest_verifies_exact_bundle() -> Result<()> {
        let directory = tempfile::tempdir()?;
        let (signed, keyring) = signed_bundle(directory.path())?;
        let verified = signed.verify(&keyring, directory.path(), NOW)?;
        assert_eq!(verified.version(), "0.1.0");
        assert_eq!(verified.release_target(), "aarch64-apple-darwin");
        Ok(())
    }

    #[test]
    fn manifest_rejects_tamper_extra_files_and_revoked_keys() -> Result<()> {
        let directory = tempfile::tempdir()?;
        let (signed, mut keyring) = signed_bundle(directory.path())?;
        std::fs::write(
            directory.path().join("bin/forge-peer"),
            b"modified executable",
        )?;
        assert!(signed.verify(&keyring, directory.path(), NOW).is_err());

        let directory = tempfile::tempdir()?;
        let (signed, _) = signed_bundle(directory.path())?;
        std::fs::write(directory.path().join("unlisted"), b"extra")?;
        assert!(signed.verify(&keyring, directory.path(), NOW).is_err());

        keyring.keys[0].revoked = true;
        let directory = tempfile::tempdir()?;
        let (signed, _) = signed_bundle(directory.path())?;
        assert!(signed.verify(&keyring, directory.path(), NOW).is_err());
        Ok(())
    }

    #[test]
    fn manifest_rejects_symlink_artifacts() -> Result<()> {
        use std::os::unix::fs::symlink;

        let directory = tempfile::tempdir()?;
        let (signed, keyring) = signed_bundle(directory.path())?;
        let artifact = directory.path().join("bin/forge-peer");
        let target = directory.path().join("outside");
        std::fs::write(&target, b"verified executable")?;
        std::fs::remove_file(&artifact)?;
        symlink(&target, &artifact)?;
        assert!(signed.verify(&keyring, directory.path(), NOW).is_err());
        Ok(())
    }

    #[test]
    fn manifest_rejects_hardlinks_and_symlinked_parent_directories() -> Result<()> {
        use std::os::unix::fs::symlink;

        let directory = tempfile::tempdir()?;
        let (signed, keyring) = signed_bundle(directory.path())?;
        let artifact = directory.path().join("bin/forge-peer");
        std::fs::hard_link(&artifact, directory.path().join("outside-link"))?;
        assert!(signed.verify(&keyring, directory.path(), NOW).is_err());

        let directory = tempfile::tempdir()?;
        let (signed, keyring) = signed_bundle(directory.path())?;
        let external = tempfile::tempdir()?;
        std::fs::write(external.path().join("forge-peer"), b"verified executable")?;
        std::fs::remove_dir_all(directory.path().join("bin"))?;
        symlink(external.path(), directory.path().join("bin"))?;
        assert!(signed.verify(&keyring, directory.path(), NOW).is_err());
        Ok(())
    }

    #[test]
    fn manifest_rejects_unsafe_artifact_modes_and_oversized_totals() -> Result<()> {
        let directory = tempfile::tempdir()?;
        let (signed, keyring) = signed_bundle(directory.path())?;
        let artifact = directory.path().join("bin/forge-peer");
        std::fs::set_permissions(&artifact, std::fs::Permissions::from_mode(0o4755))?;
        assert!(signed.verify(&keyring, directory.path(), NOW).is_err());

        let mut oversized = signed.manifest;
        oversized.artifacts = (0..3)
            .map(|index| ManifestArtifact {
                path: format!("artifact-{index}"),
                sha256: "00".repeat(32),
                size: MAX_ARTIFACT_BYTES,
                executable: false,
            })
            .collect();
        assert!(oversized.validate(NOW).is_err());
        Ok(())
    }

    #[test]
    fn bundle_entry_bound_counts_directories() -> Result<()> {
        let directory = tempfile::tempdir()?;
        std::fs::create_dir(directory.path().join("empty"))?;
        let mut found = Vec::new();
        let mut entry_count = MAX_BUNDLE_ENTRIES;
        assert!(
            collect_bundle_files(
                directory.path(),
                directory.path(),
                0,
                &mut found,
                &mut entry_count,
            )
            .is_err()
        );
        Ok(())
    }
}
