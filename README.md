# AI Nexus

A Windows desktop dashboard for a user-supplied llama.cpp server, model entries
and optional local services. Includes detached Settings, editable context profiles,
themes, live decorative animation, a compact HUD, CPU/RAM readings and a
GPU-monitoring integration.

**Source-only developer preview.** No installer, inference runtime, model, voice
asset or AMD monitoring helper is included. CUDA, HIP and Vulkan are backend
selection labels; real inference compatibility is not yet verified for this preview.
There is no automatic model downloading or GPU tuning.

Original project code is [MIT licensed](LICENSE). See
[third-party notices](THIRD_PARTY_NOTICES.md) for included material and external
components, and [validation evidence](docs/VALIDATION.md) for tested behavior.

## Build on Windows

Open PowerShell in the checkout directory. Supply Node.js/npm, a Rust MSVC
toolchain, Microsoft C++ Build Tools with a Windows SDK, and Microsoft Edge WebView2.
Preparation used Node.js 24.15.0, Rust 1.96.0, Babel 7.29.7, Tauri CLI 2.11.2 and
React/React DOM 18.3.1. Rust 1.88 is the manifest's declared minimum, not a verified
minimum. Other operating systems are unverified.

### First-time dependencies

These commands acquire development packages. Run them only when you choose to
allow downloads. They do not acquire models or inference services. They were not
executed during source-export preparation.

~~~powershell
npm ci --ignore-scripts --no-audit --no-fund
cargo fetch --locked --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc
cargo fetch --locked --manifest-path tests/native-core/Cargo.toml --target x86_64-pc-windows-msvc
~~~

Lockfiles record versions, registry locations and integrity/checksum data.
Integrity is not proof of safety. The npm command disables install scripts; its
lock includes an optional macOS-only fsevents script, unnecessary on Windows.
Keep dependency acquisition separate from ordinary offline rebuilding.

### Build and run after supplying dependencies

~~~powershell
npm run build:frontend
cargo build --offline --locked --manifest-path src-tauri/Cargo.toml --target-dir .build/desktop
& '.\.build\desktop\debug\ai-nexus-dev.exe'
~~~

npm run dev starts the development watch workflow. Its Tauri wrapper keeps Cargo
offline and output under .build/desktop, so it expects dependency setup to be
complete. npm run preview serves a read-only browser view at
http://127.0.0.1:5174; it cannot save settings, run processes or invent telemetry.

These instructions require no private launcher installation. The optional
AI_NEXUS_BUILD_TOOLS override can point to an existing folder with matching npm
build dependencies. It is build tooling, not launcher configuration.

## Configure your first entry

The app starts with an empty roster, unset runtime/helper paths, loopback ports,
and disabled optional services and OpenCode sync.

1. In Settings → Runtime, select your supplied llama.cpp build's backend and
   Browse to llama-server. Keep its required runtime libraries beside it.
2. Under Models, add a unique ID/display name and Browse to a GGUF. Supply a
   projector or draft file only when your model/build requires it.
3. Add named context profiles using presets or a custom token count. GPU splits
   and cache settings are under Advanced options. Blank GPU settings defer to the
   backend; device identifiers and splits must match your actual build.
4. Save changes, then explicitly press START on the dashboard.

Flags have an add/remove editor and searchable guidance. Settings links to the
official llama.cpp reference and displays a quoted help command for your supplied
executable. It never runs that command automatically. Flags vary between builds.

Removing an entry changes configuration only, including its optional OpenCode
mapping; it never deletes model or auxiliary files. Stop an active entry before
editing/removing it. Browse fills a draft without running or saving the file.
Context names are separate from stable IDs. The reply limit affects OpenCode
sync only, not llama-server generation limits.

## Settings and shutdown

Settings is movable/resizable, with scrolling content and an accessible save
footer. Appearance previews live and saves separately. Model/runtime/integration
drafts require Save changes. Closing Settings flushes appearance, discards other
unsaved drafts and keeps the dashboard and owned processes running.

Closing the dashboard stops this session's owned process trees and exits.
Minimize/compact HUD keep them running. Private Windows job handles retain worker
ownership after parent exit; unregistered processes are not assigned to those jobs.
Shutdown is forced termination, not service-specific graceful shutdown.
Readiness requires /health success and the expected /v1/models alias within a
fixed 120-second startup deadline.

## Configuration and recovery

One configuration drives model cards, contexts, runtime arguments, ports,
appearance, monitoring and integrations. See the
[safe schema example](config/launcher.config.example.json).

Configuration and WebView data live under .ai-nexus-data in the checkout used at
build time. Keep that checkout when running its development executable; moving
the executable alone is not a supported portable installation. Use one app
instance per checkout. Cross-process writer locking and installed/portable storage
design are pending.

Missing configuration opens an empty setup state. Invalid configuration is reported
without silently replacing it. Saves validate IDs, paths, contexts, splits, flags
and enabled integrations, and retain launcher.config.previous.json. Repair/recovery
also preserves invalid/replaced configuration. AI_NEXUS_DATA_DIR may point only
to an absolute directory inside this checkout. No recovery operation deletes models.

## Monitoring and optional integrations

CPU/RAM use native system samples. GPU cards and the HUD are retained, but GPU
monitoring defaults to unavailable. Failed polls clear readings. Ambient animation
is decorative, not measurement data. No font files are included; installed system
fallbacks can affect typography.

Monitoring providers are separate from the CUDA/HIP/Vulkan inference selection.
Monitoring does not require starting a model or an optional service.

### NVIDIA

You need a working NVIDIA driver/tooling installation with `nvidia-smi.exe`.
This monitoring path does not need a custom helper or the CUDA Toolkit.

1. Find your installed nvidia-smi executable. If it is on PATH, this optional
   PowerShell command shows its full path:

   ~~~powershell
   Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
   ~~~

   An empty result only means this command did not find it on PATH. Check your
   installed NVIDIA tooling for its location; the launcher does not install it.
2. Open Settings → Runtime → GPU monitoring. Choose `nvidia-smi` as the
   Monitoring source, enter that full path in User-supplied nvidia-smi path,
   then Save changes.
3. Check the dashboard for the measurements your GPU supports. To check the tool
   independently, use the [read-only query in the monitoring guide](docs/GPU_MONITORING.md#nvidia-use-an-existing-nvidia-smi-installation).

See [NVIDIA's official reference](https://docs.nvidia.com/deploy/nvidia-smi/) for
the tool and supported queries.

### AMD

AMD monitoring needs a compatible ADLX-based adapter: a small program that reads
the GPU's measurements and returns them in the format AI Nexus understands.
This preview does not include one. Preparing an adapter is a developer step; the
outline below is guidance, not a tested start-to-finish build recipe. With an
existing compatible helper, start at step 4.

1. Start with the [official ADLX SDK repository](https://github.com/GPUOpen-LibrariesAndSDKs/ADLX)
   and [AMD's getting-started guide](https://gpuopen.com/manuals/adlx/programming-with-adlx/adlx-programming-guide/quick-start/).
   Follow AMD's Windows C/C++ prerequisites and SDK terms.
2. Use AMD's performance-monitoring examples as a starting point for reading the
   measurements your GPU supports. Use the monitoring examples, not GPU tuning
   or stress-test examples.
3. Adapt that program to [AI Nexus's helper protocol](docs/MONITOR_PROTOCOL.md#amd-process-and-response-contract),
   then build it as a Windows executable. In plain terms, it must accept
   `--serve`, wait for a `poll` request, and send back one line containing the
   GPU readings as JSON. Installing the SDK or building an unchanged AMD sample
   does not complete this adapter step.
4. Open Settings → Runtime → GPU monitoring. Choose `amd-adlx`, enter the full
   executable path in User-supplied AMD helper path, then Save changes.
5. Check the dashboard for the measurements your GPU supports. If the helper
   cannot start, returns the wrong format or takes too long to reply, AI Nexus
   shows monitoring as unavailable.

### If readings are missing

Check that you saved the correct Monitoring source and full executable path.
An unsupported measurement appears as `--`; do not treat that as a zero reading.
For NVIDIA, try the read-only query linked above. For AMD, check the adapter's
response format and timing against the protocol reference.

GPU/provider compatibility is unverified in this preview. You can leave the
Monitoring source set to `unavailable` and still use CPU/RAM readings and the
rest of the launcher. There is no need to change drivers, permissions or tuning
settings just to follow this walkthrough. See the
[monitoring guide](docs/GPU_MONITORING.md) for troubleshooting and
[third-party notices](THIRD_PARTY_NOTICES.md) for the separate vendor terms.

### Optional integrations

Integrations currently use advanced JSON for WebUI/TTS/STT commands and OpenCode
mappings. Services require explicit enablement, distinct loopback ports, matching
health URLs and tokenized executable commands. Enablement does not automatically
start anything. Implementations, dependencies and assets are user-supplied.
OpenCode sync updates only its separately configured JSON, keeps a backup and
reports sync failures as warnings after inference readiness.

## Source snapshot

[SOURCE_MANIFEST.json](SOURCE_MANIFEST.json) records SHA-256 hashes of every
exported file except itself. Its own exclusion is explicit: embedding its hash
would change the manifest being hashed. Hashes cover ordinary file contents;
Windows alternate streams are checked separately. Seven download-marker streams
were removed from this export, and the final stream scan found none.

The manifest is an integrity snapshot, not a signature or redistribution approval.
Update it after source or documentation changes. See the
[sanitation checks and limits](docs/VALIDATION.md#sanitation-and-source-provenance).

## Tests and contribution

~~~powershell
node --test tests/config-ui.test.cjs
cargo test --offline --locked --manifest-path tests/native-core/Cargo.toml --target-dir .build/native-core
~~~

The [optional native lifecycle suite](tests/lifecycle/README.md) uses a compiled
dummy HTTP server and plain-text placeholders, not real inference or services.
See [validation evidence and limits](docs/VALIDATION.md). Real CUDA/HIP/Vulkan
inference, helper/GPU behavior, optional services, OpenCode end-to-end operation
and clean-Windows installation remain unverified. Native picker opening/cancellation
was tested previously; actual Open-button selection still needs manual confirmation.
Wider display-scale coverage is pending.

Read [CONTRIBUTING.md](CONTRIBUTING.md). Preserve the existing dashboard, themes,
typography treatment and motion controls.
