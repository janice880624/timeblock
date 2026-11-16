"use strict";
/* 方塊日程 · 啟動、連接試算表、舊資料搬家 */
/* ---------- boot (Firebase Google sign-in) ---------- */
function renderAll(){ setView(ui.view); renderTodo(); }
function resetData(){ S = { projects: [], tasks: [] }; for (const k in days) delete days[k]; for (const k in weeks) delete weeks[k]; for (const k in archives) delete archives[k]; Store.months = {}; lastScrolledFor = null; }
const CODE_URL = "https://github.com/janice880624/timeblock/blob/main/gas/Code.gs";
function gasErr(code){
  return { bad_token: "連線密碼不正確", not_setup: "試算表還沒執行 setup", network: "連不到網址，請確認部署時「誰可以存取」選了「所有人」", bad_response: "這個網址回應的不是方塊日程（網址要用 /exec 結尾的那個）" }[code] || ("連線失敗：" + code);
}
async function collectCurrent(){
  const out = {};
  {
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && /^blk:(main|day-|week-|month-|archive-)/.test(k)) out[k.slice(4)] = lsGet(k); } } catch {}
  }
  return out;
}
function openGasSetup(){
  const cur = lsGet("blk:gas") || {};
  const canMig = loaded && (S.projects.length || S.tasks.length || recs().length);
  openModal(`<h3>連接我自己的試算表</h3>
    <details class="howto" ${cur.url ? "" : "open"}><summary>第一次使用？設定步驟（約 3 分鐘）</summary><ol>
      <li><a href="https://docs.google.com/spreadsheets/d/19JEZJzrM6RGVGR918iubUGKpUoQCeix7lGUA5LwTd_s/copy" target="_blank" rel="noopener">複製範本試算表 ↗</a>（按「建立副本」）</li>
      <li>在你的副本上方選單「<b>方塊日程</b>」→「<b>初始設定</b>」，第一次會要求授權（選自己的帳號 →「進階」→「前往」→「允許」）。完成後「設定」頁會出現<b>連線密碼</b></li>
      <li>「擴充功能」→「Apps Script」→ 右上「部署」→「新增部署作業」→ 類型選「網頁應用程式」，執行身分「我」、誰可以存取「所有人」→ 按「部署」，複製 <b>/exec</b> 結尾的網址</li>
      <li>把網址和連線密碼貼到下面</li>
    </ol></details>
    <label class="fld">網頁應用程式網址<input type="text" class="mono" id="gUrl" value="${esc(cur.url || "")}" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off"></label>
    <label class="fld">連線密碼<input type="text" class="mono" id="gTok" value="${esc(cur.token || "")}" autocomplete="off"></label>
    ${canMig ? `<label class="nodate" style="margin-bottom:10px"><input type="checkbox" id="gMig" checked> 把目前的資料一起複製到這個試算表</label>` : ""}
    <p class="login-err" id="gErr"></p>
    <div class="acts"><button class="btn ghost" id="mCancel">取消</button><button class="btn" id="gGo">連線</button></div>
    <div class="oldfb">之前用 Google 帳號登入過？填好網址和密碼後，<button id="gOld">從舊的 Google 帳號搬資料</button></div>`);
  $("#mCancel").onclick = closeModal;
  loadFB().catch(() => {});                          // preload so the sign-in popup opens right on the click
  $("#gOld").onclick = () => migrateFromFirebase();
  $("#gGo").onclick = async () => {
    const url = $("#gUrl").value.trim(), token = $("#gTok").value.trim(), err = $("#gErr");
    if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(url)) { err.textContent = "網址要是 https://script.google.com/… 開頭、/exec 結尾"; return; }
    if (!token) { err.textContent = "請輸入連線密碼"; return; }
    const btn = $("#gGo"); btn.disabled = true; btn.textContent = "連線中…"; err.textContent = "";
    const prev = Store.gas; Store.gas = { url, token };
    try {
      const ping = await Store.gasCall({ action: "ping" });
      if ($("#gMig") && $("#gMig").checked) {
        if (ping.count && !btn.dataset.ok) { err.textContent = `這個試算表已經有 ${ping.count} 筆資料，複製會覆蓋同名資料。確定的話再按一次「連線」。`; btn.dataset.ok = 1; btn.disabled = false; btn.textContent = "確定複製並連線"; Store.gas = prev; return; }
        btn.textContent = "複製資料中…";
        Store.flushAll();
        const docs = await collectCurrent(), keys = Object.keys(docs);
        for (let i = 0; i < keys.length; i += 40) {
          const part = {}; keys.slice(i, i + 40).forEach(k => part[k] = docs[k]);
          await Store.gasCall({ action: "setMany", docs: part });
          btn.textContent = `複製資料中… ${Math.min(i + 40, keys.length)}/${keys.length}`;
        }
      }
      lsSet("blk:gas", { url, token }); try { localStorage.removeItem("blk:trial"); if (!cur.url || cur.url !== url) localStorage.removeItem("blk:outbox"); } catch {}
      closeModal(); toast(`已連接「${ping.name}」`);
      setTimeout(() => location.reload(), 600);
    } catch (e) {
      Store.gas = prev; btn.disabled = false; btn.textContent = "連線"; err.textContent = gasErr(e.code);
    }
  };
}
async function migrateFromFirebase(){
  const url = $("#gUrl").value.trim(), token = $("#gTok").value.trim(), err = $("#gErr");
  if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(url) || !token) { err.textContent = "請先填好試算表網址和連線密碼"; return; }
  if (!FB) { err.textContent = "載入中，請再按一次"; loadFB().catch(() => {}); return; }
  const F = FB, btn = $("#gOld");
  let app; try { app = F.getApp("old"); } catch { app = F.initializeApp(firebaseConfig, "old"); }
  const auth = F.getAuth(app);
  let cred;
  try { cred = await F.signInWithPopup(auth, new F.GoogleAuthProvider()); }      // must run first, straight from the click
  catch (e) { err.textContent = e.code === "auth/popup-blocked" ? "瀏覽器擋住了登入視窗，請允許彈出視窗後再試" : "Google 登入失敗：" + (e.code || e.message); return; }
  const prev = Store.gas; Store.gas = { url, token };
  try {
    btn.textContent = "連線試算表中…";
    await Store.gasCall({ action: "ping" });
    btn.textContent = "讀取舊資料中…";
    const snap = await F.getDocs(F.collection(F.getFirestore(app), "users", cred.user.uid, "planner"));
    const docs = {}; snap.forEach(d => { docs[d.id] = d.data(); });
    const keys = Object.keys(docs);
    if (!keys.length) { err.textContent = "這個 Google 帳號沒有舊資料"; Store.gas = prev; btn.textContent = "從舊的 Google 帳號搬資料"; return; }
    for (let i = 0; i < keys.length; i += 40) {
      const part = {}; keys.slice(i, i + 40).forEach(k => part[k] = docs[k]);
      await Store.gasCall({ action: "setMany", docs: part });
      btn.textContent = `搬資料中… ${Math.min(i + 40, keys.length)}/${keys.length}`;
    }
    try { await F.signOut(auth); } catch {}
    lsSet("blk:gas", { url, token });
    closeModal(); toast(`已搬好 ${keys.length} 筆資料`);
    setTimeout(() => location.reload(), 700);
  } catch (e) {
    Store.gas = prev; btn.textContent = "從舊的 Google 帳號搬資料"; err.textContent = e.code && !String(e.code).startsWith("permission") ? gasErr(e.code) : "讀取舊資料失敗：" + (e.code || e.message);
  }
}
async function startGas(cfg){
  Store.mode = "gas"; Store.gas = cfg; Store.allLoaded = false;
  resetData(); loaded = false; renderAll(); setSync("從試算表讀取中…");
  $("#login").classList.add("hidden");
  const a = $("#acct"); a.querySelector("span").textContent = "試算表連線中…";
  let info = {};
  try {
    const j = await Store.gasCall({ action: "ping" }); info = j;
    if ((j.keys || []).some(k => k.startsWith("day-"))) {        // 舊格式（每天一列）→ 每月一列，只需要一次
      setSync("整理資料格式中（只需要一次）…");
      await Store.gasCall({ action: "migrateDays" });
    }
    const ym = ui.date.slice(0, 7);
    const [m] = await Promise.all([Store.fetchDocs(["main"]), Store.ensureMonths([monthAdd(ym, -1), ym, monthAdd(ym, 1)])]);
    if (m.docs.main && Array.isArray(m.docs.main.projects)) S = m.docs.main;
    recs();
    const ob = lsGet("blk:outbox") || {}; let replay = 0;
    for (const k of Object.keys(ob)) {
      const e = ob[k];
      if (k.startsWith("day-")) {                                   // 舊版留下的：套到那天再存進當月
        try { await Store.ensureMonths([k.slice(4, 11)]); } catch { continue; }
        Store.applyDoc(k, e.doc); Store.save(k, e.doc); Store.outboxDel(k); replay++; continue;
      }
      if (!(k in Store.ver)) { try { await Store.fetchDocs([k]); if (k.startsWith("month-")) Store.months[k.slice(6)] = true; } catch { continue; } }
      const sv = k in Store.ver ? Store.ver[k] : null;
      const doc = e.ver === sv ? e.doc : merge3(e.base, e.doc, Store.base[k]);
      Store.applyDoc(k, doc); Store.pending[k] = clone(doc); replay++;
    }
    await loadDay(ui.date);
    loaded = true; setSync("已連到你的試算表");
    if (replay) { Store.flushGas(); toast(`補存了上次沒存到的 ${replay} 筆變更`); }
    a.classList.add("on"); a.querySelector("span").textContent = "試算表：" + (j.name || "已連線");
    setTimeout(archiveOld, 3000);
  } catch (e) {
    setSync(gasErr(e.code)); a.querySelector("span").textContent = "試算表連線失敗";
  }
  Store.onChange = () => { renderAll(); if (ui.view === "habit") renderHabit(); };
  a.onclick = () => {
    openModal(`<h3>我的試算表</h3>
      <p class="fld">${info.name ? `目前連到「${esc(info.name)}」` : "目前連線失敗"}</p>
      ${info.url ? `<p class="fld"><a href="${esc(info.url)}" target="_blank" rel="noopener" style="color:var(--accent)">打開試算表 ↗</a>　「待辦清單」「方塊紀錄」「固定行程」頁可以直接看資料</p>` : ""}
      <div class="acts"><button class="btn danger" id="gOff">中斷連線</button><span style="display:flex;gap:8px"><button class="btn ghost" id="gEdit">修改連線</button><button class="btn ghost" id="mCancel">關閉</button></span></div>`);
    $("#mCancel").onclick = closeModal;
    $("#gEdit").onclick = openGasSetup;
    $("#gOff").onclick = () => { Store.flushAll(); setTimeout(() => { try { localStorage.removeItem("blk:gas"); localStorage.removeItem("blk:trial"); localStorage.removeItem("blk:outbox"); } catch {} location.reload(); }, 800); };
  };
  renderAll();
}
async function startLocal(msg){
  Store.mode = "local";
  const main = lsGet("blk:main"); if (main && Array.isArray(main.projects)) S = main; recs();
  await loadDay(ui.date);
  loaded = true; setSync(msg);
  setTimeout(archiveOld, 3000);
  $("#acct").querySelector("span").textContent = "本機試用 · 點此連接試算表";
  $("#acct").onclick = openGasSetup;
  renderAll();
}
function boot(){
  renderAll();
  $("#gasLogin").onclick = openGasSetup;
  $("#tryLocal").onclick = () => { lsSet("blk:trial", 1); $("#login").classList.add("hidden"); startLocal("本機試用：資料只存在這台裝置"); };
  const g = lsGet("blk:gas");
  if (g && g.url && g.token) { startGas(g); return; }
  if (lsGet("blk:trial")) { startLocal("本機試用：資料只存在這台裝置"); return; }
  $("#login").classList.remove("hidden");
  setSync("請先連接試算表");
  $("#acct").querySelector("span").textContent = "尚未連接";
  $("#acct").onclick = openGasSetup;
}
boot();
