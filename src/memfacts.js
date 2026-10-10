// Fact notes: asks the model for the few durable facts in a finished chat ("the backup job runs at 02:00 on SRV-BK01"),
// and parses its answer into a clean list. The user reviews and edits the list before anything is saved.
(function (root) {
  const PROMPT =
    'Below is a conversation between a user and an assistant. List the facts from it that would be worth remembering in a ' +
    'FUTURE conversation: decisions made, settings and values chosen, names of systems, people, accounts and devices, ' +
    'problems found and how they were fixed, and the user\'s stated preferences.\n' +
    'Rules: one fact per line, each starting with "- ". Each fact must make sense on its own, without the conversation ' +
    '(write "The VPN gateway is 10.4.0.1", not "It is 10.4.0.1"). Copy exact values. Only include what the conversation ' +
    'actually states or decides; do not add advice, guesses or general knowledge. Skip small talk. At most 10 facts. ' +
    'If nothing is worth remembering, answer exactly: NONE\n\n';

  const textOf = c => (typeof c === 'string' ? c : Array.isArray(c) ? c.filter(p => p.type === 'text').map(p => p.text).join('\n') : '');

  // history: [{role, content}]. Keeps the END of a long chat (later turns usually hold the outcome), within maxChars.
  function buildPrompt(history, maxChars = 12000) {
    const lines = [];
    for (const m of history) {
      if (m.role !== 'user' && m.role !== 'assistant') continue;
      const t = textOf(m.content).replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      if (t) lines.push(`${m.role === 'user' ? 'USER' : 'ASSISTANT'}: ${t}`);
    }
    let convo = lines.join('\n\n');
    let cut = false;
    if (convo.length > maxChars) { convo = convo.slice(convo.length - maxChars); convo = convo.slice(convo.indexOf('\n') + 1); cut = true; }
    return PROMPT + (cut ? '[The start of the conversation was cut for length.]\n\n' : '') + '--- CONVERSATION ---\n' + convo + '\n--- END ---';
  }

  function parse(answer) {
    const text = String(answer || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    if (/^none\.?$/i.test(text)) return [];
    const seen = new Set(), out = [];
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*(?:[-*•]|\d{1,2}[.)])\s+(.+)$/);
      if (!m) continue;
      const f = m[1].replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
      const key = f.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (f.length < 8 || f.length > 300 || /^none\b/i.test(f) || seen.has(key)) continue;
      seen.add(key); out.push(f);
      if (out.length >= 12) break;
    }
    return out;
  }

  const api = { PROMPT, buildPrompt, parse, textOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MemFacts = api;
})(typeof window !== 'undefined' ? window : globalThis);
