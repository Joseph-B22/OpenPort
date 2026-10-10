// Part of OpenPort's logic tests. Run all with: npm test   (no model, no embedder, no real screen)
const ROOT = require('path').join(__dirname, '..').replace(/\\/g, '/');
const P = require(ROOT + '/src/promptplan.js');
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);

// --- basic fitting
let counts = Array(10).fill(100);
let r = P.planWindow({ counts, limit: 1000 });
ok(r.included.length === 10 && r.start === 0 && r.outOfView.length === 0, 'everything fits: nothing dropped');
r = P.planWindow({ counts: Array(20).fill(100), limit: 1000 });
ok(r.total <= 1000 && r.included.includes(19) && r.start > 0, `over budget: oldest dropped (start=${r.start}), newest kept, total ${r.total} <= 1000`);
ok(r.total <= 1000 * 0.7 + 100, `hysteresis jumps to the low watermark (total ${r.total}, ~700 target) instead of trimming one message`);

// --- pins and excludes
const base = Array(20).fill(100);
r = P.planWindow({ counts: base, limit: 1000, pinned: new Set([1]) });
ok(r.included.includes(1) && r.included.includes(19) && r.total <= 1000, 'a pinned old message stays in view');
r = P.planWindow({ counts: base, limit: 1000, excluded: new Set([18]) });
ok(!r.included.includes(18) && r.excluded.includes(18), 'an excluded message is left out even though it is recent');
r = P.planWindow({ counts: base, limit: 1000, pinned: new Set([0, 1, 2, 3, 4, 5, 6, 7]) });
ok(r.droppedPins.length > 0 && r.total <= 1000, `pins that would eat >60% of the window are partially dropped (${r.droppedPins.length} unpinned automatically)`);
r = P.planWindow({ counts: [5000, 100], limit: 1000 });
ok(r.included.includes(1) && r.included.length >= 1, 'the current turn is always included even if it alone exceeds the limit');

// --- prefix stability: how often does the start of the prompt stay identical turn to turn?
function simulate(lowWater) {
  let start = 0, prev = null, reuse = 0, turns = 0;
  const counts = [];
  for (let t = 0; t < 120; t++) {
    counts.push(130);                                      // each message ~130 tokens
    const plan = P.planWindow({ counts: counts.slice(), startHint: start, limit: 4000, lowWater });
    start = plan.start;
    const sig = plan.included.slice(0, -2).join(',');      // everything except the newest exchange
    if (prev !== null) { turns++; if (sig === prev || sig.startsWith(prev) || prev.startsWith(sig) && sig.length > 0 && (prev.startsWith(sig))) reuse++; }
    prev = plan.included.slice(0, -1).join(',');           // what the next turn can reuse
  }
  return Math.round(100 * reuse / turns);
}
const naive = simulate(1.0), smart = simulate(0.7);
ok(smart > naive, `prefix reuse across 120 turns: one-at-a-time sliding ${naive}% vs chunked eviction ${smart}%`);

// --- layout: volatile context goes next to the question, system prompt stays identical
const history = [{ role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1' }, { role: 'user', content: 'q2' }];
const m1 = P.buildMessages({ history, included: [0, 1, 2], systemText: 'SYS', volatileText: 'NOTES A' });
const m2 = P.buildMessages({ history, included: [0, 1, 2], systemText: 'SYS', volatileText: 'NOTES B' });
ok(JSON.stringify(m1.slice(0, 3)) === JSON.stringify(m2.slice(0, 3)) && m1[3].content !== m2[3].content, 'changing the notes only changes the final user message; everything before it is byte-identical');
const withImg = P.augment([{ type: 'image_url', image_url: { url: 'x' } }, { type: 'text', text: 'what is this' }], 'CTX');
ok(withImg[1].text === 'CTX\n\nwhat is this' && withImg[0].type === 'image_url', 'volatile context is folded into the text part of a message with an image');
ok(P.contentParts([{ type: 'image_url' }, { type: 'text', text: 'hi' }]).images === 1, 'images are counted separately from text');
