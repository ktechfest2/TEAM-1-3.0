#!/usr/bin/env bash
# Builds the static web app and publishes it. The hosting config (with the API address in its
# Content-Security-Policy) is generated from deploy/web.hosting.template.json.
set -euo pipefail
cd "$(dirname "$0")/.."
source deploy/.env.deploy
export NEXT_TELEMETRY_DISABLED=1
export NEXT_PUBLIC_API_URL="$API_URL"
export NEXT_PUBLIC_SITE_URL="$SITE_URL"
API_ORIGIN=$(node -e 'console.log(new URL(process.argv[1]).origin)' "$API_URL")
sed -e "s#__API_ORIGIN__#$API_ORIGIN#g" -e "s#__SITE__#$WEB_SITE#g" deploy/web.hosting.template.json > firebase.json
npm run build -w @trustelect/shared
npm run build -w @trustelect/web
firebase deploy --only hosting --project "$WEB_PROJECT"
