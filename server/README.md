# Persistent Server Foundation

This is a separate Node.js 24 LTS backend. The browser client remains a static
Three.js application without Node, a build step, or a CDN. The browser adapter
connects nickname entry, profile settings, inventory commands and a Tab roster.
The current public demo is guest-only; password/account forms are not exposed.
Protocol tests exercise two real WebSocket clients, not two fully integrated
browser-game sessions. A
successful static preview or backend health check is not completion of online
gameplay or a verified VPS deployment.

## Runtime And Verification

Node 24.19.0 or later in the 24.x line is required. Node's built-in SQLite API
is documented as a release candidate, not a fully stable API:
https://nodejs.org/download/release/v24.19.0/docs/api/sqlite.html

Passwords use the standard asynchronous Node/OpenSSL scrypt implementation,
random 16-byte salts, explicit parameters, and constant-time buffer comparison:
https://nodejs.org/docs/latest-v24.x/api/crypto.html

The server uses the established `ws` transport, pinned to 8.22.0. The lockfile
includes the official registry SHA-512 integrity verified independently by the
deployment session. This environment still uses its existing test transport.
Install and smoke-test the exact production dependency on
Linux before deployment is considered verified:
https://github.com/websockets/ws

```sh
cd server
npm ci --ignore-scripts --omit=dev --omit=optional
npm test
```

Local preparation tested SQLite, crypto, HTTP, and WebSocket behavior using the
already installed Playwright `ws` transport selected explicitly through
`SNEJ_TEST_WS_BUNDLE`. This is test-only injection, not a deployment dependency
or an installation workaround. Tests without that opt-in use the installed
`ws` package. There are no external requests in these local tests.

## Configuration

Set `SNEJ_DATA_DIR` to an absolute private directory outside the replaceable
release, `PUBLIC_ORIGIN` to the exact canonical HTTPS origin, `HOST=127.0.0.1`,
and `PORT=8081`. Account mode requires HTTPS except on development loopback.
For the explicit nickname-only demo, `SNEJ_GUEST_ONLY=1` allows public HTTP and
`HOST=0.0.0.0`; both account routes are disabled and normal-account sessions are
refused by every API/WS operation. Keep the
SQLite database, WAL/SHM, trusted import files, and backups out of public
content and Git. A same-origin HTTPS reverse proxy must preserve Host, Origin,
Cookie, and WebSocket upgrade headers. No proxy configuration or firewall
changes are made automatically.

## Account And Profile Contract

In guest-only mode, `POST /api/guest` accepts only `{name}`. The server assigns
an ID starting at 2 and a random HttpOnly session; a nickname is cosmetic and
may repeat across distinct guests. It is separate from the unique internal
account name. Owner aliases remain reserved. A remembered guest cookie restores
only that guest; an unfamiliar browser starts at nickname entry. Clearing or
losing the cookie loses access to that demo guest: a nickname cannot recover
someone else's profile, identity, inventory, coins, or developer rights.
HTTP guest sessions are suitable only for a public, non-sensitive demo, not
private accounts or money. Owner provisioning/grants are not executed by it.

`POST /api/register` and `/api/login` accept only `name` and `password`.
Passwords contain 12 to 256 bytes. Production sessions use a random 256-bit
token in an HttpOnly/Secure/SameSite=Strict cookie; only its SHA-256 digest is
stored. Logout and expiry invalidate existing sockets too. Browser-local
profile IDs and a client-supplied name/rank are never proof of identity.

Normal users receive IDs starting at 2. ID 1 and owner-name aliases are
reserved. A trusted administrator provisions Snejkov/ID 1 using a verified
existing profile baseline and a new password supplied on stdin, not argv.
Repeating provisioning never resets credentials, inventory, or balances.

`GET /api/profile` returns `{user, revision, schemaVersion, coins, state}`.
`coins` is authoritative only in its integer database column; there is no
editable copy under `state.inventory`. State contains position, settings,
inventory, owned items, equipped gear, clothing, loadouts, stats, and catch log.
The current catalog has no clothing assets; non-null clothing claims are
rejected. Stats/catch log remain server-owned and are not arbitrarily writable
through profile PATCH.

`PATCH /api/profile` takes `expectedRevision` and a `patch` with only position,
settings, equipped, clothing, and loadouts. Every nested level is allowlisted.
Position is bounds-checked; equipment/loadouts require ownership. Unsupported
clothing, lure casting, and invalid depth are rejected. A stale revision gives
409 rather than overwriting another change. This is not full server simulation
of terrain, collisions, fish, or casting.

`POST /api/command` accepts only `requestId`, `expectedRevision`, `action`, and
`itemId`; actions are `buy`, `equip`, and `consume-bait`. Prices are taken from
the shared source catalog, never from the request. Owned quantities and balances
are updated together transactionally. Retrying the same request ID/payload
does not charge or consume twice; a different payload under that ID conflicts.
`consume-bait` only decreases existing equipped bait and does not award catches
or money. Authoritative casting/catch simulation is a later integration step.

## Shared Lake Protocol

The same-origin `/ws?room=snej-1` requires an authenticated session and exact
Origin before upgrade. Only one lake/process is supported. Welcome includes
server identity/profile and existing peers. Presence snapshots and broadcasts
use server ID, name, and role; `hello.claimedId` and `rank` are ignored.
Presence is bounded, movement-rate checked, limited to 30 messages/second,
saved at most once/second and on disconnect, and restored on reconnect. Body,
header, message, room-size, slow-consumer, auth concurrency/rate, and heartbeat
limits are applied. Messages do not confer arbitrary inventory or money.

Chat accepts `{t:"chat", channel:"local"|"global", text}` (up to 240 characters).
The server supplies sender ID/name and delivers local messages within 100 meters
in the horizontal X/Z plane, including the sender. Global reaches every current
socket in the lake. Delivery uses accepted presence positions, not chat-supplied
coordinates. Four messages can burst, then one token refills every 2.5 seconds;
`chat.error` reports invalid messages/rate limits without ending the session.
Messages are live-only, kept in a 40-message browser buffer, not database history.
Enter or the touch-friendly Chat button opens the composer; Escape/close returns
control to the game. Nameplates track interpolated remote avatars and disappear
on leave/disconnect or outside the camera view.

Regular movement writes increase profile revisions. The browser adapter
processes `profile.revision` and handles 409/reload/merge. A replacement
socket must not overwrite its successor's position on close. There is no
multi-process coordination in this MVP; run exactly one service instance.

## Trusted Owner Import And Grant

Prepare a private, operator-verified JSON baseline with `{coins,state}` matching
the schema above, including the actual existing inventory, loadouts, settings,
stats, catch log, and position. It must not be an unverified client request.
Do not replace an existing server profile or assume a new default 100 balance
is the owner's real progress. Import/provisioning is a deliberate one-time
operation; this preparation did not read or migrate the owner's real save.

```sh
# In a trusted shell, with private SNEJ_DATA_DIR already set:
read -rs -p 'New owner account password: ' OWNER_PASSWORD; printf '\n'
printf '%s' "$OWNER_PASSWORD" | node server/admin.mjs provision-owner /private/trusted-owner.json
unset OWNER_PASSWORD
node server/admin.mjs show-owner
# Only after the real baseline/account is verified:
node server/admin.mjs grant-owner
```

The grant uses one immutable operation key
`owner-id1-gold-10000-2026-10-12`. It requires the verified-import marker and an
existing owner profile; it never creates one. `BEGIN IMMEDIATE` protects the
balance update, revision increment, and ledger insert as a single transaction.
Replays return the original result plus the current balance without crediting
again. Overflow, a conflicting key, or an injected ledger failure rolls back.
The tests use disposable fixtures only. The real +10000 has NOT been applied.

## Remaining Prerequisites

VPS SSH identity/access must be independently verified. Actual Ubuntu OS,
services, ports, disk, runtime, and existing databases still need read-only
inspection. Node/npm registry access, Linux exact-`ws` smoke tests, a domain
with trusted TLS, and an isolated same-origin HTTPS/WSS proxy are prerequisites.
The adapter/API integration tests pass through reconnect and a durable database
restart. Real two-browser Tab roster verification remains required after the
isolated guest deployment described in `GUEST_DEPLOYMENT.md`. Do not call this foundation
a deployed persistent online game before those checks pass.
