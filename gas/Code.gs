/**
 * 方塊日程 · 個人試算表後端（Google Apps Script）
 *
 * 使用方式（每個人做一次）：
 *  1. 複製範本試算表（或建立新試算表 →「擴充功能」→「Apps Script」，貼上這個檔案）。
 *  2. 試算表上方選單「方塊日程」→「初始設定」，第一次會要求授權。
 *     完成後「設定」工作表會出現你的「連線密碼」。
 *  3. 「擴充功能」→「Apps Script」→「部署」→「新增部署作業」→ 類型選「網頁應用程式」
 *       執行身分：我　／　誰可以存取：所有人
 *     按「部署」，複製「網頁應用程式網址」（結尾是 /exec）。
 *  4. 打開方塊日程網頁 →「連接我的 Google 試算表」，貼上網址與連線密碼。
 *
 * 資料存在「data」工作表（請勿手動修改）。
 * 「待辦清單」「方塊紀錄」「固定行程」是方便閱讀的副本，每次儲存會自動更新，在這裡修改不會同步回網頁。
 */

const DATA = 'data';
const CHUNK = 45000;            // 單一儲存格上限 50,000 字元，留一點空間
const TZ = Session.getScriptTimeZone() || 'Asia/Taipei';

/* ---------- 試算表選單 ---------- */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('方塊日程')
    .addItem('初始設定（產生連線密碼）', 'setupFromMenu')
    .addItem('顯示連線密碼', 'showToken')
    .addSeparator()
    .addItem('立即備份', 'backupNow')
    .addItem('從備份還原…', 'restoreBackup')
    .addSeparator()
    .addItem('重新產生連線密碼', 'resetToken')
    .addToUi();
}
function setupFromMenu() {
  const token = setup();
  SpreadsheetApp.getUi().alert('設定完成',
    '你的連線密碼：' + token + '\n\n下一步：「擴充功能」→「Apps Script」→「部署」→「新增部署作業」→ 網頁應用程式（執行身分：我／誰可以存取：所有人），複製 /exec 結尾的網址，和密碼一起貼到方塊日程網頁。',
    SpreadsheetApp.getUi().ButtonSet.OK);
}
function showToken() {
  const token = currentToken_();
  SpreadsheetApp.getUi().alert(token ? '你的連線密碼：' + token : '還沒有連線密碼，請先執行「初始設定」。');
}
function resetToken() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('重新產生連線密碼？', '舊密碼會失效，所有裝置都要重新輸入新密碼。', ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  PropertiesService.getScriptProperties().deleteProperty('TOKEN');
  const token = setup();
  ui.alert('新的連線密碼：' + token);
}
/* 密碼綁定這份試算表：從範本複製的副本不會沿用範本的密碼 */
function currentToken_() {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('TOKEN'), id = SpreadsheetApp.getActive().getId();
  if (!token) return null;
  const owner = props.getProperty('TOKEN_SS');
  if (!owner) { props.setProperty('TOKEN_SS', id); return token; }   // 舊版設定過的試算表：沿用原本的密碼
  return owner === id ? token : null;
}

/* ---------- 一次性設定 ---------- */
function setup() {
  const ss = SpreadsheetApp.getActive();
  const props = PropertiesService.getScriptProperties();
  let token = currentToken_();
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
    props.setProperty('TOKEN', token);
    props.setProperty('TOKEN_SS', ss.getId());
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
    ['', '想換密碼：上方選單「方塊日程」→「重新產生連線密碼」，網頁上也要重新輸入。'],
  ]);
  st.getRange('A1').setFontWeight('bold').setFontSize(14);
  st.getRange('A2:A3').setFontWeight('bold');
  st.getRange('B2').setFontFamily('Roboto Mono').setFontSize(13).setBackground('#fff8d6');
  st.setColumnWidth(1, 150); st.setColumnWidth(2, 520);
  try { ensureBackupTrigger_(); } catch (e) { Logger.log('無法建立每日備份：' + e); }
  SpreadsheetApp.flush();
  Logger.log('連線密碼：' + token);
  return token;
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
    const token = currentToken_();
    if (!token) return out_({ ok: false, error: 'not_setup' });
    if (p.token !== token) return out_({ ok: false, error: 'bad_token' });
    const ss = SpreadsheetApp.getActive();
    switch (p.action) {
      case 'ping':
        return out_({ ok: true, name: ss.getName(), url: ss.getUrl(), count: Object.keys(readAll_().map).length });
      case 'getAll': {
        const { map } = readAll_(), docs = {}, vers = {};
        Object.keys(map).forEach(k => { vers[k] = map[k].ver; try { docs[k] = map[k].json ? JSON.parse(map[k].json) : null; } catch (e) { docs[k] = null; } });
        return out_({ ok: true, name: ss.getName(), url: ss.getUrl(), docs, vers });
      }
      case 'vers': {
        const { map } = readAll_(), vers = {};
        Object.keys(map).forEach(k => vers[k] = map[k].ver);
        return out_({ ok: true, vers });
      }
      case 'getMany': {
        const keys = Array.isArray(p.keys) ? p.keys : [], { map } = readAll_(), vers = {};
        keys.forEach(k => vers[k] = map[k] ? map[k].ver : null);
        return out_({ ok: true, docs: getMany_(keys), vers });
      }
      case 'list':
        return out_({ ok: true, keys: Object.keys(readAll_().map) });
      case 'setMany': {
        const lock = LockService.getScriptLock();
        lock.waitLock(20000);
        let res;
        try {
          res = setMany_(p.docs || {}, p.base || null);
          refreshViews_(Object.keys(res.written));
        } finally { lock.releaseLock(); }
        return out_({ ok: true, written: res.written, conflicts: res.conflicts });
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
  const vals = sh.getRange(2, 1, last - 1, cols).getDisplayValues();
  vals.forEach((r, i) => {
    if (!r[0]) return;
    map[String(r[0])] = { row: i + 2, ver: String(r[1] || ''), json: r.slice(2).join('') };
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
/* base[k]＝網頁上次讀到的版本；和試算表現在的版本不同，代表別的裝置先改過，交回網頁合併 */
function setMany_(docs, base) {
  const all = readAll_(), sh = all.sh, written = {}, conflicts = {};
  let cols = all.cols, nextRow = Math.max(sh.getLastRow(), 1) + 1;
  const now = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss.SSS');
  Object.keys(docs).forEach(k => {
    if (!/^[\w.:@~+\-]{1,120}$/.test(k)) return;            // 只接受預期格式的 key
    const cur = all.map[k];
    if (base && Object.prototype.hasOwnProperty.call(base, k)) {
      const known = base[k] == null ? null : String(base[k]);
      if ((cur ? cur.ver : null) !== known && cur) {
        let doc = null; try { doc = cur.json ? JSON.parse(cur.json) : null; } catch (e) {}
        conflicts[k] = { ver: cur.ver, doc };
        return;
      }
    }
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
    all.map[k] = { row, ver: now, json };
    written[k] = now;
  });
  return { written, conflicts };
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

/* ---------- 每日自動備份（保留 7 天） ---------- */
const BACKUP_PREFIX = '備份 ';
function ensureBackupTrigger_() {
  const has = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'backupDaily');
  if (!has) ScriptApp.newTrigger('backupDaily').timeBased().everyDays(1).atHour(3).create();
}
function backupDaily() { makeBackup_(Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd')); }
function backupNow() {
  const name = makeBackup_(Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HHmm'));
  SpreadsheetApp.getUi().alert('已備份到隱藏工作表「' + name + '」。');
}
function makeBackup_(stamp) {
  const ss = SpreadsheetApp.getActive(), src = ss.getSheetByName(DATA);
  if (!src) return '';
  const name = BACKUP_PREFIX + stamp;
  const old = ss.getSheetByName(name); if (old) ss.deleteSheet(old);
  const copy = src.copyTo(ss).setName(name);
  copy.hideSheet();
  const backs = ss.getSheets().filter(x => x.getName().indexOf(BACKUP_PREFIX) === 0)
    .sort((a, b) => a.getName() < b.getName() ? 1 : -1);
  backs.slice(10).forEach(x => ss.deleteSheet(x));          // 每日 7 份＋手動備份，最多留 10 份
  return name;
}
function restoreBackup() {
  const ui = SpreadsheetApp.getUi(), ss = SpreadsheetApp.getActive();
  const backs = ss.getSheets().map(x => x.getName()).filter(n => n.indexOf(BACKUP_PREFIX) === 0).sort().reverse();
  if (!backs.length) { ui.alert('還沒有任何備份。'); return; }
  const res = ui.prompt('從備份還原', '輸入要還原的備份日期（直接複製下面其中一個）：\n\n' + backs.map(n => n.slice(BACKUP_PREFIX.length)).join('\n'), ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const name = BACKUP_PREFIX + res.getResponseText().trim(), src = ss.getSheetByName(name);
  if (!src) { ui.alert('找不到「' + name + '」。'); return; }
  if (ui.alert('確定要還原「' + name + '」？', '目前的資料會先自動備份成「還原前」，再被備份內容取代。', ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    makeBackup_('還原前 ' + Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HHmm'));
    const vals = src.getDataRange().getDisplayValues();
    const now = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss.SSS');
    for (let i = 1; i < vals.length; i++) if (vals[i][0]) vals[i][1] = now;   // 換新版本號，讓所有裝置重新讀取
    const data = sheet_();
    data.clearContents();
    if (data.getMaxColumns() < vals[0].length) data.insertColumnsAfter(data.getMaxColumns(), vals[0].length - data.getMaxColumns());
    data.getRange(1, 1, vals.length, vals[0].length).setNumberFormat('@').setValues(vals);
    refreshViews_(['main'].concat(vals.slice(1).map(r => r[0]).filter(k => String(k).indexOf('day-') === 0)));
  } finally { lock.releaseLock(); }
  ui.alert('已還原。請重新整理方塊日程網頁。');
}
