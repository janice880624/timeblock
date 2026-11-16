"use strict";
/* 方塊日程 · 常數與純函式（日期、格式、合併、排程計算）。沒有畫面相依，tests/ 直接載入這個檔測試 */
/* ---------- constants & helpers ---------- */
const COLORS = ["#2a78d6","#eb6834","#1baf7a","#eda100","#e87ba4","#008300","#6250d6","#e34948"];
const NONE_COLOR = "#8d8c84";
const START = 6*60, END = 24*60, SNAP = 15;
const WD = ["日","一","二","三","四","五","六"];
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,7);
const pad = n => String(n).padStart(2,"0");
const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parseKey = k => { const [y,m,d] = k.split("-").map(Number); return new Date(y, m-1, d); };
const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate()+n); return keyOf(d); };
const todayKey = () => keyOf(new Date());
const mondayOf = k => { const d = parseKey(k); const w = (d.getDay()+6)%7; d.setDate(d.getDate()-w); return keyOf(d); };
const fmt = m => `${pad(Math.floor(m/60))}:${pad(m%60)}`;
const hm = m => { m = Math.round(m); if (m < 60) return `${m}m`; const h = Math.floor(m/60), r = m%60; return r ? `${h}h${r}m` : `${h}h`; };
const hrs = m => (Math.round(m/6)/10).toString();
const snap = m => Math.round(m/SNAP)*SNAP;
const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
const shortDate = k => { const d = parseKey(k); return `${d.getMonth()+1}/${d.getDate()}`; };
const PPM = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ppm")) || 1.1;
function toast(msg){ const t=$("#toast"); t.textContent=msg; t.classList.add("show"); clearTimeout(toast._t); toast._t=setTimeout(()=>t.classList.remove("show"),1800); }
function lsGet(k){ try{ return JSON.parse(localStorage.getItem(k)); }catch{ return null; } }
function lsSet(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch{} }

/* ---------- pure helpers ---------- */
const clone = o => o == null ? o : JSON.parse(JSON.stringify(o));
const sameJ = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isObj = o => o && typeof o === "object" && !Array.isArray(o);
const isIdArr = a => Array.isArray(a) && a.length > 0 && a.every(x => isObj(x) && x.id != null);
/* 三方合併：base＝上次和試算表一致的版本，local＝這台的，server＝試算表現在的。
   只把「這台改過的部分」套到 server 上；有 id 的清單（專案、待辦、方塊、固定行程）逐筆合併。 */
function merge3(b, l, srv){
  b = isObj(b) ? b : {}; l = isObj(l) ? l : {}; srv = isObj(srv) ? srv : {};
  const out = clone(srv);
  new Set([...Object.keys(l), ...Object.keys(b)]).forEach(k => {
    const bv = b[k], lv = l[k], sv = srv[k];
    if (sameJ(lv, bv)) return;                                   // 這台沒改：用 server 的
    if (lv === undefined) { delete out[k]; return; }              // 這台刪掉了
    if ((isIdArr(lv) || isIdArr(bv) || isIdArr(sv)) && Array.isArray(lv)) out[k] = mergeArr(Array.isArray(bv) ? bv : [], lv, Array.isArray(sv) ? sv : []);
    else if (isObj(lv) && isObj(sv)) out[k] = merge3(isObj(bv) ? bv : {}, lv, sv);
    else out[k] = clone(lv);
  });
  return out;
}
function mergeArr(b, l, srv){
  const bm = new Map(b.map(x => [x.id, x])), lm = new Map(l.map(x => [x.id, x]));
  let out = srv.map(clone);
  const idx = id => out.findIndex(x => x.id === id);
  l.forEach(item => {
    const base = bm.get(item.id), i = idx(item.id);
    if (!base) { if (i < 0) out.push(clone(item)); }                       // 這台新增的
    else if (!sameJ(item, base)) { if (i < 0) out.push(clone(item)); else out[i] = clone(item); }   // 這台修改的
  });
  b.forEach(item => { if (!lm.has(item.id)) out = out.filter(x => x.id !== item.id); });          // 這台刪掉的
  return out;
}
function freeSlot(blocks, dur, from){
  const sorted = blocks.slice().sort((a,b) => a.start - b.start);
  let t = from;
  for (const b of sorted) {
    if (b.start + b.dur <= t) continue;
    if (b.start - t >= dur) break;
    t = Math.max(t, b.start + b.dur);
  }
  return t + dur <= END ? t : null;
}
function layoutLanes(blocks){
  const sorted = blocks.slice().sort((a,b) => a.start - b.start || b.dur - a.dur);
  const out = new Map(); let cluster = [], clusterEnd = -1;
  const flush = () => {
    const lanes = [];
    cluster.forEach(b => {
      let i = lanes.findIndex(end => end <= b.start);
      if (i < 0) { i = lanes.length; lanes.push(0); }
      lanes[i] = b.start + b.dur; out.set(b.id, { lane: i });
    });
    cluster.forEach(b => out.get(b.id).n = lanes.length);
    cluster = [];
  };
  sorted.forEach(b => { if (b.start >= clusterEnd && cluster.length) { flush(); clusterEnd = -1; } cluster.push(b); clusterEnd = Math.max(clusterEnd, b.start + b.dur); });
  if (cluster.length) flush();
  return out;
}
function isoWeek(k){
  const d = parseKey(k); d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const w1 = new Date(d.getFullYear(), 0, 4);
  return { y: d.getFullYear(), w: 1 + Math.round(((d - w1) / 864e5 - 3 + (w1.getDay() + 6) % 7) / 7) };
}
