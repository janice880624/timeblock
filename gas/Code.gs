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
    .addItem('立即更新閱讀用工作表', 'refreshAllViews')
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
  try { ensureViewTrigger_(); } catch (e) { Logger.log('無法建立定時更新：' + e); }
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
      case 'ping': {
        const keys = Object.keys(readIndex_());
        return out_({ ok: true, name: ss.getName(), url: ss.getUrl(), count: keys.length, keys });
      }
      case 'migrateDays': {
        const lock = LockService.getScriptLock(); lock.waitLock(30000);
        let moved = 0;
        try { moved = migrateDays_(); } finally { lock.releaseLock(); }
        return out_({ ok: true, moved });
      }
      case 'getAll': {
        const { map } = readAll_(), docs = {}, vers = {};
        Object.keys(map).forEach(k => { vers[k] = map[k].ver; try { docs[k] = map[k].json ? JSON.parse(map[k].json) : null; } catch (e) { docs[k] = null; } });
        return out_({ ok: true, name: ss.getName(), url: ss.getUrl(), docs, vers });
      }
      case 'vers': {
        const idx = readIndex_(), vers = {};
        Object.keys(idx).forEach(k => vers[k] = idx[k].ver);
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
          queueViews_(Object.keys(res.written));
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
/* 只讀 A、B 欄（key、版本），不讀內容，查版本時很快 */
function readIndex_() {
  const sh = sheet_(), last = sh.getLastRow(), idx = {};
  if (last < 2) return idx;
  sh.getRange(2, 1, last - 1, 2).getDisplayValues().forEach((r, i) => { if (r[0]) idx[String(r[0])] = { row: i + 2, ver: String(r[1] || '') }; });
  return idx;
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

/* ---------- 舊格式（每天一列）轉成每月一列 ---------- */
function migrateDays_() {
  const all = readAll_(), groups = {};
  Object.keys(all.map).forEach(k => {
    if (k.indexOf('day-') !== 0) return;
    const K = k.slice(4), ym = K.slice(0, 7);
    let d = null; try { d = all.map[k].json ? JSON.parse(all.map[k].json) : null; } catch (e) {}
    if (!d) return;
    (groups[ym] = groups[ym] || {})[K] = d;
  });
  const yms = Object.keys(groups);
  if (!yms.length) return 0;
  makeBackup_('格式轉換前 ' + Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HHmm'));
  const docs = {};
  yms.forEach(ym => {
    const key = 'month-' + ym;
    let cur = { days: {} };
    if (all.map[key]) { try { cur = JSON.parse(all.map[key].json) || cur; } catch (e) {} }
    cur.days = cur.days || {};
    Object.keys(groups[ym]).forEach(K => { if (!cur.days[K]) cur.days[K] = groups[ym][K]; });
    docs[key] = cur;
  });
  setMany_(docs, null);
  const sh = sheet_(), last = sh.getLastRow(), cols = sh.getLastColumn();
  const vals = sh.getRange(1, 1, last, cols).getDisplayValues();
  const keep = vals.filter((r, i) => i === 0 || String(r[0]).indexOf('day-') !== 0);
  sh.getRange(1, 1, last, cols).clearContent();
  sh.getRange(1, 1, keep.length, cols).setNumberFormat('@').setValues(keep);
  queueViews_(['main'].concat(Object.keys(docs)));
  return yms.length;
}

/* ---------- 方便閱讀的副本：每 10 分鐘整批更新，不拖慢每次儲存 ---------- */
function ensureViewTrigger_() {
  const has = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'refreshViewsJob');
  if (!has) ScriptApp.newTrigger('refreshViewsJob').timeBased().everyMinutes(10).create();
  PropertiesService.getScriptProperties().setProperty('VIEW_TRIGGER', '1');
}
function queueViews_(keys) {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('VIEW_TRIGGER') !== '1') { refreshViews_(keys); return; }   // 還沒設定定時更新的舊試算表：照舊立即更新
  const cur = JSON.parse(props.getProperty('DIRTY') || '[]');
  keys.forEach(k => { if (cur.indexOf(k) < 0) cur.push(k); });
  props.setProperty('DIRTY', JSON.stringify(cur.slice(-300)));
}
function refreshViewsJob() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    const props = PropertiesService.getScriptProperties();
    const keys = JSON.parse(props.getProperty('DIRTY') || '[]');
    if (!keys.length) return;
    props.deleteProperty('DIRTY');
    refreshViews_(keys);
  } finally { lock.releaseLock(); }
}
function refreshAllViews() {
  refreshViews_(Object.keys(readIndex_()));
  SpreadsheetApp.getUi().alert('已更新「待辦清單」「方塊紀錄」「固定行程」。');
}

/* ---------- 方便閱讀的副本 ---------- */
function refreshViews_(changed) {
  const needMain = changed.some(k => k === 'main' || k.indexOf('archive-') === 0);
  const monthKeys = changed.filter(k => k.indexOf('month-') === 0);
  if (!needMain && !monthKeys.length) return;
  const main = getMany_(['main']).main || { projects: [], tasks: [], recurring: [] };
  const pname = id => { const p = (main.projects || []).find(x => x.id === id); return p ? p.name : ''; };
  if (needMain) {
    const archKeys = Object.keys(readIndex_()).filter(k => k.indexOf('archive-') === 0);
    const arch = getMany_(archKeys), archived = [];
    archKeys.forEach(k => ((arch[k] && arch[k].tasks) || []).forEach(t => archived.push(t)));
    writeTasks_(main, pname, archived); writeRecurring_(main, pname);
  }
  if (monthKeys.length) { writeBlocks_(monthKeys, pname); writeLogs_(monthKeys); }
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
function writeTasks_(main, pname, archived) {
  const header = ['專案', '待辦', '上層待辦', '優先度', '截止日', '預估時間', '完成', '完成時間', '已封存'];
  const sh = view_('待辦清單', header);
  if (sh.getRange(1, 9).getValue() !== '已封存') sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
  const tasks = (main.tasks || []).concat((archived || []).map(t => Object.assign({ _arch: true }, t)));
  const title = id => { const t = tasks.find(x => x.id === id); return t ? t.title : ''; };
  const rows = tasks.map(t => [pname(t.projectId), t.title, t.parentId ? title(t.parentId) : '', PRI_[t.priority] || '中',
    t.due || '', hm_(t.est || 30), t.done ? '✓' : '', t.doneAt ? Utilities.formatDate(new Date(t.doneAt), TZ, 'yyyy-MM-dd HH:mm') : '', t._arch ? '✓' : '']);
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
function writeBlocks_(monthKeys, pname) {
  const header = ['日期', '開始', '結束', '方塊', '專案', '完成'];
  const sh = view_('方塊紀錄', header);
  const yms = monthKeys.map(k => k.slice(6));
  const last = sh.getLastRow();
  let keep = last > 1 ? sh.getRange(2, 1, last - 1, header.length).getDisplayValues() : [];
  keep = keep.filter(r => r[0] && yms.indexOf(String(r[0]).slice(0, 7)) < 0);
  const docs = getMany_(monthKeys);
  monthKeys.forEach(k => {
    const m = docs[k]; if (!m || !m.days) return;
    Object.keys(m.days).sort().forEach(K => {
      const d = m.days[K]; if (!d || !d.blocks) return;
      d.blocks.slice().sort((a, b) => a.start - b.start).forEach(b =>
        keep.push([K, time_(b.start), time_(b.start + b.dur), b.title, pname(b.projectId), b.done ? '✓' : '']));
    });
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
    refreshViews_(vals.slice(1).map(r => String(r[0])).filter(Boolean));
  } finally { lock.releaseLock(); }
  ui.alert('已還原。請重新整理方塊日程網頁。');
}

/* 每日紀錄：心情、體力、睡眠、運動 */
function writeLogs_(monthKeys) {
  const header = ['日期', '心情（1–5）', '心情筆記', '體力（1–5）', '睡眠時數', '運動分鐘', '運動內容'];
  const sh = view_('每日紀錄', header);
  if (sh.getRange(1, 2).getValue() !== header[1] || sh.getRange(1, 5).getValue() !== header[4]) { sh.clear(); sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold'); }
  const yms = monthKeys.map(k => k.slice(6));
  const last = sh.getLastRow();
  let keep = last > 1 ? sh.getRange(2, 1, last - 1, header.length).getDisplayValues() : [];
  keep = keep.filter(r => r[0] && yms.indexOf(String(r[0]).slice(0, 7)) < 0);
  const docs = getMany_(monthKeys);
  monthKeys.forEach(k => {
    const m = docs[k]; if (!m || !m.days) return;
    Object.keys(m.days).sort().forEach(K => {
      const l = m.days[K] && m.days[K].log; if (!l) return;
      keep.push([K, l.mood ? String(l.mood) : '', l.moodNote || '', l.energy ? String(l.energy) : '', l.sleep ? String(Math.round(l.sleep / 6) / 10) : '', l.ex ? String(l.ex) : '', l.exNote || '']);
    });
  });
  keep.sort((a, b) => a[0] < b[0] ? -1 : 1);
  if (last > 1) sh.getRange(2, 1, last - 1, header.length).clearContent();
  if (keep.length) sh.getRange(2, 1, keep.length, header.length).setNumberFormat('@').setValues(keep);
}
