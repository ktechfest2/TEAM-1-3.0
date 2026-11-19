#!/usr/bin/env bash
# Builds the API image here and runs it on the server. The server only receives the finished image;
# its secrets stay in /opt/trustelect/.env there.
set -euo pipefail
cd "$(dirname "$0")/.."
source deploy/.env.deploy
docker build -f apps/api/Dockerfile -t trustelect-api:latest .
docker save trustelect-api:latest | gzip -1 | ssh "$DEPLOY_SSH_HOST" 'gunzip | docker load'
scp -q deploy/api/docker-compose.yml "$DEPLOY_SSH_HOST":/opt/trustelect/docker-compose.yml
ssh "$DEPLOY_SSH_HOST" 'cd /opt/trustelect && docker compose up -d && docker image prune -f >/dev/null'
sleep 10
curl -fsS "$API_URL/health/live" && echo
