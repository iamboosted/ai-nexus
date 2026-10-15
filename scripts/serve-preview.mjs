// Tiny static server for previewing the built frontend in a browser.
//   npm run preview  ->  builds dist/ then serves it at http://127.0.0.1:5174
// Outside Tauri, window.Backend reports isTauri=false and the UI runs its
// read-only preview; it does not simulate telemetry or running services.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, relative, isAbsolute } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(root, "dist");
const PORT = 5174;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
};

const server = createServer(async (req, res) => {
  try {
    let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    if (urlPath === "/") urlPath = "/index.html";
    // prevent path traversal
    const filePath = resolve(DIST, '.' + urlPath);
    const rel = relative(DIST, filePath);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    const data = await readFile(filePath);
    res.writeHead(200, { "Content-Type": TYPES[extname(filePath)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404).end("not found");
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`AI Nexus read-only preview -> http://127.0.0.1:${PORT}`);
});
