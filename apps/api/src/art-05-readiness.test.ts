import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import AdmZip from "adm-zip";

import { buildServer } from "./app.js";
import { closeDatabase, getDatabase } from "./db.js";
import { issueTestOperatorSessionCookie } from "./security/test-operator-authority.js";
import { scanArtifactBytes } from "./services/artifacts.js";

function findingCodes(scan: ReturnType<typeof scanArtifactBytes>): Set<string> {
  return new Set(scan.scanResults.findings.map((finding) => finding.code));
}

test("ART-05 classifies malformed, macro, unsafe-archive, and unsupported files", () => {
  const malformedOffice = scanArtifactBytes({
    buffer: Buffer.from("this is not an Office archive", "utf8"),
    originalFileName: "malformed.docx",
    declaredMimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  });
  assert.ok(findingCodes(malformedOffice).has("zip_parse_error"));
  assert.equal(malformedOffice.dangerLevel, "high");
  assert.equal(malformedOffice.artifactState, "quarantined");

  const macroArchive = new AdmZip();
  macroArchive.addFile("[Content_Types].xml", Buffer.from("<Types />", "utf8"));
  macroArchive.addFile(
    "xl/workbook.xml",
    Buffer.from("<workbook><sheets /></workbook>", "utf8")
  );
  macroArchive.addFile("xl/vbaProject.bin", Buffer.from("macro", "utf8"));
  const macroOffice = scanArtifactBytes({
    buffer: macroArchive.toBuffer(),
    originalFileName: "macro-workbook.xlsm",
    declaredMimeType: "application/vnd.ms-excel.sheet.macroEnabled.12"
  });
  assert.ok(findingCodes(macroOffice).has("office_macro_project"));
  assert.equal(macroOffice.dangerLevel, "high");
  assert.equal(macroOffice.artifactState, "quarantined");

  const unsafeArchive = new AdmZip();
  unsafeArchive.addFile(
    "[Content_Types].xml",
    Buffer.from("<Types />", "utf8")
  );
  unsafeArchive.addFile(
    "xl/workbook.xml",
    Buffer.from("<workbook><sheets /></workbook>", "utf8")
  );
  unsafeArchive.addFile(
    "xl/worksheets/sheet1.xml",
    Buffer.alloc(2 * 1024 * 1024)
  );
  const compressedOffice = scanArtifactBytes({
    buffer: unsafeArchive.toBuffer(),
    originalFileName: "compressed-archive.xlsx",
    declaredMimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
  assert.ok(findingCodes(compressedOffice).has("zip_bomb_indicator"));
  assert.equal(compressedOffice.dangerLevel, "blocked");
  assert.equal(compressedOffice.artifactState, "blocked");

  for (const fixture of [
    {
      extension: "docx",
      entries: [["[Content_Types].xml", "<Types />"]]
    },
    {
      extension: "pptx",
      entries: [["[Content_Types].xml", "<Types />"]]
    },
    {
      extension: "xlsx",
      entries: [
        ["[Content_Types].xml", "<Types />"],
        ["word/document.xml", "<document />"]
      ]
    },
    {
      extension: "xlsm",
      entries: [["[Content_Types].xml", "<Types />"]]
    }
  ] as const) {
    const invalidOfficeArchive = new AdmZip();
    for (const [entryName, contents] of fixture.entries) {
      invalidOfficeArchive.addFile(entryName, Buffer.from(contents, "utf8"));
    }
    const scan = scanArtifactBytes({
      buffer: invalidOfficeArchive.toBuffer(),
      originalFileName: `malformed.${fixture.extension}`
    });
    assert.ok(findingCodes(scan).has("office_structure_invalid"));
    assert.equal(scan.dangerLevel, "high");
    assert.equal(scan.artifactState, "quarantined");
  }

  const missingContentTypes = new AdmZip();
  missingContentTypes.addFile(
    "word/document.xml",
    Buffer.from("<document />", "utf8")
  );
  const missingContentTypesScan = scanArtifactBytes({
    buffer: missingContentTypes.toBuffer(),
    originalFileName: "missing-content-types.docx"
  });
  assert.ok(
    findingCodes(missingContentTypesScan).has("office_structure_invalid")
  );
  assert.equal(missingContentTypesScan.dangerLevel, "high");
  assert.equal(missingContentTypesScan.artifactState, "quarantined");

  const unsupported = scanArtifactBytes({
    buffer: Buffer.from("MZ unsupported executable", "utf8"),
    originalFileName: "unsupported.exe",
    declaredMimeType: "application/octet-stream"
  });
  assert.ok(findingCodes(unsupported).has("unsupported_extension"));
  assert.equal(unsupported.dangerLevel, "blocked");
  assert.equal(unsupported.artifactState, "blocked");

  const malformedYaml = scanArtifactBytes({
    buffer: Buffer.from("root:\n  child: value\n bad-indent: nope", "utf8"),
    originalFileName: "malformed.yaml",
    declaredMimeType: "application/yaml"
  });
  assert.ok(findingCodes(malformedYaml).has("yaml_parse_error"));
  assert.equal(malformedYaml.dangerLevel, "low");
  assert.equal(malformedYaml.artifactState, "active");

  const duplicateYamlKey = scanArtifactBytes({
    buffer: Buffer.from("same: one\nsame: two", "utf8"),
    originalFileName: "duplicate.yml",
    declaredMimeType: "application/yaml"
  });
  assert.ok(findingCodes(duplicateYamlKey).has("yaml_parse_error"));
  assert.equal(duplicateYamlKey.dangerLevel, "low");
  assert.equal(duplicateYamlKey.artifactState, "active");

  for (const extension of ["yaml", "yml"] as const) {
    const validYaml = scanArtifactBytes({
      buffer: Buffer.from(
        "root:\n  child: value\nitems:\n  - one\n  - two",
        "utf8"
      ),
      originalFileName: `valid.${extension}`,
      declaredMimeType: "application/yaml"
    });
    assert.equal(findingCodes(validYaml).has("yaml_parse_error"), false);
    assert.ok(findingCodes(validYaml).has("static_scan_clean"));

    const validLargeYaml = scanArtifactBytes({
      buffer: Buffer.from(`quoted: "${"a".repeat(85_000)}"`, "utf8"),
      originalFileName: `valid-large.${extension}`,
      declaredMimeType: "application/yaml"
    });
    assert.equal(findingCodes(validLargeYaml).has("yaml_parse_error"), false);
    assert.ok(findingCodes(validLargeYaml).has("yaml_validation_incomplete"));
    assert.equal(validLargeYaml.artifactState, "active");
  }
});

test("ART-05 preserves the previous scan result when rescan integrity fails", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "forge-art-05-"));
  const app = await buildServer({
    dataRoot: rootDir,
    seedDemoData: false,
    devrageMetricSync: false
  });

  try {
    const operatorCookie = issueTestOperatorSessionCookie(app);
    const uploadResponse = await app.inject({
      method: "POST",
      url: "/api/v1/artifacts",
      headers: { cookie: operatorCookie },
      payload: {
        title: "Scanner retention fixture",
        originalFileName: "scanner-retention.txt",
        declaredMimeType: "text/plain",
        contentBase64: Buffer.from(
          "Static scan evidence that must remain after failure.",
          "utf8"
        ).toString("base64")
      }
    });
    assert.equal(uploadResponse.statusCode, 201, uploadResponse.body);
    const artifactId = (uploadResponse.json() as { artifact: { id: string } })
      .artifact.id;
    const before = getDatabase()
      .prepare(
        `SELECT storage_path, artifact_state, danger_score, danger_level,
                scan_results_json
         FROM artifacts
         WHERE id = ?`
      )
      .get(artifactId) as {
      storage_path: string;
      artifact_state: string;
      danger_score: number;
      danger_level: string;
      scan_results_json: string;
    };
    await writeFile(before.storage_path, Buffer.from("corrupt", "utf8"));

    const rescanResponse = await app.inject({
      method: "POST",
      url: `/api/v1/artifacts/${artifactId}/scan`,
      headers: { cookie: operatorCookie }
    });
    assert.equal(rescanResponse.statusCode, 409, rescanResponse.body);
    assert.equal(
      (rescanResponse.json() as { code: string }).code,
      "artifact_blob_integrity_mismatch"
    );

    const after = getDatabase()
      .prepare(
        `SELECT artifact_state, danger_score, danger_level, scan_results_json
         FROM artifacts
         WHERE id = ?`
      )
      .get(artifactId) as {
      artifact_state: string;
      danger_score: number;
      danger_level: string;
      scan_results_json: string;
    };
    assert.equal(after.artifact_state, "blocked");
    assert.equal(after.danger_score, before.danger_score);
    assert.equal(after.danger_level, before.danger_level);
    assert.equal(after.scan_results_json, before.scan_results_json);
  } finally {
    await app.close();
    closeDatabase();
    await rm(rootDir, { recursive: true, force: true });
  }
});
