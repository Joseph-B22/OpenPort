// Run with:  node_modules\electron\dist\electron.exe eval\electron-capture-test.js
// Opens a small window of FAKE terminal text that this script draws itself, captures THAT window by its handle,
// reads it with Windows OCR, and checks the pipeline. It never looks at any other window or at your real screen.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const root = path.join(__dirname, '..');
const { captureWindow, hwndOf } = require(path.join(root, 'screencapture.js'));
const { ScreenHelper } = require(path.join(root, 'screenhelper.js'));
app.disableHardwareAcceleration();

const html = `<body style="margin:0;background:#0c0c0c;color:#ccc;font:22px Consolas,monospace;padding:24px">
<div>PS C:\\Users\\admin&gt; ping 10.9.8.7</div><div>Request timed out.</div>
<div>2026-10-08 17:44:03 ERROR disk quota exceeded for volume vol_finance on host fs-prod-3</div>
<div>Server SW-DALLAS-07 firmware 17.6.3 VLAN 340 gateway 10.20.30.1 order A-48213</div>
<div>password: hunter2hunter2</div></body>`;

app.whenReady().then(async () => {
  const out = [];
  const ok = (c, m) => out.push((c ? 'PASS ' : 'FAIL ') + m);
  const win = new BrowserWindow({ width: 900, height: 420, show: true, title: 'ocr-test-window', webPreferences: { sandbox: true } });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  win.focus();
  await new Promise(r => setTimeout(r, 1500));
  const helper = new ScreenHelper();
  try {
    await helper.start();
    const hwnd = hwndOf(win);
    const fg = await helper.fg();
    ok(String(fg.hwnd) === hwnd, 'the helper reports this window as the one in front, and its handle matches Electron\'s (' + (String(fg.hwnd) === hwnd) + ')');
    ok(fg.title === 'ocr-test-window' && fg.minimized === false, 'foreground title and minimized flag are correct');

    const t0 = Date.now();
    const png = await captureWindow(hwnd);
    ok(!!png && png.length > 5000, `captured the window by handle: ${png ? (png.length / 1024).toFixed(0) + ' KB PNG' : 'NOTHING'} in ${Date.now() - t0} ms`);
    if (png) {
      const t1 = Date.now();
      const { text } = await helper.ocr(png);
      const ms = Date.now() - t1;
      const want = ['10.9.8.7', 'vol_finance', 'fs-prod-3', 'SW-DALLAS-07', '17.6.3', '10.20.30.1', 'A-48213'];
      // OCR is imperfect (zeros are sometimes read as the letter "e" or "o"), so we require most values, not all.
      ok(want.filter(v => text.includes(v)).length >= want.length - 1, `OCR read ${want.filter(v => text.includes(v)).length}/${want.length} key values from the captured window (${ms} ms)`);
      const missed = want.filter(v => !text.includes(v));
      if (missed.length) out.push('   missed: ' + missed.join(', ') + '\n   OCR text of this test window (fake text drawn by this script):\n   ' + text.replace(/\n/g, '\n   '));
      const { scrub } = require(path.join(root, 'scrub.js'));
      const clean = scrub(text).text;
      ok(!clean.includes('hunter2') && clean.includes('10.9.8.7'), 'scrubbing removes the password from the OCR text and keeps the IP');
    }
    // a window that does not exist is simply not captured
    ok((await captureWindow('999999999')) === null, 'a handle that matches no window returns nothing (no fallback to the full screen)');
  } catch (e) { out.push('ERROR ' + e.message); }
  finally { helper.stop(); }
  console.log(out.join('\n'));
  app.quit();
});
