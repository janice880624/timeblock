"use strict";
/* 方塊日程 · 每日規劃：排程與時間軸 */
/* ---------- scheduling ---------- */
async function quickSchedule(t, dateKey){
  const k = dateKey || ui.date;
  const d = await loadDay(k);
  if (!d) { toast("讀取失敗，稍後再試"); return; }
  const dur = t.est || 30;
  let from = 8*60;
  if (k === todayKey()) { const n = new Date(); from = Math.max(from, Math.ceil((n.getHours()*60+n.getMinutes())/SNAP)*SNAP); }
  const ab = allBlocks(k);
  let s = freeSlot(ab, dur, from);
  if (s == null) s = freeSlot(ab, dur, START);
  if (s == null) { toast("這天已經排滿了"); return; }
  addBlock(k, t, s, dur);
  toast(`已排入 ${shortDate(k)} ${fmt(s)}`);
}
function addBlock(k, t, start, dur){
  const d = days[k];
  d.blocks.push({ id: uid(), taskId: t ? t.id : null, projectId: t ? t.projectId : null, title: t ? t.title : "新方塊", start, dur, done: false });
  saveDay(k); renderDay(); renderTodo();
}

/* ---------- DAY panel ---------- */
$("#prevDay").onclick = () => goDate(addDays(ui.date, -1));
$("#nextDay").onclick = () => goDate(addDays(ui.date, 1));
$("#todayBtn").onclick = () => goDate(todayKey());
let lastScrolledFor = null;
async function goDate(k){ ui.date = k; renderDay(); await loadDay(k); renderDay(); renderTodo(); }

async function renderWeekStrip(){
  const ws = mondayOf(ui.date), keys = [...Array(7)].map((_,i) => addDays(ws, i));
  const draw = () => {
    $("#weekStrip").innerHTML = keys.map(k => {
      const d = parseKey(k), b = days[k] ? allBlocks(k) : null;
      const tot = b ? b.reduce((s,x) => s + x.dur, 0) : null;
      return `<button class="ws ${k===ui.date?"on":""} ${k===todayKey()?"today":""}" data-k="${k}">${WD[d.getDay()]}<b>${d.getDate()}</b><em>${tot==null?"·":tot?hrs(tot)+"h":"—"}</em></button>`;
    }).join("");
  };
  draw();
  if (loaded && keys.some(k => !days[k])) { await prefetchDays(keys); await Promise.all(keys.map(loadDay)); draw(); }
}
$("#weekStrip").addEventListener("click", e => { const b = e.target.closest(".ws"); if (b) goDate(b.dataset.k); });

function renderTray(){
  const tr = $("#tray");
  const open = S.tasks.filter(t => !t.done);
  if (!loaded || !open.length) { tr.innerHTML = `<div class="tray-h"><span>待排入</span></div><div class="empty" style="padding:6px">${loaded ? "沒有未完成的待辦，到「專案」或「待辦總覽」新增吧" : "載入中…"}</div>`; return; }
  const sch = scheduledToday();
  tr.innerHTML = `<div class="tray-h"><span>待排入 · 點一下自動排，長按拖曳到指定時間</span></div>
    <div class="chips">${open.map(t => `<div class="chip ${sch.has(t.id)?"sch":""}" style="--c:${colorOf(t.projectId)}" data-id="${t.id}">${esc(t.title)} · ${hm(t.est||30)}${(() => { const d = dueInfo(t); return d && d.cls ? `<span class="cd">${d.label}</span>` : ""; })()}</div>`).join("")}</div>`;
  tr.querySelectorAll(".chip").forEach(c => attachTaskDrag(c, c.dataset.id, true));
}


/* ---------- 今日紀錄：心情、體力、睡眠、運動（自己輸入） ---------- */
const ENERGY = ["", "很累", "有點累", "普通", "不錯", "很有精神"];
const MOOD = ["", "很差", "不太好", "普通", "不錯", "很好"], MOOD_FACE = ["", "😫", "😕", "😐", "🙂", "😄"];
if (ui.logOpen == null) ui.logOpen = true;
let logTimer = null;
function logSummary(l){
  const p = [];
  if (l.mood) p.push(`心情 ${MOOD_FACE[l.mood]}`);
  if (l.energy) p.push(`體力 ${l.energy}`);
  if (l.sleep) p.push(`睡眠 ${hm(l.sleep)}`);
  if (l.ex) p.push(`運動 ${hm(l.ex)}`);
  return p.join(" · ") || "還沒填";
}
function renderDayLog(){
  const el = $("#dayLog"), k = ui.date, d = days[k];
  if (!d) { el.innerHTML = ""; return; }
  if (el.contains(document.activeElement) && el.dataset.k === k) return;      // 正在輸入時不要重畫
  el.dataset.k = k;
  const l = d.log || {}, open = ui.logOpen;
  el.innerHTML = `<button class="dl-head" id="dlTog" aria-expanded="${open}"><span class="caret">▾</span><b>${k === todayKey() ? "今日" : shortDate(k)}紀錄</b><span class="dl-sum">${esc(logSummary(l))}</span></button>
    ${open ? `<div class="dl-body">
      <div class="dl-row"><span class="dl-k">體力</span>
        <div class="energy" role="group" aria-label="體力">${[1,2,3,4,5].map(n => `<button type="button" data-e="${n}" class="e${n} ${l.energy === n ? "on" : ""}" title="${ENERGY[n]}">${n}</button>`).join("")}</div>
        <span class="dl-hint">${l.energy ? ENERGY[l.energy] : "1 很累 → 5 很有精神"}</span></div>
      <div class="dl-row"><span class="dl-k">心情</span>
        <div class="mood" role="group" aria-label="心情">${[1,2,3,4,5].map(n => `<button type="button" data-m="${n}" class="m${n} ${l.mood === n ? "on" : ""}" title="${MOOD[n]}" aria-label="${MOOD[n]}">${MOOD_FACE[n]}</button>`).join("")}</div>
        <span class="dl-hint">${l.mood ? MOOD[l.mood] : "很差 → 很好"}</span>
        <input type="text" id="lgMoodN" maxlength="80" value="${esc(l.moodNote || "")}" placeholder="一句話記下今天（可不填）" aria-label="心情筆記"></div>
      <div class="dl-row"><span class="dl-k">睡眠</span>
        <input type="number" id="lgWH" min="0" max="16" inputmode="numeric" value="${l.sleep ? Math.floor(l.sleep / 60) : ""}" placeholder="0" aria-label="睡眠小時"><span>小時</span>
        <input type="number" id="lgWM" min="0" max="59" step="5" inputmode="numeric" value="${l.sleep ? l.sleep % 60 : ""}" placeholder="0" aria-label="睡眠分鐘"><span>分</span></div>
      <div class="dl-row"><span class="dl-k">運動</span>
        <input type="number" id="lgEx" min="0" max="600" step="5" inputmode="numeric" value="${l.ex || ""}" placeholder="0" aria-label="運動分鐘"><span>分鐘</span>
        <input type="text" id="lgExN" maxlength="60" value="${esc(l.exNote || "")}" placeholder="內容，例如：游泳 1500m" aria-label="運動內容"></div>
    </div>` : ""}`;
}
function saveDayLog(){
  const k = ui.date, d = days[k]; if (!d) return;
  const n = id => { const v = parseInt(($("#" + id) || {}).value, 10); return isNaN(v) || v < 0 ? 0 : v; };
  const l = Object.assign({}, d.log);
  if ($("#lgWH")) l.sleep = Math.min(n("lgWH") * 60 + Math.min(n("lgWM"), 59), 16 * 60);
  if ($("#lgEx")) l.ex = Math.min(n("lgEx"), 600);
  if ($("#lgExN")) l.exNote = $("#lgExN").value.trim();
  if ($("#lgMoodN")) l.moodNote = $("#lgMoodN").value.trim();
  Object.keys(l).forEach(x => { if (!l[x]) delete l[x]; });
  if (Object.keys(l).length) d.log = l; else delete d.log;
  $("#dayLog .dl-sum").textContent = logSummary(l);
  clearTimeout(logTimer); logTimer = setTimeout(() => saveDay(k), 600);
}
$("#dayLog").addEventListener("input", e => { if (e.target.matches("input")) saveDayLog(); });
$("#dayLog").addEventListener("click", e => {
  if (e.target.closest("#dlTog")) { ui.logOpen = !ui.logOpen; saveUI(); $("#dayLog").dataset.k = ""; renderDayLog(); return; }
  const b = e.target.closest("[data-e], [data-m]"); if (!b) return;
  const d = days[ui.date]; if (!d) return;
  const field = b.dataset.e ? "energy" : "mood", v = +(b.dataset.e || b.dataset.m), l = Object.assign({}, d.log);
  if (l[field] === v) delete l[field]; else l[field] = v;               // 再按一次取消
  if (Object.keys(l).length) d.log = l; else delete d.log;
  saveDay(ui.date); $("#dayLog").dataset.k = ""; renderDayLog();
});
function renderDay(){
  const k = ui.date, d = parseKey(k);
  const diff = Math.round((parseKey(k) - parseKey(todayKey()))/864e5);
  $("#dTitle").textContent = `${d.getMonth()+1}月${d.getDate()}日 星期${WD[d.getDay()]}`;
  $("#dSub").textContent = diff === 0 ? "今天" : diff === 1 ? "明天" : diff === -1 ? "昨天" : diff > 0 ? `${diff} 天後` : `${-diff} 天前`;
  renderWeekStrip(); renderTray(); renderDayLog();
  const ppm = PPM(), grid = $("#tlGrid");
  grid.style.height = (END-START)*ppm + "px";
  let h = "";
  for (let m = START; m <= END; m += 30) {
    const y = (m-START)*ppm;
    h += m % 60 === 0 ? `<div class="hr" style="top:${y}px"><span>${fmt(m)}</span></div>` : `<div class="hr half" style="top:${y}px"></div>`;
  }
  h += `<div class="lane" id="lane"></div>`;
  grid.innerHTML = h;
  const day = days[k];
  const stats = $("#dayStats");
  if (!day) { stats.textContent = loaded ? "" : "載入中…"; return; }
  const all = allBlocks(k);
  const lane = $("#lane"), L = layoutLanes(all);
  all.forEach(b => {
    const p = proj(b.projectId), info = L.get(b.id);
    const el = document.createElement("div");
    el.className = "blk" + (b.done ? " done" : "") + (b.recId ? " rep" : "");
    el.dataset.id = b.id;
    el.style.setProperty("--c", colorOf(b.projectId));
    el.style.top = (b.start-START)*ppm + "px";
    el.style.height = Math.max(b.dur*ppm - 2, 16) + "px";
    el.style.left = `calc(${info.lane/info.n*100}% + ${info.lane?2:0}px)`;
    el.style.width = `calc(${100/info.n}% - ${info.n>1?2:0}px)`;
    el.innerHTML = `<button class="chk" data-nodrag aria-label="完成">✓</button><div class="bt">${b.recId?`<span class="rep-ic" title="固定行程">↻</span>`:""}${esc(b.title)}${b.dur<45?` <span class="bm" style="display:inline">${fmt(b.start)}</span>`:""}</div>${b.dur>=45?`<div class="bm">${fmt(b.start)}–${fmt(b.start+b.dur)}${p?" · "+esc(p.name):""}</div>`:""}<div class="rsz" data-nodrag></div>`;
    lane.appendChild(el);
    attachBlockDrag(el, b); attachResize(el.querySelector(".rsz"), el, b);
    el.querySelector(".chk").addEventListener("click", ev => { ev.stopPropagation(); toggleBlock(b); });
  });
  if (k === todayKey()) {
    const n = new Date(), m = n.getHours()*60 + n.getMinutes();
    if (m >= START && m <= END) { const nl = document.createElement("div"); nl.className = "now"; nl.style.top = (m-START)*ppm + "px"; grid.appendChild(nl); }
  }
  const plan = all.reduce((s,b) => s+b.dur, 0), dn = all.filter(b => b.done).reduce((s,b) => s+b.dur, 0);
  stats.innerHTML = all.length
    ? `<span>方塊 <b>${all.filter(b=>b.done).length}/${all.length}</b> 完成</span><span>已規劃 <b>${hm(plan)}</b></span><span>已完成 <b>${hm(dn)}</b></span>`
    : `<span>這天還沒有方塊，點時間軸空白處或拖入待辦開始規劃。</span>`;
  if (lastScrolledFor !== k) {
    lastScrolledFor = k;
    const n = new Date(), target = k === todayKey() ? n.getHours()*60 + n.getMinutes() - 60 : 8*60;
    $("#tlScroll").scrollTop = Math.max(0, (target - START) * ppm);
  }
}
function toggleBlock(b){
  if (b.recId) { const d = days[ui.date]; d.rdone = Object.assign({}, d.rdone, { [b.recId]: !b.done }); saveDay(ui.date); renderDay(); return; }
  b.done = !b.done; saveDay(ui.date);
  const t = b.taskId && task(b.taskId);
  if (t) setTaskDone(t, b.done);
  renderDay();
}
$("#tlGrid").addEventListener("click", e => {
  if (e.target.closest(".blk") || DRAG.justEnded) return;
  if (!days[ui.date]) return;
  const r = $("#tlGrid").getBoundingClientRect();
  const m = clamp(Math.floor(((e.clientY - r.top)/PPM() + START)/30)*30, START, END-30);
  const b = { id: uid(), taskId: null, projectId: null, title: "新方塊", start: m, dur: 60, done: false };
  if (b.start + b.dur > END) b.dur = END - b.start;
  editBlock(b, true);
});
setInterval(() => { if (ui.view === "day" && ui.date === todayKey() && !DRAG.active) renderDay(); }, 60000);

/* a change to one occurrence of a recurring item turns that day's copy into a normal block */
function detachOccurrence(k, b, changes){
  const r = rec(b.recId); if (!r) return;
  r.skip = (r.skip || []).concat(k); saveMain();
  const d = days[k];
  if (d.rdone) { const x = Object.assign({}, d.rdone); delete x[r.id]; d.rdone = x; }
  const nb = Object.assign({ id: uid(), taskId: null, projectId: b.projectId, title: b.title, start: b.start, dur: b.dur, done: b.done }, changes);
  d.blocks.push(nb); saveDay(k);
  return nb;
}
