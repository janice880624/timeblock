"use strict";
/* 方塊日程 · 待辦總覽 */
/* ---------- MASTER todo view ---------- */
/* 四象限：重要＝優先度（只算「高」，或「高＋中」），緊急＝已逾期或 N 天內截止 */
const QUADS = [
  { id: "q1", t: "重要且緊急", s: "馬上做" },
  { id: "q2", t: "重要但不緊急", s: "排進行程，避免變緊急" },
  { id: "q3", t: "緊急但不重要", s: "快速處理、或請別人幫忙" },
  { id: "q4", t: "不重要也不緊急", s: "有空再說，或刪掉" },
];
/* 自己分類過的（t.quad）優先；沒分過的依優先度和截止日自動判斷 */
function autoQuad(t){
  const f = ui.mf, p = priOf(t), imp = p === "h" || (f.qImp === "hm" && p === "m");
  const d = dueInfo(t), urg = !!(d && d.diff <= +f.qDays);
  return imp ? (urg ? "q1" : "q2") : (urg ? "q3" : "q4");
}
const quadOf = t => QUADS.some(q => q.id === t.quad) ? t.quad : autoQuad(t);
function setQuad(t, q){
  if (!q || q === autoQuad(t)) delete t.quad; else t.quad = q;
  saveMain(); renderMaster();
}
function attachQuadDrag(el){
  attachDrag(el, {
    hold: true,
    onStart(ev){
      const t = task(el.dataset.id); if (!t) return null;
      const g = document.createElement("div"); g.className = "drag-ghost"; g.style.setProperty("--c", colorOf(t.projectId)); g.textContent = t.title;
      document.body.appendChild(g); el.classList.add("dragging-row");
      const c = { t, g, q: null }; this.onMove(ev, c); return c;
    },
    onMove(ev, c){
      if (!c) return;
      c.g.style.left = ev.clientX + "px"; c.g.style.top = ev.clientY + "px";
      const hit = document.elementFromPoint(ev.clientX, ev.clientY), box = hit && hit.closest(".quad");
      document.querySelectorAll(".quad.drop-on").forEach(x => x !== box && x.classList.remove("drop-on"));
      if (box) box.classList.add("drop-on");
      c.q = box ? box.dataset.q : null;
    },
    onEnd(ev, c){
      if (!c) return; c.g.remove(); el.classList.remove("dragging-row");
      document.querySelectorAll(".quad.drop-on").forEach(x => x.classList.remove("drop-on"));
      if (c.q && c.q !== quadOf(c.t)) { setQuad(c.t, c.q); toast(`已移到「${QUADS.find(q => q.id === c.q).t}」`); }
    },
    onCancel(c){ if (c) { c.g.remove(); el.classList.remove("dragging-row"); document.querySelectorAll(".quad.drop-on").forEach(x => x.classList.remove("drop-on")); } }
  });
}
function quadsHTML(list, row){
  const f = ui.mf, by = { q1: [], q2: [], q3: [], q4: [] };
  list.forEach(t => by[quadOf(t)].push(t));
  const sorter = (a, b) => ((a.due || "9") < (b.due || "9") ? -1 : (a.due || "9") > (b.due || "9") ? 1 : 0) || (PRI[priOf(a)].o - PRI[priOf(b)].o);
  return `<div class="qaxis">
      <span>重要＝</span><select data-f="qImp"><option value="h">高優先</option><option value="hm">高＋中優先</option></select>
      <span>緊急＝已逾期或</span><select data-f="qDays">${[0, 1, 3, 7, 14].map(n => `<option value="${n}">${n === 0 ? "今天" : n + " 天內"}</option>`).join("")}</select><span>截止</span>
      <span class="qhint">自己分類：把待辦拖到別的格子（手機長按再拖），或在編輯視窗選</span>
    </div>
    <div class="quads">${QUADS.map(q => { const ts = by[q.id].sort(sorter);
      return `<section class="quad ${q.id}" data-q="${q.id}"><div class="quad-h"><b>${q.t}</b><small>${q.s}</small><span class="n">${ts.length} 項</span></div>
        ${ts.length ? `<ul class="mlist">${ts.map(row).join("")}</ul>` : `<div class="empty">沒有待辦</div>`}</section>`; }).join("")}</div>`;
}
function newProject(after){
  let color = COLORS.find(c => !S.projects.some(p => p.color === c)) || COLORS[S.projects.length % COLORS.length];
  openModal(`<h3>新增專案</h3>
    <label class="fld">名稱<input type="text" id="mTitle" maxlength="40" placeholder="例如：碩士論文"></label>
    <div class="fld">顏色<div class="swatches">${COLORS.map(c => `<button class="sw ${c===color?"on":""}" style="--c:${c}" data-c="${c}" aria-label="顏色"></button>`).join("")}</div></div>
    <div class="acts"><span></span><span style="display:flex;gap:8px"><button class="btn ghost" id="mCancel">取消</button><button class="btn" id="mSave">建立</button></span></div>`);
  $("#sheet").querySelector(".swatches").addEventListener("click", e => { const s = e.target.closest(".sw"); if (!s) return; color = s.dataset.c; $("#sheet").querySelectorAll(".sw").forEach(x => x.classList.toggle("on", x === s)); });
  $("#mCancel").onclick = closeModal;
  const go = () => {
    const name = $("#mTitle").value.trim(); if (!name) { $("#mTitle").focus(); return; }
    const p = { id: uid(), name, color }; S.projects.push(p);
    saveMain(); closeModal(); after && after(p); renderTodo(); renderTray(); toast(`已建立專案「${name}」`);
  };
  $("#mSave").onclick = go;
  $("#mTitle").addEventListener("keydown", e => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); go(); } });
}
function matrixHTML(list, row){
  if (!list.length) return `<div class="empty">${S.tasks.length ? "沒有符合篩選的待辦" : "還沒有待辦，從上面新增第一個吧"}</div>`;
  const colMap = new Map();
  list.forEach(t => { const b = bucketOf(t, "due"); if (!colMap.has(b.k)) colMap.set(b.k, b); });
  const cols = [...colMap.values()].sort((a, b) => a.k - b.k);
  const pids = [...S.projects.map(p => p.id), "_"].filter(id => list.some(t => (proj(t.projectId) ? t.projectId : "_") === id));
  const inCell = (pid, k) => list.filter(t => (proj(t.projectId) ? t.projectId : "_") === pid && bucketOf(t, "due").k === k)
    .sort((a, b) => (PRI[priOf(a)].o - PRI[priOf(b)].o) || ((a.due || "9") < (b.due || "9") ? -1 : 1));
  const head = cols.map(c => `<th class="${c.c}">${esc(c.t)}<small>${list.filter(t => bucketOf(t, "due").k === c.k).length}</small></th>`).join("");
  const body = pids.map(pid => {
    const p = proj(pid), n = list.filter(t => (proj(t.projectId) ? t.projectId : "_") === pid).length;
    return `<tr style="--c:${p ? p.color : NONE_COLOR}"><th class="mx-p"><span class="dot"></span><b>${esc(p ? p.name : "其他")}</b><small>${n} 項</small></th>${
      cols.map(c => { const ts = inCell(pid, c.k); return `<td class="${c.c}">${ts.length ? `<ul class="mlist mx-cell">${ts.map(row).join("")}</ul>` : ""}</td>`; }).join("")}</tr>`;
  }).join("");
  return `<div class="mx-wrap"><table class="mx"><thead><tr><th class="mx-p">專案</th>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function bucketOf(t, sort){
  if (sort === "pri") { const p = priOf(t); return { k: PRI[p].o, t: `${PRI[p].t}優先`, c: "" }; }
  if (sort === "proj") { const i = S.projects.findIndex(p => p.id === t.projectId); return { k: i, t: (proj(t.projectId) || { name: "其他" }).name, c: "" }; }
  if (sort === "created") return { k: 0, t: "", c: "" };
  const d = dueInfo(t);
  if (!d) return { k: 9, t: "沒有截止日", c: "" };
  if (t.done) return { k: 5, t: "已完成", c: "" };
  if (d.diff < 0) return { k: 0, t: "已逾期", c: "over" };
  if (d.diff === 0) return { k: 1, t: "今天截止", c: "today" };
  if (d.diff === 1) return { k: 2, t: "明天截止", c: "" };
  if (d.diff <= 7) return { k: 3, t: "7 天內", c: "" };
  return { k: 4, t: "之後", c: "" };
}
function renderMaster(){
  const el = $("#allPanel"), f = ui.mf;
  if (!loaded) { el.innerHTML = `<div class="empty">載入中…</div>`; return; }
  const open = S.tasks.filter(t => !t.done);
  let over = 0, today = 0, near = 0, high = 0;
  open.forEach(t => { const d = dueInfo(t); if (priOf(t) === "h") high++; if (!d) return; if (d.diff < 0) over++; else if (d.diff === 0) today++; else if (d.diff <= 3) near++; });
  const pOpts = S.projects.map(p => `<option value="${p.id}" ${p.id === ui.maProj ? "selected" : ""}>${esc(p.name)}</option>`).join("");
  let list = S.tasks.filter(t => f.status === "all" || (f.status === "open" ? !t.done : t.done));
  if (f.pri !== "all") list = list.filter(t => priOf(t) === f.pri);
  if (f.proj !== "all") list = list.filter(t => t.projectId === f.proj);
  const dk = t => t.due || "9999-99-99";
  const cDue = (a, b) => dk(a) < dk(b) ? -1 : dk(a) > dk(b) ? 1 : 0;
  const cPri = (a, b) => PRI[priOf(a)].o - PRI[priOf(b)].o;
  const pIdx = t => S.projects.findIndex(p => p.id === t.projectId);
  const cmp = { due: (a,b) => cDue(a,b) || cPri(a,b), pri: (a,b) => cPri(a,b) || cDue(a,b), proj: (a,b) => pIdx(a) - pIdx(b) || cPri(a,b) || cDue(a,b), created: (a,b) => (b.created||0) - (a.created||0) }[f.sort];
  list.sort((a, b) => (bucketOf(a, f.sort).k - bucketOf(b, f.sort).k) || cmp(a, b));
  const groups = [];
  list.forEach(t => { const g = bucketOf(t, f.sort); const last = groups[groups.length - 1]; if (last && last.k === g.k && last.t === g.t) last.items.push(t); else groups.push(Object.assign({ items: [t] }, g)); });
  const row = t => { const p = proj(t.projectId), par = t.parentId && task(t.parentId), d = dueInfo(t);
    return `<li class="mrow pr-${priOf(t)} ${t.done ? "done" : ""} ${d && !t.done ? d.cls : ""}" data-id="${t.id}" style="--c:${colorOf(t.projectId)}">
      <input type="checkbox" data-act="check" data-nodrag ${t.done ? "checked" : ""} aria-label="完成">
      <div class="mmain"><div class="mt1">${priBadge(t)}<span class="t" data-act="editTask">${esc(t.title)}</span></div>
      <div class="mt2"><span class="pj"><span class="dot"></span>${esc(p ? p.name : "其他")}${par ? ` › ${esc(par.title)}` : ""}</span><span class="est">${hm(t.est || 30)}</span>${dueBadge(t)}${ui.mf.layout === "quad" && t.quad ? `<button class="qman" data-nodrag data-act="unquad" title="改回自動分類">手動 ×</button>` : ""}</div></div>
      ${t.done ? "" : `<button class="ico" data-nodrag data-act="sched" title="排入${shortDate(ui.date)}" aria-label="排入當日">⇥</button>`}
    </li>`; };
  el.innerHTML = `
    <div class="panel-head"><h2>待辦總覽</h2><span style="font-size:12.5px;color:var(--muted)">未完成 ${open.length} 項${(() => { const n = Object.values(S.archived || {}).reduce((a, b) => a + b, 0); return n && f.status !== "open" ? ` · 另有 ${n} 項較早完成的已封存` : ""; })()}</span></div>
    <div class="mtop2"><div class="mstats">
      <div class="mstat over"><b>${over}</b>已逾期</div><div class="mstat today"><b>${today}</b>今天截止</div>
      <div class="mstat near"><b>${near}</b>3 天內</div><div class="mstat"><b>${high}</b>高優先</div>
    </div>
    <form class="madd" id="mAdd">
      <input type="text" id="maTitle" placeholder="新增待辦，按 Enter" maxlength="80">
      <button class="btn">＋</button>
      <div class="opts">
        <select id="maProj" aria-label="專案">${pOpts || `<option value="">（會建立「一般」專案）</option>`}</select>
        <button type="button" class="btn ghost sm" id="maNewProj">＋ 專案</button>
        <select id="maPri" aria-label="優先度">${["h","m","l"].map(p => `<option value="${p}" ${p === (ui.maPri || "m") ? "selected" : ""}>${PRI[p].t}優先</option>`).join("")}</select>
        <input type="date" id="maDue" aria-label="截止日期" title="截止日期（可不填）">
      </div>
    </form></div>
    <div class="mfil">
      <select data-f="status"><option value="open">未完成</option><option value="all">全部</option><option value="done">已完成</option></select>
      <select data-f="pri"><option value="all">所有優先度</option><option value="h">高</option><option value="m">中</option><option value="l">低</option></select>
      <select data-f="proj"><option value="all">所有專案</option>${S.projects.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select>
      <div class="lay" role="group" aria-label="排版">${[["list", "清單"], ["quad", "四象限"], ["matrix", "專案 × 截止日"]].map(([k, t]) => `<button type="button" data-lay="${k}" class="${(f.layout || "list") === k ? "on" : ""}">${t}</button>`).join("")}</div>
      <span style="margin-left:auto" class="${f.layout !== "list" ? "hidden" : ""}">排序</span>
      <select data-f="sort" class="${f.layout !== "list" ? "hidden" : ""}"><option value="due">截止日</option><option value="pri">優先度</option><option value="proj">專案</option><option value="created">最新加入</option></select>
    </div>
    ${f.layout === "matrix" ? matrixHTML(list, row) : f.layout === "quad" ? quadsHTML(list, row) : groups.length ? `<div class="mgroups">` + groups.map(g => `<div class="mgroup">${g.t ? `<h4 class="${g.c}">${esc(g.t)} <span style="font-weight:400;color:var(--muted)">${g.items.length}</span></h4>` : ""}<ul class="mlist">${g.items.map(row).join("")}</ul></div>`).join("") + `</div>`
      : `<div class="empty">${S.tasks.length ? "沒有符合篩選的待辦" : "還沒有待辦，從上面新增第一個吧"}</div>`}`;
  if (f.layout === "quad") el.querySelectorAll(".quad .mrow").forEach(attachQuadDrag);
  el.querySelectorAll(".mfil select, .qaxis select").forEach(sel => { if (sel.dataset.f === "proj" && !proj(f.proj)) f.proj = "all"; sel.value = String(f[sel.dataset.f]); });
}
$("#allPanel").addEventListener("change", e => {
  const sel = e.target.closest(".mfil select, .qaxis select");
  if (sel) { ui.mf[sel.dataset.f] = sel.value; saveUI(); renderMaster(); return; }
  if (e.target.id === "maProj") ui.maProj = e.target.value;
  if (e.target.id === "maPri") ui.maPri = e.target.value;
});
$("#allPanel").addEventListener("submit", e => {
  e.preventDefault();
  const title = $("#maTitle").value.trim(); if (!title) return;
  let pid = $("#maProj").value;
  if (!proj(pid)) { if (!S.projects.length) S.projects.push({ id: uid(), name: "一般", color: COLORS[0] }); pid = S.projects[0].id; }
  ui.maProj = pid; ui.maPri = $("#maPri").value;
  S.tasks.push({ id: uid(), projectId: pid, parentId: null, title, est: 30, priority: ui.maPri, due: $("#maDue").value || null, done: false, created: Date.now() });
  saveMain(); renderMaster(); renderTray(); if (isDesk()) renderTodo();
  const i = $("#maTitle"); i && i.focus();
});
$("#allPanel").addEventListener("click", e => {
  if (e.target.closest("#maNewProj")) { newProject(p => { ui.maProj = p.id; renderMaster(); }); return; }
  const lb = e.target.closest("[data-lay]");
  if (lb) { ui.mf.layout = lb.dataset.lay; saveUI(); renderMaster(); return; }
  const a = e.target.closest("[data-act]"); if (!a) return;
  const t = task(a.closest(".mrow").dataset.id); if (!t) return;
  if (a.dataset.act === "check") setTaskDone(t, a.checked);
  else if (a.dataset.act === "editTask") editTask(t.id);
  else if (a.dataset.act === "sched") quickSchedule(t);
  else if (a.dataset.act === "unquad") { setQuad(t, null); toast("改回自動分類"); }
});
