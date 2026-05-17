const https = require("https");

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY || "";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

require("http").createServer((req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  if (req.method !== "POST" || req.url !== "/api") {
    res.writeHead(404); res.end("Not found"); return;
  }
  if (!API_KEY) {
    res.writeHead(500); res.end(JSON.stringify({ error: "API key not set" })); return;
  }

  let body = "";
  req.on("data", d => { body += d; if (body.length > 200000) req.destroy(); });
  req.on("end", () => {
    let parsed;
    try { parsed = JSON.parse(body); } catch {
      res.writeHead(400); res.end(JSON.stringify({ error: "Bad JSON" })); return;
    }

    const payload = JSON.stringify({
      model: parsed.model || "claude-sonnet-4-20250514",
      max_tokens: Math.min(parsed.max_tokens || 1000, 2500),
      system: parsed.system,
      messages: parsed.messages,
    });

    const options = {
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Length": Buffer.byteLength(payload),
      },
    };

    const apiReq = https.request(options, apiRes => {
      let data = "";
      apiRes.on("data", d => data += d);
      apiRes.on("end", () => {
        res.writeHead(apiRes.statusCode, { "Content-Type": "application/json" });
        res.end(data);
      });
    });

    apiReq.on("error", e => {
      res.writeHead(502); res.end(JSON.stringify({ error: e.message }));
    });
    apiReq.setTimeout(35000, () => { apiReq.destroy(); });
    apiReq.write(payload);
    apiReq.end();
  });
}).listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
