"use strict";
/* 方塊日程 · 拖曳（滑鼠＋觸控） */
/* ---------- drag engine (mouse + touch) ---------- */
const DRAG = { active: false, x: 0, y: 0, update: null, justEnded: false };
document.addEventListener("touchmove", e => { if (DRAG.active) e.preventDefault(); }, { passive: false });
function attachDrag(el, o){
  el.addEventListener("pointerdown", e => {
    if (e.button > 0 || DRAG.active) return;
    if (e.target.closest("[data-nodrag]") && e.target.closest("[data-nodrag]") !== el) return;
    const touch = e.pointerType !== "mouse", needHold = touch && o.hold;
    const st = { x: e.clientX, y: e.clientY, id: e.pointerId, started: false, armed: !needHold, ctx: null, timer: null, dist: 0 };
    const begin = ev => {
      st.started = true; DRAG.active = true; DRAG.x = ev.clientX; DRAG.y = ev.clientY;
      try { el.setPointerCapture(st.id); } catch {}
      try { navigator.vibrate && navigator.vibrate(8); } catch {}
      st.ctx = o.onStart(ev); autoScroll();
    };
    if (needHold) st.timer = setTimeout(() => { st.armed = true; begin({ clientX: st.x, clientY: st.y }); }, 300);
    const move = ev => {
      if (ev.pointerId !== st.id) return;
      st.dist = Math.hypot(ev.clientX - st.x, ev.clientY - st.y);
      if (!st.started) {
        if (!st.armed) { if (st.dist > 8) cleanup(); return; }
        if (st.dist < 5) return;
        begin(ev);
      }
      DRAG.x = ev.clientX; DRAG.y = ev.clientY;
      o.onMove(ev, st.ctx);
    };
    const up = ev => {
      if (ev.pointerId !== st.id) return;
      if (st.started) { o.onEnd(ev, st.ctx); DRAG.justEnded = true; setTimeout(() => DRAG.justEnded = false, 60); }
      else if (st.dist < 8 && o.onTap) o.onTap(ev);
      cleanup();
    };
    const cancel = () => { if (st.started && o.onCancel) o.onCancel(st.ctx); cleanup(); };
    function cleanup(){
      clearTimeout(st.timer); DRAG.active = false; DRAG.update = null;
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", cancel);
    }
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", cancel);
  });
  el.addEventListener("contextmenu", e => { if (o.hold) e.preventDefault(); });
}
function autoScroll(){
  if (!DRAG.active) return;
  const sc = $("#tlScroll"), r = sc.getBoundingClientRect();
  if (sc.offsetParent && DRAG.x >= r.left && DRAG.x <= r.right) {
    const edge = 48;
    if (DRAG.y < r.top + edge && DRAG.y > r.top - 80) { sc.scrollTop -= Math.ceil((r.top + edge - DRAG.y)/5); DRAG.update && DRAG.update(); }
    else if (DRAG.y > r.bottom - edge && DRAG.y < r.bottom + 80) { sc.scrollTop += Math.ceil((DRAG.y - (r.bottom - edge))/5); DRAG.update && DRAG.update(); }
  }
  requestAnimationFrame(autoScroll);
}
function minuteAt(x, y){
  const sc = $("#tlScroll"); if (!sc.offsetParent) return null;
  const sr = sc.getBoundingClientRect();
  if (x < sr.left || x > sr.right || y < sr.top - 10 || y > sr.bottom + 10) return null;
  const r = $("#tlGrid").getBoundingClientRect();
  return (y - r.top)/PPM() + START;
}

function attachTaskDrag(handle, taskId, isChip){
  attachDrag(handle, {
    hold: isChip,
    onTap: isChip ? () => { const t = task(taskId); t && quickSchedule(t); } : null,
    onStart(ev){
      const t = task(taskId); if (!days[ui.date]) return null;
      const g = document.createElement("div"); g.className = "drag-ghost";
      g.style.setProperty("--c", colorOf(t.projectId)); g.textContent = t.title;
      document.body.appendChild(g);
      const pv = document.createElement("div"); pv.className = "preview hidden"; $("#tlGrid").appendChild(pv);
      const ctx = { t, g, pv, dur: t.est || 30, min: null };
      DRAG.update = () => this.onMove({ clientX: DRAG.x, clientY: DRAG.y }, ctx);
      this.onMove(ev, ctx);
      return ctx;
    },
    onMove(ev, c){
      if (!c) return;
      c.g.style.left = ev.clientX + "px"; c.g.style.top = ev.clientY + "px";
      const m = minuteAt(ev.clientX, ev.clientY);
      if (m == null) { c.min = null; c.pv.classList.add("hidden"); return; }
      c.min = clamp(snap(m - c.dur/2), START, END - c.dur);
      const ppm = PPM();
      c.pv.classList.remove("hidden"); c.pv.style.top = (c.min-START)*ppm + "px"; c.pv.style.height = c.dur*ppm - 2 + "px";
      c.pv.textContent = `${fmt(c.min)}–${fmt(c.min + c.dur)}`;
    },
    onEnd(ev, c){
      if (!c) return; c.g.remove(); c.pv.remove();
      if (c.min != null) { addBlock(ui.date, c.t, c.min, c.dur); toast(`已排入 ${fmt(c.min)}`); }
    },
    onCancel(c){ if (c) { c.g.remove(); c.pv.remove(); } }
  });
}
function attachBlockDrag(el, b){
  attachDrag(el, {
    hold: true,
    onTap: () => editBlock(b, false),
    onStart(ev){
      const m = minuteAt(ev.clientX, ev.clientY);
      el.classList.add("dragging");
      const ctx = { off: (m ?? b.start) - b.start, start: b.start };
      DRAG.update = () => this.onMove({ clientX: DRAG.x, clientY: DRAG.y }, ctx);
      return ctx;
    },
    onMove(ev, c){
      const r = $("#tlGrid").getBoundingClientRect();
      const m = (ev.clientY - r.top)/PPM() + START;
      c.start = clamp(snap(m - c.off), START, END - b.dur);
      el.style.top = (c.start-START)*PPM() + "px";
      const bm = el.querySelector(".bm"); if (bm) bm.textContent = `${fmt(c.start)}–${fmt(c.start+b.dur)}`;
    },
    onEnd(ev, c){ el.classList.remove("dragging"); if (c.start !== b.start) { if (b.recId) { detachOccurrence(ui.date, b, { start: c.start }); toast("只調整了這一次，其他週不變"); } else { b.start = c.start; saveDay(ui.date); } } renderDay(); },
    onCancel(){ renderDay(); }
  });
}
function attachResize(h, el, b){
  attachDrag(h, {
    hold: false,
    onStart(ev){ el.classList.add("dragging"); return { y0: ev.clientY, d0: b.dur, dur: b.dur }; },
    onMove(ev, c){
      c.dur = clamp(snap(c.d0 + (ev.clientY - c.y0)/PPM()), SNAP, END - b.start);
      el.style.height = c.dur*PPM() - 2 + "px";
      const bm = el.querySelector(".bm"); if (bm) bm.textContent = `${fmt(b.start)}–${fmt(b.start+c.dur)}`;
    },
    onEnd(ev, c){ el.classList.remove("dragging"); if (c.dur !== b.dur) { if (b.recId) { detachOccurrence(ui.date, b, { dur: c.dur }); toast("只調整了這一次，其他週不變"); } else { b.dur = c.dur; saveDay(ui.date); } } renderDay(); },
    onCancel(){ renderDay(); }
  });
}
