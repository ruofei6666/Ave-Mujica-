#!/usr/bin/env bash
set -Eeuo pipefail
root=${1:-/opt/ave-mujica}
archive=${2:?Usage: sudo bash install-linux.sh ROOT ARCHIVE [SERVICE]}
service=${3:-ave-mujica}
[[ $EUID -eq 0 ]] || { echo 'First install needs sudo/root.' >&2; exit 1; }
[[ $root =~ ^/(opt|srv)/[A-Za-z0-9_.-]+(/[A-Za-z0-9_.-]+)*$ && $root == "$(realpath -m "$root")" && $service =~ ^[a-z][a-z0-9-]{0,63}$ ]] || { echo 'Use a dedicated directory under /opt or /srv and a valid service name.' >&2; exit 1; }
for executable in node tar curl systemctl flock useradd runuser; do command -v "$executable" >/dev/null || { echo "Install prerequisite: $executable" >&2; exit 1; }; done
node -e "if(Number(process.versions.node.split('.')[0]) < 20)process.exit(1)" || { echo 'Node.js 20 or newer is required.' >&2; exit 1; }
node_bin=$(command -v node)
[[ $node_bin =~ ^/[A-Za-z0-9_./-]+$ ]] || { echo 'Node path must have no spaces.' >&2; exit 1; }
case "$(realpath "$node_bin")" in /home/*|/root/*|/run/user/*|/tmp/*|/var/tmp/*) echo 'Node runtime must be in a system directory visible to the restricted service.' >&2; exit 1 ;; esac
[[ -f $archive ]] || { echo 'Release archive does not exist.' >&2; exit 1; }
app_user=ave-fighter
getent passwd "$app_user" >/dev/null || useradd --system --no-create-home --home-dir "$root" --shell /usr/sbin/nologin "$app_user"
runuser -u "$app_user" -- "$node_bin" --version >/dev/null || { echo 'Node runtime must be readable by ave-fighter; a root-only nvm installation cannot run this service.' >&2; exit 1; }
mkdir -p "$root/releases"
chmod 755 "$root" "$root/releases"
if [[ ! -f /etc/$service.env ]]; then
  printf 'HOST=127.0.0.1\nPORT=3000\n' >"/etc/$service.env"
  chmod 644 "/etc/$service.env"
fi
cat >"/etc/systemd/system/$service.service" <<UNIT
[Unit]
Description=Ave Mujica private two-player fighter
After=network.target

[Service]
Type=simple
User=$app_user
Group=$app_user
WorkingDirectory=$root/current
EnvironmentFile=/etc/$service.env
ExecStart=$node_bin $root/current/server.js
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
UMask=0077

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable "$service"
release="first-$(date -u +%Y%m%d-%H%M%S)-$RANDOM"
bash "$(dirname "$0")/update-release.sh" "$root" "$archive" "$service" "$release"
echo 'Local service installed. Configure HTTPS/Nginx and firewall separately; no public deployment is implied.'
