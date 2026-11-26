#!/usr/bin/env bash
# One-time move of Drona onto this Windows PC (run inside Ubuntu/WSL):  bash ~/drona/deploy/windows-setup.sh
# Finds the files you downloaded from the old server in your Windows Downloads folder, copies them in,
# switches the AI to Gemini, installs Drona and restores the backup. Safe to run again if it stops halfway.
set -euo pipefail
DEPLOY="$(cd "$(dirname "$0")" && pwd)"
ok() { printf '\033[32m✓\033[0m %s\n' "$*"; }
die() { printf '\033[31m✗ %s\033[0m\n' "$*"; exit 1; }

# 1. Find the backup: Downloads, Desktop or Documents of any Windows user (browsers sometimes rename it)
DL=""
for d in /mnt/c/Users/*/Downloads /mnt/c/Users/*/Desktop /mnt/c/Users/*/Documents /mnt/c/Users/*/OneDrive/Desktop /mnt/c/Users/*/OneDrive/Documents; do
  ls "$d"/*drona*.sql* >/dev/null 2>&1 && DL="$d" && break
done
if [[ -z "$DL" ]]; then
  echo "Files called 'drona…' on this PC:"
  find /mnt/c/Users -maxdepth 4 -iname '*drona*' 2>/dev/null | head -20 || true
  die "No drona backup (.sql.gz) found on this PC. Copy it into this PC's Downloads folder (UltraViewer → File transfer), then run this again."
fi
ok "Found your files in $DL"

# 2. Backup: the biggest drona-*.sql.gz (the complete one)
mkdir -p "$DEPLOY/backups" "$DEPLOY/secrets"
BACKUP="$(ls -S "$DL"/*drona*.sql* | head -1)"
NAME="drona-restore.sql.gz"
if [[ ! -f "$DEPLOY/backups/$NAME" ]] || [[ "$(stat -c %s "$BACKUP")" != "$(stat -c %s "$DEPLOY/backups/$NAME")" ]]; then
  echo "Copying $NAME ($(du -h "$BACKUP" | cut -f1)), this takes a minute…"
  cp "$BACKUP" "$DEPLOY/backups/$NAME"
fi
gzip -t "$DEPLOY/backups/$NAME" || die "The backup file is damaged (the download probably broke). Download it again."
ok "Backup ready: $NAME"

# 3. Settings (.env): browsers sometimes save it as 'env' or '.env.txt'
if [[ ! -f "$DEPLOY/.env" ]]; then
  ENVF=""
  for n in .env env .env.txt env.txt; do [[ -f "$DL/$n" ]] && ENVF="$DL/$n" && break; done
  [[ -n "$ENVF" ]] || die "Couldn't find the downloaded .env in $DL"
  cp "$ENVF" "$DEPLOY/.env"
fi
chmod 600 "$DEPLOY/.env"
sed -i 's/\r$//' "$DEPLOY/.env"
# Vertex AI and Google voice only work on a Google Cloud VM
sed -i 's/^AI_PROVIDER=vertex/AI_PROVIDER=gemini/; /^CALL_VOICE=google/d' "$DEPLOY/.env"
if ! grep -qE '^GEMINI_API_KEY=.+' "$DEPLOY/.env"; then
  read -r -s -p "Paste your Gemini API key (from aistudio.google.com), or just press Enter to skip for now: " key
  echo
  if [[ -n "$key" ]]; then
    sed -i '/^GEMINI_API_KEY=/d' "$DEPLOY/.env"
    echo "GEMINI_API_KEY=$key" >>"$DEPLOY/.env"
  else
    printf '\033[33m! Skipped: Drona AI stays off until you add GEMINI_API_KEY to deploy/.env and run: drona restart\033[0m\n'
  fi
fi
grep -q '^AI_PROVIDER=' "$DEPLOY/.env" || echo "AI_PROVIDER=gemini" >>"$DEPLOY/.env"
ok "Settings ready"

# 4. Gmail connect file, if you downloaded it
for n in google-oauth.json client_secret*.json; do
  for f in "$DL"/$n; do [[ -f "$f" ]] && cp "$f" "$DEPLOY/secrets/google-oauth.json" && ok "Gmail connect file copied" && break 2; done
done

# 5. Install, then put the data back
cd "$DEPLOY"
chmod +x drona
./drona install
echo
echo "Now restoring your data. Type RESTORE when asked."
./drona restore "backups/$NAME"
./drona status || true
echo
ok "Drona is running on this PC at http://localhost:$(grep -E '^DRONA_PORT=' .env | cut -d= -f2 | tr -d ' ' || echo 4100)"
echo "Last step: point the Cloudflare tunnel here (cloudflared on Windows)."
