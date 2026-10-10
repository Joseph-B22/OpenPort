// Part of OpenPort's logic tests. Run all with: npm test   (no model, no embedder, no real screen)
const ROOT = require('path').join(__dirname, '..').replace(/\\/g, '/');
const fs = require('fs'), path = require('path'), os = require('os');
const root = ROOT;
const db = require(root + '/db.js');
const SM = require(root + '/screenmem.js');
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-')); db.open(tmp);

  // ---------- exclusions ----------
  const ex = (process, title, terms) => SM.isExcluded({ process, title }, terms);
  ok(ex('1Password', 'Vault'), 'password manager program is excluded');
  ok(ex('chrome', 'Gmail - InPrivate'), 'private browsing window is excluded');
  ok(ex('msedge', 'Sign in to your account'), 'sign-in pages are excluded');
  ok(ex('chrome', 'My Bank - Accounts'), 'banking window is excluded');
  ok(ex('electron', 'OpenPort'), 'the OpenPort window itself is always excluded, even with an empty list');
  ok(SM.isExcluded({ process: 'electron', title: 'OpenPort' }, []), 'always-excluded rule cannot be removed by editing the list');
  ok(!ex('WindowsTerminal', 'PS C:\\Users\\admin> ping 10.9.8.7'), 'a normal terminal window is NOT excluded');
  ok(ex('notepad', 'customer-list.txt', ['customer']) && !ex('notepad', 'notes.txt', ['customer']), 'custom exclusion terms work');

  // ---------- prepare ----------
  ok(SM.prepare('hi') === null && SM.prepare('   \n  ') === null, 'tiny / empty OCR output is not kept');
  const p = SM.prepare('ERROR disk quota exceeded on fs-prod-3 at 10.9.8.7\npassword: hunter2hunter2\nsome more text to be long enough here');
  ok(p && !p.text.includes('hunter2') && p.text.includes('10.9.8.7') && p.scrubbed === 1, 'secrets scrubbed, IP kept, scrub count reported');

  // ---------- capture loop policy with fakes ----------
  let clock = 1_000_000_000_000, idle = 0, win = { ok: true, hwnd: 111, title: 'PS C:\\> ping 10.9.8.7', process: 'WindowsTerminal', minimized: false };
  let ocrText = 'Pinging 10.9.8.7 with 32 bytes of data:\nRequest timed out.\nRequest timed out.\nPing statistics for 10.9.8.7';
  const calls = { fg: 0, capture: 0, ocr: 0 };
  const audit = []; let states = 0;
  const embeds = []; let embedderReady = true;
  const cfg = { enabled: true, intervalSec: 30, minGapSec: 10, idleSkipSec: 120, exclude: SM.DEFAULT_EXCLUDE, retentionDays: 3 };
  const sm = new SM.ScreenMemory({
    cfg: () => cfg, now: () => clock, idleSeconds: () => idle, audit: (e, d) => audit.push(e), onState: () => states++,
    helper: { fg: async () => { calls.fg++; return win; }, ocr: async () => { calls.ocr++; return { text: ocrText }; } },
    capture: async () => { calls.capture++; return Buffer.from('fake-png'); },
    db, embedder: { isReady: () => embedderReady, embed: async (t, k, o) => { embeds.push(t[0].slice(0, 20)); return [Array.from({ length: 256 }, (_, i) => (i === 0 ? 1 : 0))]; } },
  });
  const rows = () => db.screenRows(0, clock + 1);

  await sm.tick();
  ok(rows().length === 1 && calls.capture === 1 && calls.ocr === 1, 'first look captures the window and stores its text');
  ok(rows()[0].text.includes('10.9.8.7') && rows()[0].process === 'WindowsTerminal', 'stored: text, program and title');

  clock += 5000; await sm.tick();
  ok(rows().length === 1 && calls.capture === 1, 'looking again 5 s later does nothing (interval is 30 s)');

  clock += 30000; await sm.tick();
  ok(rows().length === 1 && calls.capture === 2 && sm.stats.skippedDuplicate === 1, 'after 30 s the window is re-read, but identical text is not stored twice');

  ocrText += '\nReply from 10.9.8.7: bytes=32 time=2ms TTL=64\nPing statistics complete';
  clock += 31000; await sm.tick();
  ok(rows().length === 2, 'new text in the same window is stored');

  win = { ...win, hwnd: 222, title: 'Event Viewer', process: 'mmc' }; ocrText = 'Event Viewer\nLog Name: Security\nEvent ID 4625 An account failed to log on\nAccount Name: jmarsh';
  clock += 4000; await sm.tick();
  ok(rows().length === 2, 'switching windows < 10 s after the last capture waits (minimum gap)');
  clock += 7000; await sm.tick();
  ok(rows().length === 3 && rows()[0].title === 'Event Viewer', 'after the minimum gap the new window is captured');

  // excluded window: must not even be read
  const before = { capture: calls.capture, ocr: calls.ocr };
  win = { ok: true, hwnd: 333, title: 'Sign in to Contoso', process: 'msedge', minimized: false }; ocrText = 'Email: someone@example.com  Password: [typed]';
  clock += 40000; await sm.tick();
  ok(calls.capture === before.capture && calls.ocr === before.ocr && sm.stats.skippedExcluded === 1, 'an excluded window is neither captured nor read (no image, no OCR)');

  // idle / paused / locked
  win = { ok: true, hwnd: 444, title: 'Notepad', process: 'notepad', minimized: false }; ocrText = 'Meeting notes for Thursday: migrate the billing cluster to Ashburn site.';
  idle = 600; clock += 40000; await sm.tick();
  ok(rows().length === 3 && sm.stats.skippedIdle === 1, 'nothing is captured while you are away from the keyboard');
  idle = 0; sm.setPaused(true); clock += 40000; await sm.tick();
  ok(rows().length === 3 && audit.includes('screen_memory_paused'), 'nothing is captured while paused (and the pause is logged)');
  sm.setPaused(false); sm.locked = true; clock += 40000; await sm.tick();
  ok(rows().length === 3, 'nothing is captured while the screen is locked');
  sm.locked = false; clock += 40000; await sm.tick();
  ok(rows().length === 4, 'capturing resumes after unpausing / unlocking');

  win = { ...win, minimized: true }; clock += 40000; const c0 = calls.capture; await sm.tick();
  ok(calls.capture === c0, 'a minimized window is skipped');
  win = { ...win, minimized: false };

  // secrets never reach the database
  win = { ok: true, hwnd: 555, title: 'config.txt - Notepad', process: 'notepad', minimized: false };
  ocrText = 'enable secret 9 $9$abcdefghijkl$wxyz\nusername admin password 0 SuperSecret1\napi_key = "sk-live-abcdefghijklmnopqrstuvwx"\nhostname EDGE-SW-04 gateway 10.10.10.1';
  clock += 40000; await sm.tick();
  const all = rows().map(r => r.text).join('\n');
  ok(!/abcdefghijkl\$|SuperSecret1|sk-live-abcdef/.test(all) && all.includes('EDGE-SW-04') && all.includes('10.10.10.1'), 'secrets in the text are scrubbed before storage; the useful values remain');
  ok(sm.stats.scrubbedItems >= 3, `scrub count recorded (${sm.stats.scrubbedItems})`);

  // a moment the user chose to keep: ignores the duplicate rule, and is pinned
  const r1 = await sm.capture(win, { pinned: true }); const r2 = await sm.capture(win, { pinned: true });
  ok(r1.ok && r2.ok && rows().filter(r => r.pinned).length === 2, '"remember this window" always saves, and is marked as pinned');

  // nothing but text is stored
  const cols = Object.keys(db.screenRows(0, clock + 1)[0]);
  ok(!cols.some(c => /image|png|pixel|blob|screenshot/i.test(c)), 'stored columns hold no image data: ' + cols.join(', '));

  // embedding
  embedderReady = false;
  ocrText = 'A brand new window with enough different text to be stored: DHCP scope exhausted on VLAN 340 at 17:55.';
  win = { ok: true, hwnd: 666, title: 'DHCP console', process: 'mmc', minimized: false };
  await sm.capture(win, { pinned: true });
  ok(db.screenStats().embedded === db.screenStats().count - 1, 'with the embedding model offline, a new moment is stored and waits for its vector (no error)');
  embedderReady = true; await sm.embedSoon();
  const st = db.screenStats();
  ok(st.embedded === st.count && embeds.length === st.count, `all ${st.count} moments get a vector once the embedder is ready`);

  // search
  const withVec = db.screenRows(0, clock + 1);
  const hits = SM.searchRows(withVec, 'what was the IP I pinged that timed out', { queryVec: null });
  ok(hits.length && /Pinging|10\.9\.8\.7/.test(hits[0].snippet), 'keyword search finds the ping window: "' + hits[0]?.snippet.split('\n')[0] + '"');
  const hit2 = SM.searchRows(withVec, 'event 4625 jmarsh failed logon', { queryVec: Array.from({ length: 256 }, (_, i) => (i === 0 ? 1 : 0)) });
  ok(hit2[0].title === 'Event Viewer' && !hit2[0].snippet.includes('Request timed out'), 'search returns the right window, and the snippet is just the matching lines');
  ok(SM.searchRows([], 'x').length === 0, 'empty memory returns nothing');

  // retention
  const old = db.screenAdd({ ts: clock - 5 * 86400000, process: 'x', title: 'old', text: 'old unpinned text '.repeat(5), hash: 'h1', pinned: 0 });
  const oldPinned = db.screenAdd({ ts: clock - 20 * 86400000, process: 'x', title: 'old pinned', text: 'old pinned text '.repeat(5), hash: 'h2', pinned: 1 });
  const ancientPinned = db.screenAdd({ ts: clock - 120 * 86400000, process: 'x', title: 'ancient pinned', text: 'ancient text '.repeat(5), hash: 'h3', pinned: 1 });
  const n = sm.purge();
  const left = db.screenRows(0, clock + 1).map(r => r.title);
  ok(n === 2 && !left.includes('old') && left.includes('old pinned') && !left.includes('ancient pinned'), 'retention: unpinned older than 3 days and pinned older than 90 days are deleted; recent pinned kept');

  // delete everything
  db.screenClear();
  ok(db.screenStats().count === 0, 'delete-all empties screen memory');
  ok(!audit.some(a => /text|content/.test(a)), 'audit events carry no screen content (event names only)');
  db.close();
})().catch(e => { console.log('ERROR', e); process.exit(1); });
