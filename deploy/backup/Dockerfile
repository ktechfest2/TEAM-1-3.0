# Encrypted backups of the TrustElect database and evidence photos
FROM postgres:18-alpine
RUN apk add --no-cache openssl
COPY backup.sh restore-check.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/restore-check.sh
ENTRYPOINT ["/usr/local/bin/backup.sh"]
