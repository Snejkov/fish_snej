# Isolated Static Preview

`install-preview.sh` installs a read-only static copy of the reviewed public game
on Ubuntu Server 24.04. It does not install the account backend or enable online
shared-lake persistence. Each browser still has its own local game profile.

Review the script, then run it from an already authenticated VPS console/SSH
session as root, or with sudo:

```sh
sudo bash ./install-preview.sh
```

The default immutable game release is
`17707769c5b3ef886f941f0b6a892102ec276b22`. A different reviewed, complete release
can be passed as a full 40-character commit SHA. No moving `main` checkout is
used during installation. The public GitHub archive must be reachable without
credentials. The script is standalone; it does not need other local files.

It requires existing Python 3, curl, systemd, standard Ubuntu user-management
tools, and a free TCP port 8080. It does not run apt, replace sites, change SSH,
disable a firewall, reinstall the OS, or remove directories. Unknown existing
app directories, service users, service units, and occupied listeners cause a
stop before replacement. Existing managed preview releases are retained.

Only `index.html`, `styles.css`, and allowed public assets in `src`, `styles`,
`vendor`, `assets`, and `textures` are extracted. Hidden files, links, archive
traversals, source-control metadata, tests, worker/backend code, configurations,
credentials, and private databases are not served. The static server does not
accept account or state-changing API requests.

Managed paths: `/opt/snejfishing-preview`, user `snejpreview`, and systemd service
`snejfishing-preview`. Static content is root-owned and readable, not writable,
by the service user. Re-running the healthy installed SHA is a no-op. A changed
SHA gets a new immutable release. Failed health checks restore the previous
managed service/code, never a database. Diagnostics/staging are retained for
inspection; no broad cleanup is performed.

Public directories are explicitly set to 0755 despite the installer's restrictive
umask; public files remain 0644. Only extracted public assets receive these modes.
Startup succeeds only when health, the game page, and main JavaScript are readable
through the service, not just when the health endpoint responds.

For a preview installed with the first installer, inspect the exact managed
public directory before applying this narrow permission repair as root:

```sh
public=/opt/snejfishing-preview/releases/17707769c5b3ef886f941f0b6a892102ec276b22/public
test "$(readlink -f "$public")" = "$public" && find "$public" -type d -exec chmod 0755 {} +
curl --fail http://127.0.0.1:8080/
```

This changes only public-directory traversal rights, not files, SSH, firewall,
database data, service-user write permissions, or any other site.

Local checks after installation:

```sh
curl --fail http://127.0.0.1:8080/healthz
systemctl status snejfishing-preview --no-pager
```

The friend's preview URL is `http://194.238.57.37:8080/`. External accessibility
has not been verified. The provider's network rules and any existing host
firewall must allow inbound TCP 8080; the installer deliberately changes neither.
Use HTTP only to view this static preview. Do not enter server credentials over
HTTP. HTTPS/WSS and authenticated persistent accounts require the separate
backend deployment and are not claimed by a successful static health check.
