# Contributing

Keep changes focused on a concrete user-visible problem and explain the resulting
behavior. Preserve the dashboard, detached Settings, themes and motion controls.
Changes to process ownership, persistence, telemetry or dependencies need focused
validation and a clear account of failure behavior.

Use the safe example and temporary fixtures. Never submit machine configuration,
credentials, private paths/endpoints, raw logs, recordings, real model/voice assets,
runtimes, caches or AMD SDK/helper material.

Run the JavaScript/native core checks and relevant frontend/native builds from
the README. For lifecycle changes, run the optional dummy suite when its tools
are supplied. Report skipped/mocked checks and distinguish actual native behavior
from browser/source inspection. UI changes need reviewed screenshots and human
review in dashboard/Settings, compact HUD and live/static motion.

For bug reports, give the source/app version, Windows/tool versions, expected
behavior and minimal reproduction. Supply a redacted example configuration,
not actual configuration or unreviewed attachments.

Keep third-party notices intact. Identify the origin/license of new copied
code/assets/dependencies, distinguish shipped from user-supplied components and
update the inventory. Public source hosting and separate helper processes do not
by themselves establish redistribution rights.

Contributions to original project code are intended under MIT. Submit only work
you have permission to contribute and identify existing third-party terms.
No contributor agreement, trademark permission or binary redistribution clearance
is implied here. Large new engines, automatic downloads/tuning and coding-agent
interfaces need a separate scope discussion.
