const REDACTION_RULES = Object.freeze([
  {
    name: 'private-key',
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/gu,
    replacement: '[REDACTED_PRIVATE_KEY]',
  },
  {
    name: 'bearer-token',
    pattern: /\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/giu,
    replacement: '$1[REDACTED]',
  },
  {
    name: 'credential-assignment',
    pattern: /\b(api[_-]?key|token|secret|password|passwd|client[_-]?secret)\b\s*[:=]\s*["']?[^\s"']{6,}["']?/giu,
    replacement: '$1=[REDACTED]',
  },
  {
    name: 'github-token',
    pattern: /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/gu,
    replacement: '[REDACTED_GITHUB_TOKEN]',
  },
  {
    name: 'openai-key',
    pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/gu,
    replacement: '[REDACTED_API_KEY]',
  },
]);

/** @param {string} value */
export function redactSecrets(value) {
  let redacted = value;
  for (const rule of REDACTION_RULES) {
    redacted = redacted.replace(rule.pattern, rule.replacement);
  }
  return redacted;
}

/**
 * @returns {*}
 */
export function redactionRuleNames() {
  return REDACTION_RULES.map((rule) => rule.name);
}