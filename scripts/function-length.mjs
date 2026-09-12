// A simple brace-depth scanner that flags any function declaration, function
// expression, arrow function body, or method in a source file that exceeds a
// line-count limit. It is a heuristic, not a parser: it masks out strings,
// template literals, comments, and (best-effort) regex literals so their
// braces cannot confuse depth counting, then classifies every remaining `{`
// as "function-opening" or not by looking at the token immediately before it
// (`=>` for an arrow body; `)` whose matching `(` is not preceded by one of
// the non-function keywords if/for/while/switch/catch/with). It does not need
// to be perfect, only stable — see docs/planning/33-....md section 4 Phase B
// item 10.

const CONTROL_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'with']);

/**
 * Replace the contents of comments, strings, template literals, and (heuristically)
 * regex literals with blank filler of the same length, preserving newlines, so a
 * brace-depth scan never sees a brace that only appears inside one of those.
 * @param {string} content
 * @returns {string}
 */
export function maskNonStructural(content) {
  let out = '';
  let i = 0;
  const n = content.length;
  let prevSignificant = '';
  const blank = (ch) => (ch === '\n' ? '\n' : ' ');
  while (i < n) {
    const ch = content[i];
    const next = content[i + 1];
    if (ch === '/' && next === '/') {
      while (i < n && content[i] !== '\n') { out += blank(content[i]); i++; }
      continue;
    }
    if (ch === '/' && next === '*') {
      out += '  '; i += 2;
      while (i < n && !(content[i] === '*' && content[i + 1] === '/')) { out += blank(content[i]); i++; }
      if (i < n) { out += '  '; i += 2; }
      continue;
    }
    if (ch === '\'' || ch === '"' || ch === '`') {
      const quote = ch;
      out += blank(ch); i++;
      while (i < n && content[i] !== quote) {
        if (content[i] === '\\' && i + 1 < n) { out += blank(content[i]) + blank(content[i + 1]); i += 2; continue; }
        out += blank(content[i]); i++;
      }
      if (i < n) { out += blank(content[i]); i++; }
      prevSignificant = 'x';
      continue;
    }
    if (ch === '/' && /^$|[([{,;:=&|!?+\-*%~^<>]/u.test(prevSignificant)) {
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < n && content[j] !== '\n') {
        if (content[j] === '\\') { j += 2; continue; }
        if (content[j] === '[') { inClass = true; j++; continue; }
        if (content[j] === ']') { inClass = false; j++; continue; }
        if (content[j] === '/' && !inClass) { closed = true; break; }
        j++;
      }
      if (closed) {
        let k = j + 1;
        while (k < n && /[a-z]/iu.test(content[k])) k++;
        for (let p = i; p < k; p++) out += blank(content[p]);
        i = k;
        prevSignificant = 'x';
        continue;
      }
    }
    out += ch;
    if (!/\s/u.test(ch)) prevSignificant = ch;
    i++;
  }
  return out;
}

/**
 * Build a map from each opening bracket index to its matching closing bracket index.
 * @param {string} masked
 * @param {string} open
 * @param {string} close
 * @returns {Map<number, number>}
 */
function matchBrackets(masked, open, close) {
  const stack = [];
  const matches = new Map();
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] === open) stack.push(i);
    else if (masked[i] === close) {
      const start = stack.pop();
      if (start !== undefined) matches.set(start, i);
    }
  }
  return matches;
}

/** @param {string} content @returns {number[]} 1-indexed line number for every char index */
function buildLineIndex(content) {
  const lineOf = new Array(content.length + 1);
  let line = 1;
  for (let i = 0; i < content.length; i++) {
    lineOf[i] = line;
    if (content[i] === '\n') line++;
  }
  lineOf[content.length] = line;
  return lineOf;
}

/** @param {string} masked @param {number} index @returns {number} index of the previous non-whitespace character, or -1 */
function previousSignificant(masked, index) {
  let i = index - 1;
  while (i >= 0 && /\s/u.test(masked[i])) i--;
  return i;
}

/** @param {string} masked @param {number} index @returns {string} best-effort identifier/keyword ending at index (inclusive) */
function tokenEndingAt(masked, index) {
  let start = index;
  while (start >= 0 && /[\w$]/u.test(masked[start])) start--;
  return masked.slice(start + 1, index + 1);
}

/**
 * Find every function-opening `{` in masked content and report ones whose matching `}`
 * is more than `limit` lines away.
 * @param {string} content original file content
 * @param {number} limit
 * @returns {{ startLine: number, endLine: number, length: number, label: string }[]}
 */
export function findLongFunctions(content, limit) {
  const masked = maskNonStructural(content);
  const braceMatches = matchBrackets(masked, '{', '}');
  const parenMatches = matchBrackets(masked, '(', ')');
  const parenCloseToOpen = new Map(Array.from(parenMatches, ([openIdx, closeIdx]) => [closeIdx, openIdx]));
  const lineOf = buildLineIndex(content);
  const violations = [];

  for (const [openBrace, closeBrace] of braceMatches) {
    const beforeIdx = previousSignificant(masked, openBrace);
    if (beforeIdx < 0) continue;
    let isFunction = false;
    let label = 'function';
    if (masked[beforeIdx] === '>' && masked[beforeIdx - 1] === '=') {
      isFunction = true;
      label = 'arrow function';
    } else if (masked[beforeIdx] === ')') {
      const openParen = parenCloseToOpen.get(beforeIdx);
      if (openParen !== undefined) {
        const beforeParenIdx = previousSignificant(masked, openParen);
        const keyword = beforeParenIdx >= 0 ? tokenEndingAt(masked, beforeParenIdx) : '';
        if (!CONTROL_KEYWORDS.has(keyword)) {
          isFunction = true;
          label = keyword === 'function' ? 'function' : (keyword ? `method '${keyword}'` : 'function');
        }
      }
    }
    if (!isFunction) continue;
    const startLine = lineOf[openBrace];
    const endLine = lineOf[closeBrace];
    const length = endLine - startLine + 1;
    if (length > limit) violations.push({ startLine, endLine, length, label });
  }
  violations.sort((a, b) => a.startLine - b.startLine);
  return violations;
}
