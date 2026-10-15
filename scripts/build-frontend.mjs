// Builds the static frontend into ./dist
//   - transpiles src/launcher/*.jsx -> dist/launcher/*.js (Babel, JSX only, no modules)
//   - copies css / icons / vendored React
//   - writes dist/index.html that loads plain <script> tags (no runtime Babel)
// Output is fully static: Tauri serves it, and it also opens directly in a browser
// (where window.Backend reports isTauri=false and the preview stays read-only).

import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync } from "node:fs";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "src");
const DIST = join(root, "dist");
// An existing installed tool set can be read without installing/copying packages.
// The default remains the dependencies installed in this development project.
const toolRequire = createRequire(process.env.AI_NEXUS_BUILD_TOOLS
  ? join(resolve(process.env.AI_NEXUS_BUILD_TOOLS), "package.json")
  : import.meta.url);
const babel = toolRequire("@babel/core");
const reactPreset = toolRequire.resolve("@babel/preset-react");

// load order — everything must be defined before app.jsx renders
const SCRIPTS = [
  "bridge", "data", "gpu", "models", "services", "fx", "settings", "app",
];

function build() {
  const rel = relative(root, DIST);
  if (rel !== "dist" || isAbsolute(rel)) throw new Error("Refusing to clear output outside this project.");
  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(join(DIST, "launcher"), { recursive: true });
  mkdirSync(join(DIST, "vendor"), { recursive: true });
  cpSync(join(SRC, "launcher", "config-ui.js"), join(DIST, "launcher", "config-ui.js"));
  const example = JSON.parse(readFileSync(join(root, "config", "launcher.config.example.json"), "utf8").replace(/^\uFEFF/, ""));
  writeFileSync(join(DIST, "launcher", "example.js"), "window.NEXUS_EXAMPLE = " + JSON.stringify(example).replace(/</g, "\\u003c") + ";\n");

  // 1) transpile each JSX file (JSX syntax only; webview is modern Chromium)
  for (const name of SCRIPTS) {
    const inPath = join(SRC, "launcher", `${name}.jsx`);
    const code = readFileSync(inPath, "utf8");
    const out = babel.transformSync(code, {
      filename: inPath,
      presets: [[reactPreset, { runtime: "classic", pragma: "React.createElement" }]],
      babelrc: false,
      configFile: false,
      sourceType: "script",   // shared global scope, assigns to window — NOT ES modules
      compact: false,
      comments: false,
    });
    writeFileSync(join(DIST, "launcher", `${name}.js`), out.code, "utf8");
  }

  // 2) static assets
  cpSync(join(SRC, "launcher", "launcher.css"), join(DIST, "launcher", "launcher.css"));
  for (const ic of ["icon.svg", "icon.png"]) {
    const p = join(SRC, "launcher", ic);
    if (existsSync(p)) cpSync(p, join(DIST, "launcher", ic));
  }
  cpSync(join(SRC, "vendor"), join(DIST, "vendor"), { recursive: true });

  // 3) index.html — vendored React, then compiled scripts, in order
  const scriptTags = SCRIPTS.map((n) => `<script src="launcher/${n}.js"></script>`).join("\n");
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self' ipc: http://ipc.localhost; script-src 'self'" />
<title>AI Nexus · Development</title>
<link rel="stylesheet" href="launcher/launcher.css" />
</head>
<body>
<div id="root"></div>

<script src="vendor/react.production.min.js"></script>
<script src="vendor/react-dom.production.min.js"></script>
<script src="launcher/example.js"></script>
<script src="launcher/config-ui.js"></script>
${scriptTags}
</body>
</html>
`;
  writeFileSync(join(DIST, "index.html"), html, "utf8");
  console.log(`[build:frontend] dist ready — ${SCRIPTS.length} scripts transpiled.`);
}

build();
