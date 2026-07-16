use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::os::unix::fs::{
    DirBuilderExt as _, MetadataExt as _, OpenOptionsExt as _, PermissionsExt,
};
use std::path::{Component, Path, PathBuf};

use zeroize::Zeroizing;

use crate::error::{PeerError, Result, invalid, limit};

pub const MAX_SECRET_FILE_BYTES: usize = 16 * 1024 * 1024;
const MAX_SECRET_FILE_BYTES_U64: u64 = 16 * 1024 * 1024;
const MAX_SECRET_FILE_NAME_BYTES: usize = 128;

#[derive(Debug)]
pub struct SecureDirectory {
    path: PathBuf,
    device: u64,
    inode: u64,
    owner_uid: u32,
}

#[derive(Debug)]
pub struct SecureFileLock {
    file: File,
}

impl Drop for SecureFileLock {
    fn drop(&mut self) {
        let _result = self.file.unlock();
    }
}

impl SecureDirectory {
    pub fn open_or_create(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref();
        if !path.is_absolute() {
            return Err(invalid("secure directory path must be absolute"));
        }
        create_missing_directories_nofollow(path)?;
        reject_symlink_components(path)?;
        let metadata = std::fs::symlink_metadata(path)?;
        let owner_uid = rustix::process::geteuid().as_raw();
        if !metadata.is_dir()
            || metadata.file_type().is_symlink()
            || metadata.uid() != owner_uid
            || metadata.mode() & 0o7777 != 0o700
        {
            return Err(PeerError::Authorization(
                "secure directory must be owned by the current user with mode 0700".into(),
            ));
        }
        Ok(Self {
            path: path.to_owned(),
            device: metadata.dev(),
            inode: metadata.ino(),
            owner_uid,
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn atomic_write_secret(&self, file_name: &str, bytes: &[u8]) -> Result<()> {
        validate_secret_file_name(file_name)?;
        if bytes.is_empty() || bytes.len() > MAX_SECRET_FILE_BYTES {
            return Err(limit(format!(
                "secret file size must be within 1..={MAX_SECRET_FILE_BYTES}"
            )));
        }
        self.verify_unchanged()?;
        let destination = self.path.join(file_name);
        if let Ok(metadata) = std::fs::symlink_metadata(&destination) {
            validate_existing_secret_metadata(&metadata, self.owner_uid)?;
        }

        let temporary_name = format!(
            ".forge-peer-tmp-{}",
            hex::encode(rand::random::<[u8; 16]>())
        );
        let temporary_path = self.path.join(temporary_name);
        let result = (|| {
            let mut temporary = OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(&temporary_path)?;
            temporary.set_permissions(std::fs::Permissions::from_mode(0o600))?;
            temporary.write_all(bytes)?;
            temporary.sync_all()?;
            let metadata = temporary.metadata()?;
            validate_existing_secret_metadata(&metadata, self.owner_uid)?;
            let expected_length = u64::try_from(bytes.len())
                .map_err(|_| limit("secret file length does not fit u64"))?;
            if metadata.len() != expected_length {
                return Err(PeerError::StateConflict(
                    "temporary secret length changed before commit".into(),
                ));
            }
            self.verify_unchanged()?;
            std::fs::rename(&temporary_path, &destination)?;
            sync_directory(&self.path, self.device, self.inode)?;
            Ok(())
        })();
        if result.is_err() {
            let _cleanup = std::fs::remove_file(&temporary_path);
        }
        result
    }

    pub fn read_secret(&self, file_name: &str) -> Result<Zeroizing<Vec<u8>>> {
        validate_secret_file_name(file_name)?;
        self.verify_unchanged()?;
        let path = self.path.join(file_name);
        let expected = std::fs::symlink_metadata(&path)?;
        validate_existing_secret_metadata(&expected, self.owner_uid)?;
        if expected.len() == 0 || expected.len() > MAX_SECRET_FILE_BYTES_U64 {
            return Err(limit("secret file is empty or oversized"));
        }
        let file = File::open(&path)?;
        let opened = file.metadata()?;
        validate_existing_secret_metadata(&opened, self.owner_uid)?;
        if opened.dev() != expected.dev()
            || opened.ino() != expected.ino()
            || opened.len() != expected.len()
        {
            return Err(PeerError::StateConflict(
                "secret file changed between metadata validation and open".into(),
            ));
        }
        let capacity = usize::try_from(opened.len())
            .map_err(|_| limit("secret file length does not fit memory size"))?;
        let mut bytes = Zeroizing::new(Vec::with_capacity(capacity));
        file.take(MAX_SECRET_FILE_BYTES_U64 + 1)
            .read_to_end(&mut bytes)?;
        if bytes.len() != capacity {
            return Err(PeerError::StateConflict(
                "secret file changed while it was being read".into(),
            ));
        }
        let final_metadata = std::fs::symlink_metadata(&path)?;
        if final_metadata.file_type().is_symlink()
            || final_metadata.dev() != opened.dev()
            || final_metadata.ino() != opened.ino()
            || final_metadata.len() != opened.len()
        {
            return Err(PeerError::StateConflict(
                "secret path changed while it was being read".into(),
            ));
        }
        Ok(bytes)
    }

    pub fn try_lock_exclusive(&self, file_name: &str) -> Result<SecureFileLock> {
        validate_secret_file_name(file_name)?;
        self.verify_unchanged()?;
        let path = self.path.join(file_name);
        let file = File::from(
            rustix::fs::open(
                &path,
                rustix::fs::OFlags::CREATE
                    | rustix::fs::OFlags::RDWR
                    | rustix::fs::OFlags::NOFOLLOW
                    | rustix::fs::OFlags::CLOEXEC,
                rustix::fs::Mode::RUSR | rustix::fs::Mode::WUSR,
            )
            .map_err(std::io::Error::from)?,
        );
        file.set_permissions(std::fs::Permissions::from_mode(0o600))?;
        validate_existing_secret_metadata(&file.metadata()?, self.owner_uid)?;
        file.try_lock().map_err(|error| {
            PeerError::StateConflict(format!("secure state is already locked: {error}"))
        })?;
        let path_metadata = std::fs::symlink_metadata(&path)?;
        let opened_metadata = file.metadata()?;
        if path_metadata.dev() != opened_metadata.dev()
            || path_metadata.ino() != opened_metadata.ino()
            || path_metadata.file_type().is_symlink()
        {
            let _result = file.unlock();
            return Err(PeerError::StateConflict(
                "secure lock path changed while being opened".into(),
            ));
        }
        Ok(SecureFileLock { file })
    }

    fn verify_unchanged(&self) -> Result<()> {
        let metadata = std::fs::symlink_metadata(&self.path)?;
        if !metadata.is_dir()
            || metadata.file_type().is_symlink()
            || metadata.uid() != self.owner_uid
            || metadata.mode() & 0o7777 != 0o700
            || metadata.dev() != self.device
            || metadata.ino() != self.inode
        {
            return Err(PeerError::StateConflict(
                "secure directory changed after it was opened".into(),
            ));
        }
        Ok(())
    }
}

fn validate_existing_secret_metadata(metadata: &std::fs::Metadata, owner_uid: u32) -> Result<()> {
    if !metadata.is_file()
        || metadata.file_type().is_symlink()
        || metadata.uid() != owner_uid
        || metadata.mode() & 0o7777 != 0o600
        || metadata.nlink() != 1
    {
        return Err(PeerError::Authorization(
            "secret path must be a single-link owner-only regular file".into(),
        ));
    }
    Ok(())
}

fn validate_secret_file_name(file_name: &str) -> Result<()> {
    if file_name.is_empty()
        || file_name.len() > MAX_SECRET_FILE_NAME_BYTES
        || matches!(file_name, "." | "..")
        || !file_name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
    {
        return Err(invalid("secret file name is not a strict ASCII leaf name"));
    }
    Ok(())
}

fn reject_symlink_components(path: &Path) -> Result<()> {
    let mut current = PathBuf::new();
    for component in path.components() {
        match component {
            Component::RootDir | Component::Normal(_) => current.push(component.as_os_str()),
            _ => {
                return Err(invalid(
                    "secure directory contains non-normal path components",
                ));
            }
        }
        let metadata = std::fs::symlink_metadata(&current)?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(PeerError::Authorization(
                "secure directory path traverses a symlink or non-directory".into(),
            ));
        }
    }
    Ok(())
}

fn create_missing_directories_nofollow(path: &Path) -> Result<()> {
    let mut current = PathBuf::new();
    for component in path.components() {
        match component {
            Component::RootDir | Component::Normal(_) => current.push(component.as_os_str()),
            _ => {
                return Err(invalid(
                    "secure directory contains non-normal path components",
                ));
            }
        }
        match std::fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {}
            Ok(_) => {
                return Err(PeerError::Authorization(
                    "secure directory path traverses a symlink or non-directory".into(),
                ));
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                std::fs::DirBuilder::new().mode(0o700).create(&current)?;
                let metadata = std::fs::symlink_metadata(&current)?;
                if !metadata.is_dir() || metadata.file_type().is_symlink() {
                    return Err(PeerError::StateConflict(
                        "new secure directory component was replaced during creation".into(),
                    ));
                }
            }
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}

fn sync_directory(path: &Path, expected_device: u64, expected_inode: u64) -> Result<()> {
    let directory = File::open(path)?;
    let metadata = directory.metadata()?;
    if !metadata.is_dir() || metadata.dev() != expected_device || metadata.ino() != expected_inode {
        return Err(PeerError::StateConflict(
            "secure directory changed before durability sync".into(),
        ));
    }
    directory.sync_all()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::{PermissionsExt as _, symlink};

    use super::*;

    #[test]
    fn atomic_secret_round_trip_is_owner_only_and_leaves_no_temporary_files() -> Result<()> {
        let temporary = tempfile::tempdir()?;
        let directory_path = std::fs::canonicalize(temporary.path())?.join("private");
        let directory = SecureDirectory::open_or_create(&directory_path)?;
        directory.atomic_write_secret("identity.bin", b"first")?;
        directory.atomic_write_secret("identity.bin", b"second")?;
        assert_eq!(directory.read_secret("identity.bin")?.as_slice(), b"second");
        assert_eq!(
            std::fs::metadata(directory_path.join("identity.bin"))?
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        let names = std::fs::read_dir(&directory_path)?
            .map(|entry| entry.map(|entry| entry.file_name()))
            .collect::<std::io::Result<Vec<_>>>()?;
        assert_eq!(names, vec![std::ffi::OsString::from("identity.bin")]);
        Ok(())
    }

    #[test]
    fn secret_reads_reject_symlinks_hardlinks_and_path_traversal() -> Result<()> {
        let temporary = tempfile::tempdir()?;
        let directory_path = std::fs::canonicalize(temporary.path())?.join("private");
        let directory = SecureDirectory::open_or_create(&directory_path)?;
        let outside = temporary.path().join("outside");
        std::fs::write(&outside, b"preserve")?;
        symlink(&outside, directory_path.join("link.bin"))?;
        assert!(directory.read_secret("link.bin").is_err());
        assert!(
            directory
                .atomic_write_secret("link.bin", b"replace")
                .is_err()
        );
        assert_eq!(std::fs::read(&outside)?, b"preserve");

        directory.atomic_write_secret("identity.bin", b"secret")?;
        std::fs::hard_link(
            directory_path.join("identity.bin"),
            directory_path.join("hardlink.bin"),
        )?;
        assert!(directory.read_secret("identity.bin").is_err());
        assert!(directory.read_secret("../outside").is_err());
        Ok(())
    }

    #[test]
    fn secure_directory_rejects_group_access_and_symlink_ancestors() -> Result<()> {
        let temporary = tempfile::tempdir()?;
        let accessible = temporary.path().join("accessible");
        std::fs::create_dir(&accessible)?;
        std::fs::set_permissions(&accessible, std::fs::Permissions::from_mode(0o750))?;
        assert!(SecureDirectory::open_or_create(&accessible).is_err());

        let special = temporary.path().join("special");
        std::fs::create_dir(&special)?;
        std::fs::set_permissions(&special, std::fs::Permissions::from_mode(0o1700))?;
        assert!(SecureDirectory::open_or_create(&special).is_err());

        let real = temporary.path().join("real");
        std::fs::create_dir(&real)?;
        std::fs::set_permissions(&real, std::fs::Permissions::from_mode(0o700))?;
        let linked = temporary.path().join("linked");
        symlink(&real, &linked)?;
        assert!(SecureDirectory::open_or_create(&linked).is_err());

        let outside = temporary.path().join("outside");
        std::fs::create_dir(&outside)?;
        let outside_link = temporary.path().join("outside-link");
        symlink(&outside, &outside_link)?;
        assert!(SecureDirectory::open_or_create(outside_link.join("created")).is_err());
        assert!(!outside.join("created").exists());
        Ok(())
    }

    #[test]
    fn secret_reads_require_exact_mode_0600() -> Result<()> {
        let temporary = tempfile::tempdir()?;
        let directory_path = std::fs::canonicalize(temporary.path())?.join("private");
        let directory = SecureDirectory::open_or_create(&directory_path)?;
        directory.atomic_write_secret("identity.bin", b"secret")?;
        std::fs::set_permissions(
            directory_path.join("identity.bin"),
            std::fs::Permissions::from_mode(0o400),
        )?;
        assert!(directory.read_secret("identity.bin").is_err());
        Ok(())
    }

    #[test]
    fn secure_state_lock_has_single_process_ownership() -> Result<()> {
        let temporary = tempfile::tempdir()?;
        let directory_path = std::fs::canonicalize(temporary.path())?.join("private");
        let first_directory = SecureDirectory::open_or_create(&directory_path)?;
        let second_directory = SecureDirectory::open_or_create(&directory_path)?;
        let first = first_directory.try_lock_exclusive("daemon.lock")?;
        assert!(second_directory.try_lock_exclusive("daemon.lock").is_err());
        drop(first);
        second_directory.try_lock_exclusive("daemon.lock")?;
        Ok(())
    }
}
