import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

import { inspectJpeg, inspectPng } from "./documentation-scan.mjs";

const scanner = fileURLToPath(new URL("./documentation-scan.mjs", import.meta.url));
const contentPolicy = fileURLToPath(new URL("./content-policy.mjs", import.meta.url));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    ...options,
  });
  assert.equal(result.error, undefined);
  return result;
}

async function createRepository(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "acme-documentation-scan-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  await copyFile(scanner, path.join(directory, "scan.mjs"));
  await copyFile(contentPolicy, path.join(directory, "content-policy.mjs"));
  assert.equal(run("git", ["init", "-q"], { cwd: directory }).status, 0);
  assert.equal(run("git", ["config", "core.autocrlf", "false"], { cwd: directory }).status, 0);
  return directory;
}

async function addTrackedFile(directory, relativePath, content) {
  const absolute = path.join(directory, ...relativePath.split("/"));
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, content);
  const result = run("git", ["add", "--", relativePath], { cwd: directory });
  assert.equal(result.status, 0, result.stderr);
}

function scan(directory, options = {}) {
  return run(process.execPath, [path.join(directory, "scan.mjs")], { cwd: directory, ...options });
}

function outputValues(result) {
  const values = new Map();
  for (const line of result.stdout.trim().split(/\r?\n/u)) {
    assert.match(line, /^[A-Z0-9_]+=(?:[0-9]+|PASS|FAIL)$/u);
    const separator = line.indexOf("=");
    values.set(line.slice(0, separator), line.slice(separator + 1));
  }
  assert.equal(result.stderr, "");
  return values;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function pngSignature() {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

function pngHeader() {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  return header;
}

function syntheticPngWithMetadataChunks(metadataChunks = []) {
  const chunks = [pngChunk("IHDR", pngHeader()), ...metadataChunks];
  chunks.push(pngChunk("IDAT", deflateSync(Buffer.from([0, 0, 0, 0, 0xff]))));
  chunks.push(pngChunk("IEND", Buffer.alloc(0)));
  return Buffer.concat([pngSignature(), ...chunks]);
}

function syntheticPng(textMetadata = null) {
  const chunks = [];
  if (textMetadata !== null) {
    chunks.push(pngChunk("tEXt", Buffer.from(`Source\0${textMetadata}`, "latin1")));
  }
  return syntheticPngWithMetadataChunks(chunks);
}

function jpegSegment(marker, data) {
  const segmentLength = Buffer.alloc(2);
  segmentLength.writeUInt16BE(data.length + 2);
  return Buffer.concat([Buffer.from([0xff, marker]), segmentLength, data]);
}

function jpegFrame() {
  return jpegSegment(
    0xc0,
    Buffer.from([0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00]),
  );
}

function jpegScan() {
  return jpegSegment(0xda, Buffer.from([0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]));
}

function syntheticJpeg(textMetadata) {
  const metadata = Buffer.concat([
    Buffer.from([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]),
    Buffer.from(textMetadata, "latin1"),
  ]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jpegSegment(0xe1, metadata),
    jpegFrame(),
    jpegScan(),
    Buffer.from([0x11, 0x22]),
    Buffer.from([0xff, 0xd9]),
  ]);
}

function syntheticJpegWithPostScanMetadata(textMetadata) {
  const metadata = Buffer.concat([
    Buffer.from([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]),
    Buffer.from(textMetadata, "latin1"),
  ]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jpegFrame(),
    jpegScan(),
    Buffer.from([0x11, 0xff, 0x00, 0x22, 0xff, 0xd0, 0x33]),
    jpegSegment(0xe1, metadata),
    Buffer.from([0xff, 0xd9]),
  ]);
}

test("accepts valid local links and ignores external, mail, anchors, and code examples", async (t) => {
  const directory = await createRepository(t);
  await addTrackedFile(directory, "docs/guide.md", "# Guide\n");
  await addTrackedFile(directory, "README.md", [
    "[Guide](docs/guide.md?view=release#guide)",
    "[Guide reference][guide]",
    "[guide]: docs/guide.md#guide",
    "[Web](https://example.invalid/docs)",
    "[Mail](mailto:test@example.invalid)",
    "[Same page](#section)",
    "`[Code sample](missing.md)`",
    "```text",
    "[Fenced sample](also-missing.md)",
    "```",
    "",
  ].join("\n"));

  const result = scan(directory);
  const values = outputValues(result);
  assert.equal(result.status, 0, result.stdout);
  assert.equal(values.get("DOCUMENTATION_SCAN"), "PASS");
  assert.equal(values.get("LOCAL_LINKS_CHECKED"), "2");
  assert.equal(values.get("EXTERNAL_LINKS_SKIPPED"), "2");
  assert.equal(values.get("ANCHOR_LINKS_SKIPPED"), "1");
  assert.equal(values.get("LINK_MISSING_FINDINGS"), "0");
});

test("ignores ambient Git routing and requires the real repository root", async (t) => {
  const directory = await createRepository(t);
  await addTrackedFile(directory, "README.md", "Synthetic repository.\n");
  const result = scan(directory, {
    env: {
      ...process.env,
      GIT_ALTERNATE_OBJECT_DIRECTORIES: path.join(directory, "missing-alternates"),
      GIT_COMMON_DIR: path.join(directory, "missing-common-dir"),
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_GLOBAL: path.join(directory, "missing-global-config"),
      GIT_CONFIG_KEY_0: "core.hooksPath",
      GIT_CONFIG_VALUE_0: path.join(directory, "missing-hooks"),
      GIT_DIR: path.join(directory, "missing-git-dir"),
      GIT_INDEX_FILE: path.join(directory, "missing-index"),
      GIT_NAMESPACE: "synthetic-namespace",
      GIT_OBJECT_DIRECTORY: path.join(directory, "missing-objects"),
      GIT_REPLACE_REF_BASE: "refs/synthetic-replace/",
      GIT_WORK_TREE: path.join(directory, "missing-work-tree"),
    },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(outputValues(result).get("DOCUMENTATION_SCAN"), "PASS");

  const subdirectory = path.join(directory, "subdirectory");
  await mkdir(subdirectory);
  const wrongRoot = run(process.execPath, [path.join(directory, "scan.mjs")], {
    cwd: subdirectory,
  });
  assert.notEqual(wrongRoot.status, 0);
  assert.equal(outputValues(wrongRoot).get("DOCUMENTATION_SCAN"), "FAIL");
});

test("does not inspect ignored untracked files", async (t) => {
  const directory = await createRepository(t);
  await addTrackedFile(directory, ".gitignore", "ignored-fixtures/\n");
  await addTrackedFile(directory, "README.md", "Synthetic repository.\n");
  const ignoredDirectory = path.join(directory, "ignored-fixtures");
  await mkdir(ignoredDirectory);
  const privateMetadata = ["/", "home", "/", "fixture-user", "/", "asset.png"].join("");
  await writeFile(path.join(ignoredDirectory, "ignored.png"), syntheticPng(privateMetadata));
  await writeFile(path.join(ignoredDirectory, "ignored.md"), "[Outside](../../outside.txt)\n");

  const result = scan(directory);
  const values = outputValues(result);
  assert.equal(result.status, 0, result.stdout);
  assert.equal(values.get("TRACKED_FILES"), "2");
  assert.equal(values.get("TRACKED_BINARY_FILES"), "0");
  assert.equal(values.get("MARKDOWN_FILES"), "1");
  assert.equal(values.get("DOCUMENTATION_SCAN"), "PASS");
});

test("rejects a missing local file without disclosing its path", async (t) => {
  const directory = await createRepository(t);
  const missingName = ["not", "-present.md"].join("");
  await addTrackedFile(directory, "README.md", `[Missing](${missingName}#section)\n`);

  const result = scan(directory);
  const values = outputValues(result);
  assert.equal(result.status, 1, result.stdout);
  assert.equal(values.get("LINK_MISSING_FINDINGS"), "1");
  assert.equal(values.get("DOCUMENTATION_SCAN"), "FAIL");
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(missingName, "u"));
});

test("rejects percent-encoded traversal outside the repository", async (t) => {
  const directory = await createRepository(t);
  await addTrackedFile(directory, "docs/README.md", "[Outside](%2e%2e/%2e%2e/outside.txt)\n");

  const result = scan(directory);
  const values = outputValues(result);
  assert.equal(result.status, 1, result.stdout);
  assert.equal(values.get("LINK_TRAVERSAL_FINDINGS"), "1");
  assert.equal(values.get("DOCUMENTATION_SCAN"), "FAIL");
});

test("rejects a link whose case differs from the Git index", async (t) => {
  const directory = await createRepository(t);
  await addTrackedFile(directory, "docs/Guide.md", "# Guide\n");
  await addTrackedFile(directory, "README.md", "[Guide](docs/guide.md)\n");

  const result = scan(directory);
  const values = outputValues(result);
  assert.equal(result.status, 1, result.stdout);
  assert.equal(values.get("LINK_CASE_MISMATCH_FINDINGS"), "1");
  assert.equal(values.get("LINK_MISSING_FINDINGS"), "0");
  assert.equal(values.get("DOCUMENTATION_SCAN"), "FAIL");
});

test("rejects a link to a tracked directory", async (t) => {
  const directory = await createRepository(t);
  await addTrackedFile(directory, "docs/guide.md", "# Guide\n");
  await addTrackedFile(directory, "README.md", "[Docs](docs/)\n");

  const result = scan(directory);
  const values = outputValues(result);
  assert.equal(result.status, 1, result.stdout);
  assert.equal(values.get("LINK_DIRECTORY_FINDINGS"), "1");
  assert.equal(values.get("DOCUMENTATION_SCAN"), "FAIL");
});

test("accepts a small PNG without sensitive metadata", async (t) => {
  const directory = await createRepository(t);
  const image = syntheticPng();
  await addTrackedFile(directory, "docs/assets/safe.png", image);
  await addTrackedFile(directory, "README.md", "![Safe asset](docs/assets/safe.png#preview)\n");

  const result = scan(directory);
  const values = outputValues(result);
  assert.equal(result.status, 0, result.stdout);
  assert.equal(values.get("TRACKED_BINARY_FILES"), "1");
  assert.equal(values.get("TRACKED_BINARY_BYTES"), String(image.length));
  assert.equal(values.get("IMAGE_METADATA_FINDINGS"), "0");
  assert.equal(values.get("DOCUMENTATION_SCAN"), "PASS");
});

test("rejects PNG CRC, critical-order, missing-IDAT, and trailing-data bypasses", async (t) => {
  const directory = await createRepository(t);
  const badCrc = Buffer.from(syntheticPng());
  badCrc[badCrc.length - 1] ^= 0xff;
  const missingData = Buffer.concat([
    pngSignature(),
    pngChunk("IHDR", pngHeader()),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  const wrongFirstChunk = Buffer.concat([
    pngSignature(),
    pngChunk("tEXt", Buffer.from("Source\0public", "latin1")),
    pngChunk("IHDR", pngHeader()),
    pngChunk("IDAT", Buffer.alloc(0)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  const trailingData = Buffer.concat([syntheticPng(), Buffer.from([0x00])]);
  await addTrackedFile(directory, "bad-crc.png", badCrc);
  await addTrackedFile(directory, "missing-data.png", missingData);
  await addTrackedFile(directory, "wrong-first.png", wrongFirstChunk);
  await addTrackedFile(directory, "trailing-data.png", trailingData);

  const result = scan(directory);
  const values = outputValues(result);
  assert.equal(result.status, 1, result.stdout);
  assert.equal(values.get("BINARY_FORMAT_FINDINGS"), "4");
  assert.equal(values.get("DOCUMENTATION_SCAN"), "FAIL");
});

test("inflates bounded zTXt, iTXt, and iCCP metadata", async (t) => {
  const directory = await createRepository(t);
  const privateMetadata = ["/", "home", "/", "compressed-user", "/", "asset.png"].join("");
  const compressed = deflateSync(Buffer.from(privateMetadata, "latin1"));
  const fixtures = [
    ["compressed-text.png", pngChunk("zTXt", Buffer.concat([
      Buffer.from("Source\0", "latin1"),
      Buffer.from([0x00]),
      compressed,
    ]))],
    ["international-text.png", pngChunk("iTXt", Buffer.concat([
      Buffer.from("Source\0", "latin1"),
      Buffer.from([0x01, 0x00]),
      Buffer.from("en\0Source\0", "latin1"),
      compressed,
    ]))],
    ["profile.png", pngChunk("iCCP", Buffer.concat([
      Buffer.from("Profile\0", "latin1"),
      Buffer.from([0x00]),
      compressed,
    ]))],
  ];
  for (const [name, chunk] of fixtures) {
    await addTrackedFile(directory, name, syntheticPngWithMetadataChunks([chunk]));
  }

  const result = scan(directory);
  const values = outputValues(result);
  assert.equal(result.status, 1, result.stdout);
  assert.equal(values.get("BINARY_FORMAT_FINDINGS"), "0");
  assert.equal(values.get("IMAGE_METADATA_FINDINGS"), "3");
  assert.equal(values.get("DOCUMENTATION_SCAN"), "FAIL");
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(privateMetadata, "u"));
});

test("detects sensitive metadata split across private PNG chunks", async (t) => {
  const directory = await createRepository(t);
  const first = ["C:", "\\", "Us"].join("");
  const second = ["ers", "\\", "split-user", "\\", "asset.png"].join("");
  const image = syntheticPngWithMetadataChunks([
    pngChunk("vpAg", Buffer.from(first, "latin1")),
    pngChunk("vpAg", Buffer.from(second, "latin1")),
  ]);
  await addTrackedFile(directory, "split-private.png", image);

  const result = scan(directory);
  const values = outputValues(result);
  assert.equal(result.status, 1, result.stdout);
  assert.equal(values.get("BINARY_FORMAT_FINDINGS"), "0");
  assert.equal(values.get("IMAGE_METADATA_FINDINGS"), "1");
  assert.equal(values.get("DOCUMENTATION_SCAN"), "FAIL");
});

test("bounds aggregate metadata across PNG and JPEG segments", () => {
  const pngPart = Buffer.alloc((1024 * 1024) + 1, 0x41);
  const png = syntheticPngWithMetadataChunks([
    pngChunk("vpAg", pngPart),
    pngChunk("vpAg", pngPart),
  ]);
  assert.equal(inspectPng(png).valid, false);

  const jpegSegments = Array.from(
    { length: 33 },
    () => jpegSegment(0xe1, Buffer.alloc((64 * 1024) - 3, 0x41)),
  );
  const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    ...jpegSegments,
    jpegFrame(),
    jpegScan(),
    Buffer.from([0x11, 0x22, 0xff, 0xd9]),
  ]);
  assert.equal(inspectJpeg(jpeg).valid, false);
});

test("rejects sensitive PNG text metadata without disclosing it", async (t) => {
  const directory = await createRepository(t);
  const privateMetadata = ["C:", "\\", "Users", "\\", "fixture-user", "\\", "asset.png"].join("");
  const imageName = ["metadata", "-fixture.png"].join("");
  await addTrackedFile(directory, imageName, syntheticPng(privateMetadata));
  await addTrackedFile(directory, "README.md", `![Fixture](${imageName})\n`);

  const result = scan(directory);
  const values = outputValues(result);
  assert.equal(result.status, 1, result.stdout);
  assert.equal(values.get("IMAGE_METADATA_FINDINGS"), "1");
  assert.equal(values.get("DOCUMENTATION_SCAN"), "FAIL");
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(privateMetadata.replaceAll("\\", "\\\\"), "u"));
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(imageName, "u"));
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(directory.replaceAll("\\", "\\\\"), "u"));
});

test("rejects a synthetic GitLab token in image metadata without disclosing it", async (t) => {
  const directory = await createRepository(t);
  const syntheticSecret = "glpat-" + "G".repeat(30);
  await addTrackedFile(directory, "token-fixture.png", syntheticPng(syntheticSecret));
  await addTrackedFile(directory, "README.md", "![Fixture](token-fixture.png)\n");

  const result = scan(directory);
  const values = outputValues(result);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(values.get("IMAGE_METADATA_FINDINGS"), "1");
  assert.equal(values.get("DOCUMENTATION_SCAN"), "FAIL");
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(syntheticSecret, "u"));
});

test("rejects a provider-specific key assignment in PNG metadata", async (t) => {
  const directory = await createRepository(t);
  const providerKey = ["WXO", "API", "KEY"].join("_");
  const opaqueValue = ["opaque", "metadata", "fixture", "value"].join("-");
  const sensitiveMetadata = `${providerKey}=${opaqueValue}`;
  await addTrackedFile(directory, "provider-fixture.png", syntheticPng(sensitiveMetadata));
  await addTrackedFile(directory, "README.md", "![Fixture](provider-fixture.png)\n");

  const result = scan(directory);
  const values = outputValues(result);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(values.get("IMAGE_METADATA_FINDINGS"), "1");
  assert.equal(values.get("DOCUMENTATION_SCAN"), "FAIL");
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(opaqueValue, "u"));
});

test("rejects sensitive JPEG EXIF metadata without disclosing it", async (t) => {
  const directory = await createRepository(t);
  const privateMetadata = ["/", "home", "/", "fixture-user", "/", "asset.jpg"].join("");
  await addTrackedFile(directory, "asset.jpg", syntheticJpeg(privateMetadata));
  await addTrackedFile(directory, "README.md", "![Fixture](asset.jpg)\n");

  const result = scan(directory);
  const values = outputValues(result);
  assert.equal(result.status, 1, result.stdout);
  assert.equal(values.get("BINARY_FORMAT_FINDINGS"), "0");
  assert.equal(values.get("IMAGE_METADATA_FINDINGS"), "1");
  assert.equal(values.get("DOCUMENTATION_SCAN"), "FAIL");
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(privateMetadata, "u"));
});

test("accepts a structurally complete synthetic JPEG", async (t) => {
  const directory = await createRepository(t);
  await addTrackedFile(directory, "safe.jpg", syntheticJpeg("Public fixture metadata"));

  const result = scan(directory);
  const values = outputValues(result);
  assert.equal(result.status, 0, result.stdout);
  assert.equal(values.get("BINARY_FORMAT_FINDINGS"), "0");
  assert.equal(values.get("IMAGE_METADATA_FINDINGS"), "0");
  assert.equal(values.get("DOCUMENTATION_SCAN"), "PASS");
});

test("rejects a JPEG stub that ends at the first start-of-scan marker", async (t) => {
  const directory = await createRepository(t);
  const stub = Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02]);
  await addTrackedFile(directory, "scan-stub.jpg", stub);

  const result = scan(directory);
  const values = outputValues(result);
  assert.equal(result.status, 1, result.stdout);
  assert.equal(values.get("TRACKED_BINARY_FILES"), "1");
  assert.equal(values.get("BINARY_FORMAT_FINDINGS"), "1");
  assert.equal(values.get("DOCUMENTATION_SCAN"), "FAIL");
});

test("scans JPEG metadata between entropy data and the end marker", async (t) => {
  const directory = await createRepository(t);
  const privateMetadata = ["C:", "\\", "Users", "\\", "post-scan-user", "\\", "asset.jpg"].join("");
  await addTrackedFile(
    directory,
    "post-scan-metadata.jpg",
    syntheticJpegWithPostScanMetadata(privateMetadata),
  );

  const result = scan(directory);
  const values = outputValues(result);
  assert.equal(result.status, 1, result.stdout);
  assert.equal(values.get("BINARY_FORMAT_FINDINGS"), "0");
  assert.equal(values.get("IMAGE_METADATA_FINDINGS"), "1");
  assert.equal(values.get("DOCUMENTATION_SCAN"), "FAIL");
  assert.doesNotMatch(
    result.stdout + result.stderr,
    new RegExp(privateMetadata.replaceAll("\\", "\\\\"), "u"),
  );
});

test("requires JPEG frame, scan, and end markers", async (t) => {
  const directory = await createRepository(t);
  await addTrackedFile(directory, "missing-frame.jpg", Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jpegScan(),
    Buffer.from([0x11, 0x22, 0xff, 0xd9]),
  ]));
  await addTrackedFile(directory, "missing-scan.jpg", Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jpegFrame(),
    Buffer.from([0xff, 0xd9]),
  ]));
  await addTrackedFile(directory, "missing-end.jpg", Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jpegFrame(),
    jpegScan(),
    Buffer.from([0x11, 0x22]),
  ]));

  const result = scan(directory);
  const values = outputValues(result);
  assert.equal(result.status, 1, result.stdout);
  assert.equal(values.get("BINARY_FORMAT_FINDINGS"), "3");
  assert.equal(values.get("DOCUMENTATION_SCAN"), "FAIL");
});

test("detects sensitive metadata split across JPEG APP1 segments", async (t) => {
  const directory = await createRepository(t);
  const first = ["C:", "\\", "Us"].join("");
  const second = ["ers", "\\", "jpeg-split-user", "\\", "asset.jpg"].join("");
  const image = Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jpegSegment(0xe1, Buffer.from(first, "latin1")),
    jpegSegment(0xe1, Buffer.from(second, "latin1")),
    jpegFrame(),
    jpegScan(),
    Buffer.from([0x11, 0x22, 0xff, 0xd9]),
  ]);
  await addTrackedFile(directory, "split-app1.jpg", image);

  const result = scan(directory);
  const values = outputValues(result);
  assert.equal(result.status, 1, result.stdout);
  assert.equal(values.get("BINARY_FORMAT_FINDINGS"), "0");
  assert.equal(values.get("IMAGE_METADATA_FINDINGS"), "1");
  assert.equal(values.get("DOCUMENTATION_SCAN"), "FAIL");
});

test("rejects root paths and exact Instana header assignments in image metadata", async (t) => {
  const directory = await createRepository(t);
  const rootPath = ["/", "root", "/", "private", "/", "asset.png"].join("");
  const instanaHeader = ["x-instana", "-key", "=opaque-fixture-value"].join("");
  await addTrackedFile(directory, "root-path.png", syntheticPng(rootPath));
  await addTrackedFile(directory, "instana-header.jpg", syntheticJpeg(instanaHeader));

  const result = scan(directory);
  const values = outputValues(result);
  assert.equal(result.status, 1, result.stdout);
  assert.equal(values.get("BINARY_FORMAT_FINDINGS"), "0");
  assert.equal(values.get("IMAGE_METADATA_FINDINGS"), "2");
  assert.equal(values.get("DOCUMENTATION_SCAN"), "FAIL");
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(rootPath, "u"));
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(instanaHeader, "u"));
});

test("detects odd-aligned UTF-16 metadata independently in JPEG APP and COM segments", async (t) => {
  const directory = await createRepository(t);
  const fixtureHeader = ["x", "instana", "key"].join("-");
  const fixtureValue = ["opaque", "utf16", "fixture"].join("-");
  const sensitiveMarker = [fixtureHeader, fixtureValue].join(String.fromCharCode(61));
  const littleEndian = Buffer.from(sensitiveMarker, "utf16le");
  const bigEndian = Buffer.alloc(littleEndian.length);
  for (let index = 0; index < littleEndian.length; index += 2) {
    bigEndian[index] = littleEndian[index + 1];
    bigEndian[index + 1] = littleEndian[index];
  }
  const imageWith = (marker, metadata) => Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jpegSegment(marker, Buffer.concat([Buffer.from([0x41]), metadata])),
    jpegFrame(),
    jpegScan(),
    Buffer.from([0x11, 0x22, 0xff, 0xd9]),
  ]);
  await addTrackedFile(directory, "utf16-app.jpg", imageWith(0xe1, littleEndian));
  await addTrackedFile(directory, "utf16-comment.jpg", imageWith(0xfe, bigEndian));

  const result = scan(directory);
  const values = outputValues(result);
  assert.equal(result.status, 1, result.stdout);
  assert.equal(values.get("BINARY_FORMAT_FINDINGS"), "0");
  assert.equal(values.get("IMAGE_METADATA_FINDINGS"), "2");
  assert.equal(values.get("DOCUMENTATION_SCAN"), "FAIL");
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(sensitiveMarker, "u"));
});

test("rejects a tracked symlink-mode target without following it", async (t) => {
  const directory = await createRepository(t);
  await addTrackedFile(directory, "README.md", "![Linked asset](linked.png)\n");
  const object = run("git", ["hash-object", "-w", "--stdin"], {
    cwd: directory,
    input: "outside-target\n",
  });
  assert.equal(object.status, 0, object.stderr);
  const objectId = object.stdout.trim();
  const update = run("git", ["update-index", "--add", "--cacheinfo", `120000,${objectId},linked.png`], {
    cwd: directory,
  });
  assert.equal(update.status, 0, update.stderr);

  const result = scan(directory);
  const values = outputValues(result);
  assert.equal(result.status, 1, result.stdout);
  assert.equal(values.get("TRACKED_SPECIAL_FINDINGS"), "1");
  assert.equal(values.get("LINK_SPECIAL_TARGET_FINDINGS"), "1");
  assert.equal(values.get("DOCUMENTATION_SCAN"), "FAIL");
});

test("applies full provider and escaped-path detection to decoded image metadata", async (t) => {
  const directory = await createRepository(t);
  const providerName = ["WXO", "API", "KEY"].join("_");
  const headerName = ["x", "instana", "key"].join("-");
  const opaqueValue = ["opaque", "image", "fixture", "value"].join("-");
  const bracketAssignment = `process.env["${providerName}"] = "${opaqueValue}"`;
  const headerAppend = `headers.append("${headerName}", "${opaqueValue}")`;
  const escapedPath = ["C:", "\\\\", "Users", "\\\\", "image-user", "\\\\", "asset.png"].join("");
  await addTrackedFile(directory, "bracket.png", syntheticPng(bracketAssignment));
  await addTrackedFile(directory, "header-append.jpg", syntheticJpeg(headerAppend));
  await addTrackedFile(directory, "escaped-path.png", syntheticPng(escapedPath));

  const result = scan(directory);
  const values = outputValues(result);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(values.get("BINARY_FORMAT_FINDINGS"), "0");
  assert.equal(values.get("IMAGE_METADATA_FINDINGS"), "3");
  assert.equal(values.get("DOCUMENTATION_SCAN"), "FAIL");
  for (const sensitive of [opaqueValue, escapedPath]) {
    assert.equal((result.stdout + result.stderr).includes(sensitive), false);
  }
});

test("keeps decoded metadata references, exact annotations, continuations, placeholders, and synthetic URLs calibrated", async (t) => {
  const directory = await createRepository(t);
  const providerName = ["WXO", "API", "KEY"].join("_");
  const tokenField = ["api", "token"].join("_");
  const fixtureUrl = ["https", "://", "user", ":", "password", "@", "service.example.invalid", "/path"].join("");
  const metadata = [
    `${providerName} = Optional[str]`,
    `${tokenField} = (\n  load_runtime_value()\n)`,
    `process.env["${providerName}"] = config.runtimeKey`,
    `${providerName} = ${"$" + "{RUNTIME_KEY}"}`,
    fixtureUrl,
  ].join("\n");
  await addTrackedFile(directory, "safe-policy.png", syntheticPng(metadata));

  const result = scan(directory);
  const values = outputValues(result);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(values.get("BINARY_FORMAT_FINDINGS"), "0");
  assert.equal(values.get("IMAGE_METADATA_FINDINGS"), "0");
  assert.equal(values.get("DOCUMENTATION_SCAN"), "PASS");
});

test("rejects binary content with an unknown extension", async (t) => {
  const directory = await createRepository(t);
  await addTrackedFile(directory, "asset.fixture", Buffer.from([0x00, 0x01, 0x02, 0x03]));
  await addTrackedFile(directory, "README.md", "Synthetic repository.\n");

  const result = scan(directory);
  const values = outputValues(result);
  assert.equal(result.status, 1, result.stdout);
  assert.equal(values.get("TRACKED_BINARY_FILES"), "1");
  assert.equal(values.get("BINARY_UNKNOWN_EXTENSION_FINDINGS"), "1");
  assert.equal(values.get("DOCUMENTATION_SCAN"), "FAIL");
});

test("detects oversize unknown binary content after an ASCII prefix", async (t) => {
  const directory = await createRepository(t);
  const content = Buffer.alloc((10 * 1024 * 1024) + 1, 0x41);
  content[(64 * 1024) + 17] = 0x00;
  await addTrackedFile(directory, "late-binary.fixture", content);

  const result = scan(directory);
  const values = outputValues(result);
  assert.equal(result.status, 1, result.stdout);
  assert.equal(values.get("TRACKED_BINARY_FILES"), "1");
  assert.equal(values.get("TRACKED_BINARY_BYTES"), String(content.length));
  assert.equal(values.get("BINARY_OVERSIZE_FINDINGS"), "1");
  assert.equal(values.get("BINARY_UNKNOWN_EXTENSION_FINDINGS"), "1");
  assert.equal(values.get("DOCUMENTATION_SCAN"), "FAIL");
});

test("rejects a recognized ZIP as an unsupported binary format", async (t) => {
  const directory = await createRepository(t);
  const emptyZip = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x05, 0x06]),
    Buffer.alloc(18),
  ]);
  await addTrackedFile(directory, "archive.zip", emptyZip);

  const result = scan(directory);
  const values = outputValues(result);
  assert.equal(result.status, 1, result.stdout);
  assert.equal(values.get("TRACKED_BINARY_FILES"), "1");
  assert.equal(values.get("BINARY_FORMAT_FINDINGS"), "0");
  assert.equal(values.get("BINARY_UNSUPPORTED_FORMAT_FINDINGS"), "1");
  assert.equal(values.get("DOCUMENTATION_SCAN"), "FAIL");
});
