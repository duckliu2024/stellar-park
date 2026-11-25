const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const PORT = 9334;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DIR = __dirname;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(url) {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch (_) {}
    await sleep(200);
  }
  throw new Error("chrome not ready");
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

async function main() {
  const userData = path.join(DIR, "chrome-profile");
  fs.rmSync(userData, { recursive: true, force: true });
  const fileUrl = "file://" + path.join(DIR, "guide.html");
  const chrome = spawn(CHROME, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--allow-file-access-from-files",
    "--font-render-hinting=none",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userData}`,
    fileUrl,
  ]);
  chrome.stderr.on("data", (d) => process.stderr.write(d));

  try {
    const targets = await waitFor(`http://127.0.0.1:${PORT}/json/list`);
    const page = targets.find((t) => t.type === "page");
    if (!page) throw new Error("no page: " + JSON.stringify(targets));
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve);
      ws.addEventListener("error", reject);
    });
    const cdp = new CDP(ws);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1080,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send("Runtime.evaluate", {
      expression: "document.fonts.ready",
      awaitPromise: true,
    });
    await sleep(300);

    for (const id of ["p1", "p2", "p3", "p4"]) {
      const box = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const el = document.getElementById(${JSON.stringify(id)});
          const r = el.getBoundingClientRect();
          return { x: r.x + window.scrollX, y: r.y + window.scrollY, width: r.width, height: r.height };
        })()`,
        returnByValue: true,
      });
      const clip = box.result.value;
      const shot = await cdp.send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: true,
        fromSurface: true,
        clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale: 2 },
      });
      const out = path.join(DIR, `${id}.png`);
      fs.writeFileSync(out, Buffer.from(shot.data, "base64"));
      console.log(id, Math.round(clip.width), Math.round(clip.height), fs.statSync(out).size);
    }
    ws.close();
  } finally {
    chrome.kill("SIGKILL");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
