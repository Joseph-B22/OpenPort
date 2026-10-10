// Cartridges dialog and "cartridge chat" mode: the chat's first message is the saved document block, so the engine
// can reuse the state it saved instead of reading the document again.
const C ={ dlg: $('cart-dlg'), list: $('c-list'), status: $('c-status') };

const cel = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };

async function refreshCarts() {
  const carts = await openport.cart.list();
  C.list.replaceChildren();
  if (!carts.length) C.list.append(cel('div', { className: 'hint', textContent: 'No cartridges yet.' }));
  for (const c of carts) {
    const ask = cel('button', { type: 'button', className: 'primary', textContent: 'Ask about it' });
    const del = cel('button', { type: 'button', className: 'danger', textContent: 'Delete' });
    ask.onclick = () => startCartridgeChat(c);
    del.onclick = async () => { if (confirm(`Delete the cartridge "${c.name}"?`)) { await openport.cart.remove(c.id); refreshCarts(); } };
    C.list.append(cel('div', { className: 'mrow' },
      cel('div', { className: 'info' },
        cel('div', { className: 'name', textContent: c.name }),
        cel('div', { className: 'sub', textContent: `${c.tokens.toLocaleString()} tokens · ${c.mb} MB on disk · ${c.model} · context ${c.ctx.toLocaleString()} · made in ${(c.createMs / 1000).toFixed(1)} s` })),
      ask, del));
  }
}

$('c-create').onclick = async () => {
  C.status.textContent = '';
  const docs = (await openport.docs.pick()).filter(d => !d.error);
  if (!docs.length) return;
  for (const d of docs) {
    C.status.textContent = `Reading ${d.name} into the model…`;
    try { const c = await openport.cart.create({ name: d.name, text: d.text }); C.status.textContent = `Saved "${c.name}": ${c.tokens.toLocaleString()} tokens, ${c.mb} MB.`; }
    catch (e) { C.status.textContent = `Could not make a cartridge from ${d.name}: ${e.message}`; }
  }
  refreshCarts();
};

async function startCartridgeChat(c) {
  C.status.textContent = `Loading "${c.name}"…`;
  try {
    const t0 = performance.now();
    const info = await openport.cart.use(c.id);
    newChat();
    activeCartridge = info;
    C.status.textContent = '';
    C.dlg.close();
    els.messages.innerHTML = '';
    const note = document.createElement('div');
    note.className = 'empty';
    note.innerHTML = '<h1></h1><p></p>';
    note.querySelector('h1').textContent = `📚 ${info.name}`;
    note.querySelector('p').textContent = `Loaded in ${((performance.now() - t0) / 1000).toFixed(1)} s (${info.tokens.toLocaleString()} tokens already read). Ask your question.`;
    els.messages.append(note);
    els.input.focus();
  } catch (e) { C.status.textContent = e.message; }
}

$('open-cart').onclick = async () => { C.status.textContent = ''; await refreshCarts(); C.dlg.showModal(); };
$('c-close').onclick = () => C.dlg.close();
