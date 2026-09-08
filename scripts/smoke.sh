#!/usr/bin/env bash
# Partner API smoke test — runs the read surface end-to-end and, with
# --order <slug> <amount>, the order flow up to the signing step (then
# cancels, so nothing is left dangling).
#
#   LBX_API=https://api-staging.lbxpro.tech LBX_KEY=lbx_stg_… scripts/smoke.sh
#   … scripts/smoke.sh --order ai-infra-basket-aug20-test 5600
#
# Exit code is the number of failed checks. Needs curl + jq.
set -uo pipefail
: "${LBX_API:?}" "${LBX_KEY:?}"
auth=(-H "Authorization: Bearer $LBX_KEY")
fails=0
check() { # name, expected-status, actual-status, [detail]
  if [ "$2" = "$3" ]; then printf '  ✓ %-58s %s %s\n' "$1" "$3" "${4:-}"; else printf '  ✗ %-58s got %s want %s %s\n' "$1" "$3" "$2" "${4:-}"; fails=$((fails+1)); fi
}
get() { curl -s -o "$TMP/body" -w '%{http_code}' "${auth[@]}" "$LBX_API$1"; }
post() { curl -s -o "$TMP/body" -w '%{http_code}' "${auth[@]}" -X POST -H 'Content-Type: application/json' "${@:2}" "$LBX_API$1"; }
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

echo "Partner API smoke — $LBX_API"
echo "auth"
check "docs are public"            200 "$(curl -s -o /dev/null -w '%{http_code}' "$LBX_API/v1/partner/docs")"
check "openapi.json is public"     200 "$(curl -s -o /dev/null -w '%{http_code}' "$LBX_API/v1/partner/openapi.json")"
check "no key → 401"               401 "$(curl -s -o /dev/null -w '%{http_code}' "$LBX_API/v1/partner/companies")"
check "wrong key → 401"            401 "$(curl -s -o /dev/null -w '%{http_code}' -H 'Authorization: Bearer nope' "$LBX_API/v1/partner/companies")"

echo "data"
check "companies list"             200 "$(get '/v1/partner/companies?limit=5')" "total=$(jq -r .total "$TMP/body" 2>/dev/null)"
SLUG=$(jq -r '.items[0].slug' "$TMP/body" 2>/dev/null)
check "company detail ($SLUG)"     200 "$(get "/v1/partner/companies/$SLUG")"
check "company charts"             200 "$(get "/v1/partner/companies/$SLUG/charts")" "points=$(jq '.pricingHistory|length' "$TMP/body" 2>/dev/null)"
check "company funding"            200 "$(get "/v1/partner/companies/$SLUG/funding")" "rounds=$(jq '.rounds|length' "$TMP/body" 2>/dev/null)"
check "unknown company → 404"      404 "$(get '/v1/partner/companies/no-such-company-xyz')"
check "daily prices (bulk, latest)" 200 "$(get '/v1/partner/daily-prices')" "date=$(jq -r .date "$TMP/body" 2>/dev/null) n=$(jq '.items|length' "$TMP/body" 2>/dev/null)"
PSLUG=$(jq -r '.items[0].slug // empty' "$TMP/body" 2>/dev/null)
[ -n "$PSLUG" ] && check "daily prices ($PSLUG)"   200 "$(get "/v1/partner/companies/$PSLUG/daily-prices")" "points=$(jq '.points|length' "$TMP/body" 2>/dev/null)"
check "daily prices bad date → 400"  400 "$(get '/v1/partner/daily-prices?date=today')"
check "indexes"                    200 "$(get '/v1/partner/indexes')" "n=$(jq '.items|length' "$TMP/body" 2>/dev/null)"
check "lbx25 history"              200 "$(get '/v1/partner/indexes/lbx25/history?months=6')" "points=$(jq '.history|length' "$TMP/body" 2>/dev/null)"

echo "opportunities"
check "list (public only)"         200 "$(get '/v1/partner/opportunities')" "slugs=$(jq -r '[.items[].slug]|join(",")' "$TMP/body" 2>/dev/null)"
NONPUBLIC=$(jq -r '[.items[] | select(.visibility != "public")] | length' "$TMP/body" 2>/dev/null)
check "no non-public offers leak"  0 "$NONPUBLIC"
OSLUG=$(jq -r '.items[0].slug // empty' "$TMP/body" 2>/dev/null)
[ -n "$OSLUG" ] && check "detail ($OSLUG)" 200 "$(get "/v1/partner/opportunities/$OSLUG")"

echo "portfolio"
check "portfolio"                  200 "$(get '/v1/partner/portfolio')" "positions=$(jq '.positions|length' "$TMP/body" 2>/dev/null) value=$(jq -r .summary.valueTotal "$TMP/body" 2>/dev/null)"
check "portfolio history"          200 "$(get '/v1/partner/portfolio/history')" "points=$(jq '.points|length' "$TMP/body" 2>/dev/null)"
check "unknown position → 404"     404 "$(get '/v1/partner/positions/000000000000000000000000/history')"

echo "orders (read)"
check "list orders"                200 "$(get '/v1/partner/orders')" "n=$(jq '.items|length' "$TMP/body" 2>/dev/null)"
check "unknown order → 404"        404 "$(get '/v1/partner/orders/000000000000000000000000')"

if [ "${1:-}" = "--order" ]; then
  SLUG_O="$2"; AMOUNT="$3"; IK="smoke-$(date +%s)"
  echo "orders (write) — $SLUG_O amount=$AMOUNT"
  code=$(post '/v1/partner/orders' -H "Idempotency-Key: $IK" -d "{\"opportunitySlug\":\"$SLUG_O\",\"amount\":$AMOUNT,\"returnUrl\":\"https://example.com/signed\"}")
  check "create → awaiting_signature" 200 "$code" "status=$(jq -r .order.status "$TMP/body" 2>/dev/null) units=$(jq -r .order.numberOfUnits "$TMP/body" 2>/dev/null) total=$(jq -r .order.totalAmount "$TMP/body" 2>/dev/null)"
  [ "$code" != 200 ] && { echo "    $(jq -c . "$TMP/body" 2>/dev/null)"; }
  ID=$(jq -r '.order.id // empty' "$TMP/body" 2>/dev/null)
  SIGN=$(jq -r '.order.signingUrl // empty' "$TMP/body" 2>/dev/null)
  check "signingUrl present"       1 "$([ -n "$SIGN" ] && echo 1 || echo 0)"
  if [ -n "$ID" ]; then
    code=$(post '/v1/partner/orders' -H "Idempotency-Key: $IK" -d "{\"opportunitySlug\":\"$SLUG_O\",\"amount\":$AMOUNT}")
    check "same Idempotency-Key → same order" "$ID" "$(jq -r .order.id "$TMP/body" 2>/dev/null)"
    check "get order"              200 "$(get "/v1/partner/orders/$ID")" "status=$(jq -r .order.status "$TMP/body" 2>/dev/null)"
    check "confirm before signing → 400" 400 "$(post "/v1/partner/orders/$ID/confirm-signing")" "$(jq -r .error "$TMP/body" 2>/dev/null | cut -c1-40)"
    check "resume-signing → fresh url" 200 "$(post "/v1/partner/orders/$ID/resume-signing" -d '{}')"
    check "legal documents"        200 "$(get "/v1/partner/orders/$ID/opportunity-documents")" "docs=$(jq '.documents|length' "$TMP/body" 2>/dev/null)"
    check "cancel → cancelled"     200 "$(post "/v1/partner/orders/$ID/cancel" -d '{"note":"smoke test"}')" "status=$(jq -r .order.status "$TMP/body" 2>/dev/null)"
    check "cancel again (idempotent)" 200 "$(post "/v1/partner/orders/$ID/cancel" -d '{}')"
  fi
fi

echo
[ "$fails" = 0 ] && echo "ALL CHECKS PASSED" || echo "$fails CHECK(S) FAILED"
exit "$fails"
