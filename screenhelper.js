// Node side of native/screen-helper.ps1: one long-running PowerShell process that answers "which window is in front"
// and "what text is in this image". Requests are handled one at a time. Images travel in memory (base64 over a pipe)
// and are never written to disk.
const { spawn } = require('child_process');
const path = require('path');

class ScreenHelper {
  constructor(script = path.join(__dirname, 'native', 'screen-helper.ps1')) {
    this.script = script; this.proc = null; this.queue = []; this.buf = ''; this.ready = null; this.info = null;
  }

  start() {
    if (this.proc) return this.ready;
    this.proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.script], { windowsHide: true });
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', d => this._data(d));
    this.proc.stderr.on('data', () => {});
    this.proc.on('exit', () => { this.proc = null; this.ready = null; for (const q of this.queue.splice(0)) q.reject(new Error('screen helper exited')); });
    this.ready = new Promise((resolve, reject) => {
      this.queue.push({ resolve: msg => { this.info = msg; msg.ready ? resolve(msg) : reject(new Error(msg.error || 'OCR is not available')); }, reject });
      setTimeout(() => reject(new Error('screen helper did not start in time')), 30000).unref?.();
    });
    return this.ready;
  }

  _data(chunk) {
    this.buf += chunk;
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim().replace(/^﻿/, ''); this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      const q = this.queue.shift();
      if (!q) continue;
      try { q.resolve(JSON.parse(line)); } catch (e) { q.reject(e); }
    }
  }

  async _ask(line, timeoutMs = 15000) {
    await this.start();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { reject(new Error('screen helper timed out')); this.stop(); }, timeoutMs);
      this.queue.push({ resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } });
      this.proc.stdin.write(line + '\n');
    });
  }

  fg() { return this._ask('FG'); }                                           // {ok, hwnd, title, process, pid, minimized}
  async ocr(imageBuffer) {                                                    // PNG/JPEG bytes -> {ok, ms, text}
    const r = await this._ask('OCR ' + imageBuffer.toString('base64'), 30000);
    if (!r.ok) throw new Error(r.error || 'OCR failed');
    return r;
  }
  stop() { try { this.proc?.stdin.write('QUIT\n'); this.proc?.kill(); } catch { /* already gone */ } this.proc = null; this.ready = null; }
}

module.exports = { ScreenHelper };
