// Part of OpenPort's logic tests. Run all with: npm test   (no model, no embedder, no real screen)
const ROOT = require('path').join(__dirname, '..').replace(/\\/g, '/');
const C = require(ROOT + '/src/confidence.js');
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);

// helper: build an OpenAI-style chunk
const chunk = list => ({ choices: [{ delta: {}, logprobs: { content: list.map(([token, p, alts]) => ({ token, logprob: Math.log(p), top_logprobs: (alts || []).map(([t, q]) => ({ token: t, logprob: Math.log(q) })) })) } }] });

// "The default port is 3389." where the model hesitated between 3389 and 3390 on the "89" token
const entries = C.entriesFromChunk(chunk([[' The', 0.9], [' default', 0.95], [' port', 0.99], [' is', 0.97], [' 33', 0.8], ['89', 0.42, [['89', 0.42], ['90', 0.31], ['88', 0.1]]], ['.', 0.9]]));
ok(entries.length === 7 && Math.abs(entries[5].p - 0.42) < 1e-9 && entries[5].alts.length === 3, 'OpenAI-style chunk parsed (tokens, probabilities, alternatives)');

const words = C.toWords(entries);
ok(words.map(w => w.text).join('|') === 'The|default|port|is|3389', `tokens grouped into words, trailing "." dropped: ${words.map(w => w.text).join('|')}`);
const w3389 = words.find(w => w.text === '3389');
ok(Math.abs(w3389.minP - 0.42) < 1e-9 && w3389.minTok === '89', 'a word keeps its least confident token (0.42 on "89")');

const page = 'The default port is 3389.';
let hits = C.alignToText(words, page);
ok(hits.length === 1 && page.slice(hits[0].start, hits[0].end) === '3389', 'only the uncertain number is flagged, at the right place in the page text');
ok(C.describe(w3389).includes('42%') && C.describe(w3389).includes('90 (31%)'), `explanation mentions the confidence and the alternatives: "${C.describe(w3389)}"`);

// prose words with low probability are NOT flagged in "facts" mode (stylistic choices, not errors)
const prose = C.toWords(C.entriesFromChunk(chunk([[' The', 0.9], [' answer', 0.3], [' is', 0.5], [' RDP', 0.2]])));
ok(C.alignToText(prose, 'The answer is RDP').length === 0, 'unsure prose words are not flagged in facts mode');
ok(C.alignToText(prose, 'The answer is RDP', { mode: 'all', threshold: 0.35 }).length === 2, 'all-words mode flags them when asked');

// a confident number is not flagged
const sure = C.toWords(C.entriesFromChunk(chunk([[' port', 0.99], [' 22', 0.97]])));
ok(C.alignToText(sure, 'port 22').length === 0, 'a confident number is left alone');

// markdown: **bold** markers vanish in the page text; alignment must still find the value
const md = C.toWords(C.entriesFromChunk(chunk([[' Use', 0.9], [' **', 0.9], ['5', 0.3], ['986', 0.4], ['**', 0.9], [' for', 0.9], [' HTTPS', 0.8]])));
const pageMd = 'Use 5986 for HTTPS';
hits = C.alignToText(md, pageMd);
ok(hits.length === 1 && pageMd.slice(hits[0].start, hits[0].end) === '5986', 'alignment survives markdown characters that are not in the rendered text');

// duplicates: the second "443" is the uncertain one; the first must not be flagged by mistake
const dup = C.toWords(C.entriesFromChunk(chunk([[' 443', 0.99], [' and', 0.9], [' 443', 0.3]])));
hits = C.alignToText(dup, '443 and 443');
ok(hits.length === 1 && hits[0].start === 8, 'duplicate values: only the occurrence that was uncertain is flagged');

// code spans count as factual even without digits
const cmd = C.toWords(C.entriesFromChunk(chunk([[' run', 0.9], [' ipconfig', 0.35], [' /', 0.9], ['flush', 0.4], ['dns', 0.9]])));
hits = C.alignToText(cmd, 'run ipconfig /flushdns', { codeRanges: [[4, 22]] });
ok(hits.length >= 1 && hits.some(h => 'run ipconfig /flushdns'.slice(h.start, h.end).startsWith('ipconfig')), 'words inside code are flagged even without digits');

// llama.cpp native shape
const native = C.entriesFromChunk({ completion_probabilities: [{ content: ' 636', probs: [{ tok_str: ' 636', prob: 0.55 }, { tok_str: ' 389', prob: 0.3 }] }] });
ok(native.length === 1 && Math.abs(native[0].p - 0.55) < 1e-9 && native[0].alts.length === 2, 'llama.cpp native shape parsed too');
ok(C.entriesFromChunk({ choices: [{ delta: { content: 'hi' } }] }).length === 0, 'a chunk without probabilities yields nothing (no crash)');
ok(C.toWords([{ token: '', p: 1 }, { token: ' x', p: null, alts: [] }]).length === 1, 'missing probabilities are tolerated');
