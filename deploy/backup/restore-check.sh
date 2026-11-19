#!/bin/sh
# Restore rehearsal: decrypts the newest dump into a scratch database (trustelect_restore_check),
# restores it, and prints row counts of the main tables next to the live database's.
set -eu
set -o pipefail
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is required}"
export PGPASSWORD="$(cat /run/secrets/db_password)"
latest="$(ls -1t /backups/trustelect-*.dump.enc | head -1)"
echo "restoring $(basename "$latest")"
psql -h db -U trustelect -d postgres -qc "drop database if exists trustelect_restore_check" -c "create database trustelect_restore_check"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in "$latest" | pg_restore -h db -U trustelect -d trustelect_restore_check --no-owner --exit-on-error
q="select 'polling_units', count(*) from polling_units union all select 'submissions', count(*) from submissions union all select 'unit_results', count(*) from unit_results union all select 'declarations', count(*) from declarations union all select 'incident_reports', count(*) from incident_reports union all select 'chain_entries', count(*) from chain_entries union all select 'chain_anchors', count(*) from chain_anchors union all select 'audit_log', count(*) from audit_log union all select 'admin_users', count(*) from admin_users"
echo "table | live | restored"
psql -h db -U trustelect -d trustelect -Atc "$q" > /tmp/live
psql -h db -U trustelect -d trustelect_restore_check -Atc "$q" > /tmp/restored
paste -d'|' /tmp/live /tmp/restored | awk -F'|' '{ printf "%s | %s | %s %s\n", $1, $2, $4, ($2==$4 ? "" : "(changed since the backup)") }'
