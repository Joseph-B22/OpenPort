// Read-only file tools the model can call. Hard rules enforced here, not by the model:
//  - only paths inside the user-approved folders (symlinks and ".." resolved before checking)
//  - read-only: list, read, search. No writes, no commands, no network.
//  - sizes are capped so a tool result can't flood the context window.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { extractText, isDocument } = require('./extract');

const READ_DEFAULT = 12000, READ_MAX = 24000;
const SKIP_DIRS = new Set(['node_modules', '.git', '$recycle.bin', 'system volume information']);

const definitions = [
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description: 'List files and folders in an approved directory.',
      parameters: { type: 'object', properties: { path: { type: 'string', description: 'Absolute path of the directory' } }, required: ['path'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a text file (logs, configs, scripts, notes) from an approved folder. Long files are truncated; use start to read further.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path of the file' },
          start: { type: 'integer', description: 'Character offset to start from (default 0)' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description: 'Find files by name, or find text inside files, within the approved folders.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Text to look for' },
          mode: { type: 'string', enum: ['name', 'content'], description: 'Match file names or file contents' },
          path: { type: 'string', description: 'Optional approved folder to search; default is all approved folders' },
        },
        required: ['query', 'mode'],
      },
    },
  },
];

// Tools that need the model or the index, so main.js runs them. Only offered when they can work.
const extraDefinitions = {
  search_docs: {
    type: 'function',
    function: {
      name: 'search_docs',
      description: 'Semantic search over the indexed approved folders (code, configs, logs, notes, Word and PDF files). Finds relevant passages by meaning, not exact words. Use it for questions about "where/how/why" across many files.',
      parameters: { type: 'object', properties: { query: { type: 'string', description: 'What to look for, phrased naturally' } }, required: ['query'] },
    },
  },
  search_screen_memory: {
    type: 'function',
    function: {
      name: 'search_screen_memory',
      description: 'Look at the text of windows the user had in front of them earlier (the user switched on screen memory). ' +
        'Two ways to use it: (1) TIMELINE: leave query empty to get the list of windows/websites the user had open in that time, in order, with times. ' +
        'Use this for "what was I doing", "what website was I on", "which window had...". Set app to "browser" for websites, "terminal" for consoles. ' +
        '(2) SEARCH: give a query to find specific text, for "what was that IP / error / number on my screen". ' +
        'Always set since_minutes to match the question ("a few minutes ago" = 15, "this morning" = 300, "an hour ago" = 90). ' +
        'Results are OCR text and can contain misread characters.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Text to look for, in plain words (for example: "ping timed out 10.9.8.7"). Leave empty for the timeline.' },
          app: { type: 'string', enum: ['any', 'browser', 'terminal'], description: 'Only windows of this kind (default any)' },
          since_minutes: { type: 'integer', description: 'Look back this many minutes (default 180, max 4320)' },
          until_minutes: { type: 'integer', description: 'Ignore the most recent this-many minutes (default 0)' },
        },
        required: [],
      },
    },
  },
  check_this_pc: {
    type: 'function',
    function: {
      name: 'check_this_pc',
      description: 'Look up facts about THIS computer (the one OpenPort runs on), read-only: the status and startup type of Windows services, ' +
        'whether specific updates (KB numbers) are installed, and whether local files or folders exist. Use it instead of telling the user ' +
        'to check, when the question is about this machine ("is the Print Spooler running?", "is KB5034441 installed?", "does C:\\Logs exist?"). ' +
        'It can also LIST services with list_services: "running" (all running services), "third_party" (every service not made by Microsoft: ' +
        'use this for "which services don\'t I need?", since Microsoft services are part of Windows), "auto_not_running" (set to start automatically ' +
        'but not running: use for troubleshooting). It cannot change anything and cannot see other computers.',
      parameters: {
        type: 'object',
        properties: {
          list_services: { type: 'string', enum: ['running', 'third_party', 'auto_not_running'], description: 'List services instead of (or as well as) looking up named ones' },
          services: { type: 'array', items: { type: 'string' }, description: 'Service names or display names, e.g. ["Spooler", "Windows Update"]' },
          updates: { type: 'array', items: { type: 'string' }, description: 'Update IDs, e.g. ["KB5034441"]' },
          paths: { type: 'array', items: { type: 'string' }, description: 'Local paths, e.g. ["C:\\\\Logs", "%ProgramData%\\\\App"]' },
        },
        required: [],
      },
    },
  },
  triage_log: {
    type: 'function',
    function: {
      name: 'triage_log',
      description: 'Find what matters in a large log file (application, syslog, Windows export). Collapses thousands of lines into distinct message patterns and ranks the rare, severe and bursty ones. ' +
        'Use this first for "what went wrong?" questions about a big log, then read_file or search_files around the line numbers it gives.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path of the log file' },
          top: { type: 'integer', description: 'How many patterns to report (default 10, max 25)' },
        },
        required: ['path'],
      },
    },
  },
  network_config: {
    type: 'function',
    function: {
      name: 'network_config',
      description: 'Analyze a Cisco IOS / IOS-XE style switch or router configuration file with exact, rule-based code. ' +
        'Much more reliable than reading the raw text. Views: summary, interfaces (with optional filter), vlans, routes, acls, services, audit (security/hygiene findings).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path of the configuration file' },
          view: { type: 'string', enum: ['summary', 'interfaces', 'vlans', 'routes', 'acls', 'services', 'audit'], description: 'What to show' },
          filter: { type: 'string', description: 'For the interfaces view, space-separated: vlan=340 mode=trunk|access desc~text name~Gi3/0 shutdown up no-bpduguard no-portfast no-description port-security' },
        },
        required: ['path', 'view'],
      },
    },
  },
  summarize_file: {
    type: 'function',
    function: {
      name: 'summarize_file',
      description: 'Summarize an entire long document (Word, PDF or text) from an approved folder, even if it is far longer than you can read directly.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path of the file' },
          focus: { type: 'string', description: 'Optional: what the user cares about in the document' },
        },
        required: ['path'],
      },
    },
  },
};

const fold = p => (process.platform === 'win32' ? p.toLowerCase() : p);

async function realOrThrow(p) {
  try { return await fsp.realpath(path.resolve(p)); }
  catch { throw new Error(`Path not found: ${p}`); }
}

function create(getFolders) {
  async function allowedRoots() {
    const roots = [];
    for (const f of getFolders()) { try { roots.push(await fsp.realpath(f)); } catch { /* folder gone */ } }
    return roots;
  }

  async function resolveAllowed(p) {
    if (typeof p !== 'string' || !p.trim()) throw new Error('A path is required.');
    const real = await realOrThrow(p);
    const roots = await allowedRoots();
    const ok = roots.some(r => fold(real) === fold(r) || fold(real).startsWith(fold(r) + path.sep));
    if (!ok) throw new Error('Access denied: that path is outside the approved folders. Approved: ' + roots.join('; '));
    return real;
  }

  async function list_directory({ path: p }) {
    const dir = await resolveAllowed(p);
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    const rows = [];
    for (const e of entries.slice(0, 200)) {
      if (e.isDirectory()) rows.push(`[dir]  ${e.name}`);
      else { let size = '?'; try { size = (await fsp.stat(path.join(dir, e.name))).size + ' B'; } catch { /* ignore */ } rows.push(`[file] ${e.name}  (${size})`); }
    }
    return `${dir}\n${rows.join('\n') || '(empty)'}${entries.length > 200 ? `\n… ${entries.length - 200} more entries not shown` : ''}`;
  }

  async function read_file({ path: p, start = 0 }) {
    const file = await resolveAllowed(p);
    const st = await fsp.stat(file);
    if (!st.isFile()) throw new Error('Not a file.');
    if (isDocument(file)) {                               // Word / PDF: extract text, then page through it
      const doc = await extractText(file);
      const begin = Math.max(0, Math.floor(start));
      const slice = doc.text.slice(begin, begin + READ_DEFAULT);
      const more = begin + slice.length < doc.chars;
      return `[${file} · ${doc.kind}${doc.pages ? `, ${doc.pages} pages` : ''} · ${doc.chars} characters${begin ? ` · from offset ${begin}` : ''}` +
        `${more ? ` · truncated, call read_file again with start=${begin + slice.length}, or use summarize_file for the whole document` : ''}]\n${slice}`;
    }
    const fh = await fsp.open(file, 'r');
    try {
      const probe = Buffer.alloc(Math.min(4096, st.size));
      await fh.read(probe, 0, probe.length, 0);
      if (probe.includes(0)) throw new Error('This looks like a binary file; only text files can be read.');
      // Read enough bytes to cover the requested character window (UTF-8: up to 4 bytes/char).
      const begin = Math.max(0, Math.floor(start));
      const buf = Buffer.alloc(Math.min(READ_DEFAULT * 4, Math.max(0, st.size - begin)));
      const { bytesRead } = await fh.read(buf, 0, buf.length, begin);
      let text = buf.subarray(0, bytesRead).toString('utf8');
      const more = text.length > READ_DEFAULT || begin + bytesRead < st.size;
      text = text.slice(0, READ_DEFAULT);
      return `[${file} · ${st.size} bytes${begin ? ` · from offset ${begin}` : ''}${more ? ` · truncated, call read_file again with start=${begin + text.length}` : ''}]\n${text}`;
    } finally { await fh.close(); }
  }

  async function search_files({ query, mode, path: p }) {
    if (!query || !['name', 'content'].includes(mode)) throw new Error('query and mode ("name" or "content") are required.');
    const roots = p ? [await resolveAllowed(p)] : await allowedRoots();
    const q = query.toLowerCase();
    const hits = [];
    let visited = 0;
    const MAX_HITS = 40, MAX_FILES = 20000;

    async function walk(dir, depth) {
      if (hits.length >= MAX_HITS || visited > MAX_FILES || depth > 8) return;
      let entries;
      try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (hits.length >= MAX_HITS || visited > MAX_FILES) return;
        const full = path.join(dir, e.name);
        if (e.isSymbolicLink()) continue;
        if (e.isDirectory()) {
          if (!SKIP_DIRS.has(e.name.toLowerCase())) await walk(full, depth + 1);
          continue;
        }
        visited++;
        if (visited % 300 === 0) await new Promise(r => setImmediate(r));   // keep the app responsive
        if (mode === 'name') {
          if (e.name.toLowerCase().includes(q)) hits.push(full);
        } else {
          let st; try { st = await fsp.stat(full); } catch { continue; }
          if (st.size > 1_000_000) continue;
          try {
            const text = await fsp.readFile(full, 'utf8');
            if (text.includes('\0')) continue;
            const lines = text.split('\n');
            for (let i = 0; i < lines.length && hits.length < MAX_HITS; i++) {
              if (lines[i].toLowerCase().includes(q)) hits.push(`${full}:${i + 1}: ${lines[i].trim().slice(0, 160)}`);
            }
          } catch { /* unreadable */ }
        }
      }
    }
    for (const r of roots) await walk(r, 0);
    return hits.length ? `${hits.join('\n')}${hits.length >= MAX_HITS ? '\n… more matches not shown; narrow the query' : ''}` : `No matches (${visited} files checked).`;
  }

  const impl = { list_directory, read_file, search_files };

  // Returns {ok, text, args} — never throws; errors are handed back to the model as text.
  async function run(name, args) {
    const fn = impl[name];
    if (!fn) return { ok: false, text: `Unknown tool: ${name}` };
    try { return { ok: true, text: await fn(args || {}) }; }
    catch (e) { return { ok: false, text: `Error: ${e.message}` }; }
  }

  return { run, allowedRoots, resolveAllowed };
}

module.exports = { definitions, extraDefinitions, create };
