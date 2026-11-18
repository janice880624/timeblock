// Apps Script（gas/Code.gs）測試：在模擬的試算表環境裡直接執行
const test = require("node:test"), assert = require("node:assert/strict");
const { makeEnv } = require("./gas-env");
const call = (env, token, body) => JSON.parse(env.api.doPost({ postData: { contents: JSON.stringify(Object.assign({ token }, body)) } }).body);

test("初始設定產生密碼並建立每日備份、定時更新", () => {
  const env = makeEnv(), token = env.api.setup();
  assert.match(token, /^[0-9a-f]{16}$/);
  assert.ok(env.triggers.includes("backupDaily")); assert.ok(env.triggers.includes("refreshViewsJob"));
  assert.equal(call(env, "wrong", { action: "ping" }).error, "bad_token");
});
test("從範本複製的副本不會沿用範本的密碼", () => {
  const tpl = makeEnv({ id: "TEMPLATE" }); tpl.api.setup();
  const copyEnv = makeEnv({ id: "MYCOPY", props: Object.assign({}, tpl.props) });   // 複製時專案屬性跟著過來
  assert.equal(call(copyEnv, tpl.props.TOKEN, { action: "ping" }).error, "not_setup");
  const mine = copyEnv.api.setup();
  assert.notEqual(mine, undefined); assert.equal(call(copyEnv, mine, { action: "ping" }).ok, true);
});
test("存取資料與版本衝突", () => {
  const env = makeEnv(), t = env.api.setup();
  const w = call(env, t, { action: "setMany", docs: { main: { projects: [], tasks: [{ id: "a" }] } }, base: { main: null } });
  const v1 = w.written.main; assert.ok(v1);
  const g = call(env, t, { action: "getMany", keys: ["main", "month-2026-11"] });
  assert.equal(g.docs.main.tasks[0].id, "a"); assert.equal(g.docs["month-2026-11"], null); assert.equal(g.vers.main, v1);
  call(env, t, { action: "setMany", docs: { main: { projects: [], tasks: [{ id: "a" }, { id: "b" }] } }, base: { main: v1 } });
  const stale = call(env, t, { action: "setMany", docs: { main: { projects: [], tasks: [{ id: "c" }] } }, base: { main: v1 } });
  assert.deepEqual(Object.keys(stale.written), []);
  assert.deepEqual(stale.conflicts.main.doc.tasks.map(x => x.id), ["a", "b"]);   // 舊版本被擋下，交回最新內容
});
test("大資料自動分段存進多個儲存格", () => {
  const env = makeEnv(), t = env.api.setup();
  const big = { projects: [], tasks: Array.from({ length: 2000 }, (_, i) => ({ id: "t" + i, title: "待辦".repeat(10) })) };
  call(env, t, { action: "setMany", docs: { main: big } });
  assert.equal(call(env, t, { action: "getMany", keys: ["main"] }).docs.main.tasks.length, 2000);
});
test("舊格式（每天一列）轉成每月一列，轉換前先備份", () => {
  const env = makeEnv(), t = env.api.setup();
  const docs = { main: { projects: [], tasks: [] } };
  ["2026-10-30", "2026-10-31", "2026-11-01"].forEach(K => docs["day-" + K] = { blocks: [{ id: K }] });
  call(env, t, { action: "setMany", docs });
  assert.equal(call(env, t, { action: "migrateDays" }).moved, 2);
  const keys = call(env, t, { action: "ping" }).keys.sort();
  assert.deepEqual(keys, ["main", "month-2026-10", "month-2026-11"]);
  const oct = call(env, t, { action: "getMany", keys: ["month-2026-10"] }).docs["month-2026-10"];
  assert.deepEqual(Object.keys(oct.days).sort(), ["2026-10-30", "2026-10-31"]);
  assert.ok(env.ss.getSheets().some(s => s.getName().startsWith("備份 格式轉換前")));
});
test("閱讀用工作表延後到定時更新，封存的待辦也列出來", () => {
  const env = makeEnv(), t = env.api.setup();
  call(env, t, { action: "setMany", docs: {
    main: { projects: [{ id: "p", name: "論文" }], tasks: [{ id: "a", projectId: "p", title: "寫", done: false }], recurring: [] },
    "archive-2026": { tasks: [{ id: "z", projectId: "p", title: "舊的", done: true, doneAt: 1 }] },
    "month-2026-11": { days: { "2026-11-16": { blocks: [{ id: "b", title: "方塊", start: 540, dur: 60, projectId: "p" }] } } } } });
  assert.equal(env.ss.getSheetByName("方塊紀錄"), null);          // 還沒更新
  env.api.refreshViewsJob();
  const blocks = env.ss.getSheetByName("方塊紀錄").getDataRange().getDisplayValues();
  assert.deepEqual(blocks[1].slice(0, 5), ["2026-11-16", "09:00", "10:00", "方塊", "論文"]);
  const tasks = env.ss.getSheetByName("待辦清單").getDataRange().getDisplayValues();
  assert.equal(tasks.length, 3); assert.equal(tasks[2][8], "✓");
});
test("每日備份最多保留 10 份", () => {
  const env = makeEnv(), t = env.api.setup();
  call(env, t, { action: "setMany", docs: { main: { projects: [], tasks: [] } } });
  for (let i = 0; i < 12; i++) env.ctx.makeBackup_("2026-01-" + String(i + 1).padStart(2, "0"));
  const n = env.ss.getSheets().filter(s => s.getName().startsWith("備份 ")).length;
  assert.ok(n <= 10, "backups: " + n);
});
test("每日紀錄（體力、工作、運動）寫進「每日紀錄」工作表", () => {
  const env = makeEnv(), t = env.api.setup();
  call(env, t, { action: "setMany", docs: {
    main: { projects: [], tasks: [], recurring: [] },
    "month-2026-11": { days: {
      "2026-11-17": { blocks: [], log: { energy: 4, work: 390, ex: 60, exNote: "游泳 1500m" } },
      "2026-11-18": { blocks: [{ id: "b", title: "寫", start: 540, dur: 60 }] } } } } });
  env.api.refreshViewsJob();
  const rows = env.ss.getSheetByName("每日紀錄").getDataRange().getDisplayValues();
  assert.deepEqual(rows[1], ["2026-11-17", "4", "6.5", "60", "游泳 1500m"]);
  assert.equal(rows.length, 2);                       // 沒填紀錄的日子不列
});
