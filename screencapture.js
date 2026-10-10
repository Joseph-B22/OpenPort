// Screen grabbing for screen memory (Electron main process only). Passive capture takes ONE window (the one in
// front), never the whole desktop, and the pixels stay in memory: the caller turns them into text and drops them.
const { desktopCapturer, screen } = require('electron');

// PNG bytes of the window with this handle, or null if Windows will not let us capture it (protected, minimized...).
async function captureWindow(hwnd) {
  const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 3840, height: 2160 }, fetchWindowIcons: false });
  const s = sources.find(x => x.id.startsWith(`window:${hwnd}:`));
  if (!s || s.thumbnail.isEmpty()) return null;
  return s.thumbnail.toPNG();
}

// PNG bytes of the whole display under the mouse pointer. Used only when YOU press "Read text on my screen".
async function captureDisplayAtCursor() {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const sf = display.scaleFactor || 1;
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(display.size.width * sf), height: Math.round(display.size.height * sf) } });
  const s = sources.find(x => x.display_id === String(display.id)) || sources[0];
  if (!s || s.thumbnail.isEmpty()) return null;
  return s.thumbnail.toPNG();
}

// The window handle of an Electron BrowserWindow as a decimal number (matches what the PowerShell helper reports).
const hwndOf = win => { const b = win.getNativeWindowHandle(); return String(b.length >= 8 ? b.readBigUInt64LE(0) : b.readUInt32LE(0)); };

module.exports = { captureWindow, captureDisplayAtCursor, hwndOf };
