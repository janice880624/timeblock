// 前端純函式測試：node --test tests/
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("fs"), vm = require("vm"), path = require("path");

const ctx = { console, localStorage: { getItem: () => null, setItem() {} }, document: { querySelector: () => null } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "core.js"), "utf8") +
  "\n;globalThis.__ = { addDays, mondayOf, parseKey, keyOf, fmt, hm, hrs, snap, isoWeek, merge3, freeSlot, layoutLanes, START, END };", ctx);
const C = ctx.__;

test("日期：加減天數、跨月跨年", () => {
  assert.equal(C.addDays("2026-11-30", 1), "2026-12-01");
  assert.equal(C.addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(C.addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(C.addDays("2028-03-01", -1), "2028-02-29");
});
test("日期：每週從週一開始", () => {
  assert.equal(C.mondayOf("2026-11-16"), "2026-11-16");   // 週一
  assert.equal(C.mondayOf("2026-11-22"), "2026-11-16");   // 週日
  assert.equal(C.mondayOf("2027-01-01"), "2026-12-28");
});
test("ISO 週數", () => {
  assert.deepEqual({ ...C.isoWeek("2026-11-16") }, { y: 2026, w: 47 });
  assert.deepEqual({ ...C.isoWeek("2026-01-01") }, { y: 2026, w: 1 });
  assert.deepEqual({ ...C.isoWeek("2027-01-01") }, { y: 2026, w: 53 });
  assert.deepEqual({ ...C.isoWeek("2024-12-30") }, { y: 2025, w: 1 });
});
test("時間格式", () => {
  assert.equal(C.fmt(9 * 60 + 5), "09:05");
  assert.equal(C.fmt(1440), "24:00");
  assert.equal(C.hm(45), "45m"); assert.equal(C.hm(60), "1h"); assert.equal(C.hm(85), "1h25m");
  assert.equal(C.hrs(90), "1.5"); assert.equal(C.snap(52), 45); assert.equal(C.snap(53), 60);
});
test("找空檔：避開已排的方塊，排不下回傳 null", () => {
  const b = [{ start: 540, dur: 60 }, { start: 600, dur: 30 }, { start: 690, dur: 60 }];
  assert.equal(C.freeSlot(b, 30, 540), 630);
  assert.equal(C.freeSlot(b, 60, 540), 630);
  assert.equal(C.freeSlot(b, 90, 540), 750);
  assert.equal(C.freeSlot([], 60, C.END - 30), null);
});
test("重疊的方塊分欄排列", () => {
  const L = C.layoutLanes([{ id: "a", start: 540, dur: 60 }, { id: "b", start: 570, dur: 60 }, { id: "c", start: 700, dur: 30 }]);
  assert.equal(L.get("a").n, 2); assert.equal(L.get("b").lane, 1); assert.equal(L.get("c").n, 1);
});

const base = { projects: [{ id: "p1", name: "論文" }], tasks: [{ id: "t1", title: "A", done: false }, { id: "t2", title: "B", done: false }], recurring: [] };
const copy = o => JSON.parse(JSON.stringify(o));
test("合併：兩台各自新增，都保留", () => {
  const l = copy(base); l.tasks.push({ id: "t3", title: "C" }); l.tasks[0].done = true;
  const s = copy(base); s.tasks.push({ id: "t4", title: "D" }); s.tasks[1].title = "B2";
  const m = C.merge3(base, l, s);
  assert.deepEqual(m.tasks.map(t => t.id), ["t1", "t2", "t4", "t3"]);
  assert.equal(m.tasks[0].done, true); assert.equal(m.tasks[1].title, "B2");
});
test("合併：這台刪除的會刪掉，其他裝置新增的保留", () => {
  const l = copy(base); l.tasks = l.tasks.filter(t => t.id !== "t2");
  const s = copy(base); s.tasks.push({ id: "t9" });
  assert.deepEqual(C.merge3(base, l, s).tasks.map(t => t.id), ["t1", "t9"]);
});
test("合併：每月資料逐天、逐個方塊合併", () => {
  const b = { days: { "2026-11-16": { blocks: [{ id: "x", title: "舊" }], rdone: {} } } };
  const l = copy(b); l.days["2026-11-16"].blocks.push({ id: "y" }); l.days["2026-11-17"] = { blocks: [{ id: "z" }] };
  const s = copy(b); s.days["2026-11-16"].blocks[0].title = "改"; s.days["2026-11-16"].rdone = { r1: true };
  const m = C.merge3(b, l, s), d = m.days["2026-11-16"];
  assert.deepEqual(d.blocks.map(x => x.id), ["x", "y"]); assert.equal(d.blocks[0].title, "改");
  assert.equal(d.rdone.r1, true); assert.ok(m.days["2026-11-17"]);
});
test("合併：沒改過的欄位用試算表的，改過的用這台的", () => {
  assert.equal(C.merge3({ note: "x" }, { note: "x" }, { note: "theirs" }).note, "theirs");
  assert.equal(C.merge3({ note: "x" }, { note: "mine" }, { note: "theirs" }).note, "mine");
});
