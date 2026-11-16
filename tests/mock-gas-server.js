// 本機模擬 Apps Script 網頁應用程式：node tests/mock-gas-server.js [port]
const http = require("http");
const { makeEnv } = require("./gas-env");
const { api, ss, props, triggers } = makeEnv();
const token = api.setup();
const port = +(process.argv[2] || 8787);
http.createServer((req, res) => {
  let body = ""; req.on("data", c => body += c); req.on("end", () => {
    if (req.url === "/__state") { res.end(JSON.stringify({ token, props, triggers, sheets: ss.sheets.map(s => ({ name: s.name, hidden: s.hidden, rows: s.rows.length, keys: s.name === "data" ? s.rows.slice(1).map(r => r && r[0]).filter(Boolean) : undefined, sample: s.name === "data" ? undefined : s.rows.slice(0, 6) })) })); return; }
    if (req.url === "/__job") { api.refreshViewsJob(); res.end("{}"); return; }
    if (req.url === "/__backup") { api.backupDaily(); res.end("{}"); return; }
    if (req.url === "/__seed") { const d = JSON.parse(body); const r = JSON.parse(api.doPost({ postData: { contents: JSON.stringify({ token, action: "setMany", docs: d }) } }).body); res.end(JSON.stringify(r)); return; }
    const out = api.doPost({ postData: { contents: body } });
    res.setHeader("Content-Type", "application/json"); res.end(out.body);
  });
}).listen(port, () => console.log("mock gas on", port, "token", token));
