# LBX Partner API

Programmatic access to LBX private-market data, the public opportunity
catalog, and order placement for a partner's own investor account.

- **Base URL**: `https://api-staging.lbxpro.tech` (partner access runs against
  the LBX staging environment; production access is arranged separately)
- **Interactive docs**: https://api-staging.lbxpro.tech/v1/partner/docs
- **Machine-readable spec**: [`openapi/partner-openapi.json`](openapi/partner-openapi.json)
  (OpenAPI 3.1) · TypeScript types: [`openapi/partner-api.types.ts`](openapi/partner-api.types.ts)
- **Worked examples**: [`examples/curl.md`](examples/curl.md)
- **CLI**: [`cli/`](cli/README.md) — `lbx companies list`, `lbx orders create`, …

## Authentication

Every request carries your partner key as a bearer token:

```
Authorization: Bearer lbx_stg_…
```

Keys are issued by LBX per partner and scoped to your partner account. Keep
the key server-side — never in a browser or mobile app. Rotation is
handled by issuing a second key while the first stays valid; tell us when
you have switched and the old key is revoked.

| Response | Meaning |
| --- | --- |
| `401 UNAUTHORIZED` | Key missing or invalid |
| `404 NOT_FOUND` on every partner route | Your access isn't provisioned (yet) on this environment |

## What you can do

### Market data

| Method · path | Returns |
| --- | --- |
| `GET /v1/partner/companies` | Paginated company catalog — filter by `search`, `industry`, `cohort`, `inLBX25`, valuation/premium/activity ranges; sort with `sortBy`/`sortOrder`; page with `limit` (≤200) / `offset`. Response carries `total`. |
| `GET /v1/partner/companies/{slug}` | Company detail with 12-month pricing history and monthly activity history |
| `GET /v1/partner/companies/{slug}/charts` | 24-month pricing series (price, implied valuation, secondary premium) + funding rounds |
| `GET /v1/partner/companies/{slug}/funding` | All funding rounds |
| `GET /v1/partner/companies/{slug}/daily-prices` | Daily price series (`institutionalPrice`, `retailPrice`, one point per day, ascending). `from`/`to` are inclusive UTC days (`YYYY-MM-DD`); `limit` keeps the most recent N days (default 365, max 2000) |
| `GET /v1/partner/daily-prices?date=` | Every priced company on one day — the bulk pull. `date` defaults to the latest day that has prices; the response echoes the `date` served |
| `GET /v1/partner/indexes` | LBX indexes with current level and performance metrics |
| `GET /v1/partner/indexes/{id}/history?months=` | Index level history (`lbx25`, or the index id) |

Company `slug`s are stable, URL-safe identifiers (e.g. `anthropic`). Every
numeric field is `null` when LBX has no value — treat `null` as "unknown",
not zero.

Daily prices are published per business day for a subset of the catalog and
the set grows over time; a company without daily prices returns an empty
`points` array, not an error. For a daily sync, call `GET /v1/partner/daily-prices`
once rather than one series call per company.

### Opportunities

| Method · path | Returns |
| --- | --- |
| `GET /v1/partner/opportunities` | Active, publicly visible offers with terms, economics and status |
| `GET /v1/partner/opportunities/{slug}` | One offer in full |

Only offers of `listingType: "tokenized"` are orderable through the API.
`minInvestment` is the per-investor floor in USD; `investorDeadline` is the
public commit deadline — orders after it are refused (`SUBSCRIPTION_CLOSED`).

### Orders

Orders are placed for **your partner investor account** (one account per
partner). The lifecycle mirrors the LBX investor app exactly:

```
POST /v1/partner/orders                       →  awaiting_signature  (+ signingUrl)
        your signatory signs the prospectus on the e-signature page
POST /v1/partner/orders/{id}/confirm-signing  →  awaiting_payment
        LBX sends payment details; funds settle on the custody platform
GET  /v1/partner/orders/{id}                  →  payment_received → accepted → completed
```

| Method · path | Notes |
| --- | --- |
| `POST /v1/partner/orders` | Body: `{ "opportunitySlug", "amount", "returnUrl"? }`. `amount` is the pre-fee investment in USD. Returns the order with `signingUrl`. **Send an `Idempotency-Key` header** (see below). |
| `GET /v1/partner/orders` | All orders on your account, newest first |
| `GET /v1/partner/orders/{id}` | Status, economics (units, fees, total), status history — **poll this** |
| `POST /v1/partner/orders/{id}/confirm-signing` | Call once the signatory has completed the envelope. Idempotent. `400 "Documents not signed yet"` means call again after signing. |
| `POST /v1/partner/orders/{id}/resume-signing` | Signing URLs expire in 5–20 minutes; this issues a fresh one (optional `returnUrl`) |
| `POST /v1/partner/orders/{id}/cancel` | Unpaid orders only (`awaiting_signature`, `awaiting_payment`, `payment_details_sent`) |
| `GET /v1/partner/orders/{id}/opportunity-documents` | The offer's legal documents (references) |
| `GET /v1/partner/orders/{id}/opportunity-document?key=` | Short-lived download URL for one legal document |
| `GET /v1/partner/orders/{id}/documents/{docUid}` | Signed prospectus / receipts, once issued (`docUid` from the order's `settlementDocuments`) |

**Order statuses**

| Status | Meaning |
| --- | --- |
| `awaiting_signature` | Created; the prospectus needs signing (`signingUrl`) |
| `documents_signed` / `awaiting_payment` | Signed; LBX prepares payment instructions |
| `payment_details_sent` | Instructions delivered to your account |
| `payment_received` | Funds confirmed |
| `accepted` / `completed` | Allocation confirmed / tokens issued |
| `cancelled` / `rejected` / `failed` / `lost` | Terminal — `failureReason` says why |

`returnUrl` is where the e-signature page sends the signatory afterwards.
Pass a page of your own; it defaults to the LBX web app.

Custody-platform references on an order: `custodyOrderId` (set once the
prospectus is confirmed), `settlementDocuments[]` (`uid`, `fileName`, `size`,
`kind`), and `opportunitySnapshot.custodyAssetId`. Opportunities and positions
carry the same `custodyAssetId`.

### Portfolio

Once orders settle, your holdings and their value — the same figures the LBX
investor app shows, scoped to your partner account.

| Method · path | Returns |
| --- | --- |
| `GET /v1/partner/portfolio` | `positions` (one per settled order lot), `holdings` (grouped per offer), and a `summary` (`investedTotal`, `valueTotal`, `gain`, `gainPct`, `activePositions`). Values use LBX's current indicative prices. |
| `GET /v1/partner/portfolio/history` | Portfolio value over time (`points[{date, value}]`) |
| `GET /v1/partner/positions/{id}/history` | One position's value over time (`id` from `positions[].id`) |

### Idempotency

Network failures happen mid-`POST`. Send `Idempotency-Key: <any string unique
per order attempt>` on `POST /v1/partner/orders`; a repeated request with the
same key returns the original order instead of creating a second one. Keys
are scoped to your account and never expire.

## Errors

Every error is the same envelope:

```json
{ "error": "Human-readable message", "code": "MACHINE_CODE", "details": { } }
```

| Code | HTTP | When |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 | Bad input, or a rule refused the request (minimum, fees, status) — `details` carries field errors where applicable |
| `SUBSCRIPTION_CLOSED` | 400 | Past the offer's investor deadline |
| `OFFER_NOT_ORDERABLE` | 400 | The offer isn't accepting orders right now |
| `UNAUTHORIZED` | 401 | Key missing/invalid |
| `FORBIDDEN` | 403 | Your account can't perform this (suspended, not accredited, …) |
| `INVESTOR_SETUP_INCOMPLETE` | 403 | Your partner account's custody registration isn't complete — contact LBX |
| `NOT_FOUND` | 404 | Unknown slug/id, or the resource isn't yours |
| `UPSTREAM_ERROR` | 502 | A dependency failed; safe to retry with the same `Idempotency-Key` |

## Conventions

- JSON in and out; timestamps are ISO-8601 UTC; money is USD as numbers.
- **Additive-only changes** under `/v1/partner`: new fields and endpoints may
  appear; nothing existing is renamed or removed. Breaking changes would ship
  as `/v2/partner` with notice.
- No rate limit is enforced today; please keep polling to a sensible cadence
  (an order rarely changes status more than a few times a day).

## Support

support@lbx.pro — include the `X-Request-Id` response header of any call
you're asking about; every request is traceable by it.
