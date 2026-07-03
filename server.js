const https = require("https");

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

// Tar emot anrop i samma format som tidigare (Anthropic-stil):
//   { system, messages: [{role:"user"|"assistant", content}], max_tokens }
// och svarar i samma format: { content: [{ type:"text", text }] }
// — så index.html behöver inte ändras.

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

    // Översätt Anthropic-format → Gemini-format
    const contents = (parsed.messages || []).map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: typeof m.content === "string" ? m.content : "" }],
    }));

    const geminiBody = {
      contents,
      generationConfig: {
        maxOutputTokens: Math.min(parsed.max_tokens || 1000, 2500),
      },
    };
    if (parsed.system) {
      geminiBody.system_instruction = { parts: [{ text: String(parsed.system) }] };
    }

    const payload = JSON.stringify(geminiBody);

    const options = {
      hostname: "generativelanguage.googleapis.com",
      path: `/v1beta/models/${GEMINI_MODEL}:generateContent`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": API_KEY,
        "Content-Length": Buffer.byteLength(payload),
      },
    };

    const apiReq = https.request(options, apiRes => {
      let data = "";
      apiRes.on("data", d => data += d);
      apiRes.on("end", () => {
        let out;
        try {
          const g = JSON.parse(data);
          if (apiRes.statusCode !== 200) {
            out = { error: g.error?.message || "Gemini error", content: [] };
            res.writeHead(apiRes.statusCode, { "Content-Type": "application/json" });
            res.end(JSON.stringify(out)); return;
          }
          const text = g.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
          // Översätt Gemini-svar → Anthropic-format som frontenden förväntar sig
          out = { content: [{ type: "text", text }] };
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(out));
        } catch {
          res.writeHead(502); res.end(JSON.stringify({ error: "Bad upstream response" }));
        }
      });
    });

    apiReq.on("error", e => {
      res.writeHead(502); res.end(JSON.stringify({ error: e.message }));
    });
    apiReq.setTimeout(35000, () => { apiReq.destroy(); });
    apiReq.write(payload);
    apiReq.end();
  });
}).listen(PORT, () => console.log(`Gemini proxy running on port ${PORT}`));
