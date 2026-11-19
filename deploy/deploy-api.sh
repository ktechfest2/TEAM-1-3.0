#!/usr/bin/env bash
# Builds the API image here and runs it on the server (ssh alias: deploy-server).
# The server only receives the finished image; secrets live in /opt/trustelect/.env there.
set -euo pipefail
cd "$(dirname "$0")/.."
docker build -f apps/api/Dockerfile -t trustelect-api:latest .
docker save trustelect-api:latest | gzip -1 | ssh deploy-server 'gunzip | docker load'
scp -q deploy/api/docker-compose.yml deploy-server:/opt/trustelect/docker-compose.yml
ssh deploy-server 'cd /opt/trustelect && docker compose up -d && docker image prune -f >/dev/null'
sleep 10
curl -fsS https://api.example.org/health/live && echo
