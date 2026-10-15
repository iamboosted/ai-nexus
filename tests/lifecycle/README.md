# Native lifecycle fixtures

This optional Windows suite uses actual Tauri IPC, Windows processes and loopback
HTTP. Its Rust standard-library-only dummy never opens the plain-text GGUF
placeholders and implements no inference, GPU access or optional service.

First build the app using the root README. Its default executable is
.build/desktop/debug/ai-nexus-dev.exe. AI_NEXUS_TEST_APP can override that only
inside the same checkout.

## Tools

[tool-requirements.json](tool-requirements.json) records tested Playwright and
playwright-core 1.62.1 under Apache-2.0. These optional test tools are separate
from the root npm lockfile. The runner attaches to installed WebView2; no separate
browser download is needed.

If you choose to acquire these tools, the following is an explicit network
installation step. It was not run during source-export preparation.

~~~powershell
npm install --prefix .build/ui-tools --save-exact --ignore-scripts --no-audit --no-fund playwright@1.62.1
$env:AI_NEXUS_UI_TEST_TOOLS = (Resolve-Path '.build/ui-tools/node_modules').Path
npm run test:lifecycle
~~~

Alternatively point AI_NEXUS_UI_TEST_TOOLS at an existing supplied node_modules
directory with that version. The runner never installs packages/browsers; it
compiles the dummy directly with installed rustc.

## Behavior

The 26-check full suite takes several minutes and includes the actual 120-second
deadline. English TEST INSTANCE windows use isolated configuration/logs/WebView
storage under .test-fixtures. Monitoring, optional services and OpenCode sync
stay disabled. The Vulkan label tests validation only; no Vulkan runtime loads.

Checks include startup files/ports, HTTP/JSON readiness, entry/context switching,
cancellation generations, active-entry protection, non-destructive removal, five
immediate exits, health loss/recovery, independent Settings closure, startup
shutdown, crashed-parent worker cleanup and termination of only the test launcher.

An unregistered dummy verifies preservation of other processes. Final cleanup
checks exact fixture executable identity with an open process handle before
stopping leftovers. Results go to .build/lifecycle/results.json. A failed assertion
stays failed. --skip-deadline omits one case for a targeted rerun; report it as
skipped and retain the earlier full-run evidence.

Restricted sandboxes may block native windows/loopback; report that limitation.
Generated executables, logs, caches and fixtures stay out of source.
See [validation evidence](../../docs/VALIDATION.md). These checks do not establish
real backend/GPU/service compatibility, graceful shutdown or clean-Windows packaging.
