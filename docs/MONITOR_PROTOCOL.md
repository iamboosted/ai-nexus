# Existing monitoring interfaces

This reference describes the current launcher client. It supplies no monitoring
implementation, SDK code, binaries or new backend. Its contracts were checked
against source; no real vendor tool or helper was run for this documentation.
See the [setup guide](GPU_MONITORING.md) for configuration and limitations.

## Source of truth

| Behavior | Implementation |
| --- | --- |
| Provider selection and native IPC | [lib.rs](../src-tauri/src/lib.rs), gpu_poll and system_stats |
| Process launch, parsing and host samples | [gpu.rs](../src-tauri/src/gpu.rs) |
| Allowed providers, paths and intervals | [config.rs](../src-tauri/src/config.rs), Config::validate |
| Unavailable scalars and sample history | [config-ui.js](../src/launcher/config-ui.js), cleanMetric, gpuView and sampleHistory |
| Poll scheduling and clearing failed readings | [app.jsx](../src/launcher/app.jsx) |

The `monitoring` configuration object uses these keys:

| Key | Meaning |
| --- | --- |
| `backend` | Exactly `unavailable`, `nvidia-smi` or `amd-adlx` |
| `helper` | Absolute existing AMD adapter executable path when that provider is selected |
| `nvidia_smi` | Absolute existing NVIDIA program path when that provider is selected |
| `poll_interval_ms` | Integer 250 through 60000; default 2000 |

Use the full [safe configuration example](../config/launcher.config.example.json)
as the schema baseline. Monitoring paths are program paths, not shell command
strings. The selected program is executed; path validation does not authenticate
it or establish its distribution rights.

## NVIDIA command contract

The launcher invokes the configured executable with exactly these two arguments:

~~~text
--query-gpu=index,name,temperature.gpu,power.draw,memory.used,memory.total,utilization.gpu
--format=csv,noheader,nounits
~~~

It starts a new process per poll, supplies no stdin and captures stdout/stderr.
On Windows the console is hidden. It polls for exit at 20 ms intervals with a
two-second deadline, killing/waiting on failure or timeout. Nonzero exit status
is an error, including captured stderr. This wait is not a guarantee that every
part of process creation and output handling has a total two-second bound.

The reader trims each nonempty line and splits on commas:

| Column | Destination |
| --- | --- |
| 0 | GPU index |
| 1 | Display name |
| 2 | Temperature, degrees Celsius |
| 3 | Power, watts |
| 4 | Used GPU memory |
| 5 | Total GPU memory |
| 6 | Utilization, percent |

Rows with fewer than seven columns are skipped; extra columns are ignored.
There is no quoted-CSV parser, so embedded commas in a name are not supported.
For numeric fields it attempts to parse the first whitespace-separated token;
unparseable values such as N/A become -1. Index is cast to an unsigned integer,
not validated as a stable hardware identifier. Hotspot is always -1 because this
query does not provide it. No rows is an error.

Memory values pass through without conversion. The UI divides them by 1024 for
its GB display, or shows them under its legacy MB label. Record the provider's
units when validating a particular tool/driver; this client does not verify
unit metadata. Device indices must not be assumed to match inference device IDs.

See [NVIDIA's reference](https://docs.nvidia.com/deploy/nvidia-smi/) for the vendor
command, unsupported values and compatibility limitations. This launcher does
not implement a direct NVML API adapter or a custom CUDA helper.

## AMD process and response contract

The client starts the configured executable directly, without a shell, adding
`--serve` as its only argument. It pipes stdin/stdout, discards stderr and hides
the console on Windows. It supplies no explicit working directory, SDK/DLL path
or per-helper environment overrides. The process inherits the launcher environment;
an adapter must not depend on a particular launcher working directory.

The process is retained between polls. Each poll writes and flushes exactly:

~~~text
poll\n
~~~

Here `\n` means one LF byte, not the two literal characters backslash and n.
The helper must return and flush one UTF-8 JSON array on a single newline-terminated
stdout line for each request. No greeting, banner, progress line, pretty-printed
multiline JSON or unsolicited response belongs on stdout.

The response wait is 1500 ms after the request write/flush. Initialization can
therefore consume the first response's budget. Process creation and request writes
are outside that wait; it is not an end-to-end execution deadline.

The array contains one object per GPU row:

| Required field | Type | Meaning |
| --- | --- | --- |
| `name` | String | GPU display name |
| `temperatureC` | Number | Temperature, degrees Celsius |
| `hotspotC` | Number | Hotspot, degrees Celsius |
| `powerW` | Number | Power, watts |
| `vramUsedMB` | Number | Used GPU memory, using the same scale as total |
| `vramTotalMB` | Number | Total GPU memory; must be finite and greater than zero for the row to survive |
| `utilPct` | Number | GPU utilization, percent |

These memory fields have legacy MB names. The client makes no conversion, and
the UI divides by 1024 for its GB display. The units returned by the chosen ADLX
API and any required adapter conversion must be documented and verified when an
implementation is supplied; this source preview establishes no historical
helper's conversion behavior.

This synthetic response demonstrates framing and required fields only. Its
numbers are fictional and are not measurements or a hardware compatibility claim.
Transmit the array on one line, followed by a newline:

~~~json
[{"name":"Example GPU - synthetic protocol data","temperatureC":50,"hotspotC":-1,"powerW":-1,"vramUsedMB":1024,"vramTotalMB":8192,"utilPct":25}]
~~~

Current parsing rules:

- Every listed field is required. A missing field, null numeric field or numeric
  string fails deserialization of the whole response. NaN/Infinity are not JSON.
- Use a negative scalar such as -1 for unavailable optional measurements; the UI
  turns negative/nonfinite scalars into unavailable values. Do not invent a zero
  reading. An unavailable/nonpositive total VRAM removes the row entirely.
- Rows are enumerated from zero after filtering total VRAM. An extra helper
  `index` field is ignored. There is no stable GPU identity or vendor-ID mapping.
- An empty array, or an array with no surviving rows, is an error.
- There is no version handshake, acquisition timestamp or structured error
  envelope. Return only the documented array on stdout. The launcher cannot
  recognize syntactically valid data that a helper has cached or fabricated.
- Percentages are not fully range-validated by the native parser. History is
  clamped to 0 through 100 for drawing; implementers must supply real values in
  the intended range rather than relying on display clamping.

Sample afresh for each request where the vendor API permits it, check individual
metric support and handle an incompatible driver explicitly. These are adapter
implementation requirements, not features supplied or tested by this repository.

## Failure, reuse and shutdown

Write errors, response timeout, EOF/read failure, invalid JSON or no usable rows
fail the poll. The client kills/waits for the current AMD child and clears its
stored handle; a subsequent AMD poll attempts a new process. It also replaces
the child on a later AMD poll if its configured path changed or it has exited.
The dashboard clears displayed GPU rows when a poll rejects.

Normal dashboard shutdown kills and waits for the AMD child. There is no stop
request, acknowledged shutdown or child-worker tree ownership in this protocol.
The helper is outside the inference/service process registry and Windows jobs.
Do not infer crash cleanup guarantees for it from the dummy inference tests.
Selecting another provider does not immediately stop an existing AMD child.

Stderr is discarded in normal launcher use, so diagnostics sent there are not
available in the dashboard. A deliberate manual run of the trusted adapter may
be needed for diagnostics. The current reader has no response-line size limit;
only use a trusted adapter. None of this reference implements a sandbox.

## Native readings returned to the UI

The `gpu_poll` IPC result is an array with fields `index`, `name`,
`temp`, `hotspotTemp`, `powerW`, `vramUsedMB`,
`vramTotalMB` and `utilPct`. This is a different field layout from the AMD
helper response; the Rust adapter performs that mapping.

The frontend makes finite, nonnegative scalar values displayable, marks other
scalars unavailable and adds its own receipt time. History retains up to 64
utilization samples. It does not authenticate a measurement's acquisition time.

The separate `system_stats` IPC command refreshes sysinfo CPU and memory
samples and returns `cpuPct`, `ramUsedGB` and `ramTotalGB`. Memory
bytes are divided by 1024 cubed; the current CPU/RAM UI labels the result GiB.
It does not invoke a vendor helper.

## Implementation and distribution boundary

This document describes the existing interface so an independently supplied
adapter can interoperate. It includes no AMD header, sample, wrapper or adapter
implementation and supplies no AMD build instructions.

Any proposed supported AMD implementation needs an identified SDK revision and
its accompanying agreement, recorded code provenance, exact build/runtime inputs
and evidence for licensing and runtime behavior. The upstream
[ADLX agreement](https://github.com/GPUOpen-LibrariesAndSDKs/ADLX/blob/main/ADLX%20SDK%20License%20Agreement.pdf)
is a current reference, not proof of the agreement used by the historical helper.
User-supplied SDKs and separate helper processes do not establish redistribution
rights. See [third-party notices](../THIRD_PARTY_NOTICES.md) and
[validation limits](VALIDATION.md).
