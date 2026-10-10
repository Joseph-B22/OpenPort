// Part of OpenPort's logic tests. Run all with: npm test   (no model, no embedder, no real screen)
const ROOT = require('path').join(__dirname, '..').replace(/\\/g, '/');
const A = require(ROOT + '/src/attrib.js');
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);

const base = 'The backup job runs as svc-backup-07. It starts nightly at 02:00. Logs are kept for 30 days.';
let d = A.diffAnswers(base, base);
ok(d.changed === 0 && d.identical, 'identical answers: no change');

d = A.diffAnswers(base, 'The backup job runs as svc-backup-07. It starts nightly at 02:00. Logs are kept for 30 days!');
ok(d.changed < 0.08, `trivial rewording stays under the "no visible effect" line (${d.changed.toFixed(2)})`);

d = A.diffAnswers(base, 'I do not know which account the backup job uses. Please check the scheduler.');
ok(d.changed > 0.6 && d.lostFacts.includes('svc-backup-07') && d.lostFacts.includes('02:00'), `losing the facts is a strong effect (${d.changed.toFixed(2)}); lost: ${d.lostFacts.join(', ')}`);
ok(d.lostSentences.length === 3, `all 3 statements are listed as depending on the removed source (${d.lostSentences.length})`);

d = A.diffAnswers(base, 'The backup job runs as svc-backup-07. It starts nightly at 03:00. Logs are kept for 30 days.');
ok(d.changed >= 0.08 && d.changed < 0.6 && d.lostFacts.includes('02:00') && d.gainedFacts.includes('03:00'), `one changed fact is a middle effect (${d.changed.toFixed(2)}): lost ${d.lostFacts}, gained ${d.gainedFacts}`);

ok(A.verdict(0.02) === 'no visible effect' && A.verdict(0.2) === 'small effect' && A.verdict(0.45) === 'clear effect' && A.verdict(0.9) === 'the answer depends on this', 'verdict wording by size of change');

const ranked = A.rank([{ source: 'a', diff: { changed: 0.1 } }, { source: 'b', diff: { changed: 0.9 } }, { source: 'c', diff: { changed: 0.4 } }]);
ok(ranked.map(r => r.source).join('') === 'bca', 'sources are ranked most influential first');
ok(A.diffAnswers('', '').changed === 0, 'two empty answers do not crash');
ok(A.sentences('Use port 22. Then reconnect. Done').length === 3, 'sentence splitting');
