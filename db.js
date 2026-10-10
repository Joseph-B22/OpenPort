// Chat history + memory vectors, stored in one SQLite file (node:sqlite, built into Electron's Node).
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const crypto = require('crypto');

let db = null;

function open(dataDir) {
  db = new DatabaseSync(path.join(dataDir, 'chats.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,          -- JSON: string or OpenAI-style parts array
      text TEXT NOT NULL DEFAULT '',  -- plain text, used for search
      created INTEGER NOT NULL,
      emb BLOB                        -- normalized Float32 embedding of the Q/A pair (assistant rows)
    );
    CREATE INDEX IF NOT EXISTS idx_msg_chat ON messages(chat_id, id);
    CREATE TABLE IF NOT EXISTS doc_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL, mtime INTEGER NOT NULL, idx INTEGER NOT NULL,
      text TEXT NOT NULL, emb BLOB NOT NULL            -- 256-dim normalized Float32
    );
    CREATE INDEX IF NOT EXISTS idx_chunk_path ON doc_chunks(path);
    CREATE TABLE IF NOT EXISTS screen_moments (        -- screen memory: OCR text only, never images
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, process TEXT, title TEXT,
      text TEXT NOT NULL, hash TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0, emb BLOB   -- 256-dim normalized Float32
    );
    CREATE INDEX IF NOT EXISTS idx_screen_ts ON screen_moments(ts);
    CREATE TABLE IF NOT EXISTS memory_facts (          -- short notes saved from a finished chat ("chose the black Cat6 cable")
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT REFERENCES chats(id) ON DELETE CASCADE,   -- deleting the chat (or retention) deletes its facts too
      text TEXT NOT NULL, created INTEGER NOT NULL,
      state INTEGER NOT NULL DEFAULT 0,                -- 0 active, 1 outdated (kept, never recalled)
      replaced_by INTEGER, emb BLOB
    );
  `);
  // Mistake log: facts this PC proved after the model got a command wrong. It stores what is TRUE here ("Get-ChildItem has no
  // -Recursive; its real parameters are ..."), never a guess about what the model should have written.
  db.exec(`
    CREATE TABLE IF NOT EXISTS cmd_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,                         -- kind|command|token, lower case
      kind TEXT NOT NULL,                               -- 'param' | 'command'
      command TEXT NOT NULL, token TEXT NOT NULL,       -- e.g. Get-ChildItem / -Recursive, or Get-NetAdapterStats / Get-NetAdapterStats
      fact TEXT NOT NULL,                               -- what is true on this PC, in words
      question TEXT, emb BLOB,                          -- the question that led to the mistake (to match later questions)
      first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL,
      count INTEGER NOT NULL DEFAULT 1,                 -- times the model made this mistake
      shown INTEGER NOT NULL DEFAULT 0,                 -- times the fact was put in front of the model
      repeat_after_shown INTEGER NOT NULL DEFAULT 0,    -- times it made the mistake again WITH the fact in its prompt
      model TEXT
    );
  `);
  // Older databases: add the memory state column (0 active, 1 outdated: kept but never recalled, 2 forgotten: vector removed).
  const cols = db.prepare('PRAGMA table_info(messages)').all().map(c => c.name);
  if (!cols.includes('mem_state')) db.exec('ALTER TABLE messages ADD COLUMN mem_state INTEGER NOT NULL DEFAULT 0');
}

const now = () => Date.now();

function createChat(title) {
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO chats (id, title, created, updated) VALUES (?, ?, ?, ?)').run(id, title, now(), now());
  return id;
}

function listChats(query) {
  if (query && query.trim()) {
    const like = `%${query.trim().replace(/[%_]/g, m => '\\' + m)}%`;
    return db.prepare(`
      SELECT DISTINCT c.id, c.title, c.updated FROM chats c
      LEFT JOIN messages m ON m.chat_id = c.id
      WHERE c.title LIKE ? ESCAPE '\\' OR m.text LIKE ? ESCAPE '\\'
      ORDER BY c.updated DESC LIMIT 200`).all(like, like);
  }
  return db.prepare('SELECT id, title, updated FROM chats ORDER BY updated DESC LIMIT 500').all();
}

function getMessages(chatId) {
  return db.prepare('SELECT id, role, content FROM messages WHERE chat_id = ? ORDER BY id').all(chatId)
    .map(r => ({ id: r.id, role: r.role, content: JSON.parse(r.content) }));
}

function addMessage(chatId, role, content, text, embedding) {
  const emb = embedding ? Buffer.from(new Float32Array(embedding).buffer) : null;
  const r = db.prepare('INSERT INTO messages (chat_id, role, content, text, created, emb) VALUES (?, ?, ?, ?, ?, ?)')
    .run(chatId, role, JSON.stringify(content), text || '', now(), emb);
  db.prepare('UPDATE chats SET updated = ? WHERE id = ?').run(now(), chatId);
  return Number(r.lastInsertRowid);
}

function setEmbedding(messageId, embedding) {
  db.prepare('UPDATE messages SET emb = ? WHERE id = ?').run(Buffer.from(new Float32Array(embedding).buffer), messageId);
}

function renameChat(id, title) { db.prepare('UPDATE chats SET title = ? WHERE id = ?').run(title, id); }
function deleteChat(id) { db.prepare('DELETE FROM chats WHERE id = ?').run(id); }
function deleteAll() { db.exec('DELETE FROM memory_facts'); db.exec('DELETE FROM cmd_ledger'); db.exec('DELETE FROM chats'); db.exec('VACUUM'); }

// Brute-force cosine search; vectors are stored normalized so dot product == cosine.
// Fine for tens of thousands of messages (768 floats each).
// Searches saved Q/A pairs and saved facts together. Outdated and forgotten notes are never returned.
// Each hit carries its vector (`vec`) so the caller can spot near-duplicates; strip it before sending to the page.
const toVec = b => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
function searchMemory(queryVec, excludeChatId, topK, minScore) {
  const q = Float32Array.from(queryVec);
  const rows = [
    ...db.prepare(`
      SELECT m.id, m.text, m.emb, m.created, c.id AS chat_id, c.title, 'chat' AS kind FROM messages m
      JOIN chats c ON c.id = m.chat_id WHERE m.emb IS NOT NULL AND m.mem_state = 0 AND c.id != ?`).all(excludeChatId || ''),
    ...db.prepare(`
      SELECT f.id, f.text, f.emb, f.created, f.chat_id, COALESCE(c.title, 'Saved fact') AS title, 'fact' AS kind FROM memory_facts f
      LEFT JOIN chats c ON c.id = f.chat_id WHERE f.emb IS NOT NULL AND f.state = 0 AND COALESCE(f.chat_id, '') != ?`).all(excludeChatId || ''),
  ];
  const scored = [];
  for (const r of rows) {
    const v = toVec(r.emb);
    if (v.length !== q.length) continue;
    let s = 0;
    for (let i = 0; i < v.length; i++) s += v[i] * q[i];
    if (s >= minScore) scored.push({ id: r.id, kind: r.kind, score: s, text: r.text, created: r.created, chatId: r.chat_id, title: r.title, vec: v });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, topK);
}

// ---- memory page ----
// Everything recall can draw on, newest first. `query` filters by plain text.
function memoryList({ query = '', limit = 300 } = {}) {
  const like = `%${String(query).trim().replace(/[%_]/g, m => '\\' + m)}%`;
  const chat = db.prepare(`
    SELECT m.id, m.text, m.created, m.mem_state AS state, c.id AS chat_id, c.title, 'chat' AS kind FROM messages m
    JOIN chats c ON c.id = m.chat_id
    WHERE m.role = 'assistant' AND m.mem_state != 2 AND m.text != '' AND m.text LIKE ? ESCAPE '\\'
    ORDER BY m.created DESC LIMIT ?`).all(like, limit);
  const facts = db.prepare(`
    SELECT f.id, f.text, f.created, f.state, f.chat_id, COALESCE(c.title, 'Saved fact') AS title, 'fact' AS kind, f.replaced_by FROM memory_facts f
    LEFT JOIN chats c ON c.id = f.chat_id WHERE f.text LIKE ? ESCAPE '\\' ORDER BY f.created DESC LIMIT ?`).all(like, limit);
  return [...facts, ...chat].sort((a, b) => b.created - a.created).slice(0, limit);
}

// state: 0 active, 1 outdated, 2 forget (chat notes: the vector and the memory text are removed; the chat itself stays).
function memorySetState(kind, id, state) {
  if (kind === 'fact') {
    if (state === 2) db.prepare('DELETE FROM memory_facts WHERE id = ?').run(id);
    else db.prepare('UPDATE memory_facts SET state = ?, replaced_by = CASE WHEN ? = 0 THEN NULL ELSE replaced_by END WHERE id = ?').run(state, state, id);
  } else if (state === 2) {
    db.prepare("UPDATE messages SET mem_state = 2, emb = NULL, text = '' WHERE id = ? AND role = 'assistant'").run(id);
  } else {
    db.prepare("UPDATE messages SET mem_state = ? WHERE id = ? AND role = 'assistant'").run(state, id);
  }
}

// Saves a fact. An active fact that says nearly the same thing (cosine >= sameTopic) is marked outdated and points at the new one.
function factAdd(chatId, text, emb, { sameTopic = 0.88, now: ts = now() } = {}) {
  const q = emb ? Float32Array.from(emb) : null;
  const replaced = [];
  if (q) {
    for (const r of db.prepare('SELECT id, emb FROM memory_facts WHERE state = 0 AND emb IS NOT NULL').all()) {
      const v = toVec(r.emb);
      if (v.length !== q.length) continue;
      let s = 0;
      for (let i = 0; i < v.length; i++) s += v[i] * q[i];
      if (s >= sameTopic) replaced.push(r.id);
    }
  }
  const id = Number(db.prepare('INSERT INTO memory_facts (chat_id, text, created, emb) VALUES (?, ?, ?, ?)')
    .run(chatId || null, text, ts, q ? Buffer.from(q.buffer) : null).lastInsertRowid);
  for (const old of replaced) db.prepare('UPDATE memory_facts SET state = 1, replaced_by = ? WHERE id = ?').run(id, old);
  return { id, replaced };
}
// ---- mistake log ----
const ledgerKey = (kind, command, token) => `${kind}|${command}|${token}`.toLowerCase();
// Records one caught mistake. wasShown: the fact for this exact mistake was in the prompt when the model made it again.
function ledgerRecord({ kind, command, token, fact, question = null, emb = null, model = null, wasShown = false, now: ts = now() }) {
  const key = ledgerKey(kind, command, token);
  const e = emb ? Buffer.from(new Float32Array(emb).buffer) : null;
  const old = db.prepare('SELECT id FROM cmd_ledger WHERE key = ?').get(key);
  if (old) {
    db.prepare(`UPDATE cmd_ledger SET fact = ?, last_seen = ?, count = count + 1, repeat_after_shown = repeat_after_shown + ?, model = ?,
      question = COALESCE(question, ?), emb = COALESCE(emb, ?) WHERE id = ?`).run(fact, ts, wasShown ? 1 : 0, model, question, e, old.id);
    return { id: old.id, repeat: true };
  }
  const r = db.prepare(`INSERT INTO cmd_ledger (key, kind, command, token, fact, question, emb, first_seen, last_seen, model)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(key, kind, command, token, fact, question, e, ts, ts, model);
  return { id: Number(r.lastInsertRowid), repeat: false };
}
function ledgerAll() {
  return db.prepare('SELECT id, kind, command, token, fact, question, emb, first_seen, last_seen, count, shown, repeat_after_shown, model FROM cmd_ledger ORDER BY last_seen DESC').all()
    .map(r => ({ ...r, emb: r.emb ? toVec(r.emb) : null }));
}
function ledgerMarkShown(ids) { const st = db.prepare('UPDATE cmd_ledger SET shown = shown + 1 WHERE id = ?'); for (const id of ids) st.run(id); }
function ledgerDelete(id) { db.prepare('DELETE FROM cmd_ledger WHERE id = ?').run(id); }
function ledgerClear() { db.exec('DELETE FROM cmd_ledger'); }
function ledgerStats() {
  const r = db.prepare('SELECT COUNT(*) n, COALESCE(SUM(count), 0) caught, COALESCE(SUM(count - 1), 0) repeats, COALESCE(SUM(shown), 0) shown, COALESCE(SUM(repeat_after_shown), 0) after FROM cmd_ledger').get();
  return { entries: r.n, caught: r.caught, repeats: r.repeats, shown: r.shown, repeatsAfterShown: r.after };
}

function factSetEmb(id, emb) { db.prepare('UPDATE memory_facts SET emb = ? WHERE id = ?').run(Buffer.from(new Float32Array(emb).buffer), id); }
function factsWithoutEmbedding(limit = 200) { return db.prepare('SELECT id, text FROM memory_facts WHERE emb IS NULL LIMIT ?').all(limit); }
function chatFacts(chatId) { return db.prepare('SELECT id, text, state FROM memory_facts WHERE chat_id = ? ORDER BY id').all(chatId); }

// ---- folder index (semantic search over approved folders) ----
let chunkCache = null;                                    // decoded vectors, rebuilt after any write
const bust = () => { chunkCache = null; };

function indexPaths() {
  return new Map(db.prepare('SELECT path, MAX(mtime) AS mtime FROM doc_chunks GROUP BY path').all().map(r => [r.path, r.mtime]));
}
function indexReplace(filePath, mtime, chunks) {          // chunks: [{text, emb:number[]}]
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM doc_chunks WHERE path = ?').run(filePath);
    const ins = db.prepare('INSERT INTO doc_chunks (path, mtime, idx, text, emb) VALUES (?, ?, ?, ?, ?)');
    chunks.forEach((c, i) => ins.run(filePath, mtime, i, c.text, Buffer.from(new Float32Array(c.emb).buffer)));
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  bust();
}
function indexDelete(filePath) { db.prepare('DELETE FROM doc_chunks WHERE path = ?').run(filePath); bust(); }
function indexClear() { db.exec('DELETE FROM doc_chunks'); bust(); }
function indexStats() {
  const r = db.prepare('SELECT COUNT(DISTINCT path) AS files, COUNT(*) AS chunks FROM doc_chunks').get();
  return { files: r.files, chunks: r.chunks };
}
function indexSearch(queryVec, roots, topK = 6) {
  if (!chunkCache) {
    chunkCache = db.prepare('SELECT path, idx, text, emb FROM doc_chunks').all()
      .map(r => ({ path: r.path, idx: r.idx, text: r.text, key: r.path.toLowerCase(), vec: new Float32Array(r.emb.buffer.slice(r.emb.byteOffset, r.emb.byteOffset + r.emb.byteLength)) }));
  }
  const q = Float32Array.from(queryVec);
  const lowRoots = roots.map(r => r.toLowerCase());
  const scored = [];
  for (const c of chunkCache) {
    if (c.vec.length !== q.length || !lowRoots.some(r => c.key.startsWith(r))) continue;
    let s = 0;
    for (let i = 0; i < q.length; i++) s += c.vec[i] * q[i];
    scored.push({ score: s, path: c.path, idx: c.idx, text: c.text });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, topK);
}

// ---- screen memory ----
function screenAdd({ ts, process: proc, title, text, hash, pinned = 0 }) {
  return Number(db.prepare('INSERT INTO screen_moments (ts, process, title, text, hash, pinned) VALUES (?, ?, ?, ?, ?, ?)')
    .run(ts, proc || '', title || '', text, hash, pinned ? 1 : 0).lastInsertRowid);
}
function screenSetEmb(id, vec) { db.prepare('UPDATE screen_moments SET emb = ? WHERE id = ?').run(Buffer.from(new Float32Array(vec).buffer), id); }
const screenPending = (limit = 50) => db.prepare('SELECT id, title, text FROM screen_moments WHERE emb IS NULL ORDER BY id DESC LIMIT ?').all(limit);
function screenRows(sinceTs = 0, untilTs = Date.now() + 1, limit = 6000) {
  return db.prepare('SELECT id, ts, process, title, text, pinned, emb FROM screen_moments WHERE ts >= ? AND ts <= ? ORDER BY ts DESC LIMIT ?').all(sinceTs, untilTs, limit)
    .map(r => ({ ...r, vec: r.emb ? new Float32Array(r.emb.buffer.slice(r.emb.byteOffset, r.emb.byteOffset + r.emb.byteLength)) : null, emb: undefined }));
}
function screenPurge(retentionDays, pinnedKeepDays = 90, now = Date.now()) {
  const a = db.prepare('DELETE FROM screen_moments WHERE pinned = 0 AND ts < ?').run(now - retentionDays * 86400000).changes;
  const b = db.prepare('DELETE FROM screen_moments WHERE pinned = 1 AND ts < ?').run(now - pinnedKeepDays * 86400000).changes;
  return Number(a) + Number(b);
}
function screenClear() { db.exec('DELETE FROM screen_moments'); db.exec('VACUUM'); }
function screenStats() {
  const r = db.prepare('SELECT COUNT(*) n, SUM(pinned) pinned, SUM(emb IS NOT NULL) embedded, SUM(LENGTH(text)) bytes, MIN(ts) oldest, MAX(ts) newest FROM screen_moments').get();
  return { count: r.n, pinned: r.pinned || 0, embedded: r.embedded || 0, mb: +((r.bytes || 0) / 1e6).toFixed(2), oldest: r.oldest, newest: r.newest };
}

function clearEmbeddings() { db.exec('UPDATE messages SET emb = NULL'); db.exec('UPDATE memory_facts SET emb = NULL'); }

function messagesWithoutEmbedding(limit = 200) {   // forgotten notes (mem_state 2) are never re-embedded
  return db.prepare("SELECT id, text FROM messages WHERE emb IS NULL AND role = 'assistant' AND mem_state != 2 AND text != '' LIMIT ?").all(limit);
}

function sizeBytes() {
  const { page_count } = db.prepare('PRAGMA page_count').get();
  const { page_size } = db.prepare('PRAGMA page_size').get();
  return page_count * page_size;
}

function stats() {
  const chats = db.prepare('SELECT COUNT(*) n FROM chats').get().n;
  const messages = db.prepare('SELECT COUNT(*) n FROM messages').get().n;
  const embedded = db.prepare('SELECT COUNT(*) n FROM messages WHERE emb IS NOT NULL').get().n;
  const f = db.prepare('SELECT COUNT(*) n, SUM(state = 1) outdated FROM memory_facts').get();
  const outdated = db.prepare('SELECT COUNT(*) n FROM messages WHERE mem_state = 1').get().n;
  return { chats, messages, embedded, facts: f.n, outdated: outdated + (f.outdated || 0), sizeMB: +(sizeBytes() / 1e6).toFixed(1) };
}

// Retention: any limit set to 0 is disabled. Oldest chats go first.
function prune({ maxAgeDays = 0, maxChats = 0, maxSizeMB = 0 }) {
  let removed = 0;
  const del = id => { deleteChat(id); removed++; };
  if (maxAgeDays > 0) {
    const cutoff = now() - maxAgeDays * 86400000;
    for (const r of db.prepare('SELECT id FROM chats WHERE updated < ?').all(cutoff)) del(r.id);
  }
  if (maxChats > 0) {
    for (const r of db.prepare('SELECT id FROM chats ORDER BY updated DESC LIMIT -1 OFFSET ?').all(maxChats)) del(r.id);
  }
  if (maxSizeMB > 0) {
    const limit = maxSizeMB * 1e6;
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    // Deleted pages stay in the file until VACUUM, so measure live data size instead.
    const liveBytes = () => db.prepare('SELECT COALESCE(SUM(LENGTH(content) + LENGTH(text) + COALESCE(LENGTH(emb), 0)), 0) n FROM messages').get().n;
    while (liveBytes() > limit) {
      const oldest = db.prepare('SELECT id FROM chats ORDER BY updated ASC LIMIT 1').get();
      if (!oldest) break;
      del(oldest.id);
    }
  }
  if (removed) { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.exec('VACUUM'); }
  return removed;
}

function close() { try { db?.close(); } catch { /* ignore */ } }

module.exports = {
  open, close, createChat, listChats, getMessages, addMessage, setEmbedding, renameChat, deleteChat,
  deleteAll, searchMemory, ledgerRecord, ledgerAll, ledgerMarkShown, ledgerDelete, ledgerClear, ledgerStats, memoryList, memorySetState, factAdd, factSetEmb, factsWithoutEmbedding, chatFacts, clearEmbeddings, screenAdd, screenSetEmb, screenPending, screenRows, screenPurge, screenClear, screenStats, indexPaths, indexReplace, indexDelete, indexClear, indexStats, indexSearch, messagesWithoutEmbedding, stats, prune,
};
