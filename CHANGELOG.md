# Changelog

## v1.4 — 2026-09-14 — whoami, custody per environment (additive)

- `GET /v1/partner/whoami` — `{ partner, environment, custodyEnvironment }`.
  Make it the first call of an integration: it tells you which sandbox you
  are talking to.
- `custodyAssetId` is now the offer's identity **for the environment you
  call**. An offer not yet set up on this environment lists with
  `custodyAssetId: null` and refuses orders with `VALIDATION_ERROR` — *This
  offer is not configured on this environment and cannot be ordered here.* —
  before anything reaches custody. Previously such an order failed later with
  a provider message.
- Every response carries an `x-request-id` header; quote it when reporting an
  unexpected message. Custody-platform rejections are always translated into
  the documented sentences.
- CLI 0.3.0: `lbx whoami`.

## 2026-09-09 — minimum applies to position value (behaviour clarification)

`POST /v1/partner/orders` now enforces `minInvestment` on the whole-unit
position value rather than on the typed `amount`; the `VALIDATION_ERROR`
message quotes the effective minimum (`Minimum investment is $15,810 (17 units
at $930)`). No field or endpoint changes.

## v1.3 — 2026-09-08 — daily prices (additive)

- `GET /v1/partner/companies/{slug}/daily-prices` — daily `institutionalPrice` /
  `retailPrice` series, ascending; `from`, `to`, `limit`
- `GET /v1/partner/daily-prices?date=` — bulk snapshot of every priced company
  on one day (default: latest day with prices)

## v1.2 — 2026-09-08 — **breaking field renames** (pre-integration)

Custody-platform references are now consistently named across all partner
responses; the previous internal field names are gone:

- `order.settlementDocuments[]` — signed prospectus / receipts (`uid`, `fileName`, `size`, `kind`)
- `order.custodyOrderId` — set once the prospectus is confirmed
- `custodyAssetId` — on `opportunity`, `order.opportunitySnapshot`, `position` and `holding`
- `statusHistory[].by` gains the value `custody` (transitions driven by the custody platform)
- The internal offer-linkage key is no longer exposed at all

Made while only LBX test partners hold keys; a rename of this kind after
external integration would ship as `/v2/partner` instead.

## v1 — 2026-09-03

Initial partner surface (backend PR #255):

- Data: companies (list, detail, charts, funding), indexes (list, history)
- Opportunities: list, detail — public offers only
- Orders (nominee model): create with `Idempotency-Key`, list, get,
  confirm-signing, resume-signing, cancel, legal documents, settlement
  documents
- Auth: static bearer key per partner; staging environment only
