# Isolated Guest Demo Deployment

This is an operator checklist, not an automatic installer or a report that a
deployment occurred. Preserve the existing `snejfishing-preview` service on
8080. Use a separate `snejfishing-guest` user/service, a separate private data
directory, and an unused public port (8082 below). Do not alter SSH, firewall,
other sites, existing databases, or system-wide runtimes.

## Prepare And Verify

1. Read existing listeners/services/disk first. Stop on name/path/port conflicts.
2. Fetch one reviewed immutable full commit SHA from `Snejkov/fish_snej` into
   `/opt/snejfishing-online/releases/<SHA>`. Keep existing releases for rollback.
   Do not include local saves, keys, `.env`, `.git`, or test databases.
3. Use isolated Node 24.19.0 under `/opt/snejfishing-runtime/`; do not replace
   the system Node executable. Official linux-x64 archive SHA-256:
   `14b342e71204f811bde6153be8e04b62aef63c236fef92b55f9c83154b409647`.
   Verify against the official release's `SHASUMS256.txt` before extraction.
4. In the release's `server` directory, run the verified runtime's npm with
   `ci --ignore-scripts --omit=dev --omit=optional`. The lockfile pins ws 8.22.0
   and its official registry integrity. Run `npm test` without the test bundle
   environment variable; this checks the actual production transport on Linux.
5. Create a dedicated unprivileged `snejfishing-guest` system user with no login
   only if the name is unused. Create `/var/lib/snejfishing-guest` owned by that
   user, mode 0700. Root-owned release directories must be traversable (0755),
   files readable (0644), and never writable by the service user.
6. Atomically set `/opt/snejfishing-online/current` to the reviewed release only
   within this dedicated deployment. Verify every resolved path stays inside
   `/opt/snejfishing-online`. Do not move or recursively delete unknown paths.

## Service

Install a new `/etc/systemd/system/snejfishing-guest.service` only if unused:

```ini
[Unit]
Description=SnejFishing isolated nickname-only guest demo
After=network.target

[Service]
Type=simple
User=snejfishing-guest
Group=snejfishing-guest
WorkingDirectory=/opt/snejfishing-online/current
Environment=SNEJ_GUEST_ONLY=1
Environment=PUBLIC_ORIGIN=http://194.238.57.37:8082
Environment=HOST=0.0.0.0
Environment=PORT=8082
Environment=SNEJ_DATA_DIR=/var/lib/snejfishing-guest
ExecStart=/opt/snejfishing-runtime/node-v24.19.0-linux-x64/bin/node server/index.mjs
Restart=on-failure
RestartSec=3
TimeoutStopSec=20
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/var/lib/snejfishing-guest
MemoryMax=512M
TasksMax=128

[Install]
WantedBy=multi-user.target
```

Match `ExecStart` to the actual verified isolated runtime path. Set
`Environment=SNEJ_RELEASE=<SHA>` for the health report. Reload systemd and start
only this unit. If public 8082 is unavailable, report that fact; do not open
firewall ports automatically. HTTPS is preferred even for guests. Public
HTTP is permitted only because this explicit mode rejects credential login,
registration, and every normal-account session. Demo guest inventory is separate
from real owner/account progress. No real owner import or grant is performed.

## Acceptance

- `/healthz` returns `mode:authenticated-game`, `entry:guest`, and the pinned SHA.
- Public index, main, game, i18n, UI, styles and vendor modules return 200.
- `/api/login` and `/api/register` return 404 without processing credentials.
- Private `.git`, `.env`, `server/admin.mjs`, and database paths return 404.
- Two independent browser sessions enter different nicks without passwords,
  join `snej-1`, and both see both real IDs/names by toggling Tab.
- Leaving removes that player from the other roster; reconnect/reload preserves
  the remembered guest ID/settings/items. A new cookie-free browser has no
  profile and cannot claim an existing guest through its nickname.
- Restart this service without replacing/deleting its database, then confirm
  both remembered sessions and profiles restore. Check logs for startup errors.
- Avatar/movement rendering and private-account HTTPS flows are distinct later
  acceptance checks; a static preview or health response does not prove them.

## Shutdown And Rollback

Stop only `snejfishing-guest`. For code rollback, record the current link, verify
the previous release/schema is compatible, switch the dedicated `current` link
to that immutable release, and restart only this unit. Leave SQLite/WAL/SHM,
guest sessions, and backups in `/var/lib/snejfishing-guest` unchanged. Never roll
back the database by copying an older one over it. If no compatible old guest
release exists, keep this service stopped and the existing static preview alive.
