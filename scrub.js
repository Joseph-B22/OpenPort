// Removes secrets from text BEFORE it is stored (screen memory). It is deliberately aggressive: a missed secret is
// worse than a scrubbed harmless string. IP addresses, host names and error messages are kept on purpose, because
// finding those later is the point. Pure function: text in, text out.
const RULES = [
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[PRIVATE KEY REMOVED]'],
  ['jwt', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{6,}\b/g, '[TOKEN REMOVED]'],
  ['cloud/api key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bxox[baprs]-[A-Za-z0-9-]{10,}\b|\bsk-[A-Za-z0-9_-]{20,}\b|\bAIza[0-9A-Za-z_-]{30,}\b/g, '[KEY REMOVED]'],
  ['bearer', /\b(bearer|basic)\s+[A-Za-z0-9._~+\/=-]{16,}/gi, '$1 [REMOVED]'],
  // Cisco-style secrets: "enable secret 9 $9$abc", "username x password 7 0822...", "snmp-server community s3cret RW"
  ['network device secret', /\b(enable\s+(?:secret|password)|username\s+\S+\s+(?:secret|password)|snmp-server\s+community|tacacs-server\s+key|radius-server\s+key|pre-shared-key|key-string)\s+(?:\d\s+)?\S+/gi, '$1 [REMOVED]'],
  // password: xyz / token=abc / "api_key": "..."
  ['key=value secret', /\b(pass(?:word|wd|phrase|code)?|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|auth[_-]?key|credentials?)(["']?\s*[:=]\s*)("[^"\n]+"|'[^'\n]+'|\S+)/gi, '$1$2[REMOVED]'],
  ['one-time code', /\b(code|otp|passcode|verification|authenticator|2fa|mfa|security code)\b([^\d\n]{0,30})(\d{6,8})\b/gi, '$1$2[CODE REMOVED]'],
  ['ssn', /\b\d{3}-\d{2}-\d{4}\b/g, '[ID REMOVED]'],
];

// Long unbroken random-looking strings (keys, tokens, hashes of secrets): 40+ characters with both letters and digits.
const LONG = /(?<![\w\\.])[A-Za-z0-9+\/_=-]{40,}(?![\w\\.])/g;
const looksRandom = s => /[A-Za-z]/.test(s) && /\d/.test(s) && !/^[A-Za-z]+$/.test(s);

function luhn(digits) {
  let sum = 0, alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = +digits[i];
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
}

function scrub(text) {
  let out = String(text || '');
  const removed = {};
  const count = (name, n) => { if (n) removed[name] = (removed[name] || 0) + n; };

  for (const [name, re, repl] of RULES) {
    let n = 0;
    out = out.replace(re, (...m) => { n++; return repl.replace(/\$(\d)/g, (_, i) => m[+i] ?? ''); });
    count(name, n);
  }
  let n = 0;
  out = out.replace(LONG, m => { if (looksRandom(m)) { n++; return '[LONG STRING REMOVED]'; } return m; });
  count('long random string', n);

  n = 0;
  out = out.replace(/\b(?:\d[ -]?){13,19}\b/g, m => {
    const d = m.replace(/[^\d]/g, '');
    if (d.length >= 13 && d.length <= 19 && luhn(d)) { n++; return '[CARD REMOVED]'; }
    return m;
  });
  count('card number', n);
  return { text: out, removed, total: Object.values(removed).reduce((a, b) => a + b, 0) };
}

module.exports = { scrub, luhn };
