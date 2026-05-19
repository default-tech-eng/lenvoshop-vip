/* One-time helper: delete the inline _LEGACY_QUIZ_OUTCOMES + QUIZ_QUESTIONS blocks
 * from build.js, replace quizPage() with a refactored version that takes a quiz arg,
 * and add quizzesIndexPage() helper. */
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'build.js');
let src = fs.readFileSync(file, 'utf8');

function findClosing(s, startIdx, openChar, closeChar) {
  let depth = 0; let inStr = false; let strChar = ''; let escape = false;
  for (let i = startIdx; i < s.length; i++) {
    const c = s[i];
    if (escape) { escape = false; continue; }
    if (c === '\\') { escape = true; continue; }
    if (inStr) { if (c === strChar) inStr = false; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = true; strChar = c; continue; }
    if (c === openChar) depth++;
    else if (c === closeChar) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

function removeBlock(src, marker, openChar) {
  const idx = src.indexOf(marker);
  if (idx < 0) { console.warn('marker not found:', marker); return src; }
  const openIdx = idx + marker.length - 1;
  const closeIdx = findClosing(src, openIdx, openChar, openChar === '{' ? '}' : ']');
  if (closeIdx < 0) { console.warn('close not found for', marker); return src; }
  let endIdx = closeIdx + 1;
  if (src[endIdx] === ';') endIdx++;
  if (src[endIdx] === '\n') endIdx++;
  // Also consume the leading blank line if there is one
  let startIdx = idx;
  if (src[startIdx - 1] === '\n' && src[startIdx - 2] === '\n') startIdx--;
  console.log('Removed', marker, '(', endIdx - startIdx, 'chars )');
  return src.slice(0, startIdx) + src.slice(endIdx);
}

src = removeBlock(src, 'const _LEGACY_QUIZ_OUTCOMES = {', '{');
src = removeBlock(src, 'const QUIZ_QUESTIONS = [', '[');

fs.writeFileSync(file, src);
console.log('build.js stripped of legacy quiz blocks.');
