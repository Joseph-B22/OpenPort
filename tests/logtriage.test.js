// Part of OpenPort's logic tests. Run all with: npm test   (no model, no embedder, no real screen)
const ROOT = require('path').join(__dirname, '..').replace(/\\/g, '/');
const L = require(ROOT + '/logtriage.js');
const data = require(ROOT + '/eval/data.js');
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);

(async () => {
  // templates collapse the variable parts
  ok(L.template('2026-10-06 09:14:22 ERROR connection to 10.20.30.5:443 failed after 30 s (host db-prod-7)') === 'ERROR connection to <IP> failed after <N> s (host <HOST>)',
    'template masks timestamp, IP:port, numbers and host names: "' + L.template('2026-10-06 09:14:22 ERROR connection to 10.20.30.5:443 failed after 30 s (host db-prod-7)') + '"');
  ok(L.template('Jan  5 03:12:01 sshd[1234]: Failed password for root from 1.2.3.4 port 5555') === L.template('Mar 17 22:01:55 sshd[9876]: Failed password for root from 9.9.9.9 port 22'), 'syslog-style lines with different times, pids and IPs share one template');

  // the synthetic 4,200-line log from the experiments: 3 planted problems among routine INFO lines
  const log = data.buildLog().text;
  let t0 = Date.now();
  let rep = await L.triage(log, { top: 8 });
  const ms = Date.now() - t0;
  const head = rep.split('\n')[0];
  console.log('   ' + head);
  ok(/4200 lines|4,200 lines/.test(head) || /lines reduced to \d+ distinct/.test(head), 'summary line reports line and pattern counts');
  const patterns = +head.match(/to (\d+) distinct/)[1];
  ok(patterns < 40, `4,200 lines collapse to ${patterns} patterns`);
  const top5 = rep.split('\n#').slice(1, 6).join('\n');
  ok(/fs-prod-3/.test(top5) && /portal\.corp\.example/.test(top5) && /jmarsh/.test(top5), 'all three planted problems (disk quota, certificate, lockout) are in the top 5');
  ok(!/INFO api request completed/.test(rep.split('\n#').slice(1, 4).join('\n')), 'routine INFO chatter is not in the top 3');
  ok(ms < 1500, `triage of 4,200 lines took ${ms} ms`);

  // adversarial: frequent benign warning must not outrank a rare critical; a burst of identical errors must rank high
  let lines = [];
  const t = (i) => `2026-10-06 10:${String(Math.floor(i / 60) % 60).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`;
  for (let i = 0; i < 3000; i++) lines.push(`${t(i)} INFO service heartbeat ok id=${i}`);
  for (let i = 0; i < 400; i++) lines.push(`${t(i * 2)} WARN cache miss for key user:${i}`);                          // frequent, mild
  lines.push(`${t(1500)} CRITICAL kernel panic: out of memory on host app-9`);                                         // rare, severe
  for (let i = 0; i < 60; i++) lines.push(`${t(2000 + i)} ERROR upstream 10.1.1.${i % 5} returned 503 for /api/orders`);   // a burst
  rep = await L.triage(lines.join('\n'), { top: 5 });
  const order = rep.split('\n#').slice(1).map(s => s.split('\n')[0]);
  console.log('   ranking:\n   ' + order.map(o => o.slice(0, 100)).join('\n   '));
  ok(/kernel panic/.test(rep.split('\n#')[1]), 'the single critical line ranks #1');
  ok(/503/.test(rep.split('\n#').slice(1, 3).join('\n')) && /bursty/.test(rep), 'the 60-line error burst ranks near the top and is marked bursty');
  const warnRank = order.findIndex(o => /WARN|cache miss/.test(o + rep.split('\n#')[order.length]));
  ok(!/heartbeat/.test(rep.split('\n#').slice(1, 4).join('\n')), 'heartbeat noise stays out of the top 3');

  // embedding merge with a fake embedder: near-duplicate wording merges, different meaning does not
  const fake = async texts => texts.map(x => { const v = [/timed? ?out|timeout/i.test(x) ? 1 : 0, /denied|refused/i.test(x) ? 1 : 0, /disk|quota/i.test(x) ? 1 : 0, 0.05]; const n = Math.hypot(...v); return v.map(a => a / n); });
  const txt = ['ERROR connection timed out to 10.0.0.1', 'ERROR connect timeout to 10.0.0.2', 'ERROR disk quota exceeded on vol1', 'ERROR access denied for user bob'].join('\n');
  const merged = await L.triage(txt, { top: 5, embed: fake });
  ok(/similar patterns merged/.test(merged) && /2 similar patterns merged/.test(merged), 'two wordings of "timeout" merge into one group');
  ok(/disk quota/.test(merged) && /access denied/.test(merged), 'different problems stay separate');
  const plain = await L.triage(txt, { top: 5 });
  ok(!/merged/.test(plain.split('\n')[0]), 'without an embedder the result is still produced (deterministic)');
  let err = ''; try { await L.triage('\n\n  \n'); } catch (e) { err = e.message; }
  ok(/empty/.test(err), 'empty log is reported clearly');
})();
