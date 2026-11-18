"use strict";
/* 方塊日程 · 記憶體裡的資料、讀取、封存 */
/* ---------- state ---------- */
let S = { projects: [], tasks: [] };
const days = {}, weeks = {}, archives = {};
const logHasData = l => !!(l && (l.energy || l.mood || l.work || l.ex || (l.exNote && l.exNote.trim()) || (l.moodNote && l.moodNote.trim())));
const dayHasData = d => d && ((d.blocks && d.blocks.length) || (d.rdone && Object.keys(d.rdone).some(x => d.rdone[x])) || logHasData(d.log));
function buildMonth(ym){
  const out = { days: {} };
  Object.keys(days).sort().forEach(K => { if (K.startsWith(ym + "-") && dayHasData(days[K])) out.days[K] = days[K]; });
  return out;
}
/* 一次把需要的月份讀進來（試算表模式），之後的 loadDay 都直接用記憶體裡的 */
const prefetchDays = keys => Store.ensureMonths(keys.map(k => k.slice(0, 7))).catch(() => {});
const ui = Object.assign({ view: "day", hideDone: false, collapsed: {} }, lsGet("blk:ui") || {});
ui.date = todayKey(); ui.weekStart = mondayOf(ui.date); ui.addingSub = null;
let loaded = false;
ui.mf = Object.assign({ status: "open", pri: "all", proj: "all", sort: "due", layout: "list", qImp: "h", qDays: 3 }, ui.mf || {});
if (ui.recOpen == null) ui.recOpen = false;
const saveUI = () => lsSet("blk:ui", { view: ui.view, hideDone: ui.hideDone, collapsed: ui.collapsed, mf: ui.mf, recOpen: ui.recOpen, logOpen: ui.logOpen });
const saveMain = () => Store.save("main", S);
const saveDay = k => Store.save("day-" + k, days[k]);
async function loadDay(k){
  if (days[k]) return days[k];
  let d = null;
  try { d = await Store.load("day-" + k); }
  catch { try { await new Promise(r => setTimeout(r, 700)); d = await Store.load("day-" + k); } catch { return null; } } // never cache a failed read as empty
  if (!days[k]) days[k] = (d && Array.isArray(d.blocks)) ? d : { blocks: [] };
  return days[k];
}
async function loadArchive(y){
  if (archives[y]) return archives[y];
  let d = null; try { d = await Store.load("archive-" + y); } catch { return null; }
  if (!archives[y]) archives[y] = d && Array.isArray(d.tasks) ? d : { tasks: [] };
  return archives[y];
}
/* 完成超過 45 天的待辦（連同小事項）移到 archive-年份，main 就不會越存越大 */
const ARCHIVE_DAYS = 45;
let archiving = false;
async function archiveOld(){
  if (archiving || !loaded) return; archiving = true;
  try {
    const cut = Date.now() - ARCHIVE_DAYS * 864e5, old = t => t && t.done && t.doneAt && t.doneAt < cut;
    const tops = S.tasks.filter(t => !t.parentId && old(t) && S.tasks.filter(c => c.parentId === t.id).every(old));
    if (!tops.length) return;
    const moving = new Set(); tops.forEach(t => { moving.add(t.id); S.tasks.filter(c => c.parentId === t.id).forEach(c => moving.add(c.id)); });
    const byYear = {};
    S.tasks.filter(t => moving.has(t.id)).forEach(t => { const y = new Date(t.doneAt || Date.now()).getFullYear(); (byYear[y] = byYear[y] || []).push(t); });
    for (const y of Object.keys(byYear)) {
      const a = await loadArchive(y); if (!a) return;          // 讀不到封存區就先不要動
      const have = new Set(a.tasks.map(t => t.id));
      byYear[y].forEach(t => { if (!have.has(t.id)) a.tasks.push(clone(t)); });
      Store.save("archive-" + y, a);
    }
    S.archived = S.archived || {};
    S.tasks.filter(t => moving.has(t.id)).forEach(t => { S.archived[t.projectId] = (S.archived[t.projectId] || 0) + 1; });
    S.tasks = S.tasks.filter(t => !moving.has(t.id));
    saveMain(); renderTodo();
  } finally { archiving = false; }
}
async function archivedBetween(t0, t1){
  const ys = [...new Set([new Date(t0).getFullYear(), new Date(t1 - 1).getFullYear()])];
  const out = [];
  for (const y of ys) { const a = await loadArchive(y); if (a) a.tasks.forEach(t => { if (t.done && t.doneAt >= t0 && t.doneAt < t1) out.push(t); }); }
  return out;
}
async function loadWeek(k){
  if (weeks[k]) return weeks[k];
  let d = null; try { d = await Store.load("week-" + k); } catch {}
  if (!weeks[k]) weeks[k] = d || { note: "" };
  return weeks[k];
}
const proj = id => S.projects.find(p => p.id === id);
const task = id => S.tasks.find(t => t.id === id);
const colorOf = pid => (proj(pid) || {}).color || NONE_COLOR;
const blockMin = b => b.dur;
const recs = () => (S.recurring = S.recurring || []);
const rec = id => recs().find(r => r.id === id);
function recFor(k){
  const wd = parseKey(k).getDay(), rd = (days[k] && days[k].rdone) || {};
  return recs().filter(r => r.days.includes(wd) && k >= r.from && (!r.until || k <= r.until) && !(r.skip || []).includes(k))
    .map(r => ({ id: "r:" + r.id, recId: r.id, taskId: null, title: r.title, projectId: r.projectId, start: r.start, dur: r.dur, done: !!rd[r.id] }));
}
const fullDate = k => { const d = parseKey(k); return `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}`; };
const rangeText = r => r.until ? `${shortDate(r.from)}–${shortDate(r.until)}` : `${shortDate(r.from)} 起`;
function dateFields(from, until){
  return `<div class="daterow">
    <label class="fld">開始日期<input type="date" id="mFrom" value="${from}"></label>
    <label class="fld">結束日期<input type="date" id="mUntil" value="${until || ""}"${until ? "" : " disabled"}></label>
  </div>
  <label class="nodate"><input type="checkbox" id="mNoEnd" ${until ? "" : "checked"}> 不設結束日期（一直重複）</label>`;
}
function bindDateFields(){
  $("#mNoEnd").addEventListener("change", e => { const u = $("#mUntil"); u.disabled = e.target.checked; if (!e.target.checked && !u.value) u.value = addDays($("#mFrom").value || todayKey(), 7*16); });
}
function readDates(){
  const from = $("#mFrom").value, until = $("#mNoEnd").checked ? null : ($("#mUntil").value || null);
  if (!from) { toast("請選開始日期"); return null; }
  if (until && until < from) { toast("結束日期不能早於開始日期"); return null; }
  return { from, until };
}
const PRI = { h: { t: "高", o: 0 }, m: { t: "中", o: 1 }, l: { t: "低", o: 2 } };
const priOf = t => PRI[t.priority] ? t.priority : "m";
function dueInfo(t){
  if (!t.due) return null;
  const diff = Math.round((parseKey(t.due) - parseKey(todayKey()))/864e5);
  if (t.done) return { cls: "", label: `${shortDate(t.due)} 截止`, diff };
  if (diff < 0) return { cls: "over", label: `逾期 ${-diff} 天`, diff };
  if (diff === 0) return { cls: "today", label: "今天截止", diff };
  if (diff === 1) return { cls: "soon", label: "明天截止", diff };
  if (diff <= 3) return { cls: "near", label: `${diff} 天後截止`, diff };
  return { cls: "", label: `${shortDate(t.due)} 截止`, diff };
}
const dueBadge = t => { const d = dueInfo(t); return d ? `<span class="due ${d.cls}">${d.label}</span>` : ""; };
const priBadge = t => `<span class="pri p-${priOf(t)}" title="優先度：${PRI[priOf(t)].t}">${PRI[priOf(t)].t}</span>`;
const allBlocks = k => (days[k] ? days[k].blocks : []).concat(recFor(k));
const wdText = ds => { const o = [1,2,3,4,5,6,0].filter(d => ds.includes(d)); return o.length === 7 ? "每天" : o.join() === "1,2,3,4,5" ? "平日" : o.length===2&&o.includes(0)&&o.includes(6) ? "週末" : "週" + o.map(d => WD[d]).join("、"); };
