"use strict";
/* 方塊日程 · 固定行程總覽 */
/* ---------- HABIT (recurring overview, one cell per week) ---------- */
ui.hAnchor = mondayOf(todayKey());
const hWeeks = () => matchMedia("(max-width:640px)").matches ? 3 : matchMedia("(max-width:1000px)").matches ? 6 : 10;
$("#prevHabit").onclick = () => { ui.hAnchor = addDays(ui.hAnchor, -7 * hWeeks()); renderHabit(); };
$("#nextHabit").onclick = () => { ui.hAnchor = addDays(ui.hAnchor, 7 * hWeeks()); renderHabit(); };
$("#thisHabitBtn").onclick = () => { ui.hAnchor = mondayOf(todayKey()); renderHabit(); };
function occState(r, k, today){
  const wd = parseKey(k).getDay();
  if (!r.days.includes(wd) || k < r.from || (r.until && k > r.until)) return "none";
  if ((r.skip || []).includes(k)) return "skip";
  if (k > today) return "future";
  if (((days[k] && days[k].rdone) || {})[r.id]) return "done";
  return k === today ? "todo" : "miss";
}
function occList(r, from, to, today){           // every scheduled occurrence of r between from..to
  const out = []; let k = from > r.from ? from : r.from;
  const end = r.until && r.until < to ? r.until : to;
  for (let g = 0; k <= end && g < 800; k = addDays(k, 1), g++) { const st = occState(r, k, today); if (st !== "none") out.push({ k, st }); }
  return out;
}
function seriesStats(r, today){
  const end = r.until || today;
  const all = occList(r, r.from, end, today).filter(o => o.st !== "skip");
  const past = all.filter(o => o.st !== "future");
  const dn = past.filter(o => o.st === "done").length;
  return { total: r.until ? all.length : null, past: past.length, done: dn, miss: past.filter(o => o.st === "miss").length };
}
async function renderHabit(){
  const n = hWeeks(), mondays = [...Array(n)].map((_, i) => addDays(ui.hAnchor, -7 * (n - 1 - i)));
  const first = mondays[0], last = addDays(mondays[n - 1], 6), today = todayKey(), thisMon = mondayOf(today);
  const w0 = isoWeek(first), w1 = isoWeek(mondays[n - 1]);
  $("#hTitle").textContent = `${w0.y === w1.y ? w1.y : w0.y + "–" + w1.y} · W${w0.w} – W${w1.w}`;
  $("#hSub").textContent = `${shortDate(first)} – ${shortDate(last)}`;
  const draw = () => {
    if (ui.view !== "habit") return;
    const items = recs().filter(r => r.from <= last && (!r.until || r.until >= first))
      .sort((a, b) => ((a.until && a.until < today) - (b.until && b.until < today)) || a.start - b.start);
    if (!items.length) {
      $("#hKpis").innerHTML = "";
      $("#hTable").innerHTML = `<div class="empty">這段期間沒有固定行程。<br>到「專案」頁的「↻ 固定行程」新增上課、運動等每週固定的事。</div>`;
      return;
    }
    let wDone = 0, wPast = 0, wMiss = 0, wMin = 0;
    const head = mondays.map(m => `<th class="${m === thisMon ? "cur" : ""}"><b>W${isoWeek(m).w}</b>${shortDate(m)}</th>`).join("");
    const rows = items.map(r => {
      const cells = mondays.map(m => {
        const occ = occList(r, m, addDays(m, 6), today);
        if (!occ.length) return `<td><i class="wc none"></i></td>`;
        const live = occ.filter(o => o.st !== "skip"), dn = live.filter(o => o.st === "done").length;
        const past = live.filter(o => o.st !== "future").length, miss = live.filter(o => o.st === "miss").length;
        wDone += dn; wPast += past; wMiss += miss; wMin += dn * r.dur;
        const fut = m > today, ratio = live.length ? dn / live.length : 0;
        const cls = fut ? "future" : !live.length ? "skip" : dn === live.length ? "full" : dn ? "part" : past ? "zero" : "pending";
        return `<td class="${m === thisMon ? "cur" : ""}"><button class="wc ${cls}" style="--p:${Math.round(ratio * 100)}%" data-r="${r.id}" data-m="${m}" title="W${isoWeek(m).w}：完成 ${dn}/${live.length} 次">${live.length ? `${dn}/${live.length}` : "–"}</button></td>`;
      }).join("");
      const st = seriesStats(r, today), ended = r.until && r.until < today;
      const pct = st.total ? Math.round(st.done / st.total * 100) : st.past ? Math.round(st.done / st.past * 100) : 0;
      const rate = st.past ? Math.round(st.done / st.past * 100) : 0;
      return `<tr class="${ended ? "ended" : ""}" style="--c:${colorOf(r.projectId)}">
        <th class="nm" data-rid="${r.id}"><b><span class="dot"></span>${esc(r.title)}</b><small>${wdText(r.days)} ${fmt(r.start)} · ${rangeText(r)}${ended ? " · 已結束" : ""}</small></th>
        ${cells}
        <td class="st"><b>${pct}%</b><small>${st.total ? `完成 ${st.done} / 共 ${st.total} 次` : `完成 ${st.done} / ${st.past} 次`}</small>
          <div class="sbar"><i style="width:${pct}%"></i></div>
          ${st.total ? `<small>到今天完成率 ${rate}%</small>` : `<small>持續中</small>`}</td>
      </tr>`;
    }).join("");
    $("#hTable").innerHTML = `<table class="htable"><thead><tr><th class="nm" style="cursor:default">固定行程</th>${head}<th class="st">整體進度</th></tr></thead><tbody>${rows}</tbody></table>`;
    $("#hKpis").innerHTML = `
      <div class="kpi"><small>這段期間完成率</small><b>${wPast ? Math.round(wDone / wPast * 100) : 0}<em>%</em></b><em>W${w0.w}–W${w1.w}，到今天為止</em></div>
      <div class="kpi"><small>完成</small><b>${wDone}<em> 次</em></b><em>應完成 ${wPast} 次</em></div>
      <div class="kpi"><small>沒做到</small><b>${wMiss}<em> 次</em></b><em>不含取消的</em></div>
      <div class="kpi"><small>完成時數</small><b>${hrs(wMin)}<em> 小時</em></b><em>這段期間累計</em></div>`;
  };
  draw();
  if (!loaded) return;
  // stats need every past day since the earliest series start (capped at one year)
  const items = recs().filter(r => r.from <= last && (!r.until || r.until >= first));
  if (!items.length) return;
  let from = items.reduce((m, r) => r.from < m ? r.from : m, first);
  const cap = addDays(today, -366); if (from < cap) from = cap;
  const need = [];
  for (let k = from, g = 0; k <= today && g < 400; k = addDays(k, 1), g++) if (!days[k] && items.some(r => occState(r, k, today) !== "none")) need.push(k);
  if (need.length) { await prefetchDays(need); if (ui.view !== "habit") return; }
  for (let i = 0; i < need.length; i += 7) {
    await Promise.all(need.slice(i, i + 7).map(loadDay));
    if (ui.view !== "habit") return;
    if (i % 28 === 0 || i + 7 >= need.length) draw();
  }
}
function openWeek(r, m){
  const today = todayKey(), occ = occList(r, m, addDays(m, 6), today);
  const w = isoWeek(m);
  openModal(`<h3>${esc(r.title)} · W${w.w}</h3>
    <p class="fld">${shortDate(m)} – ${shortDate(addDays(m, 6))}　${wdText(r.days)} ${fmt(r.start)}–${fmt(r.start + r.dur)}</p>
    <ul class="wklist">${occ.map(o => { const d = parseKey(o.k);
      return `<li><span>${d.getMonth()+1}/${d.getDate()} 週${WD[d.getDay()]}</span>${
        o.st === "skip" ? `<em>已取消</em>` : o.st === "future" ? `<em>還沒到</em>` :
        `<label><input type="checkbox" data-k="${o.k}" ${o.st === "done" ? "checked" : ""}> 完成</label>`}</li>`; }).join("")}</ul>
    <div class="acts"><button class="btn ghost" id="mEditRec">編輯固定行程</button><button class="btn" id="mCancel">完成</button></div>`);
  $("#mCancel").onclick = () => { closeModal(); renderHabit(); };
  $("#mEditRec").onclick = () => editRecurring(r, today, true);
  $("#sheet").querySelectorAll("input[data-k]").forEach(cb => cb.addEventListener("change", async () => {
    const d = await loadDay(cb.dataset.k); if (!d) { toast("讀取失敗，稍後再試"); cb.checked = !cb.checked; return; }
    d.rdone = Object.assign({}, d.rdone, { [r.id]: cb.checked }); saveDay(cb.dataset.k);
  }));
}
$("#hTable").addEventListener("click", e => {
  const nm = e.target.closest(".nm[data-rid]");
  if (nm) { const r = rec(nm.dataset.rid); if (r) editRecurring(r, todayKey(), true); return; }
  const c = e.target.closest("button.wc"); if (!c) return;
  const r = rec(c.dataset.r); if (r) openWeek(r, c.dataset.m);
});
