"use strict";
/* 方塊日程 · 分頁切換與「專案」頁 */
/* ---------- view switching ---------- */
const isDesk = () => matchMedia("(min-width:900px)").matches;
function setView(v){
  if (v === "todo" && isDesk()) v = "day";
  ui.view = v; saveUI();
  $("#app").className = "view-" + v;
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.view === v));
  if (v === "week") renderWeek(); else if (v === "month") renderMonth(); else if (v === "all") renderMaster(); else if (v === "habit") renderHabit(); else if (v === "day") renderDay(); else renderTodo();
  if (v === "day" && isDesk()) renderTodo();
}
$("#tabs").addEventListener("click", e => { const b = e.target.closest("button"); if (b) setView(b.dataset.view); });
matchMedia("(min-width:900px)").addEventListener?.("change", () => setView(ui.view));

/* ---------- TODO panel ---------- */
$("#hideDone").checked = !!ui.hideDone;
$("#hideDone").addEventListener("change", e => { ui.hideDone = e.target.checked; saveUI(); renderTodo(); });
$("#addProj").addEventListener("submit", e => {
  e.preventDefault();
  const name = $("#projName").value.trim(); if (!name) return;
  const used = S.projects.map(p => p.color);
  const color = COLORS.find(c => !used.includes(c)) || COLORS[S.projects.length % COLORS.length];
  S.projects.push({ id: uid(), name, color });
  $("#projName").value = ""; saveMain(); renderTodo(); renderTray();
});
function estOptions(sel){ return [15,30,45,60,90,120,180].map(m => `<option value="${m}" ${m===sel?"selected":""}>${hm(m)}</option>`).join(""); }
function scheduledToday(){ const d = days[ui.date]; return new Set(d ? d.blocks.map(b => b.taskId).filter(Boolean) : []); }

function renderRecs(){
  const el = $("#recList"); if (!loaded) { el.innerHTML = ""; return; }
  const today = todayKey(), act = recs().filter(r => !r.until || r.until >= today).sort((a,b) => a.start - b.start);
  const open = ui.recOpen || !act.length;
  const todayN = recFor(ui.date).length;
  el.innerHTML = `<div class="recs ${open ? "" : "closed"}"><div class="recs-h"><button class="recs-tog" id="recTog" aria-expanded="${open}"><span class="caret">▾</span><b>↻ 固定行程</b><span class="recs-n">${act.length} 個${todayN ? ` · ${shortDate(ui.date)} 有 ${todayN} 個` : ""}</span></button><button class="btn ghost sm" id="addRec">＋ 新增</button></div>
    ${!open ? "" : act.length ? act.map(r => `<div class="rec" data-rid="${r.id}" style="--c:${colorOf(r.projectId)}"><span class="dot"></span><span class="t">${esc(r.title)}<small>${wdText(r.days)} ${fmt(r.start)}–${fmt(r.start+r.dur)} · ${rangeText(r)}</small></span><span class="ico">⋯</span></div>`).join("")
      : `<div class="empty" style="padding:8px 0;text-align:left">上課、固定會議、運動…設定一次，每週自動出現在時間軸。</div>`}</div>`;
  $("#addRec").onclick = newRecurring;
  $("#recTog").onclick = () => { ui.recOpen = !open; saveUI(); renderRecs(); };
  el.querySelectorAll(".rec").forEach(x => x.onclick = () => editRecurring(rec(x.dataset.rid), todayKey(), true));
}
function renderTodo(){
  renderRecs();
  if (ui.view === "all") renderMaster();
  const el = $("#projList");
  if (!loaded) { el.innerHTML = `<div class="empty">載入中…</div>`; return; }
  if (!S.projects.length) { el.innerHTML = `<div class="empty">還沒有專案。<br>先新增一個專案（例如「碩士論文」「日常雜事」），再把待辦加進去。</div>`; return; }
  const sch = scheduledToday();
  el.innerHTML = S.projects.map(p => {
    const top = S.tasks.filter(t => t.projectId === p.id && !t.parentId);
    const all = S.tasks.filter(t => t.projectId === p.id);
    const arch = (S.archived && S.archived[p.id]) || 0;
    const done = all.filter(t => t.done).length + arch, total = all.length + arch;
    const pct = total ? Math.round(done/total*100) : 0;
    const rows = top.map(t => {
      const subs = S.tasks.filter(s => s.parentId === t.id);
      const show = x => !(ui.hideDone && x.done);
      let h = show(t) || subs.some(show) ? taskRow(t, false, sch) : "";
      subs.filter(show).forEach(s => h += taskRow(s, true, sch));
      if (ui.addingSub === t.id) h += `<li class="subadd"><input data-subfor="${t.id}" placeholder="新增小事項，按 Enter" maxlength="80"><select data-subest>${estOptions(30)}</select></li>`;
      return h;
    }).join("");
    return `<div class="proj ${ui.collapsed[p.id]?"collapsed":""}" style="--c:${p.color}" data-pid="${p.id}">
      <div class="proj-h"><button class="caret" data-act="toggle" aria-label="收合">▾</button><span class="dot"></span><b>${esc(p.name)}</b><span class="prog">${done}/${total}</span><button class="ico" data-act="editProj" aria-label="編輯專案">⋯</button></div>
      <div class="pbar"><i style="width:${pct}%"></i></div>
      <ul class="tasks">${rows}</ul>
      <form class="addtask" data-pid="${p.id}"><input placeholder="新增待辦…" maxlength="80"><select>${estOptions(30)}</select></form>
    </div>`;
  }).join("");
  el.querySelectorAll(".handle").forEach(h => attachTaskDrag(h, h.closest(".task").dataset.id, false));
  const si = el.querySelector("[data-subfor]"); if (si) si.focus();
}
function taskRow(t, sub, sch){
  return `<li class="task ${sub?"sub":""} ${t.done?"done":""}" data-id="${t.id}">
    <span class="handle" title="拖曳到時間軸">⠿</span>
    <input type="checkbox" ${t.done?"checked":""} data-act="check" aria-label="完成">
    ${priOf(t) === "h" ? priBadge(t) : ""}<span class="t" data-act="editTask">${esc(t.title)}</span>${dueBadge(t)}
    ${sch.has(t.id) ? `<span class="sched-dot" title="已排入當日"></span>` : ""}
    <span class="est">${hm(t.est||30)}</span>
    <button class="ico" data-act="sched" title="排入${shortDate(ui.date)}" aria-label="排入當日">⇥</button>
    ${sub ? "" : `<button class="ico" data-act="addSub" title="新增小事項" aria-label="新增小事項">＋</button>`}
  </li>`;
}
$("#projList").addEventListener("click", e => {
  const a = e.target.closest("[data-act]"); if (!a) return;
  const act = a.dataset.act, pEl = a.closest(".proj"), tEl = a.closest(".task");
  const pid = pEl && pEl.dataset.pid, t = tEl && task(tEl.dataset.id);
  if (act === "toggle") { ui.collapsed[pid] = !ui.collapsed[pid]; saveUI(); renderTodo(); }
  else if (act === "editProj") editProject(pid);
  else if (act === "check" && t) { setTaskDone(t, a.checked); }
  else if (act === "editTask" && t) editTask(t.id);
  else if (act === "sched" && t) quickSchedule(t);
  else if (act === "addSub" && t) { ui.addingSub = ui.addingSub === t.id ? null : t.id; renderTodo(); }
});
$("#projList").addEventListener("submit", e => {
  e.preventDefault();
  const f = e.target.closest(".addtask"); if (!f) return;
  const inp = f.querySelector("input"), title = inp.value.trim(); if (!title) return;
  S.tasks.push({ id: uid(), projectId: f.dataset.pid, parentId: null, title, est: +f.querySelector("select").value, done: false, created: Date.now() });
  saveMain(); renderTodo(); renderTray();
  const again = document.querySelector(`.addtask[data-pid="${f.dataset.pid}"] input`); again && again.focus();
});
$("#projList").addEventListener("keydown", e => {
  const inp = e.target.closest("[data-subfor]"); if (!inp) return;
  if (e.key === "Escape") { ui.addingSub = null; renderTodo(); return; }
  if (e.key !== "Enter" || e.isComposing) return;
  e.preventDefault();
  const title = inp.value.trim(); if (!title) return;
  const parent = task(inp.dataset.subfor);
  const est = +inp.parentElement.querySelector("[data-subest]").value;
  S.tasks.push({ id: uid(), projectId: parent.projectId, parentId: parent.id, title, est, done: false, created: Date.now() });
  saveMain(); renderTodo(); renderTray();
});
function setTaskDone(t, done){
  t.done = done; t.doneAt = done ? Date.now() : null;
  // finishing a parent finishes its small items too
  if (done && !t.parentId) S.tasks.filter(s => s.parentId === t.id && !s.done).forEach(s => { s.done = true; s.doneAt = Date.now(); });
  saveMain(); renderTodo(); renderTray(); if (ui.view === "week") renderWeek();
}
