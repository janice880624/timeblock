"use strict";
/* 方塊日程 · 編輯視窗、復原 */
/* ---------- modals ---------- */
function openModal(html){ $("#sheet").innerHTML = html; $("#modal").classList.remove("hidden"); const f = $("#sheet").querySelector("input[type=text]"); if (f && !isTouch()) f.focus(); }
function closeModal(){ $("#modal").classList.add("hidden"); $("#sheet").innerHTML = ""; }
const isTouch = () => matchMedia("(pointer:coarse)").matches;
$("#modal").addEventListener("click", e => { if (e.target.id === "modal") closeModal(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#modal").classList.contains("hidden")) closeModal(); });
const projOptions = sel => `<option value="">（不屬於專案）</option>` + S.projects.map(p => `<option value="${p.id}" ${p.id===sel?"selected":""}>${esc(p.name)}</option>`).join("");
let undoTimer;
/* 刪除前先記下受影響的資料，7 秒內可以按「復原」 */
function withUndo(msg, keys, fn){
  const snap = keys.map(k => [k, clone(Store.docOf(k))]);
  fn();
  const bar = $("#undoBar");
  bar.querySelector("span").textContent = msg; bar.classList.add("show");
  clearTimeout(undoTimer); undoTimer = setTimeout(() => bar.classList.remove("show"), 7000);
  bar.querySelector("button").onclick = () => {
    snap.forEach(([k, d]) => { if (d) { Store.applyDoc(k, clone(d)); Store.save(k, Store.docOf(k)); } });
    bar.classList.remove("show"); clearTimeout(undoTimer); closeModal(); renderAll(); if (ui.view === "habit") renderHabit();
    toast("已復原");
  };
}
function confirmBtn(btn, label, fn){
  btn.addEventListener("click", () => { if (btn.dataset.arm) fn(); else { btn.dataset.arm = 1; btn.textContent = label; setTimeout(() => { if (btn.isConnected) { delete btn.dataset.arm; btn.textContent = "刪除"; } }, 3000); } });
}

function wdPicker(sel){
  return `<div class="wds" id="mWds">${[1,2,3,4,5,6,0].map(d => `<button type="button" class="wd ${sel.includes(d)?"on":""}" data-d="${d}">${WD[d]}</button>`).join("")}</div>
  <div class="wd-quick"><button type="button" data-q="1,2,3,4,5">平日</button><button type="button" data-q="0,1,2,3,4,5,6">每天</button><button type="button" data-q="">清除</button></div>`;
}
function bindWdPicker(){
  const box = $("#mWds");
  box.addEventListener("click", e => { const w = e.target.closest(".wd"); if (w) w.classList.toggle("on"); });
  box.nextElementSibling.addEventListener("click", e => { const q = e.target.closest("[data-q]"); if (!q) return; const set = q.dataset.q ? q.dataset.q.split(",").map(Number) : []; box.querySelectorAll(".wd").forEach(w => w.classList.toggle("on", set.includes(+w.dataset.d))); });
}
const pickedDays = () => [...document.querySelectorAll("#mWds .wd.on")].map(w => +w.dataset.d);
function durInputs(id, mins){
  const h = Math.floor(mins/60), m = mins % 60;
  return `<div class="durin"><input type="number" id="${id}H" min="0" max="18" value="${h}" inputmode="numeric" aria-label="小時"> 小時 <input type="number" id="${id}M" min="0" max="59" step="5" value="${m}" inputmode="numeric" aria-label="分鐘"> 分</div>
    <div class="durq" data-for="${id}">${[15,30,45,60,90,120,180].map(x => `<button type="button" data-m="${x}">${hm(x)}</button>`).join("")}</div>`;
}
function readDurOf(id){
  const h = parseInt($("#"+id+"H").value, 10) || 0, m = parseInt($("#"+id+"M").value, 10) || 0;
  return clamp(h*60 + m, 5, 18*60);
}
document.addEventListener("click", e => {
  const b = e.target.closest(".durq button"); if (!b) return;
  const id = b.parentElement.dataset.for, x = +b.dataset.m;
  if (id === "end") { const en = Math.min(readStart() + x, END); $("#mEnd").value = fmt(en % 1440); keepDur = en - readStart(); updDurTxt(); return; }
  $("#"+id+"H").value = Math.floor(x/60); $("#"+id+"M").value = x % 60;
});
let keepDur = 60;
function timeFields(start, dur){
  const end = Math.min(start + dur, END);
  keepDur = Math.max(end - start, 5);
  return `<div class="two">
      <label class="fld">開始<input type="time" id="mStart" value="${fmt(start)}" step="300"></label>
      <label class="fld">結束<input type="time" id="mEnd" value="${fmt(end % 1440)}" step="300"></label>
    </div>
    <div class="durline"><span id="mDurTxt">共 ${hm(end - start)}</span><span class="durq" data-for="end">${[15,30,45,60,90,120,180].map(x => `<button type="button" data-m="${x}">${hm(x)}</button>`).join("")}</span></div>`;
}
const parseHM = v => { const p = (v || "").split(":").map(Number); return p.length < 2 || isNaN(p[0]) || isNaN(p[1]) ? null : p[0]*60 + p[1]; };
function readStart(){ const m = parseHM($("#mStart").value); return m == null ? 9*60 : clamp(m, START, END - 5); }
function readEnd(){ let m = parseHM($("#mEnd").value); if (m == null) return null; if (m === 0) m = 1440; return m; }
function readDur(){ const e = readEnd(); return e == null ? 0 : e - readStart(); }
function timeOk(){
  if (readDur() < 5) { toast("結束時間要晚於開始時間"); return false; }
  const m = parseHM($("#mStart").value); if (m != null && m < START) toast("時間軸從 06:00 開始，已調整為 06:00");
  return true;
}
function updDurTxt(){ const el = $("#mDurTxt"); if (!el) return; const d = readDur(); el.textContent = d >= 5 ? `共 ${hm(d)}` : "結束要晚於開始"; el.classList.toggle("bad", d < 5); }
document.addEventListener("input", e => {
  if (e.target.id === "mStart") {           // moving the start keeps the length
    const st = parseHM(e.target.value); if (st == null) return;
    const en = Math.min(st + keepDur, END); $("#mEnd").value = fmt(en % 1440); updDurTxt();
  } else if (e.target.id === "mEnd") { updDurTxt(); keepDur = Math.max(readDur(), 5); }
});
function newRecurring(){
  const b = { id: uid(), taskId: null, projectId: null, title: "", start: 9*60, dur: 120, done: false };
  editBlock(b, true, []);
}
function editRecurring(r, k, seriesOnly){
  const occ = !seriesOnly && recFor(k).find(x => x.recId === r.id);
  openModal(`<h3>${seriesOnly ? "固定行程" : "固定行程 · " + shortDate(k)}</h3>
    <label class="fld">名稱<input type="text" id="mTitle" value="${esc(r.title)}" maxlength="80"></label>
    <label class="fld">專案<select id="mProj">${projOptions(r.projectId)}</select></label>
    ${timeFields(r.start, r.dur)}
    <div class="fld">每週重複${wdPicker(r.days)}${dateFields(r.from, r.until)}</div>
    ${occ ? `<label class="fld" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="mDone" ${occ.done?"checked":""}> 這次已完成</label>` : ""}
    <div class="choice">
      ${occ ? `<button class="btn ghost" id="mOnce">只改這一次</button>` : ""}
      <button class="btn" id="mSeries">${seriesOnly ? "儲存" : "套用到之後每一次"}</button>
    </div>
    <div class="acts" style="margin-top:12px">
      <span style="display:flex;gap:8px">${occ ? `<button class="btn danger sm" id="mSkip">這次取消</button>` : ""}<button class="btn danger sm" id="mDelRec">刪除</button></span>
      <button class="btn ghost sm" id="mCancel">關閉</button>
    </div>`);
  bindWdPicker(); bindDateFields();
  $("#mCancel").onclick = closeModal;
  const vals = () => ({ title: $("#mTitle").value.trim() || r.title, projectId: $("#mProj").value || null, start: readStart(), dur: Math.min(readDur(), END - readStart()) });
  if (occ) {
    $("#mOnce").onclick = () => { if (!timeOk()) return; detachOccurrence(k, occ, Object.assign(vals(), { done: $("#mDone").checked })); closeModal(); renderDay(); };
    $("#mSkip").onclick = () => withUndo("這次已取消，其他週照常", ["main"], () => { r.skip = (r.skip || []).concat(k); saveMain(); closeModal(); renderDay(); });
  }
  $("#mSeries").onclick = () => {
    if (!timeOk()) return;
    const v = vals(), ds = pickedDays(), dt = readDates();
    if (!ds.length) { toast("至少選一個星期"); return; }
    if (!dt) return;
    const at = seriesOnly ? todayKey() : k;
    if (occ) { const d = days[k]; d.rdone = Object.assign({}, d.rdone, { [r.id]: $("#mDone").checked }); saveDay(k); }
    const changed = v.title !== r.title || v.projectId !== r.projectId || v.start !== r.start || v.dur !== r.dur || ds.join() !== r.days.join();
    if (!changed || r.from >= at || dt.from >= at) {
      // only the dates changed, or the series hasn't started yet: edit in place
      Object.assign(r, v, { days: ds, from: dt.from, until: dt.until });
    } else {
      // keep past weeks as they were, new settings apply from this date on
      r.until = addDays(at, -1);
      if (dt.until && dt.until < at) r.until = dt.until;
      else {
        const nr = Object.assign({ id: uid(), skip: (r.skip||[]).filter(x => x >= at) }, v, { days: ds, from: at, until: dt.until });
        recs().push(nr);
        if (occ) { const d = days[k]; d.rdone = Object.assign({}, d.rdone, { [nr.id]: $("#mDone").checked }); saveDay(k); }
      }
    }
    saveMain(); closeModal(); renderDay(); renderTodo(); if (ui.view === "month") renderMonth(); if (ui.view === "habit") renderHabit();
    toast(dt.until ? `固定行程已更新（到 ${fullDate(dt.until)}）` : "固定行程已更新");
  };
  $("#mDelRec").onclick = () => {
    const at = seriesOnly ? todayKey() : k, canStop = r.from < at;
    const box = document.createElement("div"); box.className = "delbox";
    box.innerHTML = `<p>要怎麼刪除「${esc(r.title)}」？</p>
      <button class="btn danger" id="mDelAll">完全刪除（連過去的紀錄一起刪）</button>
      ${canStop ? `<button class="btn ghost" id="mDelFrom">從 ${shortDate(at)} 起停止，保留之前的紀錄</button>` : ""}
      <button class="btn ghost" id="mDelBack">返回</button>`;
    const acts = $("#sheet .acts"); acts.replaceWith(box);
    const done = () => { saveMain(); closeModal(); renderDay(); renderTodo(); if (ui.view === "month") renderMonth(); if (ui.view === "habit") renderHabit(); };
    $("#mDelAll").onclick = () => withUndo(`已刪除「${r.title}」`, ["main"], () => { S.recurring = recs().filter(x => x.id !== r.id); done(); });
    if (canStop) $("#mDelFrom").onclick = () => withUndo(`「${r.title}」從 ${shortDate(at)} 起停止`, ["main"], () => { r.until = addDays(at, -1); done(); });
    $("#mDelBack").onclick = () => { box.replaceWith(acts); };
  };
}
function editBlock(b, isNew, preDays){
  const k = ui.date, t = b.taskId && task(b.taskId);
  if (b.recId) { const r = rec(b.recId); if (r) editRecurring(r, k, false); return; }
  openModal(`<h3>${preDays ? "新增固定行程" : isNew ? "新增方塊" : "編輯方塊"}</h3>
    <label class="fld">名稱<input type="text" id="mTitle" value="${esc(b.title)}" maxlength="80"></label>
    <label class="fld">專案<select id="mProj">${projOptions(b.projectId)}</select></label>
    ${timeFields(b.start, b.dur)}
    ${t ? "" : `<div class="fld">每週重複（上課、固定會議等）${wdPicker(preDays || [])}<div id="mRange" class="${preDays ? "" : "hidden"}">${dateFields(k, null)}</div></div>`}
    ${t ? `<p class="fld">連結待辦：${esc(t.title)}（完成方塊會同步勾選）</p>` : ""}
    <label class="fld" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="mDone" ${b.done?"checked":""}> 已完成</label>
    <div class="acts">${isNew ? "<span></span>" : `<button class="btn danger" id="mDel">刪除</button>`}<span style="display:flex;gap:8px"><button class="btn ghost" id="mCancel">取消</button><button class="btn" id="mSave">儲存</button></span></div>`);
  if (isNew) $("#mTitle").select();
  if (!t) {
    bindWdPicker(); bindDateFields();
    const showRange = () => $("#mRange").classList.toggle("hidden", !preDays && !pickedDays().length);
    $("#mWds").addEventListener("click", () => setTimeout(showRange));
    $("#mWds").nextElementSibling.addEventListener("click", () => setTimeout(showRange));
  }
  $("#mCancel").onclick = closeModal;
  if (!isNew) $("#mDel").onclick = () => withUndo(`已刪除「${b.title}」`, ["day-" + k], () => { days[k].blocks = days[k].blocks.filter(x => x.id !== b.id); saveDay(k); closeModal(); renderDay(); renderTodo(); });
  $("#mSave").onclick = () => {
    if (!timeOk()) return;
    const ds = t ? [] : pickedDays();
    if (preDays && !ds.length) { toast("請選擇每週哪幾天"); return; }
    if (ds.length) {
      const st = readStart(), dt = readDates(); if (!dt) return;
      recs().push({ id: uid(), title: $("#mTitle").value.trim() || "固定行程", projectId: $("#mProj").value || null, start: st, dur: Math.min(readDur(), END - st), days: ds, from: dt.from, until: dt.until, skip: [] });
      if (!isNew) { days[k].blocks = days[k].blocks.filter(x => x.id !== b.id); saveDay(k); }
      saveMain(); closeModal(); renderDay(); renderTodo(); if (ui.view === "month") renderMonth(); toast(`已設為${wdText(ds)}固定行程（${fullDate(dt.from)} 起）`);
      return;
    }
    b.title = $("#mTitle").value.trim() || "未命名方塊";
    b.projectId = $("#mProj").value || null;
    b.start = readStart(); b.dur = Math.min(readDur(), END - b.start);
    const wasDone = b.done; b.done = $("#mDone").checked;
    if (isNew) days[k].blocks.push(b);
    saveDay(k); closeModal();
    if (t && wasDone !== b.done) setTaskDone(t, b.done);
    renderDay(); renderTodo();
  };
}
function editTask(id){
  const t = task(id), subs = S.tasks.filter(s => s.parentId === id);
  openModal(`<h3>編輯待辦</h3>
    <label class="fld">名稱<input type="text" id="mTitle" value="${esc(t.title)}" maxlength="80"></label>
    <div class="two">
      <label class="fld">專案<select id="mProj">${S.projects.map(p => `<option value="${p.id}" ${p.id===t.projectId?"selected":""}>${esc(p.name)}</option>`).join("")}</select></label>
      <div class="fld">預估時間${durInputs("mEst", t.est||30)}</div>
    </div>
    <div class="fld">優先度<div class="seg" id="mPri">${["h","m","l"].map(p => `<button type="button" data-p="${p}" class="${p===priOf(t)?"on":""}">${PRI[p].t}</button>`).join("")}</div></div>
    <div class="fld">四象限<div class="seg qseg" id="mQuad">${[["", "自動"], ["q1", "重要緊急"], ["q2", "重要不急"], ["q3", "緊急不重要"], ["q4", "都不"]].map(([q, l]) => `<button type="button" data-q="${q}" class="${(t.quad || "") === q ? "on" : ""}">${l}</button>`).join("")}</div></div>
    <div class="fld">截止日期<div class="duerow"><input type="date" id="mDue" value="${t.due || ""}"><button type="button" class="btn ghost sm" id="mDueClr">清除</button></div></div>
    ${subs.length ? `<p class="fld">底下有 ${subs.length} 個小事項，刪除時會一起刪除。</p>` : ""}
    <div class="acts"><button class="btn danger" id="mDel">刪除</button><span style="display:flex;gap:8px"><button class="btn ghost" id="mCancel">取消</button><button class="btn" id="mSave">儲存</button></span></div>`);
  $("#mCancel").onclick = closeModal;
  $("#mPri").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; $("#mPri").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b)); });
  $("#mDueClr").onclick = () => { $("#mDue").value = ""; };
  $("#mQuad").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; $("#mQuad").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b)); });
  $("#mDel").onclick = () => withUndo(`已刪除「${t.title}」${subs.length ? `和 ${subs.length} 個小事項` : ""}`, ["main"], () => { S.tasks = S.tasks.filter(x => x.id !== id && x.parentId !== id); saveMain(); closeModal(); renderTodo(); renderTray(); });
  $("#mSave").onclick = () => {
    t.title = $("#mTitle").value.trim() || t.title; t.est = readDurOf("mEst");
    t.priority = ($("#mPri .on") || {}).dataset?.p || "m"; t.due = $("#mDue").value || null;
    const q = ($("#mQuad .on") || {}).dataset?.q || ""; if (q) t.quad = q; else delete t.quad;
    const np = $("#mProj").value;
    if (np !== t.projectId) { t.projectId = np; subs.forEach(s => s.projectId = np); }
    saveMain(); closeModal(); renderTodo(); renderTray();
  };
}
function editProject(pid){
  const p = proj(pid); let color = p.color;
  const n = S.tasks.filter(t => t.projectId === pid).length;
  openModal(`<h3>編輯專案</h3>
    <label class="fld">名稱<input type="text" id="mTitle" value="${esc(p.name)}" maxlength="40"></label>
    <div class="fld">顏色<div class="swatches">${COLORS.map(c => `<button class="sw ${c===color?"on":""}" style="--c:${c}" data-c="${c}" aria-label="顏色"></button>`).join("")}</div></div>
    ${n ? `<p class="fld">刪除專案會一起刪除裡面 ${n} 個待辦（已排的方塊會保留）。</p>` : ""}
    <div class="acts"><button class="btn danger" id="mDel">刪除</button><span style="display:flex;gap:8px"><button class="btn ghost" id="mCancel">取消</button><button class="btn" id="mSave">儲存</button></span></div>`);
  $("#sheet").querySelector(".swatches").addEventListener("click", e => { const s = e.target.closest(".sw"); if (!s) return; color = s.dataset.c; $("#sheet").querySelectorAll(".sw").forEach(x => x.classList.toggle("on", x === s)); });
  $("#mCancel").onclick = closeModal;
  confirmBtn($("#mDel"), "再按一次刪除", () => withUndo(`已刪除專案「${p.name}」`, ["main"], () => { S.projects = S.projects.filter(x => x.id !== pid); S.tasks = S.tasks.filter(t => t.projectId !== pid); saveMain(); closeModal(); renderTodo(); renderTray(); renderDay(); }));
  $("#mSave").onclick = () => { p.name = $("#mTitle").value.trim() || p.name; p.color = color; saveMain(); closeModal(); renderTodo(); renderTray(); renderDay(); };
}
