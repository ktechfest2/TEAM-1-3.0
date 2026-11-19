#!/usr/bin/env bash
# Builds the static web app and publishes it to Firebase Hosting (https://trustelect.web.app).
set -euo pipefail
cd "$(dirname "$0")/.."
export NEXT_TELEMETRY_DISABLED=1
export NEXT_PUBLIC_API_URL=https://api.example.org
npm run build -w @trustelect/shared
npm run build -w @trustelect/web
firebase deploy --only hosting --project trustelect
