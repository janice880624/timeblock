/**
 * 方塊日程 · 個人試算表後端（Google Apps Script）
 *
 * 使用方式（每個人做一次）：
 *  1. 建立一份新的 Google 試算表 →「擴充功能」→「Apps Script」，把這個檔案的內容整個貼上並儲存。
 *  2. 在上方選單選 setup → 按「執行」，第一次會要求授權（選自己的帳號 → 進階 → 前往專案 → 允許）。
 *     執行完，試算表會多出「設定」工作表，裡面有你的「連線密碼」。
 *  3. 右上角「部署」→「新增部署作業」→ 類型選「網頁應用程式」
 *       執行身分：我　／　誰可以存取：所有人
 *     按「部署」，複製「網頁應用程式網址」（結尾是 /exec）。
 *  4. 打開方塊日程網頁 →「使用我自己的試算表」，貼上網址與連線密碼。
 *
 * 資料存在「data」工作表（請勿手動修改）。
 * 「待辦清單」「方塊紀錄」「固定行程」是方便閱讀的副本，每次儲存會自動更新，在這裡修改不會同步回網頁。
 */

const DATA = 'data';
const CHUNK = 45000;            // 單一儲存格上限 50,000 字元，留一點空間
const TZ = Session.getScriptTimeZone() || 'Asia/Taipei';

/* ---------- 一次性設定 ---------- */
function setup() {
  const ss = SpreadsheetApp.getActive();
  const props = PropertiesService.getScriptProperties();
  let token = props.getProperty('TOKEN');
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
    props.setProperty('TOKEN', token);
  }
  const data = ss.getSheetByName(DATA) || ss.insertSheet(DATA);
  if (data.getLastRow() === 0) data.getRange(1, 1, 1, 3).setValues([['key', 'updatedAt', 'json（請勿修改）']]);
  data.setFrozenRows(1);

  const st = ss.getSheetByName('設定') || ss.insertSheet('設定', 0);
  st.clear();
  st.getRange('A1:B6').setValues([
    ['方塊日程 · 連線設定', ''],
    ['連線密碼', token],
    ['網頁應用程式網址', '部署後，把 /exec 結尾的網址貼在這裡備忘（非必要）'],
    ['', ''],
    ['說明', '在方塊日程網頁選「使用我自己的試算表」，貼上網址與連線密碼即可。'],
    ['', '想換密碼：清除專案屬性 TOKEN 後再執行一次 setup，網頁上也要重新輸入。'],
  ]);
  st.getRange('A1').setFontWeight('bold').setFontSize(14);
  st.getRange('A2:A3').setFontWeight('bold');
  st.getRange('B2').setFontFamily('Roboto Mono').setFontSize(13).setBackground('#fff8d6');
  st.setColumnWidth(1, 150); st.setColumnWidth(2, 520);
  SpreadsheetApp.flush();
  Logger.log('連線密碼：' + token);
}

/* ---------- 網頁 API ---------- */
function doGet(e) {
  return handle_(e && e.parameter ? e.parameter : {});
}
function doPost(e) {
  let body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) {}
  return handle_(body);
}
function handle_(p) {
  try {
    const token = PropertiesService.getScriptProperties().getProperty('TOKEN');
    if (!token) return out_({ ok: false, error: 'not_setup' });
    if (p.token !== token) return out_({ ok: false, error: 'bad_token' });
    const ss = SpreadsheetApp.getActive();
    switch (p.action) {
      case 'ping':
        return out_({ ok: true, name: ss.getName(), url: ss.getUrl(), count: Object.keys(readAll_().map).length });
      case 'getAll': {
        const { map } = readAll_(), docs = {};
        Object.keys(map).forEach(k => { try { docs[k] = map[k].json ? JSON.parse(map[k].json) : null; } catch (e) { docs[k] = null; } });
        return out_({ ok: true, name: ss.getName(), url: ss.getUrl(), docs });
      }
      case 'getMany':
        return out_({ ok: true, docs: getMany_(Array.isArray(p.keys) ? p.keys : []) });
      case 'list':
        return out_({ ok: true, keys: Object.keys(readAll_().map) });
      case 'setMany': {
        const lock = LockService.getScriptLock();
        lock.waitLock(20000);
        try {
          setMany_(p.docs || {});
          refreshViews_(Object.keys(p.docs || {}));
        } finally { lock.releaseLock(); }
        return out_({ ok: true });
      }
      default:
        return out_({ ok: false, error: 'bad_action' });
    }
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message || err) });
  }
}
function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------- 儲存（每個 key 一列，JSON 分段存在 C 欄之後） ---------- */
function sheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(DATA);
  if (!sh) { setup(); sh = ss.getSheetByName(DATA); }
  return sh;
}
function readAll_() {
  const sh = sheet_(), last = sh.getLastRow(), cols = Math.max(sh.getLastColumn(), 3);
  const map = {};
  if (last < 2) return { sh, map, cols };
  const vals = sh.getRange(2, 1, last - 1, cols).getValues();
  vals.forEach((r, i) => {
    if (!r[0]) return;
    map[String(r[0])] = { row: i + 2, json: r.slice(2).join('') };
  });
  return { sh, map, cols };
}
function getMany_(keys) {
  const { map } = readAll_(), docs = {};
  keys.forEach(k => {
    const hit = map[k];
    if (!hit || !hit.json) { docs[k] = null; return; }
    try { docs[k] = JSON.parse(hit.json); } catch (e) { docs[k] = null; }
  });
  return docs;
}
function setMany_(docs) {
  const all = readAll_(), sh = all.sh;
  let cols = all.cols, nextRow = Math.max(sh.getLastRow(), 1) + 1;
  const now = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
  Object.keys(docs).forEach(k => {
    if (!/^[\w.:@~+\-]{1,120}$/.test(k)) return;            // 只接受預期格式的 key
    const json = docs[k] == null ? '' : JSON.stringify(docs[k]);
    const parts = [];
    for (let i = 0; i < json.length; i += CHUNK) parts.push(json.slice(i, i + CHUNK));
    if (!parts.length) parts.push('');
    const need = 2 + parts.length;
    if (need > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), need - sh.getMaxColumns());
    const hit = all.map[k];
    const row = hit ? hit.row : nextRow++;
    const width = Math.max(need, cols);
    const values = [k, now].concat(parts);
    while (values.length < width) values.push('');
    sh.getRange(row, 1, 1, width).setNumberFormat('@').setValues([values]);
    cols = width;
    all.map[k] = { row, json };
  });
}

/* ---------- 方便閱讀的副本 ---------- */
function refreshViews_(changed) {
  const needMain = changed.indexOf('main') >= 0;
  const dayKeys = changed.filter(k => k.indexOf('day-') === 0);
  if (!needMain && !dayKeys.length) return;
  const main = getMany_(['main']).main || { projects: [], tasks: [], recurring: [] };
  const pname = id => { const p = (main.projects || []).find(x => x.id === id); return p ? p.name : ''; };
  if (needMain) { writeTasks_(main, pname); writeRecurring_(main, pname); }
  if (dayKeys.length) writeBlocks_(dayKeys, pname);
}
function view_(name, header) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold'); sh.setFrozenRows(1); }
  return sh;
}
const PRI_ = { h: '高', m: '中', l: '低' };
const hm_ = m => { m = Number(m) || 0; return m % 60 ? Math.floor(m / 60) + ':' + ('0' + m % 60).slice(-2) : (m / 60) + ':00'; };
const time_ = m => ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + m % 60).slice(-2);
function writeTasks_(main, pname) {
  const header = ['專案', '待辦', '上層待辦', '優先度', '截止日', '預估時間', '完成', '完成時間'];
  const sh = view_('待辦清單', header);
  const tasks = main.tasks || [];
  const title = id => { const t = tasks.find(x => x.id === id); return t ? t.title : ''; };
  const rows = tasks.map(t => [pname(t.projectId), t.title, t.parentId ? title(t.parentId) : '', PRI_[t.priority] || '中',
    t.due || '', hm_(t.est || 30), t.done ? '✓' : '', t.doneAt ? Utilities.formatDate(new Date(t.doneAt), TZ, 'yyyy-MM-dd HH:mm') : '']);
  sh.getRange(2, 1, Math.max(sh.getMaxRows() - 1, 1), header.length).clearContent();
  if (rows.length) sh.getRange(2, 1, rows.length, header.length).setNumberFormat('@').setValues(rows);
}
function writeRecurring_(main, pname) {
  const header = ['名稱', '專案', '星期', '開始', '結束', '開始日期', '結束日期'];
  const sh = view_('固定行程', header);
  const WD = ['日', '一', '二', '三', '四', '五', '六'];
  const rows = (main.recurring || []).map(r => [r.title, pname(r.projectId), (r.days || []).map(d => WD[d]).join('、'),
    time_(r.start), time_(r.start + r.dur), r.from || '', r.until || '']);
  sh.getRange(2, 1, Math.max(sh.getMaxRows() - 1, 1), header.length).clearContent();
  if (rows.length) sh.getRange(2, 1, rows.length, header.length).setNumberFormat('@').setValues(rows);
}
function writeBlocks_(dayKeys, pname) {
  const header = ['日期', '開始', '結束', '方塊', '專案', '完成'];
  const sh = view_('方塊紀錄', header);
  const dates = dayKeys.map(k => k.slice(4));
  const last = sh.getLastRow();
  let keep = last > 1 ? sh.getRange(2, 1, last - 1, header.length).getDisplayValues() : [];
  keep = keep.filter(r => r[0] && dates.indexOf(r[0]) < 0);
  const docs = getMany_(dayKeys);
  dayKeys.forEach(k => {
    const d = docs[k]; if (!d || !d.blocks) return;
    d.blocks.slice().sort((a, b) => a.start - b.start).forEach(b =>
      keep.push([k.slice(4), time_(b.start), time_(b.start + b.dur), b.title, pname(b.projectId), b.done ? '✓' : '']));
  });
  keep.sort((a, b) => (a[0] + a[1]) < (b[0] + b[1]) ? -1 : 1);
  if (last > 1) sh.getRange(2, 1, last - 1, header.length).clearContent();
  if (keep.length) sh.getRange(2, 1, keep.length, header.length).setNumberFormat('@').setValues(keep);
}
