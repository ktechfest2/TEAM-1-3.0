#!/bin/sh
# Encrypted database dump every BACKUP_INTERVAL_SECONDS (default daily), evidence archive weekly.
# BACKUP_ONCE=1 runs a single backup and exits (used for the restore rehearsal).
set -eu
set -o pipefail
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is required}"
INTERVAL="${BACKUP_INTERVAL_SECONDS:-86400}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
export PGPASSWORD="$(cat /run/secrets/db_password)"
enc() { openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE -out "$1"; }

run() {
  ts="$(date -u +%Y%m%d-%H%M%S)"
  f="/backups/trustelect-$ts.dump.enc"
  if pg_dump -h db -U trustelect -d trustelect -Fc | enc "$f.part"; then
    mv "$f.part" "$f"
    echo "$(date -u +%FT%TZ) database backup ok: $(basename "$f") ($(stat -c %s "$f") bytes)"
  else
    rm -f "$f.part"
    echo "$(date -u +%FT%TZ) database backup FAILED" >&2
  fi
  # Evidence photos are write-once: a weekly archive (and one on the first run) is enough
  if [ "$(date -u +%u)" = 7 ] || ! ls /backups/evidence-*.tar.enc >/dev/null 2>&1; then
    e="/backups/evidence-$ts.tar.enc"
    if tar -C /evidence -cf - . | enc "$e.part"; then
      mv "$e.part" "$e"
      echo "$(date -u +%FT%TZ) evidence backup ok: $(basename "$e") ($(stat -c %s "$e") bytes)"
    else
      rm -f "$e.part"
      echo "$(date -u +%FT%TZ) evidence backup FAILED" >&2
    fi
  fi
  find /backups -name 'trustelect-*.dump.enc' -mtime +"$KEEP_DAYS" -delete
  # Keep the newest evidence archive whatever its age
  ls -1t /backups/evidence-*.tar.enc 2>/dev/null | tail -n +3 | xargs -r rm -f
}

if [ "${BACKUP_ONCE:-0}" = 1 ]; then run; exit 0; fi
while true; do run; sleep "$INTERVAL"; done
