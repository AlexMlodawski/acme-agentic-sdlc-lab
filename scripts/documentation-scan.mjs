import { spawnSync } from "node:child_process";
import { lstat, open, readFile, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { TextDecoder } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inflateSync } from "node:zlib";

import {
  containsAbsoluteUserPath,
  containsHighConfidenceSecret,
  containsOpaqueProviderCredential,
} from "./content-policy.mjs";

const MAX_BINARY_BYTES = 10 * 1024 * 1024;
const MAX_MARKDOWN_BYTES = 10 * 1024 * 1024;
const MAX_METADATA_BYTES = 2 * 1024 * 1024;
const PREFIX_BYTES = 64 * 1024;
const root = process.cwd();
const REGULAR_GIT_MODES = new Set(["100644", "100755"]);
const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"]);
const SUPPORTED_BINARY_TYPES = new Set(["jpeg", "png"]);
const TEXT_CONTROL_BYTES = new Set([9, 10, 12, 13]);

const BINARY_TYPES = new Map([
  [".gif", "gif"],
  [".ico", "ico"],
  [".jpeg", "jpeg"],
  [".jpg", "jpeg"],
  [".m4a", "mp4"],
  [".mkv", "webm"],
  [".mp3", "mp3"],
  [".mp4", "mp4"],
  [".ogg", "ogg"],
  [".otf", "otf"],
  [".pdf", "pdf"],
  [".png", "png"],
  [".ttf", "ttf"],
  [".wasm", "wasm"],
  [".wav", "wav"],
  [".webm", "webm"],
  [".webp", "webp"],
  [".woff", "woff"],
  [".woff2", "woff2"],
  [".zip", "zip"],
]);

const GENERIC_METADATA_CREDENTIAL = /\b(?:api[_-]?key|access[_-]?token|password|secret)\b\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{8,}/iu;

function isolatedGitEnvironment(environment = process.env) {
  const allowed = new Set([
    "COMSPEC", "LANG", "LANGUAGE", "LC_ALL", "PATH", "PATHEXT", "SYSTEMDRIVE",
    "SYSTEMROOT", "TEMP", "TERM", "TMP", "TMPDIR", "WINDIR",
  ]);
  const result = {};
  for (const [name, value] of Object.entries(environment)) {
    if (typeof value === "string" && allowed.has(name.toUpperCase())) result[name] = value;
  }
  return {
    ...result,
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : os.devNull,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_NO_LAZY_FETCH: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
  };
}

const gitEnvironment = isolatedGitEnvironment();

function runGit(cwd, args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: null,
    env: gitEnvironment,
    maxBuffer: 64 * 1024 * 1024,
    shell: false,
    windowsHide: true,
  });
  if (result.error || result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
    throw new Error("git operation failed");
  }
  return result.stdout;
}

async function repositoryRoot() {
  const serialized = runGit(root, ["rev-parse", "--show-toplevel"]);
  const decoded = serialized.toString("utf8").trimEnd();
  if (decoded === "" || decoded.includes("\uFFFD") || /[\r\n]/u.test(decoded)) {
    throw new Error("repository root is invalid");
  }
  const [realTopLevel, realWorkingDirectory] = await Promise.all([
    realpath(decoded),
    realpath(root),
  ]);
  const normalize = (value) => {
    const resolved = path.resolve(value);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  if (normalize(realTopLevel) !== normalize(realWorkingDirectory)) {
    throw new Error("documentation scan must run at the repository root");
  }
  return realTopLevel;
}

function trackedEntries(root) {
  const serialized = runGit(root, ["ls-files", "--stage", "-z"]);
  const decoded = serialized.toString("utf8");
  if (decoded.includes("\uFFFD")) throw new Error("tracked paths are not UTF-8");

  const entries = [];
  for (const record of decoded.split("\0")) {
    if (record === "") continue;
    const separator = record.indexOf("\t");
    const metadata = separator < 0 ? "" : record.slice(0, separator);
    const match = /^([0-7]{6}) ([0-9a-f]{40,64}) ([0-3])$/u.exec(metadata);
    if (!match || separator < 0) throw new Error("tracked entry is malformed");
    entries.push({
      mode: match[1],
      objectId: match[2],
      stage: match[3],
      gitPath: record.slice(separator + 1),
    });
  }
  if (entries.length === 0) throw new Error("repository has no tracked files");
  return entries;
}

function isContained(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (
    relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

function absoluteFromGitPath(root, gitPath) {
  if (
    gitPath === ""
    || gitPath.includes("\\")
    || gitPath.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error("tracked path is unsafe");
  }
  const absolute = path.resolve(root, ...gitPath.split("/"));
  if (!isContained(root, absolute) || absolute === root) {
    throw new Error("tracked path escapes repository");
  }
  return absolute;
}

function gitCaseKey(value) {
  return value.toLowerCase();
}

function buildPathIndex(entries) {
  const files = new Map();
  const foldedFiles = new Map();
  const directories = new Set();
  const foldedDirectories = new Set();
  let indexFindings = 0;

  for (const entry of entries) {
    if (entry.stage !== "0" || files.has(entry.gitPath)) {
      indexFindings += 1;
      continue;
    }
    files.set(entry.gitPath, entry);
    const folded = gitCaseKey(entry.gitPath);
    if (!foldedFiles.has(folded)) foldedFiles.set(folded, []);
    foldedFiles.get(folded).push(entry.gitPath);

    const segments = entry.gitPath.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      const directory = segments.slice(0, index).join("/");
      directories.add(directory);
      foldedDirectories.add(gitCaseKey(directory));
    }
  }
  return { files, foldedFiles, directories, foldedDirectories, indexFindings };
}

async function readPrefix(absolute, size) {
  const length = Math.min(size, PREFIX_BYTES);
  if (length === 0) return Buffer.alloc(0);
  const buffer = Buffer.alloc(length);
  const handle = await open(absolute, "r");
  try {
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function classifyFileContent(absolute, expectedSize) {
  const prefix = Buffer.alloc(Math.min(expectedSize, PREFIX_BYTES));
  const chunk = Buffer.alloc(PREFIX_BYTES);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytesReadTotal = 0;
  let prefixBytes = 0;
  let controls = 0;
  let invalidUtf8 = false;
  let sawNull = false;
  const handle = await open(absolute, "r");

  try {
    while (true) {
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, bytesReadTotal);
      if (bytesRead === 0) break;
      const window = chunk.subarray(0, bytesRead);
      const copyLength = Math.min(window.length, prefix.length - prefixBytes);
      if (copyLength > 0) {
        window.copy(prefix, prefixBytes, 0, copyLength);
        prefixBytes += copyLength;
      }

      for (const byte of window) {
        if (byte === 0) sawNull = true;
        if (byte < 32 && !TEXT_CONTROL_BYTES.has(byte)) controls += 1;
      }
      if (!invalidUtf8) {
        try {
          decoder.decode(window, { stream: true });
        } catch {
          invalidUtf8 = true;
        }
      }
      bytesReadTotal += bytesRead;

      // NUL and invalid UTF-8 are definitive. Stop without retaining the rest of
      // the file; size accounting continues to come from lstat.
      if (sawNull || invalidUtf8) break;
    }

    if (!sawNull && !invalidUtf8 && bytesReadTotal === expectedSize) {
      try {
        decoder.decode();
      } catch {
        invalidUtf8 = true;
      }
    }
  } finally {
    await handle.close();
  }

  if (!sawNull && !invalidUtf8 && bytesReadTotal !== expectedSize) {
    throw new Error("tracked file changed while it was classified");
  }
  return {
    prefix: prefix.subarray(0, prefixBytes),
    binary: sawNull || invalidUtf8
      || (bytesReadTotal > 0 && controls / bytesReadTotal > 0.02),
  };
}

function startsWithBytes(buffer, expected, offset = 0) {
  if (buffer.length < offset + expected.length) return false;
  return expected.every((byte, index) => buffer[offset + index] === byte);
}

function hasKnownSignature(type, buffer) {
  switch (type) {
    case "gif":
      return buffer.subarray(0, 6).toString("ascii") === "GIF87a"
        || buffer.subarray(0, 6).toString("ascii") === "GIF89a";
    case "ico":
      return startsWithBytes(buffer, [0x00, 0x00, 0x01, 0x00]);
    case "jpeg":
      return startsWithBytes(buffer, [0xff, 0xd8, 0xff]);
    case "mp3":
      return buffer.subarray(0, 3).toString("ascii") === "ID3"
        || (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0);
    case "mp4":
      return buffer.subarray(4, 8).toString("ascii") === "ftyp";
    case "ogg":
      return buffer.subarray(0, 4).toString("ascii") === "OggS";
    case "otf":
      return buffer.subarray(0, 4).toString("ascii") === "OTTO";
    case "pdf":
      return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
    case "png":
      return startsWithBytes(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "ttf":
      return startsWithBytes(buffer, [0x00, 0x01, 0x00, 0x00])
        || buffer.subarray(0, 4).toString("ascii") === "true";
    case "wasm":
      return startsWithBytes(buffer, [0x00, 0x61, 0x73, 0x6d]);
    case "wav":
      return buffer.subarray(0, 4).toString("ascii") === "RIFF"
        && buffer.subarray(8, 12).toString("ascii") === "WAVE";
    case "webm":
      return startsWithBytes(buffer, [0x1a, 0x45, 0xdf, 0xa3]);
    case "webp":
      return buffer.subarray(0, 4).toString("ascii") === "RIFF"
        && buffer.subarray(8, 12).toString("ascii") === "WEBP";
    case "woff":
      return buffer.subarray(0, 4).toString("ascii") === "wOFF";
    case "woff2":
      return buffer.subarray(0, 4).toString("ascii") === "wOF2";
    case "zip":
      return startsWithBytes(buffer, [0x50, 0x4b, 0x03, 0x04])
        || startsWithBytes(buffer, [0x50, 0x4b, 0x05, 0x06])
        || startsWithBytes(buffer, [0x50, 0x4b, 0x07, 0x08]);
    default:
      return false;
  }
}

function utf16BigEndian(buffer, offset = 0) {
  const source = buffer.subarray(offset);
  const evenLength = source.length - (source.length % 2);
  const swapped = Buffer.alloc(evenLength);
  for (let index = 0; index < evenLength; index += 2) {
    swapped[index] = source[index + 1];
    swapped[index + 1] = source[index];
  }
  return swapped.toString("utf16le");
}

function containsSensitiveMetadata(buffer) {
  const representations = [
    buffer.toString("latin1"),
    buffer.toString("utf8"),
    buffer.toString("utf16le"),
    buffer.subarray(1).toString("utf16le"),
    utf16BigEndian(buffer, 0),
    utf16BigEndian(buffer, 1),
  ];
  return representations.some((text) => (
    containsHighConfidenceSecret(text)
    || containsOpaqueProviderCredential(text)
    || containsAbsoluteUserPath(text)
    || GENERIC_METADATA_CREDENTIAL.test(text)
  ));
}

function inflateMetadata(buffer, maximumOutputBytes = MAX_METADATA_BYTES) {
  if (
    buffer.length > MAX_METADATA_BYTES
    || maximumOutputBytes < 1
    || maximumOutputBytes > MAX_METADATA_BYTES
  ) {
    return null;
  }
  try {
    const inflated = inflateSync(buffer, {
      info: true,
      maxOutputLength: maximumOutputBytes,
    });
    return inflated.engine.bytesWritten === buffer.length ? inflated.buffer : null;
  } catch {
    return null;
  }
}

function metadataAccumulator() {
  const parts = [];
  let encodedBytes = 0;
  let decodedBytes = 0;
  return {
    reserveEncoded(buffer) {
      if (encodedBytes + buffer.length > MAX_METADATA_BYTES) return false;
      encodedBytes += buffer.length;
      return true;
    },
    append(buffer) {
      if (decodedBytes + buffer.length > MAX_METADATA_BYTES) return false;
      parts.push(buffer);
      decodedBytes += buffer.length;
      return true;
    },
    remainingDecoded() {
      return MAX_METADATA_BYTES - decodedBytes;
    },
    sensitive() {
      if (decodedBytes === 0) return false;
      return parts.some((part) => containsSensitiveMetadata(part))
        || containsSensitiveMetadata(Buffer.concat(parts, decodedBytes));
    },
  };
}

function validPngKeyword(separator) {
  return separator >= 1 && separator <= 79;
}

function collectPngMetadata(type, data, metadata) {
  if (!metadata.reserveEncoded(data) || !metadata.append(data)) return false;

  if (type === "tEXt") {
    const separator = data.indexOf(0);
    return validPngKeyword(separator);
  }
  if (type === "zTXt") {
    const separator = data.indexOf(0);
    if (
      !validPngKeyword(separator)
      || separator + 2 > data.length
      || data[separator + 1] !== 0
    ) {
      return false;
    }
    const inflated = inflateMetadata(
      data.subarray(separator + 2),
      metadata.remainingDecoded(),
    );
    return inflated !== null && metadata.append(inflated);
  }
  if (type === "iTXt") {
    const keywordEnd = data.indexOf(0);
    if (!validPngKeyword(keywordEnd) || keywordEnd + 3 > data.length) return false;
    const compressionFlag = data[keywordEnd + 1];
    const compressionMethod = data[keywordEnd + 2];
    const languageEnd = data.indexOf(0, keywordEnd + 3);
    const translatedEnd = languageEnd < 0 ? -1 : data.indexOf(0, languageEnd + 1);
    if (
      !new Set([0, 1]).has(compressionFlag)
      || compressionMethod !== 0
      || languageEnd < 0
      || translatedEnd < 0
    ) {
      return false;
    }
    const payload = data.subarray(translatedEnd + 1);
    if (compressionFlag === 0) return true;
    const inflated = inflateMetadata(payload, metadata.remainingDecoded());
    return inflated !== null && metadata.append(inflated);
  }
  if (type === "iCCP") {
    const profileNameEnd = data.indexOf(0);
    if (
      !validPngKeyword(profileNameEnd)
      || profileNameEnd + 2 > data.length
      || data[profileNameEnd + 1] !== 0
    ) {
      return false;
    }
    const inflated = inflateMetadata(
      data.subarray(profileNameEnd + 2),
      metadata.remainingDecoded(),
    );
    return inflated !== null && metadata.append(inflated);
  }
  return true;
}

const CRC32_TABLE = new Uint32Array(256);
for (let index = 0; index < CRC32_TABLE.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
  }
  CRC32_TABLE[index] = value >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function inspectPngHeader(data) {
  if (data.length !== 13) return null;
  const width = data.readUInt32BE(0);
  const height = data.readUInt32BE(4);
  const bitDepth = data[8];
  const colorType = data[9];
  const allowedDepths = new Map([
    [0, new Set([1, 2, 4, 8, 16])],
    [2, new Set([8, 16])],
    [3, new Set([1, 2, 4, 8])],
    [4, new Set([8, 16])],
    [6, new Set([8, 16])],
  ]);
  if (
    width === 0
    || height === 0
    || !allowedDepths.get(colorType)?.has(bitDepth)
    || data[10] !== 0
    || data[11] !== 0
    || !new Set([0, 1]).has(data[12])
  ) {
    return null;
  }
  return { bitDepth, colorType };
}

function inspectPng(buffer) {
  if (!hasKnownSignature("png", buffer)) return { valid: false, sensitive: false };
  let offset = 8;
  let chunkIndex = 0;
  let header = null;
  let sawPalette = false;
  let sawData = false;
  let dataSequenceEnded = false;
  const metadata = metadataAccumulator();
  const result = (valid) => ({ valid, sensitive: metadata.sensitive() });

  while (offset < buffer.length) {
    if (offset + 12 > buffer.length) return result(false);
    const length = buffer.readUInt32BE(offset);
    const typeBytes = buffer.subarray(offset + 4, offset + 8);
    const type = typeBytes.toString("ascii");
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (
      !/^[A-Za-z]{4}$/u.test(type)
      || (typeBytes[2] & 0x20) !== 0
      || dataEnd + 4 > buffer.length
    ) {
      return result(false);
    }
    const data = buffer.subarray(dataStart, dataEnd);
    const expectedCrc = buffer.readUInt32BE(dataEnd);
    if (crc32(buffer.subarray(offset + 4, dataEnd)) !== expectedCrc) return result(false);

    if (chunkIndex === 0 && type !== "IHDR") return result(false);
    const ancillary = (typeBytes[0] & 0x20) !== 0;
    const privateChunk = (typeBytes[1] & 0x20) !== 0;
    if ((ancillary || privateChunk) && !collectPngMetadata(type, data, metadata)) {
      return result(false);
    }

    if (sawData && type !== "IDAT") dataSequenceEnded = true;

    if (type === "IHDR") {
      if (chunkIndex !== 0 || header !== null) return result(false);
      header = inspectPngHeader(data);
      if (header === null) return result(false);
    } else if (type === "PLTE") {
      if (
        header === null
        || sawPalette
        || sawData
        || data.length === 0
        || data.length > 768
        || data.length % 3 !== 0
        || new Set([0, 4]).has(header.colorType)
        || (header.colorType === 3 && data.length / 3 > 2 ** header.bitDepth)
      ) {
        return result(false);
      }
      sawPalette = true;
    } else if (type === "IDAT") {
      if (header === null || dataSequenceEnded) return result(false);
      sawData = true;
    } else if (type === "IEND") {
      if (
        header === null
        || !sawData
        || length !== 0
        || (header.colorType === 3 && !sawPalette)
        || dataEnd + 4 !== buffer.length
      ) {
        return result(false);
      }
      return result(true);
    } else if (!ancillary) {
      return result(false);
    }

    offset = dataEnd + 4;
    chunkIndex += 1;
  }
  return result(false);
}

const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function validJpegFrame(data) {
  if (data.length < 9) return false;
  const components = data[5];
  return data[0] > 0
    && data.readUInt16BE(1) > 0
    && data.readUInt16BE(3) > 0
    && components >= 1
    && components <= 4
    && data.length === 6 + (3 * components);
}

function validJpegScan(data) {
  if (data.length < 6) return false;
  const components = data[0];
  return components >= 1
    && components <= 4
    && data.length === 4 + (2 * components);
}

function inspectJpeg(buffer) {
  if (!hasKnownSignature("jpeg", buffer)) return { valid: false, sensitive: false };
  let offset = 2;
  let inScan = false;
  let sawFrame = false;
  let sawScan = false;
  const metadata = metadataAccumulator();
  const result = (valid) => ({ valid, sensitive: metadata.sensitive() });

  while (offset < buffer.length) {
    if (inScan) {
      const markerStart = buffer.indexOf(0xff, offset);
      if (markerStart < 0) return result(false);
      let markerOffset = markerStart + 1;
      while (markerOffset < buffer.length && buffer[markerOffset] === 0xff) {
        markerOffset += 1;
      }
      if (markerOffset >= buffer.length) return result(false);
      const scanMarker = buffer[markerOffset];
      if (scanMarker === 0x00 || (scanMarker >= 0xd0 && scanMarker <= 0xd7)) {
        offset = markerOffset + 1;
        continue;
      }
      inScan = false;
      offset = markerStart;
      continue;
    }

    if (buffer[offset] !== 0xff) return result(false);
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    if (offset >= buffer.length) return result(false);
    const marker = buffer[offset];
    offset += 1;

    if (marker === 0xd9) {
      return result(offset === buffer.length && sawFrame && sawScan);
    }
    if (marker === 0x01) continue;
    if (
      marker === 0x00
      || marker === 0xd8
      || (marker >= 0xd0 && marker <= 0xd7)
      || offset + 2 > buffer.length
    ) {
      return result(false);
    }

    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) {
      return result(false);
    }
    const data = buffer.subarray(offset + 2, offset + segmentLength);
    if ((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe) {
      if (!metadata.reserveEncoded(data) || !metadata.append(data)) return result(false);
    }
    if (JPEG_SOF_MARKERS.has(marker)) {
      if (sawFrame || sawScan || !validJpegFrame(data)) return result(false);
      sawFrame = true;
    } else if (marker === 0xda) {
      if (!sawFrame || !validJpegScan(data)) return result(false);
      sawScan = true;
    }
    offset += segmentLength;
    if (marker === 0xda) inScan = true;
  }
  return result(false);
}

function isEscaped(value, index) {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) {
    slashes += 1;
  }
  return slashes % 2 === 1;
}

function maskInlineCode(line) {
  const characters = line.split("");
  let index = 0;
  while (index < line.length) {
    if (line[index] !== "`" || isEscaped(line, index)) {
      index += 1;
      continue;
    }
    let delimiterLength = 1;
    while (line[index + delimiterLength] === "`") delimiterLength += 1;
    const delimiter = "`".repeat(delimiterLength);
    const closing = line.indexOf(delimiter, index + delimiterLength);
    if (closing < 0) {
      index += delimiterLength;
      continue;
    }
    for (let cursor = index; cursor < closing + delimiterLength; cursor += 1) {
      characters[cursor] = " ";
    }
    index = closing + delimiterLength;
  }
  return characters.join("");
}

function maskNonMarkdownRegions(markdown) {
  const withoutComments = markdown.replace(/<!--[\s\S]*?-->/gu, (value) => (
    value.replace(/[^\r\n]/gu, " ")
  ));
  const lines = withoutComments.split(/\r?\n/u);
  let fence = null;
  return lines.map((line) => {
    const marker = /^ {0,3}(`{3,}|~{3,})/u.exec(line)?.[1] ?? null;
    if (fence) {
      const closesFence = marker
        && marker[0] === fence.character
        && marker.length >= fence.length;
      if (closesFence) fence = null;
      return " ".repeat(line.length);
    }
    if (marker) {
      fence = { character: marker[0], length: marker.length };
      return " ".repeat(line.length);
    }
    return maskInlineCode(line);
  }).join("\n");
}

function parseDestination(value, start) {
  let index = start;
  while (index < value.length && /[ \t]/u.test(value[index])) index += 1;
  if (value[index] === "<") {
    const begin = index + 1;
    index = begin;
    while (index < value.length) {
      if (value[index] === ">" && !isEscaped(value, index)) {
        return { destination: value.slice(begin, index), end: index + 1 };
      }
      if (value[index] === "\n" || value[index] === "\r") return null;
      index += 1;
    }
    return null;
  }

  const begin = index;
  let depth = 0;
  while (index < value.length) {
    const character = value[index];
    if (character === "\\" && index + 1 < value.length) {
      index += 2;
      continue;
    }
    if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      if (depth === 0) break;
      depth -= 1;
    } else if (/\s/u.test(character) && depth === 0) {
      break;
    }
    index += 1;
  }
  if (index === begin) return { destination: "", end: index };
  return { destination: value.slice(begin, index), end: index };
}

function extractMarkdownDestinations(markdown) {
  const source = maskNonMarkdownRegions(markdown);
  const destinations = [];
  let index = 0;
  while (index < source.length) {
    if (source[index] !== "[" || isEscaped(source, index)) {
      index += 1;
      continue;
    }
    let depth = 1;
    let closing = index + 1;
    while (closing < source.length && depth > 0) {
      if (source[closing] === "\\" && closing + 1 < source.length) {
        closing += 2;
        continue;
      }
      if (source[closing] === "[") depth += 1;
      if (source[closing] === "]") depth -= 1;
      closing += 1;
    }
    if (depth === 0 && source[closing] === "(") {
      const parsed = parseDestination(source, closing + 1);
      if (parsed) destinations.push(parsed.destination);
    }
    index = depth === 0 ? closing : index + 1;
  }

  for (const line of source.split("\n")) {
    const definition = /^ {0,3}\[([^\]\r\n]+)\]:[ \t]*(.*)$/u.exec(line);
    if (!definition || definition[1].startsWith("^")) continue;
    const parsed = parseDestination(definition[2], 0);
    if (parsed) destinations.push(parsed.destination);
  }

  const htmlTag = /<(?:a|img|source)\b[^>]*>/giu;
  let match;
  while ((match = htmlTag.exec(source)) !== null) {
    const attribute = /\b(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/giu;
    let attributeMatch;
    while ((attributeMatch = attribute.exec(match[0])) !== null) {
      destinations.push(attributeMatch[1] ?? attributeMatch[2] ?? attributeMatch[3] ?? "");
    }
  }
  return destinations;
}

function stripUnescapedSuffix(value) {
  for (let index = 0; index < value.length; index += 1) {
    if ((value[index] === "?" || value[index] === "#") && !isEscaped(value, index)) {
      return value.slice(0, index);
    }
  }
  return value;
}

function unescapeMarkdownDestination(value) {
  return value.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/gu, "$1");
}

function validateDestination(rawDestination, markdownGitPath, root, pathIndex, counters) {
  counters.linkTargets += 1;
  const raw = rawDestination.trim();
  if (/^(?:https?:|mailto:)/iu.test(raw)) {
    counters.externalLinksSkipped += 1;
    return;
  }
  if (raw.startsWith("#")) {
    counters.anchorLinksSkipped += 1;
    return;
  }

  counters.localLinksChecked += 1;
  const withoutSuffix = stripUnescapedSuffix(raw);
  let decoded;
  try {
    decoded = decodeURIComponent(unescapeMarkdownDestination(withoutSuffix));
  } catch {
    counters.linkDecodeFindings += 1;
    return;
  }

  if (decoded === "") {
    decoded = path.basename(markdownGitPath);
  }
  if (
    /[\u0000-\u001f\u007f]/u.test(decoded)
    || decoded.includes("\\")
    || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(decoded)
  ) {
    counters.linkInvalidPathFindings += 1;
    return;
  }
  if (/^(?:\/|[A-Za-z]:[\\/])/u.test(decoded)) {
    counters.linkTraversalFindings += 1;
    return;
  }

  const markdownAbsolute = absoluteFromGitPath(root, markdownGitPath);
  const absolute = path.resolve(path.dirname(markdownAbsolute), ...decoded.split("/"));
  if (!isContained(root, absolute)) {
    counters.linkTraversalFindings += 1;
    return;
  }

  const relative = path.relative(root, absolute).split(path.sep).join("/");
  if (relative === "" || pathIndex.directories.has(relative)) {
    counters.linkDirectoryFindings += 1;
    return;
  }
  if (pathIndex.files.has(relative)) {
    if (!REGULAR_GIT_MODES.has(pathIndex.files.get(relative).mode)) {
      counters.linkSpecialTargetFindings += 1;
    }
    return;
  }

  const folded = gitCaseKey(relative);
  if (pathIndex.foldedFiles.has(folded) || pathIndex.foldedDirectories.has(folded)) {
    counters.linkCaseMismatchFindings += 1;
    return;
  }
  counters.linkMissingFindings += 1;
}

function newCounters() {
  return {
    trackedFiles: 0,
    trackedIndexFindings: 0,
    trackedReadFindings: 0,
    trackedSpecialFindings: 0,
    markdownFiles: 0,
    markdownContentFindings: 0,
    linkTargets: 0,
    localLinksChecked: 0,
    externalLinksSkipped: 0,
    anchorLinksSkipped: 0,
    linkDecodeFindings: 0,
    linkInvalidPathFindings: 0,
    linkTraversalFindings: 0,
    linkDirectoryFindings: 0,
    linkMissingFindings: 0,
    linkCaseMismatchFindings: 0,
    linkSpecialTargetFindings: 0,
    trackedBinaryFiles: 0,
    trackedBinaryBytes: 0,
    binaryOversizeFindings: 0,
    binaryUnknownExtensionFindings: 0,
    binaryUnsupportedFormatFindings: 0,
    binaryFormatFindings: 0,
    imageMetadataFindings: 0,
  };
}

async function scanRepository() {
  const root = await repositoryRoot();
  const entries = trackedEntries(root);
  const pathIndex = buildPathIndex(entries);
  const counters = newCounters();
  counters.trackedFiles = pathIndex.files.size;
  counters.trackedIndexFindings = pathIndex.indexFindings;
  const markdownDocuments = [];

  for (const entry of pathIndex.files.values()) {
    const extension = path.extname(entry.gitPath).toLowerCase();
    const isMarkdown = MARKDOWN_EXTENSIONS.has(extension);
    const binaryType = BINARY_TYPES.get(extension);
    if (isMarkdown) counters.markdownFiles += 1;
    if (!REGULAR_GIT_MODES.has(entry.mode)) {
      counters.trackedSpecialFindings += 1;
      continue;
    }

    const absolute = absoluteFromGitPath(root, entry.gitPath);
    let metadata;
    let prefix;
    let binaryByContent = false;
    try {
      metadata = await lstat(absolute);
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        counters.trackedSpecialFindings += 1;
        continue;
      }
      if (binaryType) {
        prefix = await readPrefix(absolute, metadata.size);
      } else {
        const classification = await classifyFileContent(absolute, metadata.size);
        prefix = classification.prefix;
        binaryByContent = classification.binary;
      }
    } catch {
      counters.trackedReadFindings += 1;
      continue;
    }

    const isBinary = Boolean(binaryType) || binaryByContent;
    if (isBinary) {
      counters.trackedBinaryFiles += 1;
      counters.trackedBinaryBytes += metadata.size;
      if (metadata.size > MAX_BINARY_BYTES) counters.binaryOversizeFindings += 1;
      if (!binaryType) {
        counters.binaryUnknownExtensionFindings += 1;
        continue;
      }
      if (!hasKnownSignature(binaryType, prefix)) {
        counters.binaryFormatFindings += 1;
      }
      if (!SUPPORTED_BINARY_TYPES.has(binaryType)) {
        counters.binaryUnsupportedFormatFindings += 1;
        continue;
      }
      if (!hasKnownSignature(binaryType, prefix) || metadata.size > MAX_BINARY_BYTES) {
        continue;
      }

      try {
        const buffer = await readFile(absolute);
        const inspection = binaryType === "png" ? inspectPng(buffer) : inspectJpeg(buffer);
        if (!inspection.valid) counters.binaryFormatFindings += 1;
        if (inspection.sensitive) counters.imageMetadataFindings += 1;
      } catch {
        counters.trackedReadFindings += 1;
      }
      continue;
    }

    if (!isMarkdown) continue;
    if (metadata.size > MAX_MARKDOWN_BYTES) {
      counters.markdownContentFindings += 1;
      continue;
    }
    try {
      const buffer = await readFile(absolute);
      const markdown = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
      markdownDocuments.push({ gitPath: entry.gitPath, markdown });
    } catch {
      counters.markdownContentFindings += 1;
    }
  }

  for (const { gitPath, markdown } of markdownDocuments) {
    for (const destination of extractMarkdownDestinations(markdown)) {
      validateDestination(destination, gitPath, root, pathIndex, counters);
    }
  }
  return counters;
}

function renderResult(counters) {
  const output = [
    ["TRACKED_FILES", counters.trackedFiles],
    ["TRACKED_INDEX_FINDINGS", counters.trackedIndexFindings],
    ["TRACKED_READ_FINDINGS", counters.trackedReadFindings],
    ["TRACKED_SPECIAL_FINDINGS", counters.trackedSpecialFindings],
    ["MARKDOWN_FILES", counters.markdownFiles],
    ["MARKDOWN_CONTENT_FINDINGS", counters.markdownContentFindings],
    ["MARKDOWN_LINK_TARGETS", counters.linkTargets],
    ["LOCAL_LINKS_CHECKED", counters.localLinksChecked],
    ["EXTERNAL_LINKS_SKIPPED", counters.externalLinksSkipped],
    ["ANCHOR_LINKS_SKIPPED", counters.anchorLinksSkipped],
    ["LINK_DECODE_FINDINGS", counters.linkDecodeFindings],
    ["LINK_INVALID_PATH_FINDINGS", counters.linkInvalidPathFindings],
    ["LINK_TRAVERSAL_FINDINGS", counters.linkTraversalFindings],
    ["LINK_DIRECTORY_FINDINGS", counters.linkDirectoryFindings],
    ["LINK_MISSING_FINDINGS", counters.linkMissingFindings],
    ["LINK_CASE_MISMATCH_FINDINGS", counters.linkCaseMismatchFindings],
    ["LINK_SPECIAL_TARGET_FINDINGS", counters.linkSpecialTargetFindings],
    ["TRACKED_BINARY_FILES", counters.trackedBinaryFiles],
    ["TRACKED_BINARY_BYTES", counters.trackedBinaryBytes],
    ["BINARY_OVERSIZE_FINDINGS", counters.binaryOversizeFindings],
    ["BINARY_UNKNOWN_EXTENSION_FINDINGS", counters.binaryUnknownExtensionFindings],
    ["BINARY_UNSUPPORTED_FORMAT_FINDINGS", counters.binaryUnsupportedFormatFindings],
    ["BINARY_FORMAT_FINDINGS", counters.binaryFormatFindings],
    ["IMAGE_METADATA_FINDINGS", counters.imageMetadataFindings],
  ];
  const findingKeys = output.filter(([key]) => key.endsWith("_FINDINGS"));
  const passed = findingKeys.every(([, value]) => value === 0);
  for (const [key, value] of output) console.log(`${key}=${value}`);
  console.log(`DOCUMENTATION_SCAN=${passed ? "PASS" : "FAIL"}`);
  if (!passed) process.exitCode = 1;
}

async function main() {
  try {
    renderResult(await scanRepository());
  } catch {
    console.log("DOCUMENTATION_SCAN_ERROR=FAIL");
    console.log("DOCUMENTATION_SCAN=FAIL");
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) await main();

export {
  extractMarkdownDestinations,
  inspectJpeg,
  inspectPng,
  scanRepository,
  validateDestination,
};
