// Part of OpenPort's logic tests. Run all with: npm test   (no model, no embedder, no real screen)
// Cross-chat memory: time words, recency ranking, "newer note replaces older", the Memory page database calls, fact parsing.
// Uses a throwaway database and hand-made vectors (no embedding model).
const ROOT = require('path').join(__dirname, '..').replace(/\\/g, '/');
const fs = require('fs'), path = require('path'), os = require('os');
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
const R = require(ROOT + '/memrank.js');
const F = require(ROOT + '/src/memfacts.js');
const DAY = R.DAY;
const NOW = new Date(2026, 9, 8, 15, 0, 0).getTime();          // Thursday 8 Oct 2026, 15:00 local

// ---- time words ----
const w = q => R.parseTimeHint(q, NOW);
const inW = (win, t) => win && t >= win.since && t <= win.until;
ok(w('what did we decide yesterday about DNS') && inW(w('yesterday'), NOW - DAY) && !inW(w('yesterday'), NOW - 2 * DAY - 6 * 3600e3) && !inW(w('yesterday'), NOW), '"yesterday" covers yesterday only');
ok(inW(w('earlier today'), NOW - 3600e3) && !inW(w('today'), NOW - DAY), '"today" covers today only');
ok(inW(w('the switch issue last week'), NOW - 9 * DAY) && !inW(w('last week'), NOW - DAY), '"last week" covers 7-13 days back, not yesterday');
ok(inW(w('the thing from 3 days ago'), NOW - 3 * DAY) && !inW(w('3 days ago'), NOW - 10 * DAY), '"3 days ago" is roughly three days back');
ok(inW(w('two weeks ago'), NOW - 14 * DAY), 'number words work ("two weeks ago")');
ok(inW(w('in the past 5 days'), NOW - 4 * DAY) && !inW(w('in the past 5 days'), NOW - 8 * DAY), '"in the past 5 days"');
ok(w('how do I flush DNS') === null && w('what is a weekday') === null && w('the daily backup') === null, 'questions without a time word get no date filter');

ok(R.ageLabel(NOW - 3600e3, NOW) === 'today' && R.ageLabel(NOW - DAY, NOW) === 'yesterday' && R.ageLabel(NOW - 5 * DAY, NOW) === '5 days ago' && /weeks/.test(R.ageLabel(NOW - 30 * DAY, NOW)), 'age labels read naturally');

// ---- ranking ----
const unit = (...xs) => { const n = Math.hypot(...xs); return Float32Array.from(xs.map(x => x / n)); };
const hits = [
  { id: 1, score: 0.80, created: NOW - 200 * DAY, text: 'old', vec: unit(1, 0, 0) },
  { id: 2, score: 0.79, created: NOW - 1 * DAY, text: 'new', vec: unit(1, 0.05, 0) },
  { id: 3, score: 0.95, created: NOW - 300 * DAY, text: 'strong old', vec: unit(0, 1, 0) },
];
let r = R.rerank(hits, { now: NOW });
ok(r[1].id === 2 && r[2].id === 1, 'of two near-equal matches the newer ranks first');
ok(r[0].id === 3, 'recency never lifts a weak match over a clearly stronger old one');
R.markSuperseded(r);
ok(r.find(h => h.id === 1).superseded === true && !r.find(h => h.id === 2).superseded && !r.find(h => h.id === 3).superseded, 'the older of two near-identical notes is flagged as replaced; unrelated notes are not');
const sel = R.selectMemories(hits, 'what did we say yesterday', { now: NOW, topK: 3 });
ok(sel.hits.length === 1 && sel.hits[0].id === 2 && sel.window.label === 'yesterday', 'a dated question only recalls notes from that date');
ok(sel.hits.every(h => !('vec' in h)) && sel.hits[0].age === 'yesterday', 'vectors are stripped and an age is attached before sending to the page');
const fact = R.rerank([{ score: 0.80, created: NOW - DAY, kind: 'chat' }, { score: 0.80, created: NOW - DAY, kind: 'fact' }], { now: NOW });
ok(fact[0].kind === 'fact', 'a saved fact edges out an equally close chat answer');

// ---- "stands out" rule ----
const flat = Array.from({ length: 40 }, (_, i) => 0.66 + (i % 5) * 0.005);         // a vague question: everything ~0.66-0.68
ok(R.standsOut([{ score: 0.68 }, { score: 0.67 }], flat, { minScore: 0.65 }).length === 0, 'a vague question that resembles every note a little recalls nothing');
const peaked = [0.86, ...Array.from({ length: 39 }, () => 0.6)];                    // a specific question: one note clearly closer
ok(R.standsOut([{ score: 0.86 }], peaked, { minScore: 0.65 }).length === 1, 'a specific question still recalls the note that clearly matches');
ok(R.standsOut([{ score: 0.7 }], [0.7, 0.69, 0.68], { minScore: 0.65 }).length === 1, 'with only a few notes there is no reliable "typical" level, so only the fixed minimum applies');
ok(R.selectMemories([{ score: 0.68, created: NOW, text: 'x' }], 'what website was I on', { now: NOW, pool: flat, minScore: 0.65 }).hits.length === 0, 'the rule is applied by the recall pipeline');

// ---- fact parsing ----
const parsed = F.parse('<think>hmm</think>Here are the facts:\n- The VPN gateway is 10.4.0.1\n* **Backup job** runs at 02:00 on SRV-BK01\n2. User prefers PowerShell over cmd\n- The VPN gateway is 10.4.0.1\n- ok\nThanks!');
ok(parsed.length === 3 && parsed[0] === 'The VPN gateway is 10.4.0.1' && parsed[1] === 'Backup job runs at 02:00 on SRV-BK01', 'fact list: bullets, numbers and bold are cleaned; duplicates, tiny lines and chatter dropped');
ok(F.parse('NONE').length === 0 && F.parse('None.').length === 0, '"NONE" means no facts');
const long = Array.from({ length: 200 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `message ${i} ` + 'x'.repeat(100) }));
const p = F.buildPrompt(long, 3000);
ok(p.includes('message 199') && !p.includes('message 0 ') && p.includes('cut for length'), 'long chats keep their end (the outcome) and say the start was cut');
ok(F.buildPrompt([{ role: 'user', content: [{ type: 'text', text: 'see image' }, { type: 'image_url', image_url: { url: 'data:x' } }] }, { role: 'tool', content: 'secret file' }]).includes('USER: see image') &&
   !F.buildPrompt([{ role: 'tool', content: 'secret file' }]).includes('secret file'), 'only user and assistant text goes into the fact prompt (no images, no tool output)');

// ---- database ----
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memdb-'));
const db = require(ROOT + '/db.js');
db.open(dir);
const c1 = db.createChat('Cabling'), c2 = db.createChat('DNS');
const v = (...xs) => Array.from(unit(...xs));
db.addMessage(c1, 'user', 'q', 'q');
const m1 = db.addMessage(c1, 'assistant', 'a', 'Q: cable?\nA: grey Cat5e', v(1, 0, 0));
const m2 = db.addMessage(c2, 'assistant', 'a', 'Q: dns?\nA: 10.20.0.10', v(0, 1, 0));
ok(db.searchMemory(v(1, 0, 0), null, 5, 0.5).length === 1 && db.searchMemory(v(1, 0, 0), null, 5, 0.5)[0].kind === 'chat', 'chat answers are searchable');
db.memorySetState('chat', m1, 1);
ok(db.searchMemory(v(1, 0, 0), null, 5, 0.5).length === 0, 'an answer marked outdated is never recalled');
ok(db.memoryList().find(x => x.id === m1).state === 1, '...but still listed on the Memory page');
db.memorySetState('chat', m1, 0);
ok(db.searchMemory(v(1, 0, 0), null, 5, 0.5).length === 1, 'restore makes it recallable again');
const a = db.factAdd(c1, 'Uplink uses the grey Cat5e cable', v(1, 0.02, 0), { now: NOW - 5 * DAY });
const b = db.factAdd(c1, 'Uplink uses the black Cat6 cable', v(1, 0.05, 0), { now: NOW });
ok(a.replaced.length === 0 && b.replaced.length === 1 && b.replaced[0] === a.id, 'a new fact on the same topic replaces the older fact');
const hitsNow = db.searchMemory(v(1, 0.03, 0), null, 5, 0.5);
ok(hitsNow.some(h => h.kind === 'fact' && h.id === b.id) && !hitsNow.some(h => h.kind === 'fact' && h.id === a.id), 'only the newer fact is recalled');
const listed = db.memoryList().find(x => x.kind === 'fact' && x.id === a.id);
ok(listed && listed.state === 1 && listed.replaced_by === b.id, 'the replaced fact shows as outdated, pointing at its replacement');
db.factAdd(c2, 'DNS servers are 10.20.0.10 and 10.20.0.11', v(0, 1, 0));
ok(db.chatFacts(c2).length === 1, 'facts are listed per chat');
ok(db.searchMemory(v(0, 1, 0), c2, 5, 0.5).length === 0, 'the current chat\'s own answers and facts are not recalled into itself');
db.memorySetState('chat', m2, 2);
ok(db.messagesWithoutEmbedding().every(x => x.id !== m2) && db.memoryList().every(x => !(x.kind === 'chat' && x.id === m2)), 'a forgotten answer is gone from memory and is never re-embedded');
ok(db.getMessages(c2).length === 1, '...while the chat message itself stays in the history');
const st = db.stats();
ok(st.facts === 3 && st.outdated === 1, 'stats count facts and outdated notes');
db.deleteChat(c1);
ok(db.memoryList().every(x => x.chat_id !== c1), 'deleting a chat deletes its facts (retention and "delete chat" keep their promise)');
db.deleteAll();
ok(db.memoryList().length === 0, 'delete all history removes every fact');
db.close();
try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp folder */ }
