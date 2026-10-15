# Third-party materials and distribution scope

The root MIT license covers original AI Nexus code. It does not replace
third-party terms or grant rights to external SDKs, models, fonts or runtimes.

## Source material included

| Component | Included file | Version/terms | Source |
| --- | --- | --- | --- |
| React | src/vendor/react.production.min.js | 18.3.1, MIT | [Published package](https://www.npmjs.com/package/react/v/18.3.1) |
| React DOM | src/vendor/react-dom.production.min.js | 18.3.1, MIT | [Published package](https://www.npmjs.com/package/react-dom/v/18.3.1) |

Original license headers and [their notice](third-party/react/LICENSE.txt) remain
intact. These assets and their notice were also verified byte-for-byte against the
matching installed React/React DOM 18.3.1 package distributions.
No font binary, image pack, icon library, AMD SDK/header/sample/wrapper, helper
executable or inference/voice binary is included. The chevron icon is generated
from the retained project geometry in src-tauri/build.rs.

## External build dependencies

[dependency-inventory.json](third-party/dependency-inventory.json) records versions,
sources, declared licenses, evidence and checksum/integrity data for 97 npm entries
and 499 distinct package/version entries across both Cargo lockfiles. No private cache paths are recorded.

The Windows x64 MSVC app resolution contains 316 registry packages; all their
license expressions were available locally. Existing cached archives were
checked against locked checksums for 453 package/version entries, including
manifest and available license-file comparisons. The remaining 46 non-selected
entries have no locally available license evidence and are explicitly unreviewed. No crate source,
compiled library, installed npm package or build-tool binary is vendored here.
Package metadata is inventory evidence, not a redistribution clearance.

Direct Rust dependencies include Tauri, serde/serde_json, sysinfo, reqwest, tokio,
dirs and windows, with tauri-build for building. npm supplies React/React DOM,
Babel and Tauri CLI tooling. Optional Playwright/playwright-core 1.62.1 test tools
are Apache-2.0, user-supplied and outside the root npm lockfile.

The graph is not uniformly MIT. Notable entries for future artifact review:

| Packages | Recorded expression |
| --- | --- |
| cssparser 0.36.0; cssparser-macros 0.6.1; dtoa-short 0.3.5; option-ext 0.2.0; selectors 0.36.1 | MPL-2.0 |
| ring 0.17.14 | Apache-2.0 AND ISC |
| brotli 8.0.3 | BSD-3-Clause AND MIT |
| dpi 0.1.2 | Apache-2.0 AND MIT |
| unicode-ident 1.0.24 | (MIT OR Apache-2.0) AND Unicode-3.0 |

Other terms include Unicode, certificate/data and additional permissive licenses.
Preserve compound expressions. A dependency graph includes build-only packages;
it does not prove which code ends up in a binary. Any compiled distribution needs
an artifact-specific notice/license/source-availability review, including code
bundled inside dependencies.

## User-supplied components

| Component | Source/reference | Position |
| --- | --- | --- |
| llama.cpp build and backend libraries | [llama.cpp](https://github.com/ggml-org/llama.cpp) and selected distributor | Not included. Review the exact build and its bundled libraries before redistribution. |
| CUDA/HIP/Vulkan drivers and runtime libraries | Selected vendor/distributor | Not included. Separate vendor terms apply. |
| AMD ADLX SDK, helper source/binary and DLLs | [ADLX](https://github.com/GPUOpen-LibrariesAndSDKs/ADLX) | All excluded. Historical helper/SDK provenance and applicable terms remain unresolved. No helper build recipe or distribution clearance is supplied. A current upstream agreement cannot identify an unknown historical SDK. |
| NVIDIA monitoring executable | User's supplied NVIDIA tooling | Not included or validated. Its terms apply. |
| Model/projector/draft/voice assets | Exact publisher/model card | Not included. Licenses and use conditions vary by asset. |
| Open WebUI/TTS/STT/OpenCode | User-selected implementations and versions | No code/assets included. Configuration does not license those tools or dependencies. |
| WebView2, Windows SDK/MSVC, Rust and Node.js | Official vendor/toolchain distributions | Prerequisites only, not included or licensed under the project MIT license. |
| Fonts | Installed system fonts/fallbacks | No files or remote font requests included. Redistribution needs separate review. |

The [monitoring guide](docs/GPU_MONITORING.md) and
[interface reference](docs/MONITOR_PROTOCOL.md) describe existing launcher behavior.
They include no vendor helper implementation. NVIDIA monitoring uses the supplied
nvidia-smi program; it does not require distributing a custom CUDA helper.
AMD's SDK/Python binding is not an AI Nexus protocol adapter. Having users supply
an SDK does not establish rights to distribute an adapter or its compiled output.
Use the agreement accompanying the exact SDK revision being used; the current
upstream agreement does not identify the historical helper's terms.

## Distribution boundary

This is a source-only inventory, not an installer/binary notice package. Before
offering downloads, check the exact output, linked/bundled components, notices,
source availability, SDK/EULA conditions and assets. Preparing this tree does
not approve AMD helper or other binary redistribution.
