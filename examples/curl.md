# End-to-end with curl

```bash
export LBX_API=https://api-staging.lbxpro.tech
export LBX_KEY=lbx_stg_…            # your partner key
auth=(-H "Authorization: Bearer $LBX_KEY")
```

## 1. Data

```bash
# First page of the catalog, most recently funded first
curl -s "${auth[@]}" "$LBX_API/v1/partner/companies?limit=20&sortBy=lastRoundDate&sortOrder=desc" | jq '.total, .items[0]'

# One company, its charts, its funding rounds
curl -s "${auth[@]}" "$LBX_API/v1/partner/companies/anthropic" | jq .company.name
curl -s "${auth[@]}" "$LBX_API/v1/partner/companies/anthropic/charts" | jq '.pricingHistory | last'
curl -s "${auth[@]}" "$LBX_API/v1/partner/companies/anthropic/funding" | jq '.rounds | length'

# Daily prices — one company's series, then everything priced on the latest day
curl -s "${auth[@]}" "$LBX_API/v1/partner/companies/anthropic/daily-prices?from=2026-09-01" | jq '.points | last'
curl -s "${auth[@]}" "$LBX_API/v1/partner/daily-prices" | jq '{date, n: (.items|length), first: .items[0]}'

# The LBX25 index and 24 months of history
curl -s "${auth[@]}" "$LBX_API/v1/partner/indexes" | jq '.items[] | {id, name, indexLevel}'
curl -s "${auth[@]}" "$LBX_API/v1/partner/indexes/lbx25/history?months=24" | jq '.history | length'
```

## 2. Opportunities

```bash
curl -s "${auth[@]}" "$LBX_API/v1/partner/opportunities" \
  | jq '.items[] | {slug, name: .displayName, listingType, minInvestment, investorDeadline, status}'
```

## 3. Place an order

```bash
# Idempotency-Key: anything unique per attempt (a UUID from your side is ideal)
curl -s "${auth[@]}" -X POST "$LBX_API/v1/partner/orders" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 6f1c9d2e-order-0001" \
  -d '{"opportunitySlug":"<slug>","amount":25000,"returnUrl":"https://partner.example/lbx/signed"}' \
  | tee /tmp/order.json | jq '{id: .order.id, status: .order.status, units: .order.numberOfUnits, total: .order.totalAmount, signingUrl: .order.signingUrl}'

ORDER=$(jq -r .order.id /tmp/order.json)
```

Open `signingUrl` for your authorised signatory. It expires in 5–20 minutes —
if it does:

```bash
curl -s "${auth[@]}" -X POST "$LBX_API/v1/partner/orders/$ORDER/resume-signing" \
  -H "Content-Type: application/json" -d '{"returnUrl":"https://partner.example/lbx/signed"}' \
  | jq .order.signingUrl
```

## 4. Confirm signing, then poll

```bash
# After the envelope is completed (400 "Documents not signed yet" = call again later)
curl -s "${auth[@]}" -X POST "$LBX_API/v1/partner/orders/$ORDER/confirm-signing" | jq .order.status
# → "awaiting_payment"

# Poll for progress (a few times a day is plenty)
curl -s "${auth[@]}" "$LBX_API/v1/partner/orders/$ORDER" \
  | jq '{status: .order.status, history: [.order.statusHistory[] | {status, at}]}'
```

## 5. Documents

```bash
# The offer's legal documents
curl -s "${auth[@]}" "$LBX_API/v1/partner/orders/$ORDER/opportunity-documents" | jq .documents
KEY=$(curl -s "${auth[@]}" "$LBX_API/v1/partner/orders/$ORDER/opportunity-documents" | jq -r '.documents[0].key')
curl -s "${auth[@]}" "$LBX_API/v1/partner/orders/$ORDER/opportunity-document?key=$KEY" | jq .url

# Settlement documents, once the custody platform has issued them
curl -s "${auth[@]}" "$LBX_API/v1/partner/orders/$ORDER" | jq '.order.settlementDocuments'
DOC=$(curl -s "${auth[@]}" "$LBX_API/v1/partner/orders/$ORDER" | jq -r '.order.settlementDocuments[0].uid')
curl -s "${auth[@]}" -o prospectus.pdf "$LBX_API/v1/partner/orders/$ORDER/documents/$DOC"
```

## 6. Portfolio (after settlement)

```bash
curl -s "${auth[@]}" "$LBX_API/v1/partner/portfolio" | jq '.summary, (.holdings[] | {name, units, value})'
curl -s "${auth[@]}" "$LBX_API/v1/partner/portfolio/history" | jq '.points | last'
POS=$(curl -s "${auth[@]}" "$LBX_API/v1/partner/portfolio" | jq -r '.positions[0].id // empty')
[ -n "$POS" ] && curl -s "${auth[@]}" "$LBX_API/v1/partner/positions/$POS/history" | jq '.points | length'
```

## 7. Cancel (unpaid orders only)

```bash
curl -s "${auth[@]}" -X POST "$LBX_API/v1/partner/orders/$ORDER/cancel" \
  -H "Content-Type: application/json" -d '{"note":"duplicate"}' | jq .order.status
```

## Errors look like

```json
{ "error": "Minimum investment is $10,000", "code": "VALIDATION_ERROR" }
```

Quote the `X-Request-Id` response header when asking LBX about a call.
