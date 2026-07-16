import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as signBytes,
  verify as verifyBytes
} from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  readFile,
  readdir,
  realpath,
  writeFile
} from "node:fs/promises";
import path from "node:path";

export const NATIVE_SOURCE_MANIFEST_FILE = "native-source.manifest.json";
export const NATIVE_SOURCE_SIGNATURE_FILE = "native-source.signature.json";
export const FORGE_NATIVE_SOURCE_REPOSITORY =
  "https://github.com/albertbuchard/forge";
export const UNSIGNED_INTEGRATION_COMMIT_SHA = "0".repeat(40);
export const UNSIGNED_INTEGRATION_SIGNING_KEY_ID = "0".repeat(32);

const MANIFEST_SCHEMA_VERSION = 1;
const SIGNATURE_SCHEMA_VERSION = 1;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_SIGNATURE_BYTES = 4 * 1024;
const MAX_SOURCE_FILES = 4_096;
const MAX_SOURCE_FILE_BYTES = 16 * 1024 * 1024;
const MAX_SOURCE_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;
const SEMVER_PATTERN =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const KEY_ID_PATTERN = /^[0-9a-f]{32}$/;
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const CONTROL_FILES = new Set([
  NATIVE_SOURCE_MANIFEST_FILE,
  NATIVE_SOURCE_SIGNATURE_FILE
]);

export const TRUSTED_NATIVE_SOURCE_KEYS = Object.freeze([
  Object.freeze({
    id: "89a4d300af4b6a837362a7e8e5014e6b",
    algorithm: "Ed25519",
    publicKeyPem:
      "-----BEGIN PUBLIC KEY-----\n" +
      "MCowBQYDK2VwAyEA1bqIbD6h0tzjV7w5SyBcT2UNr3zPhZRuaMREsQvrLF0=\n" +
      "-----END PUBLIC KEY-----\n",
    notBefore: "2026-07-15T00:00:00.000Z",
    notAfter: null,
    revokedAt: null
  })
]);

export class NativeSourceManifestError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "NativeSourceManifestError";
    this.code = code;
  }
}

function fail(code, message, cause) {
  throw new NativeSourceManifestError(code, message, { cause });
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactKeys(value, expected, label) {
  if (!isPlainObject(value)) fail("schema", `${label} must be an object.`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((entry, index) => entry !== wanted[index])
  ) {
    fail("schema", `${label} contains missing or unknown fields.`);
  }
}

function assertCanonicalIsoTimestamp(value, label) {
  if (typeof value !== "string" || value.length > 64) {
    fail("schema", `${label} must be a canonical ISO timestamp.`);
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    fail("schema", `${label} must be a canonical ISO timestamp.`);
  }
  return parsed.getTime();
}

function assertSemver(value, label) {
  if (
    typeof value !== "string" ||
    value.length > 128 ||
    !SEMVER_PATTERN.test(value)
  ) {
    fail("schema", `${label} must be a bounded semantic version.`);
  }
}

function normalizeManifestPath(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 512 ||
    value.includes("\0") ||
    value.includes("\\") ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    value
      .split("/")
      .some((part) => part === "" || part === "." || part === "..") ||
    path.posix.normalize(value) !== value ||
    CONTROL_FILES.has(value)
  ) {
    fail("schema", "The source manifest contains an unsafe file path.");
  }
  return value;
}

function validateFileEntry(entry) {
  assertExactKeys(
    entry,
    ["path", "size", "sha256", "executable"],
    "A source file entry"
  );
  const filePath = normalizeManifestPath(entry.path);
  if (
    !Number.isSafeInteger(entry.size) ||
    entry.size < 0 ||
    entry.size > MAX_SOURCE_FILE_BYTES
  ) {
    fail("schema", `The source file ${filePath} has an invalid size.`);
  }
  if (typeof entry.sha256 !== "string" || !SHA256_PATTERN.test(entry.sha256)) {
    fail("schema", `The source file ${filePath} has an invalid checksum.`);
  }
  if (typeof entry.executable !== "boolean") {
    fail(
      "schema",
      `The source file ${filePath} has an invalid executable flag.`
    );
  }
  return {
    path: filePath,
    size: entry.size,
    sha256: entry.sha256,
    executable: entry.executable
  };
}

export function validateNativeSourceManifest(value) {
  assertExactKeys(
    value,
    [
      "schemaVersion",
      "artifact",
      "packageName",
      "packageVersion",
      "runtimePackageVersion",
      "repository",
      "commitSha",
      "generatedAt",
      "signingKeyId",
      "files"
    ],
    "The native source manifest"
  );
  if (value.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    fail("schema", "The native source manifest version is unsupported.");
  }
  if (
    value.artifact !== "forge-peer-source" ||
    value.packageName !== "forge-peer"
  ) {
    fail("provenance", "The native source manifest names the wrong artifact.");
  }
  assertSemver(value.packageVersion, "packageVersion");
  assertSemver(value.runtimePackageVersion, "runtimePackageVersion");
  if (value.repository !== FORGE_NATIVE_SOURCE_REPOSITORY) {
    fail(
      "provenance",
      "The native source manifest names the wrong repository."
    );
  }
  if (
    typeof value.commitSha !== "string" ||
    !COMMIT_SHA_PATTERN.test(value.commitSha)
  ) {
    fail("schema", "The native source manifest commit is invalid.");
  }
  assertCanonicalIsoTimestamp(value.generatedAt, "generatedAt");
  if (
    typeof value.signingKeyId !== "string" ||
    !KEY_ID_PATTERN.test(value.signingKeyId)
  ) {
    fail("schema", "The native source manifest signing key id is invalid.");
  }
  const unsignedIntegrationCommit =
    value.commitSha === UNSIGNED_INTEGRATION_COMMIT_SHA;
  const unsignedIntegrationKey =
    value.signingKeyId === UNSIGNED_INTEGRATION_SIGNING_KEY_ID;
  if (unsignedIntegrationCommit !== unsignedIntegrationKey) {
    fail(
      "provenance",
      "Unsigned integration provenance must use both sentinel identifiers."
    );
  }
  if (
    !Array.isArray(value.files) ||
    value.files.length === 0 ||
    value.files.length > MAX_SOURCE_FILES
  ) {
    fail("schema", "The native source manifest has an invalid file count.");
  }
  const files = value.files.map(validateFileEntry);
  const sorted = [...files].sort((left, right) =>
    left.path.localeCompare(right.path, "en")
  );
  let totalBytes = 0;
  for (let index = 0; index < files.length; index += 1) {
    if (files[index].path !== sorted[index].path) {
      fail("schema", "The native source manifest file list is not canonical.");
    }
    if (index > 0 && files[index - 1].path === files[index].path) {
      fail("schema", "The native source manifest contains duplicate paths.");
    }
    totalBytes += files[index].size;
    if (totalBytes > MAX_SOURCE_TOTAL_BYTES) {
      fail(
        "bounds",
        "The native source manifest exceeds the source size limit."
      );
    }
  }
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    artifact: "forge-peer-source",
    packageName: "forge-peer",
    packageVersion: value.packageVersion,
    runtimePackageVersion: value.runtimePackageVersion,
    repository: FORGE_NATIVE_SOURCE_REPOSITORY,
    commitSha: value.commitSha,
    generatedAt: value.generatedAt,
    signingKeyId: value.signingKeyId,
    files
  };
}

export function validateNativeSourceSignature(value) {
  assertExactKeys(
    value,
    ["schemaVersion", "algorithm", "keyId", "signature"],
    "The native source signature"
  );
  if (
    value.schemaVersion !== SIGNATURE_SCHEMA_VERSION ||
    value.algorithm !== "Ed25519" ||
    typeof value.keyId !== "string" ||
    !KEY_ID_PATTERN.test(value.keyId) ||
    typeof value.signature !== "string" ||
    value.signature.length !== 86 ||
    !BASE64URL_PATTERN.test(value.signature)
  ) {
    fail("schema", "The native source signature is invalid.");
  }
  return {
    schemaVersion: SIGNATURE_SCHEMA_VERSION,
    algorithm: "Ed25519",
    keyId: value.keyId,
    signature: value.signature
  };
}

export function serializeNativeSourceManifest(manifest) {
  return `${JSON.stringify(validateNativeSourceManifest(manifest))}\n`;
}

export function serializeNativeSourceSignature(signature) {
  return `${JSON.stringify(validateNativeSourceSignature(signature))}\n`;
}

function publicKeyId(publicKey) {
  const der = publicKey.export({ type: "spki", format: "der" });
  return createHash("sha256").update(der).digest("hex").slice(0, 32);
}

export function signNativeSourceManifest(manifest, privateKeyInput) {
  const manifestBytes = Buffer.from(
    serializeNativeSourceManifest(manifest),
    "utf8"
  );
  let privateKey;
  try {
    privateKey =
      privateKeyInput?.type === "private"
        ? privateKeyInput
        : createPrivateKey(privateKeyInput);
  } catch (error) {
    fail(
      "signing_key",
      "The native source signing key could not be loaded.",
      error
    );
  }
  if (privateKey.asymmetricKeyType !== "ed25519") {
    fail("signing_key", "The native source signing key must be Ed25519.");
  }
  const keyId = publicKeyId(createPublicKey(privateKey));
  if (keyId !== manifest.signingKeyId) {
    fail(
      "signing_key",
      "The native source signing key does not match the manifest."
    );
  }
  return {
    schemaVersion: SIGNATURE_SCHEMA_VERSION,
    algorithm: "Ed25519",
    keyId,
    signature: signBytes(null, manifestBytes, privateKey).toString("base64url")
  };
}

async function hashFile(filePath) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", resolve);
  });
  return hash.digest("hex");
}

async function assertSecureRoot(sourceRoot) {
  const absoluteRoot = path.resolve(sourceRoot);
  let metadata;
  try {
    metadata = await lstat(absoluteRoot);
  } catch (error) {
    fail("filesystem", "The native source root is unavailable.", error);
  }
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    fail("filesystem", "The native source root must be a real directory.");
  }
  let resolved;
  try {
    resolved = await realpath(absoluteRoot);
  } catch (error) {
    fail("filesystem", "The native source root could not be resolved.", error);
  }
  return resolved;
}

async function inspectSourceTree(sourceRoot) {
  const root = await assertSecureRoot(sourceRoot);
  const files = [];
  let totalBytes = 0;

  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      const metadata = await lstat(entryPath);
      if (metadata.isSymbolicLink()) {
        fail("filesystem", "The native source tree contains a symbolic link.");
      }
      if (metadata.isDirectory()) {
        await walk(entryPath);
        continue;
      }
      if (!metadata.isFile()) {
        fail("filesystem", "The native source tree contains a special file.");
      }
      const relative = path.relative(root, entryPath).split(path.sep).join("/");
      if (CONTROL_FILES.has(relative)) continue;
      const manifestPath = normalizeManifestPath(relative);
      if (metadata.size > MAX_SOURCE_FILE_BYTES) {
        fail("bounds", `The native source file ${manifestPath} is too large.`);
      }
      totalBytes += metadata.size;
      if (
        files.length >= MAX_SOURCE_FILES ||
        totalBytes > MAX_SOURCE_TOTAL_BYTES
      ) {
        fail("bounds", "The native source tree exceeds its package bounds.");
      }
      files.push({
        path: manifestPath,
        size: metadata.size,
        sha256: await hashFile(entryPath),
        executable: (metadata.mode & 0o111) !== 0
      });
    }
  }

  await walk(root);
  if (files.length === 0)
    fail("filesystem", "The native source tree is empty.");
  files.sort((left, right) => left.path.localeCompare(right.path, "en"));
  return { root, files };
}

export async function createNativeSourceManifest(input) {
  const tree = await inspectSourceTree(input.sourceRoot);
  const manifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    artifact: "forge-peer-source",
    packageName: "forge-peer",
    packageVersion: input.packageVersion,
    runtimePackageVersion: input.runtimePackageVersion,
    repository: FORGE_NATIVE_SOURCE_REPOSITORY,
    commitSha: input.commitSha,
    generatedAt: (input.generatedAt ?? new Date()).toISOString(),
    signingKeyId: input.signingKeyId,
    files: tree.files
  };
  return validateNativeSourceManifest(manifest);
}

async function readBoundedJson(filePath, maximumBytes, label) {
  let metadata;
  try {
    metadata = await lstat(filePath);
  } catch (error) {
    fail("missing", `${label} is missing.`, error);
  }
  if (
    metadata.isSymbolicLink() ||
    !metadata.isFile() ||
    metadata.size <= 0 ||
    metadata.size > maximumBytes ||
    (metadata.mode & 0o111) !== 0
  ) {
    fail("filesystem", `${label} is not a bounded regular data file.`);
  }
  let bytes;
  try {
    bytes = await readFile(filePath);
  } catch (error) {
    fail("filesystem", `${label} could not be read.`, error);
  }
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    fail("schema", `${label} is not valid JSON.`, error);
  }
  return { bytes, value };
}

function validateTrustedKey(key, manifest, now) {
  assertExactKeys(
    key,
    ["id", "algorithm", "publicKeyPem", "notBefore", "notAfter", "revokedAt"],
    "A trusted native source key"
  );
  if (
    key.id !== manifest.signingKeyId ||
    key.algorithm !== "Ed25519" ||
    typeof key.publicKeyPem !== "string" ||
    !KEY_ID_PATTERN.test(key.id)
  ) {
    fail("untrusted_key", "The native source signing key is not trusted.");
  }
  if (key.revokedAt !== null) {
    assertCanonicalIsoTimestamp(key.revokedAt, "revokedAt");
    fail("revoked_key", "The native source signing key has been revoked.");
  }
  const generatedAt = assertCanonicalIsoTimestamp(
    manifest.generatedAt,
    "generatedAt"
  );
  const notBefore = assertCanonicalIsoTimestamp(key.notBefore, "notBefore");
  if (generatedAt < notBefore) {
    fail("key_validity", "The manifest predates its trusted signing key.");
  }
  if (key.notAfter !== null) {
    const notAfter = assertCanonicalIsoTimestamp(key.notAfter, "notAfter");
    if (generatedAt > notAfter) {
      fail("expired_key", "The manifest was signed after its key expired.");
    }
  }
  if (generatedAt > now.getTime() + MAX_CLOCK_SKEW_MS) {
    fail("clock", "The native source manifest timestamp is in the future.");
  }
  let publicKey;
  try {
    publicKey = createPublicKey(key.publicKeyPem);
  } catch (error) {
    fail("untrusted_key", "The trusted native source key is malformed.", error);
  }
  if (
    publicKey.asymmetricKeyType !== "ed25519" ||
    publicKeyId(publicKey) !== key.id
  ) {
    fail("untrusted_key", "The trusted native source key id is inconsistent.");
  }
  return publicKey;
}

export async function writeNativeSourceBundle(input) {
  const manifest = await createNativeSourceManifest(input);
  const signature = signNativeSourceManifest(manifest, input.privateKey);
  const manifestPath = path.join(input.sourceRoot, NATIVE_SOURCE_MANIFEST_FILE);
  const signaturePath = path.join(
    input.sourceRoot,
    NATIVE_SOURCE_SIGNATURE_FILE
  );
  await writeFile(manifestPath, serializeNativeSourceManifest(manifest), {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx"
  });
  await writeFile(signaturePath, serializeNativeSourceSignature(signature), {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx"
  });
  return { manifest, signature, manifestPath, signaturePath };
}

export async function verifyNativeSourceBundle(input) {
  const sourceRoot = await assertSecureRoot(input.sourceRoot);
  const manifestPath = path.join(sourceRoot, NATIVE_SOURCE_MANIFEST_FILE);
  const signaturePath = path.join(sourceRoot, NATIVE_SOURCE_SIGNATURE_FILE);
  const [manifestJson, signatureJson] = await Promise.all([
    readBoundedJson(
      manifestPath,
      MAX_MANIFEST_BYTES,
      "The native source manifest"
    ),
    readBoundedJson(
      signaturePath,
      MAX_SIGNATURE_BYTES,
      "The native source signature"
    )
  ]);
  const manifest = validateNativeSourceManifest(manifestJson.value);
  const signature = validateNativeSourceSignature(signatureJson.value);
  const canonicalManifest = Buffer.from(
    serializeNativeSourceManifest(manifest),
    "utf8"
  );
  const canonicalSignature = Buffer.from(
    serializeNativeSourceSignature(signature),
    "utf8"
  );
  if (!manifestJson.bytes.equals(canonicalManifest)) {
    fail("canonical", "The native source manifest encoding is not canonical.");
  }
  if (!signatureJson.bytes.equals(canonicalSignature)) {
    fail("canonical", "The native source signature encoding is not canonical.");
  }
  if (signature.keyId !== manifest.signingKeyId) {
    fail("signature", "The manifest and signature key ids do not match.");
  }
  if (
    input.expectedRuntimePackageVersion !== undefined &&
    manifest.runtimePackageVersion !== input.expectedRuntimePackageVersion
  ) {
    fail(
      "version",
      "The native source manifest does not match this runtime version."
    );
  }
  const trustedKeys = input.trustedKeys ?? TRUSTED_NATIVE_SOURCE_KEYS;
  const trustedKey = trustedKeys.find(
    (candidate) => candidate.id === signature.keyId
  );
  if (!trustedKey) {
    fail("untrusted_key", "The native source signing key is not trusted.");
  }
  const publicKey = validateTrustedKey(
    trustedKey,
    manifest,
    input.now ?? new Date()
  );
  const signatureBytes = Buffer.from(signature.signature, "base64url");
  if (
    signatureBytes.length !== 64 ||
    !verifyBytes(null, canonicalManifest, publicKey, signatureBytes)
  ) {
    fail("signature", "The native source manifest signature is invalid.");
  }

  const tree = await inspectSourceTree(sourceRoot);
  if (tree.files.length !== manifest.files.length) {
    fail(
      "file_set",
      "The native source tree does not match the signed file set."
    );
  }
  for (let index = 0; index < manifest.files.length; index += 1) {
    const expected = manifest.files[index];
    const actual = tree.files[index];
    if (
      actual.path !== expected.path ||
      actual.size !== expected.size ||
      actual.sha256 !== expected.sha256 ||
      actual.executable !== expected.executable
    ) {
      fail(
        "checksum",
        `The native source file ${expected.path} failed verification.`
      );
    }
  }
  return { manifest, signature, sourceRoot };
}
