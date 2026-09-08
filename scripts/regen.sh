#!/usr/bin/env bash
# Regenerate the partner OpenAPI spec + TypeScript types from a backend checkout.
#   scripts/regen.sh ~/projects/lbx-backend-hono
# The backend's CI gate keeps its spec true to the code; this only snapshots
# the partner projection here for hand-off.
set -euo pipefail
BACKEND="${1:?path to lbx-backend-hono checkout}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
(cd "$BACKEND" && npx tsx scripts/emit-openapi.ts "$HERE/openapi/partner-openapi.json" --partner)
(cd "$BACKEND" && npx openapi-typescript "$HERE/openapi/partner-openapi.json" -o "$HERE/openapi/partner-api.types.ts")
jq -r '"partner spec: \(.paths|length) paths, \(.components.schemas|length) schemas"' "$HERE/openapi/partner-openapi.json"
