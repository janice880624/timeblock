"use strict";
/* 方塊日程 · 月曆 */
/* ---------- MONTH panel ---------- */
ui.month = ui.date.slice(0, 7);
const monthAdd = (ym, n) => { const [y, m] = ym.split("-").map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth()+1)}`; };
$("#prevMonth").onclick = () => { ui.month = monthAdd(ui.month, -1); renderMonth(); };
$("#nextMonth").onclick = () => { ui.month = monthAdd(ui.month, 1); renderMonth(); };
$("#thisMonthBtn").onclick = () => { ui.month = todayKey().slice(0, 7); renderMonth(); };
$("#mGrid").addEventListener("click", e => { const c = e.target.closest(".mc"); if (!c) return; ui.date = c.dataset.k; lastScrolledFor = null; setView("day"); goDate(c.dataset.k); });
async function renderMonth(){
  const ym = ui.month, [y, m] = ym.split("-").map(Number);
  $("#mTitleM").textContent = `${y} 年 ${m} 月`;
  const first = `${ym}-01`, start = mondayOf(first);
  const lastDay = new Date(y, m, 0).getDate();
  const nWeeks = Math.ceil(((parseKey(first).getDay() + 6) % 7 + lastDay) / 7);
  const keys = [...Array(nWeeks * 7)].map((_, i) => addDays(start, i));
  const cur = todayKey().slice(0, 7);
  $("#mSubM").textContent = ym === cur ? "本月" : ym < cur ? "過去" : "未來";
  const draw = () => {
    if (ui.month !== ym) return;
    const today = todayKey(), small = matchMedia("(max-width:640px)").matches;
    $("#mGrid").innerHTML = keys.map(k => {
      const d = parseKey(k), inM = k.slice(0, 7) === ym;
      const bl = allBlocks(k).sort((a, b) => a.start - b.start);
      const plan = bl.reduce((s, b) => s + b.dur, 0), dn = bl.filter(b => b.done).reduce((s, b) => s + b.dur, 0);
      const dueN = S.tasks.filter(t => !t.done && t.due === k).length;
      const max = small ? 6 : 3, shown = bl.slice(0, max);
      const items = shown.map(b => `<div class="mi ${b.done ? "done" : ""}" style="--c:${colorOf(b.projectId)}" title="${fmt(b.start)} ${esc(b.title)}"><span class="dot"></span><span>${b.recId ? "↻" : ""}${esc(b.title)}</span></div>`).join("");
      return `<button class="mc ${inM ? "" : "out"} ${k === today ? "today" : ""}" data-k="${k}" aria-label="${d.getMonth()+1}月${d.getDate()}日">
        <div class="mtop"><span class="mn">${d.getDate()}</span>${plan ? `<span class="mh">${hrs(plan)}h</span>` : ""}</div>
        ${dueN ? `<div class="mdue">⚑ 截止 ${dueN}</div>` : ""}
        ${plan ? `<div class="mbar"><i style="width:${dn / plan * 100}%"></i></div>` : ""}
        ${small ? `<div class="mdots">${items}</div>` : items}
        ${bl.length > max ? `<div class="mmore">+${bl.length - max} 個</div>` : ""}
      </button>`;
    }).join("");
    const inKeys = keys.filter(k => k.slice(0, 7) === ym);
    let P = 0, D = 0, n = 0, nd = 0; const byP = new Map();
    inKeys.forEach(k => allBlocks(k).forEach(b => { P += b.dur; n++; if (b.done) { D += b.dur; nd++; } const id = proj(b.projectId) ? b.projectId : "_"; byP.set(id, (byP.get(id) || 0) + b.dur); }));
    const top = [...byP.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    $("#mSum").innerHTML = n ? `<span>本月規劃 <b>${hrs(P)}h</b></span><span>已完成 <b>${hrs(D)}h</b></span><span>執行率 <b>${P ? Math.round(D / P * 100) : 0}%</b></span><span>方塊 <b>${nd}/${n}</b></span>`
      + top.map(([id, v]) => { const p = proj(id); return `<span class="pj" style="--c:${p ? p.color : NONE_COLOR}"><span class="dot"></span>${esc(p ? p.name : "其他")} ${hrs(v)}h</span>`; }).join("")
      : `<span>這個月還沒有安排</span>`;
  };
  draw();
  if (!loaded) return;
  const missing = keys.filter(k => !days[k]);
  if (missing.length) await prefetchDays(missing);
  for (let i = 0; i < missing.length; i += 7) {           // load a week at a time, not 42 reads at once
    await Promise.all(missing.slice(i, i + 7).map(loadDay));
    if (ui.month !== ym || ui.view !== "month") return;
    draw();
  }
}
