# GPU monitoring setup

This guide describes the existing source developer preview. Real NVIDIA/AMD
monitoring has not been validated in this sanitized copy. The launcher ships no
monitoring executable, SDK, driver or vendor DLL.

CPU and RAM readings use the launcher's native sysinfo integration and need no
GPU helper. GPU monitoring is independent of the inference backend: CUDA, HIP and
Vulkan select the supplied llama.cpp build, while the monitoring provider selects
how the launcher reads GPU metrics.

| Monitoring source in Settings | Supplied by the user | Current scope |
| --- | --- | --- |
| `unavailable` | Nothing | Default; no GPU measurements displayed |
| `nvidia-smi` | A working NVIDIA nvidia-smi executable and its driver environment | Existing command/CSV integration; hardware compatibility unverified here |
| `amd-adlx` | A compatible executable implementing the [AI Nexus protocol](MONITOR_PROTOCOL.md#amd-process-and-response-contract) | Interface retained; implementation and supported build recipe are not included |

One provider is selected at a time. The current implementation does not merge
NVIDIA and AMD providers. Monitoring indices are not a mapping to CUDA/HIP/Vulkan
device identifiers. Configure inference devices using the supplied backend's own
identifiers.

## NVIDIA: use an existing nvidia-smi installation

No custom CUDA helper or CUDA Toolkit is required by this monitoring integration.
Supply a working nvidia-smi installation from NVIDIA's driver/tooling environment.
The launcher does not install it or discover a fixed vendor installation path.

If it is already on PATH, this optional PowerShell command only locates it:

~~~powershell
Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
~~~

If that returns nothing, use the location from your own installed NVIDIA tooling.
An empty result does not establish that the driver or program is absent.

To check the same read-only query the launcher uses, replace the illustrative
path below with your actual executable path. Run it yourself only when you want
to query the GPU; AI Nexus does not execute commands from this document.

~~~powershell
$nvidiaSmi = 'C:\Tools\NVIDIA\nvidia-smi.exe'
& $nvidiaSmi '--query-gpu=index,name,temperature.gpu,power.draw,memory.used,memory.total,utilization.gpu' '--format=csv,noheader,nounits'
~~~

This query requests identity, temperature, power, memory and utilization. It
contains no clock, power-limit, reset or driver-setting operation. See
[NVIDIA's official nvidia-smi reference](https://docs.nvidia.com/deploy/nvidia-smi/).
NVIDIA documents that unsupported measurements can be N/A and that command output
is not guaranteed to remain compatible across releases.

1. Open Settings, then Runtime, then GPU monitoring.
2. Set Monitoring source to `nvidia-smi`.
3. Enter the absolute executable path in User-supplied nvidia-smi path.
4. Keep the default Poll interval of 2000 ms initially, then Save changes.

Saving validates the current configuration draft, including other edited paths.
Monitoring does not require starting a model or an optional service. The app will
invoke the chosen monitoring program when its dashboard polls.

Unknown or unsupported scalar measurements display as `--`; they are not
zeroes. This NVIDIA query supplies no hotspot measurement. The current reader
expects the documented seven-column CSV order and uses a simple comma split.
If the exact query or format fails, leave the provider unavailable and report the
redacted failure rather than altering drivers or permissions to satisfy this guide.

## AMD: a compatible adapter is required

The `amd-adlx` option expects an executable speaking AI Nexus's own
stdin/stdout protocol. Installing the ADLX SDK or building AMD's Python extension
does not create that executable.

If you already supply a compatible executable:

1. Verify its origin, applicable terms and protocol compatibility.
2. In Settings, Runtime, GPU monitoring, choose `amd-adlx`.
3. Enter its absolute path in User-supplied AMD helper path.
4. Save changes. Dashboard polling can now start that executable with `--serve`.

Those are configuration steps for an existing adapter, not a recipe for obtaining
or building one. The [interface reference](MONITOR_PROTOCOL.md) specifies what the
launcher expects and what adapter developers must account for.

Official AMD references:

- [ADLX repository and SDK structure](https://github.com/GPUOpen-LibrariesAndSDKs/ADLX).
- [Current upstream SDK agreement](https://github.com/GPUOpen-LibrariesAndSDKs/ADLX/blob/main/ADLX%20SDK%20License%20Agreement.pdf).
- [Building Python bindings for ADLX](https://gpuopen.com/manuals/adlx/programming-with-adlx/adlx-programming-guide/quick-start/building-python-bindings-for-adlx/).

The Python guide builds a Python extension, with its own listed prerequisites.
It does not describe AI Nexus's process protocol. AMD states that the ADLX library
is installed with the display driver; the actual DLL-loading behavior of any
supplied adapter still depends on that adapter and must be established separately.

These upstream links can change. They do not identify the SDK revision or license
used for the historical helper. No historical SDK version, tested adapter build,
runtime DLL selection or redistribution permission is established by this guide.
No AMD helper source, headers, samples, wrapper, executable or DLL is included.

Before providing a supported build recipe or downloadable adapter, establish its
exact SDK revision and accompanying agreement, the origin of incorporated code,
the build inputs/runtime components and the applicable distribution conditions.
Users supplying an SDK themselves does not settle those questions for our code
or compiled output. See [third-party notices](../THIRD_PARTY_NOTICES.md).

## Readings, failures and lifecycle limits

- Poll interval accepts 250 through 60000 ms; the default is 2000. The next poll is
  scheduled after the preceding dashboard poll completes, so this is not a fixed
  sampling frequency.
- Failed GPU polls clear the displayed readings. A syntactically valid cached
  response is different: the current AMD protocol has no acquisition timestamp,
  so the launcher cannot establish whether the helper actually sampled afresh.
- Decorative animation is separate from measurement values. The utilization graph
  advances from received samples; receipt time is not proof of sensor freshness.
- The NVIDIA command is started for each GPU poll and is given about two seconds
  to exit. The AMD helper is persistent; its response wait is 1.5 seconds per poll.
- Normal dashboard shutdown explicitly kills and waits for the AMD helper's
  immediate process. There is no graceful shutdown message. It is not registered
  in the inference/service Windows process jobs; crash cleanup and descendant
  cleanup are not established for this monitoring helper.
- Switching away from AMD stops further AMD requests but does not immediately
  terminate an already running helper in the current implementation. Normal app
  shutdown performs cleanup; a later AMD poll handles a changed helper path.

## Troubleshooting and evidence

| Symptom | Check |
| --- | --- |
| GPU monitoring unavailable | Check selected provider, saved absolute path and the visible error. Default unavailable is intentional. |
| Saving fails | Check the complete draft's validation error; enabled providers need an existing absolute program path. |
| NVIDIA exits or produces no usable rows | Run the exact read-only query above manually and compare its columns with the [interface reference](MONITOR_PROTOCOL.md#nvidia-command-contract). |
| AMD parse error, empty rows or timeout | Check the required JSON fields, one-line framing, positive VRAM total and the 1.5-second response wait. Extra stdout logging breaks the protocol. |
| AMD initialization/loading failure | Verify the supplied adapter's own documentation. AI Nexus discards its stderr; a manual diagnostic run is needed to see that stream. |
| Missing hotspot or other metric | Treat unsupported values as unavailable. Do not substitute invented measurements. |

These steps do not start inference, tune GPUs, request elevation or acquire
dependencies. Do not assume a failing query is a reason to change drivers,
permissions or power settings.

When reporting behavior, give the source version, Windows/GPU/driver/provider
versions, affected metric and a redacted minimal result. Include the exact SDK
revision and adapter build identity for AMD when known. Omit personal paths,
credentials, GPU serial/UUID details and raw diagnostic dumps.

See [validation evidence](VALIDATION.md) for the checks actually performed. This
guide is source-checked documentation, not certification of a GPU/driver matrix.
