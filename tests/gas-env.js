// 在 Node 裡模擬 Google 試算表／Apps Script 環境，載入 gas/Code.gs。測試與本機模擬伺服器共用。
const fs = require("fs"), vm = require("vm"), path = require("path");
function makeSheet(name) {
  const sh = {
    name, rows: [], hidden: false, maxCols: 26,
    _cell(r, c) { return (this.rows[r - 1] || [])[c - 1] ?? ""; },
    getName() { return this.name; }, setName(n) { this.name = n; return this; },
    getLastRow() { let n = 0; this.rows.forEach((r, i) => { if (r && r.some(v => v !== "" && v != null)) n = i + 1; }); return n; },
    getLastColumn() { let n = 0; this.rows.forEach(r => (r || []).forEach((v, i) => { if (v !== "" && v != null) n = Math.max(n, i + 1); })); return n; },
    getMaxColumns() { return this.maxCols; }, getMaxRows() { return Math.max(1000, this.rows.length); },
    insertColumnsAfter(_, n) { this.maxCols += n; },
    setFrozenRows() {}, setColumnWidth() {}, clear() { this.rows = []; return this; }, hideSheet() { this.hidden = true; return this; },
    copyTo(ss) { const c = ss.insertSheet(this.name + " copy"); c.rows = JSON.parse(JSON.stringify(this.rows)); return c; },
    getRange(a, b, nr, nc) {
      if (typeof a === "string") { const m = a.match(/^([A-Z])(\d+)(?::([A-Z])(\d+))?$/); const col = ch => ch.charCodeAt(0) - 64;
        a = +m[2]; const c0 = col(m[1]); nr = m[3] ? +m[4] - a + 1 : 1; nc = m[3] ? col(m[3]) - c0 + 1 : 1; b = c0; }
      nr = nr || 1; nc = nc || 1; const self = this, r0 = a, c0 = b;
      const rg = {
        getValues() { const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push(self._cell(r0 + i, c0 + j)); out.push(row); } return out; },
        getDisplayValues() { return rg.getValues().map(r => r.map(v => v == null ? "" : String(v))); },
        getValue() { return self._cell(r0, c0); },
        setValues(v) { v.forEach((row, i) => { const rr = (self.rows[r0 + i - 1] = self.rows[r0 + i - 1] || []); row.forEach((x, j) => { rr[c0 + j - 1] = x; }); }); return rg; },
        clearContent() { for (let i = 0; i < nr; i++) { const rr = self.rows[r0 + i - 1]; if (rr) for (let j = 0; j < nc; j++) rr[c0 + j - 1] = ""; } return rg; },
        setNumberFormat() { return rg; }, setFontWeight() { return rg; }, setFontSize() { return rg; }, setFontFamily() { return rg; }, setBackground() { return rg; },
      };
      return rg;
    },
    getDataRange() { return this.getRange(1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1)); },
  };
  return sh;
}
function makeEnv(opts = {}) {
const ss = {
  sheets: [], id: opts.id || "SS1",
  getId() { return this.id; }, getName() { return "我的方塊日程"; }, getUrl() { return "https://docs.google.com/spreadsheets/d/SS1"; },
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; },
  insertSheet(n) { const s = makeSheet(n); this.sheets.push(s); return s; },
  deleteSheet(s) { this.sheets = this.sheets.filter(x => x !== s); }, getSheets() { return this.sheets.slice(); },
};
const props = opts.props || {};
const triggers = [];
const pad = n => String(n).padStart(2, "0");
let clock = 0;
const ctx = {
  SpreadsheetApp: { getActive: () => ss, flush() {}, getUi: () => ({ alert() {}, prompt() {}, ButtonSet: {}, Button: {}, createMenu() { return { addItem() { return this; }, addSeparator() { return this; }, addToUi() {} }; } }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: k => { delete props[k]; } }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, tryLock() { return true; }, releaseLock() {} }) },
  Utilities: {
    getUuid: () => "0123456789abcdef0123456789abcdef",
    formatDate(d, tz, f) { const t = new Date(d.getTime() + (clock++)); return f.replace("yyyy", t.getFullYear()).replace("MM", pad(t.getMonth() + 1)).replace("dd", pad(t.getDate())).replace("HH", pad(t.getHours())).replace("mm", pad(t.getMinutes())).replace("ss", pad(t.getSeconds())).replace("SSS", String(t.getMilliseconds()).padStart(3, "0")); },
  },
  Session: { getScriptTimeZone: () => "Asia/Taipei" },
  ContentService: { MimeType: { JSON: "json" }, createTextOutput: s => ({ setMimeType() { return { body: s }; } }) },
  ScriptApp: { getProjectTriggers: () => triggers.map(h => ({ getHandlerFunction: () => h })), newTrigger: h => { const b = { timeBased: () => b, everyDays: () => b, everyMinutes: () => b, atHour: () => b, create: () => triggers.push(h) }; return b; } },
  Logger: { log() {} },
  console,
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "gas", "Code.gs"), "utf8") + "\n;this.__api = { doPost, setup, refreshViewsJob, backupDaily, currentToken_ };", ctx);
const api = ctx.__api;
return { api, ss, props, triggers, ctx };
}

module.exports = { makeEnv };
