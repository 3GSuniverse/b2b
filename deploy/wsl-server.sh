#!/usr/bin/env bash
# Runs Drona on this Windows PC like a real server: Docker inside Ubuntu (no Docker Desktop), started by
# Windows at boot, even before anyone signs in. Run in Ubuntu:  bash ~/drona/deploy/wsl-server.sh
# Safe to run again; each step is skipped once done.
set -euo pipefail
DEPLOY="$(cd "$(dirname "$0")" && pwd)"
ok() { printf '\033[32m✓\033[0m %s\n' "$*"; }
say() { printf '\033[1m%s\033[0m\n' "$*"; }
die() { printf '\033[31m✗ %s\033[0m\n' "$*"; exit 1; }
grep -qi microsoft /proc/version || die "Run this inside Ubuntu on Windows (WSL)."
DISTRO="${WSL_DISTRO_NAME:-Ubuntu}"

# 1. systemd, so Docker starts by itself whenever Ubuntu starts
if ! grep -q '^systemd=true' /etc/wsl.conf 2>/dev/null; then
  printf '[boot]\nsystemd=true\n' | sudo tee -a /etc/wsl.conf >/dev/null
  say "Step 1 done. Now:"
  echo "  1) Close this window"
  echo "  2) Open PowerShell and type:  wsl --shutdown"
  echo "  3) Open Ubuntu again and run:  bash ~/drona/deploy/wsl-server.sh"
  exit 0
fi
ok "Ubuntu starts its services by itself"

# 2. Docker inside Ubuntu (not Docker Desktop)
if [[ ! -x /usr/bin/dockerd ]]; then
  say "Installing Docker inside Ubuntu (2-3 minutes)…"
  curl -fsSL https://get.docker.com | sudo sh
fi
sudo usermod -aG docker "$USER"
sudo systemctl enable --now docker >/dev/null 2>&1
sudo docker info >/dev/null 2>&1 || die "Docker didn't start. Is Docker Desktop still running? Quit it (whale icon → Quit) and try again."
ok "Docker runs inside Ubuntu"

# 3. Windows starts Ubuntu (and so Docker and Drona) at boot, 1 minute after the PC is on
WINUSER="$(cmd.exe /c 'echo %USERNAME%' 2>/dev/null | tr -d '\r')"
if ! schtasks.exe /Query /TN "Drona server" >/dev/null 2>&1; then
  say "Windows will now ask for the Windows password of '$WINUSER' (the one you use to sign in to this PC)."
  say "It's needed so Drona starts at boot even before anyone signs in. Nothing shows while you type."
  schtasks.exe /Create /F /TN "Drona server" /SC ONSTART /DELAY 0001:00 /RL HIGHEST /RU "$WINUSER" /RP \
    /TR "wsl.exe -d $DISTRO -u root --exec /bin/sh -c \"systemctl start docker; sleep infinity\"" \
    || die "Couldn't create the start-up task. Run this script again and check the password."
fi
ok "Windows starts Drona at boot (task 'Drona server')"

# 4. Drona itself, with your data
cd "$DEPLOY"
chmod +x drona
if ! sg docker -c "docker ps --format '{{.Names}}'" | grep -q drona-api; then
  sg docker -c "./drona install"
  if [[ -f backups/drona-restore.sql.gz ]]; then
    echo
    say "Putting your data back. Type RESTORE when asked."
    sg docker -c "./drona restore backups/drona-restore.sql.gz"
  fi
fi
sg docker -c "./drona status" || true
echo
ok "Done. Restart the PC, wait 3 minutes, and open the site: everything starts by itself."
