// Turns a file into plain text: .docx (mammoth), .pdf (unpdf/pdf.js), or any text file.
// Runs entirely locally. Untrusted documents are only parsed for text, never executed.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const MAX_CHARS = 5_000_000;
const MAX_DOC_BYTES = 50 * 1024 * 1024;
const DOC_EXTS = new Set(['.docx', '.pdf']);

const cache = new Map();                                  // small LRU so paged reads don't re-parse
function remember(key, value) {
  cache.set(key, value);
  if (cache.size > 6) cache.delete(cache.keys().next().value);
}

const isDocument = file => DOC_EXTS.has(path.extname(file).toLowerCase());

async function extractText(file) {
  const st = await fsp.stat(file);
  if (!st.isFile()) throw new Error('Not a file.');
  if (st.size > MAX_DOC_BYTES) throw new Error(`File is too large (${(st.size / 1e6).toFixed(0)} MB; limit ${MAX_DOC_BYTES / 1e6} MB).`);
  const key = `${file}|${st.mtimeMs}|${st.size}`;
  if (cache.has(key)) return cache.get(key);

  const ext = path.extname(file).toLowerCase();
  let text, kind, pages = null;

  if (ext === '.docx') {
    const mammoth = require('mammoth');
    text = (await mammoth.extractRawText({ path: file })).value;
    kind = 'docx';
  } else if (ext === '.pdf') {
    const { extractText: pdfText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(await fsp.readFile(file)));
    const res = await pdfText(pdf, { mergePages: false });
    pages = res.text.length;
    text = res.text.map((t, i) => `--- page ${i + 1} ---\n${t.trim()}`).join('\n\n');
    if (res.text.join('').trim().length < 20) throw new Error('No readable text in this PDF (it may be a scanned image).');
    kind = 'pdf';
  } else {
    const buf = await fsp.readFile(file);
    if (buf.subarray(0, 4096).includes(0)) throw new Error('This looks like a binary file; only text, Word (.docx) and PDF files can be read.');
    text = buf.toString('utf8');
    kind = 'text';
  }

  text = text.replace(/\r\n/g, '\n');
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS);
  if (!text.trim()) throw new Error('The file contains no text.');
  const result = { text, kind, pages, chars: text.length };
  remember(key, result);
  return result;
}

module.exports = { extractText, isDocument, DOC_EXTS };
