// 在 Node.js 模擬 Google Apps Script 執行環境，用來測試 gas/Code.gs。
// 每個 request 都在全新的 vm context 執行（就像 GAS 每次請求都是新的執行），
// 但試算表、快取、指令碼屬性是共用的。
const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');
const path = require('path');

function coerce(v) {
  // 模擬試算表：'開頭 → 純文字；看起來像數字的字串 → 數字
  if (typeof v === 'string') {
    if (v.startsWith("'")) return v.slice(1);
    if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  }
  return v;
}

class Sheet {
  constructor(name) { this.name = name; this.data = []; }
  getName() { return this.name; }
  width() { return this.data.reduce((m, r) => Math.max(m, r.length), 0); }
  appendRow(row) { this.data.push(row.map(coerce)); }
  setFrozenRows() {}
  getLastRow() {
    for (let i = this.data.length - 1; i >= 0; i--) if (this.data[i].some(v => v !== '' && v != null)) return i + 1;
    return 0;
  }
  getLastColumn() { return this.width(); }
  getDataRange() { return this.getRange(1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.width())); }
  getRange(r, c, nr = 1, nc = 1) {
    const sh = this;
    const ensure = () => { while (sh.data.length < r + nr - 1) sh.data.push([]); };
    return {
      getValues() {
        const out = [];
        for (let i = 0; i < nr; i++) {
          const row = sh.data[r - 1 + i] || [];
          const o = [];
          for (let j = 0; j < nc; j++) o.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]);
          out.push(o);
        }
        return out;
      },
      setValues(vals) {
        if (vals.length !== nr || vals.some(v => v.length !== nc)) throw new Error(`setValues 尺寸不符 ${vals.length}x${vals[0] && vals[0].length} vs ${nr}x${nc}`);
        ensure();
        vals.forEach((row, i) => row.forEach((v, j) => { sh.data[r - 1 + i][c - 1 + j] = coerce(v); }));
      },
      setValue(v) { ensure(); sh.data[r - 1][c - 1] = coerce(v); },
      clearContent() { ensure(); for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) sh.data[r - 1 + i][c - 1 + j] = ''; },
    };
  }
  deleteRows(start, n) { this.data.splice(start - 1, n); }
  deleteRow(r) { this.data.splice(r - 1, 1); }
}

class Spreadsheet {
  constructor(id) { this.id = id; this.sheets = {}; }
  getSheetByName(n) { return this.sheets[n] || null; }
  getSheets() { return Object.values(this.sheets); }
  insertSheet(n) { return (this.sheets[n] = new Sheet(n)); }
  getId() { return this.id; }
  getName() { return 'mock'; }
}

function createEnv() {
  const env = {
    ss: new Spreadsheet('active'),
    hub: new Spreadsheet('HUB_ID'),
    cache: new Map(),
    props: {},
    propReads: 0,
  };
  const users = env.hub.insertSheet('Users');
  users.data.push(['passCode', 'name', 'x', 'x', 'tier', 'quota', 'status', 'expire']);
  return env;
}

function services(env) {
  return {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => env.ss,
      openById: id => { if (id === env.hub.id) return env.hub; if (env.others && env.others[id]) return env.others[id]; throw new Error('not found'); },
      flush() {},
    },
    CacheService: { getScriptCache: () => ({
      get: k => (env.cache.has(k) ? env.cache.get(k) : null),
      put: (k, v) => { if (String(v).length > 100000) throw new Error('cache value too large'); env.cache.set(k, String(v)); },
      remove: k => env.cache.delete(k),
    }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({
      getProperties: () => { env.propReads++; return Object.assign({}, env.props); },
      getProperty: k => { env.propReads++; return env.props[k] == null ? null : env.props[k]; },
      setProperty: (k, v) => { env.props[k] = v; },
    }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, s) => Array.from(crypto.createHash(alg).update(s, 'utf8').digest()),
      base64EncodeWebSafe: bytes => Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      formatDate: (d, tz, f) => d.toISOString().slice(0, f.length > 10 ? 19 : 10).replace('T', ' '),
      getUuid: () => crypto.randomUUID(),
    },
    Session: { getScriptTimeZone: () => 'Asia/Taipei' },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: s => ({ content: s, setMimeType() { return this; } }),
    },
    DriveApp: {},
    console: { log() {}, error() {} },
    JSON, Math, Date, String, Number, Object, Array, Set, isNaN, Error,
  };
}

const CODE = fs.readFileSync(process.env.GAS_FILE || path.join(__dirname, '..', 'gas', 'Code.gs'), 'utf8');

function run(env, fnName, arg) {
  const ctx = vm.createContext(services(env));
  vm.runInContext(CODE + `\n;globalThis.__out = ${fnName}(__arg);`, Object.assign(ctx, { __arg: arg }));
  const out = ctx.__out;
  return out && out.content ? JSON.parse(out.content) : out;
}
const post = (env, body) => run(env, 'doPost', { postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } });
const get = (env, params) => run(env, 'doGet', { parameter: params });

module.exports = { createEnv, run, post, get, Spreadsheet };
