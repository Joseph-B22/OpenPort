const { contextBridge, ipcRenderer, webUtils } = require('electron');

const call = channel => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('openport', {
  getConfig: call('config:get'),
  setConfig: call('config:set'),
  systemInfo: call('system:info'),
  listModels: call('models:list'),
  getState: call('engine:state'),
  startEngine: call('engine:start'),
  stopEngine: call('engine:stop'),
  tokenize: call('engine:tokenize'),
  onState: cb => ipcRenderer.on('engine:state', (_e, s) => cb(s)),

  screenmem: {
    status: call('screenmem:status'),
    pause: call('screenmem:pause'),
    remember: call('screenmem:remember'),
    clear: call('screenmem:clear'),
    search: call('screenmem:search'),
    readScreen: call('screen:ocr'),
    onState: cb => ipcRenderer.on('screenmem:state', (_e, s) => cb(s)),
  },
  cart: {
    list: call('cart:list'),
    create: call('cart:create'),
    use: call('cart:use'),
    remove: call('cart:delete'),
  },
  evals: {
    cases: call('evals:cases'),
    saveCases: call('evals:saveCases'),
    runs: call('evals:runs'),
    deleteRun: call('evals:deleteRun'),
    start: call('evals:start'),
    cancel: call('evals:cancel'),
    onProgress: cb => ipcRenderer.on('evals:progress', (_e, p) => cb(p)),
  },
  tools: {
    list: call('tools:list'),
    run: call('tools:run'),
    pickFolder: call('tools:pickFolder'),
  },
  captureScreen: call('screen:capture'),
  ctx: {
    sync: call('ctx:sync'),
    recall: call('ctx:recall'),
  },
  docs: {
    pick: call('docs:pick'),
    load: call('docs:load'),
    summarize: call('docs:summarize'),
    pathFor: file => webUtils.getPathForFile(file),
  },
  index: {
    status: call('index:status'),
    build: call('index:build'),
    cancel: call('index:cancel'),
    clear: call('index:clear'),
    onProgress: cb => ipcRenderer.on('index:progress', (_e, p) => cb(p)),
  },
  audit: {
    recent: call('audit:recent'),
    reveal: call('audit:reveal'),
  },
  models: {
    all: call('models:all'),
    catalog: call('models:catalog'),
    remove: call('models:delete'),
    importFiles: call('models:import'),
    hfSearch: call('hf:search'),
    hfFiles: call('hf:files'),
    hfDownload: call('hf:download'),
    hfCancel: call('hf:cancel'),
    onProgress: cb => ipcRenderer.on('models:progress', (_e, p) => cb(p)),
  },
  chats: {
    list: call('chats:list'),
    get: call('chats:get'),
    create: call('chats:create'),
    rename: call('chats:rename'),
    remove: call('chats:delete'),
    removeAll: call('chats:deleteAll'),
    stats: call('chats:stats'),
    prune: call('chats:prune'),
    append: call('chats:append'),
  },
  memory: {
    status: call('memory:status'),
    search: call('memory:search'),
    list: call('memory:list'),
    setState: call('memory:setState'),
    chatFacts: call('memory:chatFacts'),
    saveFacts: call('memory:saveFacts'),
  },
  cmdcheck: {
    check: call('cmdcheck:check'),
  },
  stats: {
    get: call('stats:get'),
  },
  claims: {
    probe: call('claims:probe'),
  },
  ledger: {
    relevant: call('ledger:relevant'),
    list: call('ledger:list'),
    remove: call('ledger:delete'),
    clear: call('ledger:clear'),
  },
});
