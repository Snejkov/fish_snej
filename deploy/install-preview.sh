#!/usr/bin/env bash
set -Eeuo pipefail
umask 027

# Static preview only. No account server, database, passwords, or firewall changes.
RELEASE="${1:-17707769c5b3ef886f941f0b6a892102ec276b22}"
BASE=/opt/snejfishing-preview
SERVICE=snejfishing-preview
USER_NAME=snejpreview
PORT=8080
UNIT=/etc/systemd/system/snejfishing-preview.service
fail() { printf 'STOP: %s\n' "$*" >&2; exit 1; }
[[ "$RELEASE" =~ ^[a-f0-9]{40}$ ]] || fail 'Pass a reviewed full GitHub commit SHA, not a moving branch.'
[[ $EUID -eq 0 ]] || fail 'Run in an authorized root SSH session or with sudo.'
[[ -r /etc/os-release ]] || fail 'Cannot inspect operating system.'
# shellcheck disable=SC1091
source /etc/os-release
[[ "$ID" == ubuntu && "$VERSION_ID" == 24.04 ]] || fail 'This installer supports Ubuntu Server 24.04 only.'
for command in python3 curl ss systemctl systemd-analyze useradd install readlink ln mv mktemp stat grep getent cut df free; do
  command -v "$command" >/dev/null || fail "Missing prerequisite: $command (nothing installed automatically)."
done
[[ $(readlink -f /opt) == /opt ]] || fail '/opt is redirected; inspect before continuing.'
[[ ! -L "$BASE" && ! -L "$UNIT" ]] || fail 'Reserved app directory or unit is a symlink.'
if [[ -e "$BASE" ]]; then
  [[ -f "$BASE/.snej-preview-managed" && $(<"$BASE/.snej-preview-managed") == static-preview-v1 ]] || fail 'App directory belongs to an unknown installation.'
  [[ $(stat -c %u "$BASE") == 0 ]] || fail 'App directory must be root-owned.'
fi
if [[ -e "$UNIT" ]]; then
  grep -qx '# SnejFishing preview managed v1' "$UNIT" || fail 'Existing service unit is not ours.'
  [[ $(stat -c %u "$UNIT") == 0 ]] || fail 'Existing service unit is not root-owned.'
elif [[ $(systemctl show "$SERVICE" --property=LoadState --value) != not-found ]]; then
  fail 'A service with this name exists outside the reserved unit path.'
fi
if getent passwd "$USER_NAME" >/dev/null; then
  [[ -f "$BASE/.snej-preview-managed" ]] || fail 'Reserved service user already exists outside this installation.'
  [[ $(getent passwd "$USER_NAME" | cut -d: -f6-7) == /nonexistent:/usr/sbin/nologin ]] || fail 'Unexpected service-user configuration.'
fi
printf 'Inspecting existing services, sockets, resources, and firewall (read only):\n'
systemctl list-units --type=service --state=running --no-pager
ss -ltn
df -h /opt
free -m
if command -v ufw >/dev/null; then ufw status; fi
OCCUPIED=$(ss -H -ltnp "sport = :$PORT")
if [[ -n "$OCCUPIED" ]]; then
  [[ -f "$UNIT" ]] && systemctl is-active --quiet "$SERVICE" || fail "Port $PORT is occupied. No existing listener will be replaced."
  PID=$(systemctl show "$SERVICE" --property=MainPID --value)
  [[ "$PID" =~ ^[1-9][0-9]*$ && "$OCCUPIED" == *"pid=$PID,"* ]] || fail 'Occupied port is owned by a different process.'
  curl --fail --silent --max-time 5 "http://127.0.0.1:$PORT/healthz" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("mode")=="static-preview"' || fail 'Occupied port does not identify as our static preview.'
fi
if [[ -L "$BASE/current" ]]; then
  CURRENT=$(readlink -f "$BASE/current")
  [[ "$CURRENT" == "$BASE/releases/"* && -f "$CURRENT/.release" ]] || fail 'Current release link points outside the managed releases.'
elif [[ -e "$BASE/current" ]]; then
  fail 'Current release path is not a managed symlink.'
else
  CURRENT=''
fi
if [[ -d "$BASE/releases/$RELEASE" ]]; then
  [[ -f "$BASE/releases/$RELEASE/.release" && $(<"$BASE/releases/$RELEASE/.release") == "$RELEASE" ]] || fail 'Requested release path has unknown contents.'
  [[ "$CURRENT" == "$BASE/releases/$RELEASE" ]] && curl --fail --silent --max-time 5 "http://127.0.0.1:$PORT/healthz" >/dev/null && {
    printf 'Already installed: %s on port %s. External reachability is not checked.\n' "$RELEASE" "$PORT"; exit 0;
  }
  fail 'This release already exists but is not healthy/current. Inspect before reusing it.'
fi
install -d -m 0755 "$BASE" "$BASE/releases"
printf '%s\n' static-preview-v1 > "$BASE/.snej-preview-managed"
STAGE=$(mktemp -d "$BASE/.prepare.XXXXXXXX")
printf 'Downloading public reviewed commit %s. Staging: %s\n' "$RELEASE" "$STAGE"
curl --proto '=https' --tlsv1.2 --fail --show-error --location --max-time 180 \
  "https://github.com/Snejkov/fish_snej/archive/$RELEASE.tar.gz" --output "$STAGE/release.tar.gz"
python3 - "$STAGE/release.tar.gz" "$STAGE/public" "$RELEASE" <<'EXTRACT_PUBLIC'
import pathlib, sys, tarfile
archive, dest, release = sys.argv[1:]
root = pathlib.Path(dest)
root.mkdir(mode=0o755)
prefix = 'fish_snej-' + release
dirs = {'src', 'styles', 'vendor', 'assets', 'textures'}
suffixes = {'.js', '.css', '.json', '.png', '.jpg', '.jpeg', '.webp', '.svg', '.glb', '.gltf', '.bin', '.woff2'}
total = 0
with tarfile.open(archive, 'r:gz') as bundle:
    for member in bundle:
        path = pathlib.PurePosixPath(member.name)
        if not path.parts or path.parts[0] != prefix or '..' in path.parts or path.is_absolute():
            raise SystemExit('Unsafe archive member')
        local = pathlib.PurePosixPath(*path.parts[1:])
        if not local.parts or any(part.startswith('.') for part in local.parts):
            continue
        allowed = str(local) in {'index.html', 'styles.css'} or (local.parts[0] in dirs and local.suffix.lower() in suffixes)
        if not allowed or not member.isfile():
            continue
        total += member.size
        if member.size > 32 * 1024 * 1024 or total > 256 * 1024 * 1024:
            raise SystemExit('Unexpectedly large public archive')
        target = root.joinpath(*local.parts)
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        with bundle.extractfile(member) as source, target.open('xb') as output:
            output.write(source.read())
        target.chmod(0o644)
for required in ['index.html', 'styles.css', 'src/main.js', 'vendor/three.module.min.js']:
    if not root.joinpath(required).is_file():
        raise SystemExit('Missing public file: ' + required)
EXTRACT_PUBLIC
cat > "$STAGE/preview_server.py" <<'PREVIEW_SERVER'
import argparse, http.server, json, pathlib, urllib.parse

MIME = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
        '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.woff2': 'font/woff2'}

class Preview(http.server.BaseHTTPRequestHandler):
    server_version = 'SnejFishingPreview/1'
    sys_version = ''

    def setup(self):
        super().setup()
        self.connection.settimeout(10)

    def do_HEAD(self):
        self.do_GET(head=True)

    def do_GET(self, head=False):
        path = urllib.parse.unquote(urllib.parse.urlsplit(self.path).path)
        if path == '/healthz':
            data = json.dumps({'ok': True, 'mode': 'static-preview', 'release': self.server.release,
                               'online': False, 'accounts': 'browser-local-only'}).encode()
            mime = 'application/json'
        else:
            parts = pathlib.PurePosixPath(path).parts
            if '..' in parts or '\\' in path or '\x00' in path or any(part.startswith('.') for part in parts):
                self.send_error(404); return
            if not (path in {'/', '/index.html', '/styles.css'} or path.startswith(('/src/', '/styles/', '/vendor/', '/assets/', '/textures/'))):
                self.send_error(404); return
            target = (self.server.root / (path.lstrip('/') or 'index.html')).resolve()
            if not target.is_relative_to(self.server.root) or not target.is_file() or target.suffix.lower() not in MIME:
                self.send_error(404); return
            try:
                data = target.read_bytes()
            except OSError:
                self.send_error(404); return
            mime = MIME[target.suffix.lower()]
        self.send_response(200)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.end_headers()
        if not head:
            self.wfile.write(data)

def serve(root, release, port, bind='0.0.0.0'):
    server = http.server.ThreadingHTTPServer((bind, port), Preview)
    server.root, server.release = pathlib.Path(root).resolve(), release
    return server

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', required=True)
    parser.add_argument('--release', required=True)
    parser.add_argument('--port', type=int, default=8080)
    args = parser.parse_args()
    serve(args.root, args.release, args.port).serve_forever()
PREVIEW_SERVER
python3 - "$STAGE/preview_server.py" <<'CHECK_PYTHON'
import pathlib, sys
compile(pathlib.Path(sys.argv[1]).read_text(), sys.argv[1], 'exec')
CHECK_PYTHON
if ! getent passwd "$USER_NAME" >/dev/null; then
  useradd --system --user-group --home-dir /nonexistent --shell /usr/sbin/nologin "$USER_NAME"
fi
install -d -m 0755 "$BASE/releases/$RELEASE"
mv "$STAGE/public" "$BASE/releases/$RELEASE/public"
install -m 0644 "$STAGE/preview_server.py" "$BASE/releases/$RELEASE/preview_server.py"
printf '%s\n' "$RELEASE" > "$BASE/releases/$RELEASE/.release"
chmod 0644 "$BASE/releases/$RELEASE/.release"
cat > "$STAGE/snejfishing-preview.service" <<EOF
# SnejFishing preview managed v1
[Unit]
Description=SnejFishing isolated static preview (no online accounts)
After=network.target
[Service]
User=$USER_NAME
Group=$USER_NAME
ExecStart=/usr/bin/python3 $BASE/releases/$RELEASE/preview_server.py --root $BASE/releases/$RELEASE/public --release $RELEASE --port $PORT
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
CapabilityBoundingSet=
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
UMask=0077
MemoryMax=256M
TasksMax=128
[Install]
WantedBy=multi-user.target
EOF
systemd-analyze verify "$STAGE/snejfishing-preview.service"
if [[ -f "$UNIT" ]]; then install -m 0644 "$UNIT" "$STAGE/previous.unit"; fi
[[ ! -e "$BASE/.next-current" && ! -L "$BASE/.next-current" ]] || fail 'A pending update link already exists; inspect before continuing.'
SWITCHED=false
rollback_on_failure() {
  local status=$?
  if [[ $status -ne 0 && "$SWITCHED" == true ]]; then
    set +e
    systemctl stop "$SERVICE"
    if [[ -f "$STAGE/previous.unit" && -n "$CURRENT" && ! -e "$BASE/.rollback-current" && ! -L "$BASE/.rollback-current" ]]; then
      install -m 0644 "$STAGE/previous.unit" "$UNIT"
      ln -s "$CURRENT" "$BASE/.rollback-current"
      mv -Tf "$BASE/.rollback-current" "$BASE/current"
      systemctl daemon-reload
      systemctl restart "$SERVICE"
    fi
    printf 'Failed preview update; previous managed code restoration attempted. Diagnostics: %s\n' "$STAGE" >&2
  fi
}
trap rollback_on_failure EXIT
SWITCHED=true
install -m 0644 "$STAGE/snejfishing-preview.service" "$UNIT"
ln -s "$BASE/releases/$RELEASE" "$BASE/.next-current"
mv -Tf "$BASE/.next-current" "$BASE/current"
systemctl daemon-reload
systemctl enable "$SERVICE"
systemctl restart "$SERVICE"
HEALTHY=false
for attempt in {1..15}; do
  if curl --fail --silent --max-time 2 "http://127.0.0.1:$PORT/healthz" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["mode"]=="static-preview" and d["release"]==sys.argv[1]' "$RELEASE"; then HEALTHY=true; break; fi
  sleep 1
done
if [[ "$HEALTHY" != true ]]; then
  fail "Health check failed. Diagnostics preserved in $STAGE. No database or other site was touched."
fi
printf '\nStatic preview ready locally on port %s, release %s.\n' "$PORT" "$RELEASE"
printf 'Friend URL: http://194.238.57.37:%s/\n' "$PORT"
printf 'External access is NOT verified. VPS provider/network rules must allow inbound TCP %s.\n' "$PORT"
printf 'No firewall rules changed. HTTP is preview-only: no server passwords or online accounts.\n'
printf 'Game profiles here remain local to each browser. This is NOT the shared-lake backend.\n'
