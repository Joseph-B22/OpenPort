// Part of OpenPort's logic tests. Run all with: npm test   (no model, no embedder, no real screen)
// Copy score wording (src/provenance-ui.js copyScoreText), using the numbers the real engine reported in eval\bench-speed.js.
const ROOT = require('path').join(__dirname, '..').replace(/\\/g, '/');
const fs = require('fs'), vm = require('vm');
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
const src = fs.readFileSync(ROOT + '/src/provenance-ui.js', 'utf8');
const ctx = vm.createContext({});
vm.runInContext(src, ctx);
const f = t => vm.runInContext(`copyScoreText(${JSON.stringify(t)})`, ctx);

ok(/^Copy-ahead: 94% .*616 of 655 tokens.*mostly a copy with small changes\. Written at 396 tokens\/s\.$/.test(f({ drafted: 717, accepted: 616, outTokens: 655, tps: 396 })), 'config fix (measured): 94%, "mostly a copy with small changes"');
ok(/33% .*a mix of copied and new text/.test(f({ drafted: 274, accepted: 85, outTokens: 256, tps: 123 })), 'script edit (measured): 33%, "a mix"');
ok(/3% .*mostly new writing/.test(f({ drafted: 192, accepted: 10, outTokens: 288 })), 'normal chat: "mostly new writing"');
ok(f({ drafted: 5, accepted: 4, outTokens: 300 }) === null && f({}) === null && f({ drafted: 100, accepted: 50 }) === null, 'too few guesses, or copy-ahead off: no line at all');
ok(/100%/.test(f({ drafted: 500, accepted: 900, outTokens: 600 })), 'never shows more than 100%');
