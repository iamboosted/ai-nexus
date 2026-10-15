# Export validation

This source-only Windows developer preview was prepared on 2026-10-14.

## Checks performed on this export

| Check | Result and evidence |
| --- | --- |
| Allowlisted copy | 43 source files initially copied and hash-verified; four private handoff/copy-history documents excluded |
| Frontend build | Passed using existing Babel 7.29.7 tooling read-only; all eight JSX scripts compiled |
| Native development build | Passed in the new checkout with Cargo offline and locked; generated icon and frontend were rebuilt |
| JavaScript tests | 18 passed, including explicitly mocked IPC tests |
| Native core tests | 21 passed using production configuration, launch, process and close-policy modules with temporary fixtures |
| Native dummy-server suite | 26 passed, 0 failed, 0 skipped against this export's own rebuilt app |
| Actual readiness deadline | Passed in 120.457 seconds; owned dummy and worker stopped |
| Crash/shutdown regression | Five immediate exits, entry/context switching, cancellation, Settings/main closure, parent-crash cleanup and termination of only the test launcher passed; unregistered dummy preserved |
| Data integrity | Normal configuration remained absent/unchanged and all four plain-text fixture files retained their bytes during tests |
| Vendored React/React DOM | Version 18.3.1 assets and notice exactly matched the existing installed packages; original vendor files and headers retained |
| Dependency evidence | 97 npm entries inventoried; 499 Cargo package/version entries recorded; 453 existing crate archives matched locked checksums; all 316 Windows app-resolution licenses recorded |

No dependencies were acquired or installed for these checks. Frontend validation
used the optional existing-tool override rather than a fresh npm installation.
Rust compiled against existing local crates. The documented first-time npm/cargo
acquisition commands and optional Playwright installation command were not run.
This is not a clean-Windows or cold-dependency-installation test.

All native fixture instances used English TEST INSTANCE banners, separate storage,
dummy HTTP servers and plain-text model placeholders. No actual inference, model
collection, optional service or monitoring helper was started. The existing
development copy and personal launcher installations were not modified.

## Sanitation and source provenance

The final source manifest lists 51 files with SHA-256 snapshots. The export
contains 52 files in total. SOURCE_MANIFEST.json explicitly excludes itself:
embedding its own hash would change the content being hashed. Hashes cover
ordinary file contents; alternate streams are checked separately.
The original application/dashboard/Settings code, styles, configuration schema,
runtime client and process fixes are retained. Export changes concern public
documentation, MIT/owner metadata, third-party records, ignore rules, a development
application identifier and a corrected browser-preview comment.

Internal handoffs, copied installation history, absolute personal tool paths,
private configuration, raw test evidence, Git metadata, dependencies, generated
frontend/build output, caches, fixtures, logs, recordings, models, runtime binaries,
font files and AMD SDK/helper components are excluded. Validation output is removed
after checks; no executable or installer is included.

The content checks cover prohibited file types/paths, known private-path patterns,
credential-like literals, safe defaults, manifest/integrity consistency and local
Markdown links. They do not certify the absence of every possible secret or defect.
The initial export preparation did not fetch external documentation URLs.
Official NVIDIA monitoring and AMD SDK/binding references were subsequently read
for the documentation plan; no SDK or package was acquired. The documentation
completion pass used those references and the current source without new network
requests.

## Final sanitation and interface documentation

The final pass on 2026-10-14 removed seven Zone.Identifier download-marker streams
from the public export only. Those streams contained local referrer paths; no
values are reproduced here. All seven ordinary file contents retained their
SHA-256 hashes. The final scan found no remaining alternate streams.

The monitoring guide and protocol reference were added, with README and
third-party links. They document the existing NVIDIA command and AMD process/JSON
contract, provider selection, unavailable-value behavior, timeouts and cleanup
limits. They include no AMD implementation or new helper build procedure.

The final checks cover the complete file set and hashes, hidden files and reparse
points, alternate streams, credential/private-path patterns, safe defaults, JSON
examples, local Markdown links and source correspondence of the documented
protocol. No application, model, service, monitoring provider, build or test suite
was run during this documentation pass. The build/test results above belong to
the earlier export validation.

All application source, styles, scripts, lockfiles, vendored files, licenses,
example configuration and dependency inventory retained their pre-pass hashes.
Only documentation and the manifest changed, plus the seven removed metadata
streams. No Git repository, dependency directory or generated build output was
created.

## Remaining release limits

- Actual CUDA/HIP/Vulkan inference, GPU/helper operation, optional services and
  OpenCode end-to-end behavior remain untested in this preview.
- Native picker opening/cancellation was previously checked; actual file selection
  with the Windows Open button and broader DPI/visual acceptance need manual review.
- This source checkout is the configuration anchor. Installed/portable storage,
  cross-process writer locking and graceful backend shutdown remain future work.
- Clean-Windows setup and dependency acquisition commands need an independent run.
- AMD helper/SDK provenance and redistribution obligations remain unresolved.
  No helper build recipe or legal clearance is supplied.
- 46 non-selected Cargo lock entries remain without local license evidence.
  They are not vendored or part of the reviewed Windows app resolution; review
  them before claiming other platform/feature coverage.
- Any downloadable binary needs an artifact-specific third-party review, including
  applicable notices, covered-source availability, vendor SDK/EULA terms and assets.

No Git repository was initialized and no package, binary or source was published.
