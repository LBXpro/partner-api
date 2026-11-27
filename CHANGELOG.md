# Changelog

## v1.8 — 2026-11-27 — investors on funding rounds; activity history by month only (`quarter` deprecated)

### Funding rounds (additive)

- `FundingRound.investors` (new, always present) in
  `GET /v1/partner/companies/{slug}/funding`: the names of investors in the
  round, as recorded by LBX. The lead investor is not marked.
- An empty list means LBX has no investor data for that round, not that it
  had no investors.
- `/charts` is unchanged: its `fundingRounds` carry no investors.

### Activity history

- `activityHistory` in `GET /v1/partner/companies/{slug}` holds one point per
  month only (still up to 24 months back from the latest point).
- `ActivityHistoryPoint.quarter` is deprecated and will be removed in the
  next version: use `month`. Its value does not change (the calendar quarter
  of the month before `month`; several points share it).
- `activityHistory` in `GET /v1/partner/opportunities/{slug}` is deprecated
  with `OpportunityActivityPoint`, and will be removed in the next version;
  the company detail has the history.

## v1.7 — 2026-11-16 — monthly activity history (additive fields; history changes shape)

- The activity score is published every month: calculated on the 1st,
  published on the 2nd, around 09:00 UTC.
  `activityHistory` in `GET /v1/partner/companies/{slug}` gets one point per
  month from November 2026; the points before that keep their quarter labels. The window is still
  the last 8 quarters (24 months back from the latest point), so the array
  grows from up to 8 points to up to 24 as monthly points build up.
- `ActivityHistoryPoint.month` (new, always present): the month the score was
  calculated in, `YYYY-MM`. A quarterly point is labelled with the month
  after its quarter (`Q3 2026` → `2026-10`). Key and compare points by
  `month`.
- `ActivityHistoryPoint.quarter` keeps its meaning: the quarter the score's
  data ends in (`Q4 2026` for `2026-11`). Monthly points in the same quarter
  share it, so it is **no longer unique** within a history: a client keyed
  on `quarter` overwrites points.
- `activityHistory` is ordered oldest first by `month`. Before, it was
  sorted by the `quarter` label as text, which misordered points across a
  year boundary; any re-sorting you added for that is no longer needed.
- Activity scores are stored with 2 decimals.
- `slug` (new) in `GET /v1/partner/companies/{slug}/charts` and
  `/funding`: the company's current slug. A renamed company's former slug
  still resolves; the response tells you which slug to store.
- `GET /v1/partner/daily-prices` without `date` skips a day that is still
  being loaded: when the newest day has under 90% of the previous day's
  companies, the previous day is served. No change to the response.

## 2026-10-27 — production environment (docs)

The partner API is documented on production as well as staging:
`https://api.lbxpro.tech` (keys `lbx_prd_…`, custody **live**) beside
`https://api-staging.lbxpro.tech` (keys `lbx_stg_…`, custody **test**). Your
LBX account manager tells you which environment is yours. A key works only on
the environment it was issued for. See *Environments* in the README. No field
or endpoint changes.

## v1.6 — 2026-10-22 — deal flow and permission sets (additive)

- `GET /v1/partner/deal-flow` — `{ asOf, items }`: every secondary-market
  order seen in the last 28 days, one row per order in its latest state, the
  whole feed in one response. Rebuilt once a day (around 07:00 UTC); `asOf`
  says when. `id` is a signed 64-bit integer sent as a **string** — keep it
  a string. `created` is the day the order was last seen. Field notes in the
  README under *Deal flow*.
- Keys now hold **permission sets**: `core` (market data, opportunities,
  orders, portfolio) and `deal-flow`. A call outside a key's sets answers
  `403 FORBIDDEN` — *This partner key does not include …*. Existing keys
  hold `core`; nothing changes for them. `whoami` answers any valid key.
- `UPSTREAM_ERROR` can now also be a `503`: the deal-flow feed is
  temporarily unavailable; retry later.
- CLI 0.4.0: `lbx deal-flow` (table, `--csv`, `--json`). `lbx ping` now calls
  `whoami`, so it works with any key: it prints the partner name, and its
  `--json` has `partner` in place of `companies`.
- `scripts/smoke.sh` checks the permission sets the key holds, runs only
  those checks, and expects `403` from the rest.

## v1.5 — 2026-10-05 — spread and calculation type on daily prices (additive)

- Both daily-price responses add `spreadPercent` and `calculationType` on
  each series point and each bulk item. `spreadPercent` is the retail premium
  over the institutional price, in percent (`25.4753` = 25.4753%), not a
  bid/ask spread; `null` when unavailable. `calculationType` is `observed` or
  `modeled`, or `null` when unavailable.
- The OpenAPI snapshot also now includes `units` on order create and
  `uninvestedRemainder` on the order. The guide already described both; they
  were missing from the committed spec.
- CLI 0.3.1: `lbx prices` and `lbx companies prices` tabulate `spreadPercent`
  and `calculationType`.

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
