#!/usr/bin/env bash
set -Eeuo pipefail
root=${1:?Usage: update-release.sh ROOT ARCHIVE SERVICE RELEASE_ID}
archive=${2:?Missing archive}
service=${3:-ave-mujica}
release=${4:?Missing release ID}
[[ $EUID -eq 0 ]] || { echo 'Run as root or through sudo.' >&2; exit 1; }
[[ $root =~ ^/(opt|srv)/[A-Za-z0-9_.-]+(/[A-Za-z0-9_.-]+)*$ && $root == "$(realpath -m "$root")" ]] || { echo 'Application must use a dedicated directory under /opt or /srv.' >&2; exit 1; }
[[ $service =~ ^[a-z][a-z0-9-]{0,63}$ && $release =~ ^[A-Za-z0-9-]+$ ]] || { echo 'Invalid service or release ID.' >&2; exit 1; }
[[ -f $archive && -f /etc/systemd/system/$service.service ]] || { echo 'First install the systemd service; see README.' >&2; exit 1; }
for executable in tar node curl systemctl flock; do command -v "$executable" >/dev/null; done
mkdir -p "$root/releases"
exec 9>"$root/.update-lock"
flock -n 9 || { echo 'Another update is running.' >&2; exit 1; }
destination="$root/releases/$release"
[[ ! -e $destination ]] || { echo 'Release already exists.' >&2; exit 1; }
while IFS= read -r entry; do
  case "$entry" in /*|../*|*/../*) echo 'Unsafe archive entry.' >&2; exit 1 ;; esac
done < <(tar -tzf "$archive")
mkdir -p "$destination"
tar -xzf "$archive" -C "$destination" --no-same-owner
for file in dist/client/index.html dist/server/index.cjs server.js package.json pnpm-lock.yaml node_modules/ws/index.js; do
  [[ -f $destination/$file ]] || { echo "Missing release file: $file" >&2; exit 1; }
done
chmod -R u=rwX,go=rX "$destination"
node --check "$destination/server.js"
node --check "$destination/dist/server/index.cjs"
node --check "$destination/dist/client/sw.js"
# Bind a random local port and validate this release before replacing current.
(
  cd "$destination"
  node <<'NODE'
const { createGameServer } = require('./server.js');
(async () => {
  const app = createGameServer({ host: '127.0.0.1', port: 0 });
  try {
    const address = await app.listen();
    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    if (!response.ok || !(await response.json()).ok) throw new Error('Release health check failed');
  } finally { await app.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
NODE
)
previous=''
if [[ -L $root/current ]]; then
  previous=$(readlink -f "$root/current")
  [[ $previous == "$root/releases/"* && -d $previous ]] || { echo 'Current points outside releases.' >&2; exit 1; }
elif [[ -e $root/current ]]; then
  echo 'Current must be a release symlink.' >&2; exit 1
fi
switched=0
rollback() {
  local status=$?
  trap - ERR
  if [[ $switched -eq 1 ]]; then
    if [[ -n $previous ]]; then
      ln -sfn "$previous" "$root/current.rollback"
      mv -Tf "$root/current.rollback" "$root/current"
      if systemctl restart "$service"; then echo "Rolled back to $previous" >&2; else echo 'Rollback restart failed; check journalctl.' >&2; fi
    else
      [[ -L $root/current && $(readlink -f "$root/current") == "$destination" ]] && rm -f -- "$root/current"
      systemctl stop "$service" || true
      echo 'First release failed; there is no previous release.' >&2
    fi
  fi
  exit "$status"
}
trap rollback ERR
ln -sfn "$destination" "$root/current.next"
mv -Tf "$root/current.next" "$root/current"
switched=1
systemctl restart "$service"
port=3000
if [[ -f /etc/$service.env ]]; then
  configured=$(sed -n 's/^PORT=//p' "/etc/$service.env" | tail -n 1)
  [[ -z $configured ]] || port=$configured
fi
[[ $port =~ ^[0-9]+$ && $port -gt 0 && $port -le 65535 ]]
healthy=0
consecutive=0
previous_healthy_pid=''
for attempt in $(seq 1 30); do
  main_pid=$(systemctl show "$service" --property MainPID --value)
  if [[ $main_pid =~ ^[0-9]+$ && $main_pid -gt 0 ]] && systemctl is-active --quiet "$service" &&
     body=$(curl --fail --silent --max-time 1 "http://127.0.0.1:$port/health") &&
     health_pid=$(printf '%s' "$body" | node -e 'let body="";process.stdin.on("data",chunk=>body+=chunk);process.stdin.on("end",()=>{try{const data=JSON.parse(body);if(data.ok!==true||!Number.isSafeInteger(data.pid)||data.pid<=0)process.exit(1);console.log(data.pid);}catch{process.exit(1);}});') &&
     [[ $health_pid == "$main_pid" ]]; then
    if [[ $main_pid == "$previous_healthy_pid" ]]; then consecutive=$((consecutive + 1)); else consecutive=1; fi
    previous_healthy_pid=$main_pid
    if [[ $consecutive -ge 2 ]]; then healthy=1; break; fi
  else
    consecutive=0
    previous_healthy_pid=''
  fi
  sleep .3
done
[[ $healthy -eq 1 ]] || { echo 'New release failed health check.' >&2; false; }
trap - ERR
echo "Updated $service to $release; previous releases remain available."
