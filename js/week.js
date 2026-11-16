"use strict";
/* 方塊日程 · 週統整 */
/* ---------- WEEK panel ---------- */
$("#prevWeek").onclick = () => { ui.weekStart = addDays(ui.weekStart, -7); renderWeek(); };
$("#nextWeek").onclick = () => { ui.weekStart = addDays(ui.weekStart, 7); renderWeek(); };
$("#thisWeekBtn").onclick = () => { ui.weekStart = mondayOf(todayKey()); renderWeek(); };
let noteTimer;
$("#weekNote").addEventListener("input", e => {
  const k = ui.weekStart; weeks[k] = weeks[k] || {}; weeks[k].note = e.target.value;
  clearTimeout(noteTimer); noteTimer = setTimeout(() => Store.save("week-" + k, weeks[k]), 600);
});
let weekData = null;
async function renderWeek(){
  const ws = ui.weekStart, keys = [...Array(7)].map((_,i) => addDays(ws, i));
  $("#wTitle").textContent = `${shortDate(keys[0])} – ${shortDate(keys[6])}`;
  const cur = mondayOf(todayKey());
  $("#wSub").textContent = ws === cur ? "本週" : ws < cur ? `${Math.round((parseKey(cur)-parseKey(ws))/6048e5)} 週前` : "未來的週";
  if (!loaded) { $("#kpis").innerHTML = `<div class="empty">載入中…</div>`; return; }
  await prefetchDays(keys); await Promise.all(keys.map(loadDay)); const wk = await loadWeek(ws);
  if (ui.weekStart !== ws) return;
  const note = $("#weekNote"); if (document.activeElement !== note) note.value = wk.note || "";

  const per = keys.map(k => { const bl = allBlocks(k); return { k, plan: bl.reduce((s,b)=>s+b.dur,0), done: bl.filter(b=>b.done).reduce((s,b)=>s+b.dur,0), n: bl.length, nd: bl.filter(b=>b.done).length }; });
  const P = per.reduce((s,x)=>s+x.plan,0), D = per.reduce((s,x)=>s+x.done,0);
  const nB = per.reduce((s,x)=>s+x.n,0), nD = per.reduce((s,x)=>s+x.nd,0);
  const t0 = parseKey(ws).getTime(), t1 = parseKey(addDays(ws, 7)).getTime();
  const archT = t0 < Date.now() - (ARCHIVE_DAYS - 7) * 864e5 ? await archivedBetween(t0, t1) : [];
  if (ui.weekStart !== ws) return;
  const doneTasks = S.tasks.filter(t => t.done && t.doneAt >= t0 && t.doneAt < t1).concat(archT.filter(a => !task(a.id))).sort((a,b) => a.doneAt - b.doneAt);
  $("#kpis").innerHTML = `
    <div class="kpi"><small>已規劃</small><b>${hrs(P)}<em> 小時</em></b><em>${nB} 個方塊</em></div>
    <div class="kpi"><small>已完成</small><b>${hrs(D)}<em> 小時</em></b><em>${nD} 個方塊</em></div>
    <div class="kpi"><small>執行率</small><b>${P ? Math.round(D/P*100) : 0}<em>%</em></b><em>完成時數 ÷ 規劃時數</em></div>
    <div class="kpi"><small>完成待辦</small><b>${doneTasks.length}<em> 項</em></b><em>本週勾選完成</em></div>`;

  const max = Math.max(60, ...per.map(x => x.plan));
  $("#dayBars").innerHTML = per.map(x => {
    const ph = x.plan/max*100, dh = x.plan ? x.done/x.plan*100 : 0;
    return `<div class="dcol" title="${shortDate(x.k)}：規劃 ${hm(x.plan)}，完成 ${hm(x.done)}"><div class="pl" style="height:${ph}%">${x.plan?`<span class="val">${hrs(x.plan)}h</span>`:""}<div class="dn" style="height:${dh}%"></div></div></div>`;
  }).join("");
  $("#dayLabels").innerHTML = per.map(x => `<span ${x.k===todayKey()?'style="color:var(--accent);font-weight:700"':""}>${WD[parseKey(x.k).getDay()]}</span>`).join("");

  const byP = new Map();
  keys.forEach(k => allBlocks(k).forEach(b => {
    const id = proj(b.projectId) ? b.projectId : "_";
    const o = byP.get(id) || { plan: 0, done: 0 }; o.plan += b.dur; if (b.done) o.done += b.dur; byP.set(id, o);
  }));
  const rowsP = [...byP.entries()].sort((a,b) => b[1].plan - a[1].plan);
  const pmax = Math.max(1, ...rowsP.map(r => r[1].plan));
  $("#projBars").innerHTML = rowsP.length ? rowsP.map(([id,o]) => {
    const p = proj(id), c = p ? p.color : NONE_COLOR, nm = p ? p.name : "其他";
    return `<div class="prow" style="--c:${c}" title="${esc(nm)}：規劃 ${hm(o.plan)}，完成 ${hm(o.done)}"><span class="nm"><span class="dot"></span>${esc(nm)}</span><div class="track"><div class="p" style="width:${o.plan/pmax*100}%"></div><div class="d" style="width:${o.done/pmax*100}%"></div></div><span class="v">${hrs(o.done)} / ${hrs(o.plan)}h</span></div>`;
  }).join("") : `<div class="empty">這週還沒有排方塊</div>`;

  $("#doneList").innerHTML = doneTasks.length ? doneTasks.map(t => { const p = proj(t.projectId), dd = new Date(t.doneAt);
    return `<li style="--c:${colorOf(t.projectId)}"><span class="dot"></span><span>${esc(t.title)}${p?` <span style="color:var(--muted);font-size:12px">· ${esc(p.name)}</span>`:""}</span><span class="when">週${WD[dd.getDay()]}</span></li>`; }).join("")
    : `<li class="empty" style="display:block">這週還沒有完成的待辦</li>`;

  const today = todayKey();
  const miss = []; keys.forEach(k => { if (k <= today) allBlocks(k).filter(b => !b.done && (k < today || b.start + b.dur <= nowMin())).forEach(b => miss.push({ k, b })); });
  $("#missList").innerHTML = miss.length ? miss.map(({k,b}) => `<li style="--c:${colorOf(b.projectId)}"><span class="dot"></span><span>${esc(b.title)}</span><span class="when">週${WD[parseKey(k).getDay()]} ${fmt(b.start)}</span></li>`).join("")
    : `<li class="empty" style="display:block">${P ? "排了的都完成了 👏" : "還沒有資料"}</li>`;

  weekData = { keys, per, P, D, nB, nD, doneTasks, rowsP, miss };
}
const nowMin = () => { const n = new Date(); return n.getHours()*60 + n.getMinutes(); };
$("#copySummary").addEventListener("click", async () => {
  if (!weekData) return;
  const w = weekData;
  let s = `【週統整 ${shortDate(w.keys[0])}–${shortDate(w.keys[6])}】\n`;
  s += `規劃 ${hrs(w.P)}h／完成 ${hrs(w.D)}h（執行率 ${w.P?Math.round(w.D/w.P*100):0}%），方塊 ${w.nD}/${w.nB}\n\n`;
  s += `■ 每日\n` + w.per.map(x => `週${WD[parseKey(x.k).getDay()]} ${shortDate(x.k)}：規劃 ${hm(x.plan)}，完成 ${hm(x.done)}`).join("\n") + "\n\n";
  s += `■ 專案時間\n` + (w.rowsP.map(([id,o]) => `${(proj(id)||{name:"其他"}).name}：${hrs(o.done)} / ${hrs(o.plan)}h`).join("\n") || "（無）") + "\n\n";
  s += `■ 完成的待辦\n` + (w.doneTasks.map(t => `✓ ${t.title}`).join("\n") || "（無）") + "\n\n";
  s += `■ 沒完成的方塊\n` + (w.miss.map(m => `· ${m.b.title}`).join("\n") || "（無）") + "\n\n";
  s += `■ 回顧\n${$("#weekNote").value || "（未填）"}`;
  try { await navigator.clipboard.writeText(s); toast("已複製本週統整"); }
  catch { openModal(`<h3>複製本週統整</h3><textarea class="copybox" readonly>${esc(s)}</textarea><div class="acts"><span></span><button class="btn" id="mCancel">關閉</button></div>`); const ta = $("#sheet textarea"); ta.focus(); ta.select(); $("#mCancel").onclick = closeModal; }
});
