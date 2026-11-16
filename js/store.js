"use strict";
/* 方塊日程 · 儲存層：試算表（Apps Script）與本機兩種模式、暫存佇列、版本合併 */
/* ---------- storage (account db, falls back to this browser) ---------- */
const Store = {
  mode: "local", col: null, pending: {}, inflight: {}, timers: {},
  gas: null, allLoaded: false, gTimer: null, gBusy: false, gAgain: false,
  ver: {}, base: {}, onChange: null,
  /* 試算表模式：每天的方塊合併成「每月一列」（month-2026-11），一年只有 12 列；只在需要時讀取 */
  months: {}, monthWait: {}, fq: null,
  docOf(key){
    if (key === "main") return S;
    if (key.startsWith("day-")) return days[key.slice(4)];
    if (key.startsWith("week-")) return weeks[key.slice(5)];
    if (key.startsWith("month-")) return buildMonth(key.slice(6));
    if (key.startsWith("archive-")) return archives[key.slice(8)];
    return null;
  },
  applyDoc(key, d){
    if (key === "main") { if (d && Array.isArray(d.projects)) { S = d; recs(); } }
    else if (key.startsWith("day-")) days[key.slice(4)] = d && Array.isArray(d.blocks) ? d : { blocks: [] };
    else if (key.startsWith("week-")) weeks[key.slice(5)] = d || { note: "" };
    else if (key.startsWith("archive-")) archives[key.slice(8)] = d && Array.isArray(d.tasks) ? d : { tasks: [] };
    else if (key.startsWith("month-")) {
      const ym = key.slice(6), ds = (d && d.days) || {};
      Object.keys(days).forEach(K => { if (K.startsWith(ym + "-") && !(K in ds)) days[K] = { blocks: [] }; });
      Object.keys(ds).forEach(K => { const x = ds[K] || {}; if (!Array.isArray(x.blocks)) x.blocks = []; days[K] = x; });
      this.months[ym] = true;
    }
  },
  /* 30 毫秒內的讀取合併成一次 getMany */
  fetchDocs(keys){
    if (!this.fq) { this.fq = { keys: new Set(), waiters: [] }; setTimeout(() => this.drainFetch(), 30); }
    keys.forEach(k => this.fq.keys.add(k));
    return new Promise((res, rej) => this.fq.waiters.push({ res, rej }));
  },
  async drainFetch(){
    const q = this.fq; this.fq = null; const keys = [...q.keys];
    try {
      const j = await this.gasCall({ action: "getMany", keys });
      keys.forEach(k => { if (!(k in this.pending)) { this.ver[k] = j.vers ? (j.vers[k] ?? null) : null; this.base[k] = clone(j.docs[k] ?? null); } });
      q.waiters.forEach(w => w.res(j));
    } catch (e) { q.waiters.forEach(w => w.rej(e)); }
  },
  ensureMonths(yms){
    if (this.mode !== "gas") return Promise.resolve();
    return Promise.all([...new Set(yms)].filter(ym => !this.months[ym]).map(ym => this.monthWait[ym] || (this.monthWait[ym] =
      this.fetchDocs(["month-" + ym]).then(j => { this.applyDoc("month-" + ym, j.docs["month-" + ym]); delete this.monthWait[ym]; },
                                           e => { delete this.monthWait[ym]; throw e; }))));
  },
  /* 還沒確認存進試算表的修改，先放在瀏覽器裡；關頁或斷線後，下次打開會補送 */
  outboxPut(key, doc){
    const ob = lsGet("blk:outbox") || {};
    ob[key] = { doc, ver: key in this.ver ? this.ver[key] : null, base: this.base[key] ?? null };
    lsSet("blk:outbox", ob);
  },
  outboxDel(key){ const ob = lsGet("blk:outbox") || {}; if (key in ob) { delete ob[key]; lsSet("blk:outbox", ob); } },
  /* 切回頁面時，把其他裝置改過的資料抓回來 */
  async sync(){
    if (this.mode !== "gas" || !loaded || this.gBusy || DRAG.active || !$("#modal").classList.contains("hidden")) return;
    let j; try { j = await this.gasCall({ action: "vers" }); } catch { return; }
    const changed = Object.keys(j.vers || {}).filter(k => k in this.ver && !k.startsWith("day-") && j.vers[k] !== this.ver[k]);
    if (!changed.length) return;
    let g; try { g = await this.gasCall({ action: "getMany", keys: changed }); } catch { return; }
    if (!$("#modal").classList.contains("hidden") || DRAG.active) return;
    changed.forEach(k => {
      const server = g.docs[k];
      if (k in this.pending) { const merged = merge3(this.base[k], this.docOf(k), server); this.applyDoc(k, merged); this.pending[k] = clone(merged); this.outboxPut(k, this.pending[k]); }
      else this.applyDoc(k, server);
      this.ver[k] = g.vers[k]; this.base[k] = clone(server);
    });
    this.onChange && this.onChange();
    toast("已載入其他裝置的變更");
  },
  async gasCall(body){
    let res;
    try { res = await fetch(this.gas.url, { method: "POST", body: JSON.stringify(Object.assign({ token: this.gas.token }, body)), redirect: "follow" }); }
    catch { throw { code: "network" }; }
    if (!res.ok) throw { code: "http_" + res.status };
    let j; try { j = await res.json(); } catch { throw { code: "bad_response" }; }
    if (!j.ok) throw { code: j.error || "error" };
    return j;
  },
  async flushGas(){
    if (this.gBusy) { this.gAgain = true; return; }
    const keys = Object.keys(this.pending); if (!keys.length) return;
    const docs = {}, base = {};
    keys.forEach(k => { docs[k] = this.pending[k]; delete this.pending[k]; base[k] = k in this.ver ? this.ver[k] : null; });
    this.gBusy = true; let failed = false, merged = 0;
    try {
      const j = await this.gasCall({ action: "setMany", docs, base });
      Object.keys(j.written || {}).forEach(k => {
        this.ver[k] = j.written[k]; this.base[k] = docs[k];
        if (k in this.pending) this.outboxPut(k, this.pending[k]); else this.outboxDel(k);
      });
      Object.keys(j.conflicts || {}).forEach(k => {          // 別的裝置先改過：合併後再存一次
        const c = j.conflicts[k], m = merge3(this.base[k], this.docOf(k) || docs[k], c.doc);
        this.ver[k] = c.ver; this.base[k] = clone(c.doc);
        this.applyDoc(k, m); this.pending[k] = clone(m); this.outboxPut(k, this.pending[k]); merged++;
      });
    }
    catch (e) {
      failed = true;
      keys.forEach(k => { if (!(k in this.pending)) this.pending[k] = docs[k]; });
      toast(e.code === "bad_token" ? "連線密碼錯誤，請重新連接試算表" : "存到試算表失敗，5 秒後再試");
      setSync("尚有變更未儲存");
    }
    this.gBusy = false;
    if (failed) { clearTimeout(this.gTimer); this.gTimer = setTimeout(() => this.flushGas(), 5000); return; }
    if (merged) { this.onChange && this.onChange(); toast("已和其他裝置的變更合併"); }
    if (this.gAgain || Object.keys(this.pending).length) { this.gAgain = false; this.flushGas(); }
    else setSync("已存到你的試算表");
  },
  async load(key){
    if (this.mode === "gas") {
      if (key.startsWith("day-")) { await this.ensureMonths([key.slice(4, 11)]); return days[key.slice(4)] || null; }
      const j = await this.fetchDocs([key]);
      return j.docs ? j.docs[key] ?? null : null;
    }
    return lsGet("blk:" + key);
  },
  save(key, data){
    if (this.mode === "gas") {
      if (key.startsWith("day-")) {                       // 每天的變更存進當月那一列
        const K = key.slice(4), ym = K.slice(0, 7);
        if (!this.months[ym]) { const keep = clone(data); this.ensureMonths([ym]).then(() => { days[K] = keep; this.save(key, keep); }).catch(() => toast("讀取失敗，這次修改沒有存到")); return; }
        key = "month-" + ym; data = this.docOf(key);
      }
      this.pending[key] = clone(data);
      this.outboxPut(key, this.pending[key]); clearTimeout(this.gTimer); this.gTimer = setTimeout(() => this.flushGas(), 700); setSync("儲存中…"); return;
    }
    this.pending[key] = JSON.parse(JSON.stringify(data));
    clearTimeout(this.timers[key]);
    this.timers[key] = setTimeout(() => this.flush(key), 450);
    setSync("儲存中…");
  },
  async flush(key, retried){
    if (this.inflight[key]) return;
    const d = this.pending[key]; if (!d) return;
    delete this.pending[key]; this.inflight[key] = true;
    try {
      lsSet("blk:" + key, d);
    } catch (e) {
      const code = e && e.code;
      if ((code === "unavailable" || code === "deadline-exceeded") && !retried) {
        this.pending[key] = this.pending[key] || d;
        this.inflight[key] = false;
        setTimeout(() => this.flush(key, true), 800 + Math.random()*900);
        return;
      }
      toast("儲存失敗，稍後會再試");
      if (!this.pending[key]) this.pending[key] = d;
      this.inflight[key] = false;
      setSync("尚有變更未儲存");
      return;
    }
    this.inflight[key] = false;
    if (this.pending[key]) this.flush(key);
    else if (!Object.keys(this.pending).length && !Object.values(this.inflight).some(Boolean)) setSync("已存在此瀏覽器");
  },
  flushAll(){ if (this.mode === "gas") { clearTimeout(this.gTimer); this.flushGas(); return; } Object.keys(this.pending).forEach(k => { clearTimeout(this.timers[k]); this.flush(k); }); }
};
function setSync(t){ $("#syncState").textContent = t; }
let hiddenAt = 0;
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") { hiddenAt = Date.now(); Store.flushAll(); }
  else if (Date.now() - hiddenAt > 15000) Store.sync();
});
setInterval(() => { if (document.visibilityState === "visible") Store.sync(); }, 180000);
window.addEventListener("pagehide", () => Store.flushAll());
window.addEventListener("beforeunload", e => { if (Store.mode === "gas" && (Object.keys(Store.pending).length || Store.gBusy)) { Store.flushAll(); e.preventDefault(); e.returnValue = ""; } });
