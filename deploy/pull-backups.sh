#!/usr/bin/env bash
# Copies the newest encrypted backups from the server to this computer (off-server copy).
# Decrypting needs BACKUP_PASSPHRASE from the local .env.
set -euo pipefail
cd "$(dirname "$0")/.."
source deploy/.env.deploy
mkdir -p backups && chmod 700 backups
for pattern in 'trustelect-*.dump.enc' 'evidence-*.tar.enc'; do
  f=$(ssh "$DEPLOY_SSH_HOST" "ls -1t /opt/trustelect/backups/$pattern 2>/dev/null | head -1")
  [ -n "$f" ] && scp -q "$DEPLOY_SSH_HOST:$f" backups/ && echo "copied $(basename "$f")"
done
