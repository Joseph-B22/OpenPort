// Part of OpenPort's logic tests. Run all with: npm test   (no model, no embedder, no real screen)
const ROOT = require('path').join(__dirname, '..').replace(/\\/g, '/');
const fs = require('fs'), path = require('path'), os = require('os');
const E = require(ROOT + '/evals.js');
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evt-'));
  // scoring rules
  ok(E.score('Use ipconfig /flushdns in an elevated prompt', { expect: ['ipconfig /flushdns'] }).pass, 'substring match');
  ok(E.score('IPCONFIG /FLUSHDNS', { expect: ['ipconfig /flushdns'] }).pass, 'matching ignores case');
  ok(E.score('run netstat -an', { expect: ['ss|netstat|lsof'] }).pass, '"a|b" accepts any alternative');
  ok(!E.score('I would not know', { expect: ['3389'] }).pass, 'missing expectation fails');
  ok(!E.score('VLAN 10 and 340', { expect: ['340'], forbid: ['vlan 10'] }).pass, 'forbidden text fails');
  ok(!E.score('yes, absolutely, definitely', { expect: ['yes'], maxChars: 12 }).pass, 'maxChars fails a rambling answer');
  ok(E.score('yes', { expect: ['yes'], maxChars: 12 }).pass, 'maxChars passes a short answer');

  // starter set is seeded once and every case is checkable
  const cases = E.loadCases(dir);
  ok(cases.length === 12 && cases.every(c => c.expect.length), `starter set seeded: ${cases.length} cases, each with an expectation`);
  ok(E.loadCases(dir).length === 12, 'seeding happens once');
  const long = cases.find(c => c.name === 'Needle in long text');
  ok(long.context.length > 5000 && long.context.includes('02:00'), `long-text case has ${long.context.length} chars of context with the needle inside`);

  // a fake model that knows half the answers, to test the runner and aggregation
  const knows = ['3389', '636', 'show vlan brief', '128', 'yes', '02:00'];
  const ask = async msgs => {
    const q = msgs[1].content;
    const hit = knows.find(k => (q.includes('RDP') && k === '3389') || (q.includes('LDAPS') && k === '636') || (q.includes('VLANs in brief') && k === 'show vlan brief') || (q.includes('IPv6') && k === '128') || (q.includes('one word') && k === 'yes') || (q.includes('maintenance window') && k === '02:00'));
    return { content: hit || 'I am not sure.', tps: 42.5, tokens: 12 };
  };
  const progress = [];
  const run = await E.runSuite({ cases, ask, systemPrompt: 'sys', meta: { model: 'fake-model', backend: 'cpu', ctx: 8192 }, onProgress: p => progress.push(p.done) });
  ok(run.total === 12 && run.passed >= 6 && run.passed <= 8, `runner scored ${run.passed}/12 for a model that knows about half`);
  ok(run.avgTps === 42.5 && run.details.length === 12 && progress.length === 12, 'speed averaged, one detail per case, progress reported per case');
  ok(run.details.find(d => d.name === 'Admits what it cannot know').pass === false, '"I am not sure." does not count as admitting ignorance (needs a clear phrase)');

  // errors are recorded, not thrown
  const bad = await E.runSuite({ cases: cases.slice(0, 2), ask: async () => { throw new Error('engine exploded'); }, systemPrompt: 's', meta: { model: 'x' } });
  ok(bad.passed === 0 && bad.details[0].error === 'engine exploded', 'an engine error fails that case and the suite keeps going');

  // cancel
  const ctl = new AbortController(); let n = 0;
  const cancelled = await E.runSuite({ cases, ask: async () => { if (++n === 3) ctl.abort(); return { content: 'x' }; }, signal: ctl.signal, systemPrompt: 's', meta: {} });
  ok(cancelled.cancelled && cancelled.completed === 3, `cancel stops after the current case (${cancelled.completed} of 12 done)`);

  // persistence
  E.saveRun(dir, run);
  ok(E.loadRuns(dir)[0].id === run.id, 'runs are saved and listed newest first');
  E.deleteRun(dir, run.id);
  ok(E.loadRuns(dir).length === 0, 'run can be deleted');
  const saved = E.saveCases(dir, [{ name: 'Mine', prompt: 'q?', expect: ['a', ''], forbid: [] }]);
  ok(saved.length === 1 && saved[0].expect.length === 1 && E.loadCases(dir).length === 1, 'custom cases save (empty expectations dropped)');
  fs.rmSync(dir, { recursive: true, force: true });
})();
