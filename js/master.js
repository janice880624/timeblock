"use strict";
/* 方塊日程 · 待辦總覽 */
/* ---------- MASTER todo view ---------- */
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
    return `<li class="mrow ${t.done ? "done" : ""} ${d && !t.done ? d.cls : ""}" data-id="${t.id}" style="--c:${colorOf(t.projectId)}">
      <input type="checkbox" data-act="check" ${t.done ? "checked" : ""} aria-label="完成">
      <div class="mmain"><div class="mt1">${priBadge(t)}<span class="t" data-act="editTask">${esc(t.title)}</span></div>
      <div class="mt2"><span class="pj"><span class="dot"></span>${esc(p ? p.name : "其他")}${par ? ` › ${esc(par.title)}` : ""}</span><span class="est">${hm(t.est || 30)}</span>${dueBadge(t)}</div></div>
      ${t.done ? "" : `<button class="ico" data-act="sched" title="排入${shortDate(ui.date)}" aria-label="排入當日">⇥</button>`}
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
        <select id="maPri" aria-label="優先度">${["h","m","l"].map(p => `<option value="${p}" ${p === (ui.maPri || "m") ? "selected" : ""}>${PRI[p].t}優先</option>`).join("")}</select>
        <input type="date" id="maDue" aria-label="截止日期" title="截止日期（可不填）">
      </div>
    </form></div>
    <div class="mfil">
      <select data-f="status"><option value="open">未完成</option><option value="all">全部</option><option value="done">已完成</option></select>
      <select data-f="pri"><option value="all">所有優先度</option><option value="h">高</option><option value="m">中</option><option value="l">低</option></select>
      <select data-f="proj"><option value="all">所有專案</option>${S.projects.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select>
      <div class="lay" role="group" aria-label="排版"><button type="button" data-lay="list" class="${f.layout !== "matrix" ? "on" : ""}">清單</button><button type="button" data-lay="matrix" class="${f.layout === "matrix" ? "on" : ""}">專案 × 截止日</button></div>
      <span style="margin-left:auto" class="${f.layout === "matrix" ? "hidden" : ""}">排序</span>
      <select data-f="sort" class="${f.layout === "matrix" ? "hidden" : ""}"><option value="due">截止日</option><option value="pri">優先度</option><option value="proj">專案</option><option value="created">最新加入</option></select>
    </div>
    ${f.layout === "matrix" ? matrixHTML(list, row) : groups.length ? `<div class="mgroups">` + groups.map(g => `<div class="mgroup">${g.t ? `<h4 class="${g.c}">${esc(g.t)} <span style="font-weight:400;color:var(--muted)">${g.items.length}</span></h4>` : ""}<ul class="mlist">${g.items.map(row).join("")}</ul></div>`).join("") + `</div>`
      : `<div class="empty">${S.tasks.length ? "沒有符合篩選的待辦" : "還沒有待辦，從上面新增第一個吧"}</div>`}`;
  el.querySelectorAll(".mfil select").forEach(sel => { if (sel.dataset.f === "proj" && !proj(f.proj)) f.proj = "all"; sel.value = f[sel.dataset.f]; });
}
$("#allPanel").addEventListener("change", e => {
  const sel = e.target.closest(".mfil select");
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
  const lb = e.target.closest("[data-lay]");
  if (lb) { ui.mf.layout = lb.dataset.lay; saveUI(); renderMaster(); return; }
  const a = e.target.closest("[data-act]"); if (!a) return;
  const t = task(a.closest(".mrow").dataset.id); if (!t) return;
  if (a.dataset.act === "check") setTaskDone(t, a.checked);
  else if (a.dataset.act === "editTask") editTask(t.id);
  else if (a.dataset.act === "sched") quickSchedule(t);
});
