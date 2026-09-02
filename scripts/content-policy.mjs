const HIGH_CONFIDENCE_SECRETS = [
  /-----BEGIN (?:(?:ENCRYPTED|RSA|EC|DSA|OPENSSH) PRIVATE KEY|PRIVATE KEY|PGP PRIVATE KEY BLOCK)-----/u,
  /\b(?:ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|npm_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,})\b/u,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u,
  /\bAIza[0-9A-Za-z_-]{30,}\b/u,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/u,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/u,
];

const EMBEDDED_CREDENTIAL_URL = /https?:\/\/([^\s/@:]+):([^\s/@]+)@([^\s/]+)/gimu;
const PROVIDER_CREDENTIAL_NAME = String.raw`(?:WXO_API_KEY|INSTANA_AGENT_KEY|(?:[A-Z][A-Z0-9]*_)+API_TOKEN|x-instana-key)`;
const PROVIDER_VALUE_PATTERNS = [
  {
    pattern: new RegExp(
      String.raw`(?:^|[\0\r\n{,;])\s*(?:(?:export|const|let|var|set)\s+)?(?:(?:process\.)?env\.|\$env:)?["']?${PROVIDER_CREDENTIAL_NAME}["']?\s*(?:=|:)\s*([^\r\n]*)`,
      "gimu",
    ),
    codeReference: "qualified",
  },
  {
    pattern: new RegExp(
      String.raw`(?:^|[\r\n])\s*setx\s+["']?${PROVIDER_CREDENTIAL_NAME}["']?\s+([^\r\n]*)`,
      "gimu",
    ),
    codeReference: "none",
  },
  {
    pattern: new RegExp(
      String.raw`\.\s*(?:set|append|add)\s*\(\s*["']${PROVIDER_CREDENTIAL_NAME}["']\s*,\s*([^\r\n)]*)`,
      "gimu",
    ),
    codeReference: "any",
  },
  {
    pattern: new RegExp(
      String.raw`(?:process\.env|os\.environ|environ)\s*\[\s*["']${PROVIDER_CREDENTIAL_NAME}["']\s*\]\s*=\s*([^\r\n]*)`,
      "gimu",
    ),
    codeReference: "any",
  },
  {
    pattern: new RegExp(
      String.raw`(?:os\.)?environ\s*\.\s*setdefault\s*\(\s*["']${PROVIDER_CREDENTIAL_NAME}["']\s*,\s*([^\r\n)]*)`,
      "gimu",
    ),
    codeReference: "any",
  },
  {
    pattern: new RegExp(
      String.raw`(?:^|[\r\n])\s*ENV\s+${PROVIDER_CREDENTIAL_NAME}\s*=\s*([^\r\n]*)`,
      "gimu",
    ),
    codeReference: "none",
  },
  {
    pattern: new RegExp(
      String.raw`(?:^|[\r\n])\s*-\s+${PROVIDER_CREDENTIAL_NAME}\s*=\s*([^\r\n]*)`,
      "gimu",
    ),
    codeReference: "none",
  },
  {
    pattern: new RegExp(
      String.raw`(?:^|\s)(?:-H|--header)\s+["']?${PROVIDER_CREDENTIAL_NAME}\s*:\s*([^"'\r\n]*)`,
      "gimu",
    ),
    codeReference: "none",
  },
  {
    pattern: /(?:^|[\r\n{,])\s*["']apikey["']\s*:\s*([^\r\n,}]*)/gimu,
    codeReference: "none",
  },
  {
    pattern: /(?:^|[\r\n{,])\s*["']?api_token["']?\s*:\s*([^\r\n,}]*)/gimu,
    codeReference: "none",
  },
  {
    pattern: /(?:^|[\r\n{])\s*["']?api_token["']?\s*=\s*([^\r\n,}]*)/gimu,
    codeReference: "none",
  },
];

const BEARER_VALUE_PATTERNS = [
  /\b(?:authorization|proxy-authorization)[^\r\n:=]{0,12}(?:=|:)\s*(?:f)?["'`]?bearer\s+([^\s"'`,;]+)/gimu,
  /\.\s*(?:set|append|add)\s*\(\s*["'](?:authorization|proxy-authorization)["']\s*,\s*(?:f)?["'`]bearer\s+([^\s"'`,;)]+)/gimu,
  /(?:^|\s)(?:-H|--header)\s+["']?(?:authorization|proxy-authorization)\s*:\s*bearer\s+([^\s"'`,;]+)/gimu,
];

const ABSOLUTE_USER_PATH = new RegExp([
  "[A-Za-z]:[\\\\/](?:Users|Documents and Settings)[\\\\/][^\\\\/\\r\\n]+",
  "\\/(?:Users|home)\\/[^/\\r\\n]+",
  "\\/mnt\\/[A-Za-z]\\/" + "Use" + "rs\\/[^/\\r\\n]+",
  "\\/" + "root(?=\\/|[\\s\"'<>]|$)(?:\\/[^/\\r\\n]+)?",
  "(?:\\\\\\\\)[A-Za-z0-9][A-Za-z0-9._-]+[\\\\/][A-Za-z0-9$._-]{2,}(?:[\\\\/][^\\r\\n]+)?",
].join("|"), "iu");

const EXPLICIT_PLACEHOLDER = /^(?:sentinel|synthetic|dummy|example|fake|fixture|test|wrong|demo|server-only|must-not-appear|not-a-secret)(?:[-_]|$)/u;
const EXACT_UNQUOTED_ANNOTATION = /^(?:str|string|none|optional(?:\[[A-Za-z0-9_., |]+\])?)$/iu;
const CODE_REFERENCE = /^(?:[A-Za-z_$][A-Za-z0-9_$]*)(?:(?:\??\.)[A-Za-z_$][A-Za-z0-9_$]*|\[[^\r\n\]]+\]|\([^\r\n)]*\))*$/u;

function extractedValue(rawValue) {
  let value = rawValue.trim();
  const quote = new Set(["\"", "'", "`"]).has(value[0]) ? value[0] : null;
  if (quote !== null) {
    let closing = -1;
    for (let index = 1; index < value.length; index += 1) {
      if (value[index] !== quote) continue;
      let escapes = 0;
      for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) {
        escapes += 1;
      }
      if (escapes % 2 === 0) {
        closing = index;
        break;
      }
    }
    value = closing < 0 ? value.slice(1) : value.slice(1, closing);
  } else if (value.startsWith("<")) {
    const closing = value.indexOf(">");
    value = closing < 0 ? value : value.slice(0, closing + 1);
  } else {
    value = value.split(/[\s,;}#]/u, 1)[0];
  }
  return { quoted: quote !== null, value: value.trim() };
}

function isExplicitPlaceholder(value) {
  const normalized = value.toLowerCase();
  return normalized === ""
    || normalized === "undefined"
    || normalized === "null"
    || normalized === "token"
    || normalized === "api_key"
    || /^<[^>]+>$/u.test(normalized)
    || normalized.startsWith("${")
    || normalized.startsWith("{{")
    || /^\$[A-Za-z_][A-Za-z0-9_]*$/u.test(value)
    || EXPLICIT_PLACEHOLDER.test(normalized);
}

function isUnquotedCodeReference(value) {
  const normalized = value.toLowerCase();
  return CODE_REFERENCE.test(value)
    || normalized.startsWith("process.env.")
    || normalized.startsWith("process.env[")
    || normalized.startsWith("os.environ[")
    || normalized.startsWith("os.environ.")
    || normalized.startsWith("environment.")
    || normalized.startsWith("config.")
    || normalized.startsWith("configuration.")
    || /^(?:validate)?(?:wxoapikey|instanaagentkey|[a-z][a-z0-9]*apitoken)\(/u.test(normalized);
}

function isQualifiedCodeReference(value) {
  return isUnquotedCodeReference(value)
    && (value.includes(".") || value.includes("[") || value.includes("("));
}

function providerValueIsAllowed(rawValue, codeReference) {
  const candidate = extractedValue(rawValue);
  if (isExplicitPlaceholder(candidate.value)) return true;
  if (candidate.quoted) return false;
  if (candidate.value === "(") return true;
  if (EXACT_UNQUOTED_ANNOTATION.test(candidate.value)) return true;
  if (codeReference === "any") return isUnquotedCodeReference(candidate.value);
  if (codeReference === "qualified") return isQualifiedCodeReference(candidate.value);
  return false;
}

function bearerValueIsAllowed(rawValue) {
  const candidate = extractedValue(rawValue);
  return isExplicitPlaceholder(candidate.value)
    || (!candidate.quoted && (
      candidate.value.startsWith("{")
      || isUnquotedCodeReference(candidate.value)
    ));
}

function syntheticUrlPart(value) {
  const normalized = value.toLowerCase();
  return isExplicitPlaceholder(value)
    || new Set(["user", "username", "person", "password", "passwd"]).has(normalized);
}

function escapedSeparatorVariants(value) {
  const variants = [value];
  let current = value;
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const next = current.replace(
      /\\{2,}/gu,
      (run) => "\\".repeat(Math.ceil(run.length / 2)),
    );
    if (next === current) break;
    variants.push(next);
    current = next;
  }
  return variants;
}

export function containsOpaqueProviderCredential(text) {
  for (const { pattern, codeReference } of PROVIDER_VALUE_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      if (!providerValueIsAllowed(match[1], codeReference)) return true;
    }
  }
  for (const pattern of BEARER_VALUE_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      if (!bearerValueIsAllowed(match[1])) return true;
    }
  }
  return false;
}

export function containsHighConfidenceSecret(text) {
  if (HIGH_CONFIDENCE_SECRETS.some((pattern) => pattern.test(text))) return true;
  for (const match of text.matchAll(EMBEDDED_CREDENTIAL_URL)) {
    if (syntheticUrlPart(match[1]) && syntheticUrlPart(match[2])) continue;
    return true;
  }
  return false;
}

export function containsAbsoluteUserPath(text) {
  return escapedSeparatorVariants(text).some((variant) => ABSOLUTE_USER_PATH.test(variant));
}
