# lbx — Partner API CLI

A dependency-free TypeScript/Bun client for the [LBX Partner API](../README.md).
Every documented endpoint has a command; every command prints a human table by
default and raw JSON with `--json`.

## Install

Bun 1.2 or later:

```sh
cd cli
bun install
bun run bin/lbx.ts --help
```

Or link it so `lbx` is on your `PATH`:

```sh
bun link
```

Recent Node (22.18+, where type stripping is on by default; checked with
22.23) also runs it unchanged: `node bin/lbx.ts ping`.

## Configure

Give the CLI your partner key through the environment or a file:

```sh
export LBX_KEY=lbx_stg_…                       # the key itself
# or
export LBX_KEY_FILE=~/.config/lbx/partner-key  # a file whose first line is the key
chmod 600 ~/.config/lbx/partner-key

export LBX_API=https://api-staging.lbxpro.tech  # optional, this is the default
```

Per call, `--api-key-file <path>` and `--api <url>` override those. There is
also `--api-key <key>`, but an inline key lands in your shell history and in
`ps` output, so prefer the environment or a file. Precedence is `--api-key`,
`--api-key-file`, `LBX_KEY`, `LBX_KEY_FILE`.

The key is only ever sent as a bearer token. It is never printed in full:
`lbx ping` and `--verbose` show it masked (`lbx_stg_…xxxx`), enough to tell two
keys apart. A plain-`http://` base URL is refused unless you pass
`--insecure`, since the key would travel unencrypted.

```sh
lbx ping                 # confirms the base URL and key, cheapest call there is
lbx ping --verbose       # -v: logs each request and response to stderr
lbx ping --timeout 5     # per-request budget in seconds (default 30, 0 disables)
```

## Commands

| Command | What it does |
| --- | --- |
| `lbx ping` | Check the base URL and key |
| `lbx companies list` | Browse the catalog — see filters below |
| `lbx companies get <slug>` | Company detail |
| `lbx companies charts <slug>` | 24-month pricing series, plus that window's funding rounds |
| `lbx companies funding <slug>` | All funding rounds |
| `lbx companies prices <slug> [--from d] [--to d] [--limit n]` | Daily institutional and retail prices, oldest first |
| `lbx prices [--date d]` | Every priced company on one day (default: the latest day with prices) |
| `lbx indexes list` | Indexes with level and performance |
| `lbx indexes history <id> [--months n]` | Index level over time (`lbx25`, or an id) |
| `lbx opportunities list` | Public offers, with an `ORDERABLE` column |
| `lbx opportunities get <slug>` | One offer's terms and economics |
| `lbx orders list` | Orders on your partner account |
| `lbx orders get <id>` | Status, economics, custody ids, settlement documents, history |
| `lbx orders create --opportunity <slug> --amount <usd>` | Place an order, returns a signing URL |
| `lbx orders confirm-signing <id> [--wait s]` | Once the signatory has signed (`--wait` polls) |
| `lbx orders resume-signing <id>` | Fresh signing URL (they expire in 5–20 min) |
| `lbx orders cancel <id> [--note]` | Cancel an unpaid order |
| `lbx orders documents <id>` | The offer's legal documents |
| `lbx orders document-url <id> --key <key>` | Short-lived download URL for one |
| `lbx orders file <id> <docUid> [--out path]` | Download a signed prospectus / receipt, once issued |
| `lbx portfolio show [--lots]` | Holdings per offer, the lots behind them, and totals |
| `lbx portfolio history` | Portfolio value over time |
| `lbx positions history <id>` | One lot's value over time (`id` from the lots table) |

`lbx <group>` (or `lbx <group> --help`) lists a group's commands;
`lbx <command> --help` prints that command's flags.

### Catalog filters

```sh
lbx companies list --in-lbx25 --sort-by impliedValuation --sort-order desc --limit 10
lbx companies list --industry "AI infrastructure" --industry FinTech   # repeatable
lbx companies list --search anthropic --json
```

`--industry` takes the industry **name** (`"HR Tech"`), not the slug, and repeats
for a union. `--limit` is capped at 200 by the API and checked locally first.
`--no-in-lbx25` sends `inLBX25=false`, which the API accepts but does not yet
filter on (it returns the full catalog); it will exclude constituents once
the API honours it.

### Daily prices

```sh
lbx prices                                     # every priced company, latest day
lbx prices --date 2026-09-04                   # a specific day (UTC)
lbx companies prices anthropic --from 2026-09-01 --limit 30
lbx companies prices anthropic --csv > anthropic-prices.csv
```

Days are UTC calendar dates (`YYYY-MM-DD`) and are checked locally before any
request. Daily prices cover a subset of the catalog that grows over time; a
company without them prints an empty table, not an error. For a daily sync,
`lbx prices` is one call instead of one per company.

### Placing an order

```sh
lbx opportunities list                       # only listingType=tokenized is orderable
lbx orders create --opportunity lbx-ai-infrastructure-basket-series \
                  --amount 15000 \
                  --return-url https://partner.example/signed
# stderr: idempotency-key 6f1c…            (printed before the request goes out)
# stdout: the order, its signing URL, and the key again
lbx orders confirm-signing <id>              # after the signatory signs
lbx orders confirm-signing <id> --wait 600   # or let it poll every 10s for up to 10 min
lbx orders get <id>                          # poll from here
```

`confirm-signing` is idempotent. If the envelope is not signed yet the API
answers `400 "Documents not signed yet"`; the CLI turns that into exit `75`
(try again later) rather than `1`, and `--wait <seconds>` keeps retrying
every 10 s until it goes through or the time is up.

#### Retrying a create

`orders create` sends an `Idempotency-Key` header — a fresh UUID unless you
pass `--idempotency-key <key>` — and prints it to stderr **before** the request
leaves, so you have it even if the call hangs or the connection drops. If the
command fails after that point, retry with the same key:

```sh
lbx orders create --opportunity … --amount 15000 --idempotency-key 6f1c…
```

A repeat under the same key returns the original order instead of creating a
second one; the error output repeats the key with that exact flag.

### Order documents

Two different things live under "documents":

- `orders documents <id>` lists the **offer's** legal documents (the T&Cs the
  signatory agreed to), and `orders document-url <id> --key <key>` mints a
  short-lived download URL for one of them.
- `orders file <id> <docUid>` downloads a **custody-side** document once it
  has been issued — the signed prospectus, a receipt. The route streams the
  PDF itself, so this command writes a file:

```sh
lbx orders get <id>                             # settlementDocuments lists uid, kind, fileName
lbx orders file <id> <docUid>                   # ./<server filename>, else ./<docUid>.pdf
lbx orders file <id> <docUid> --out ~/Downloads/ # into a directory, server filename kept
lbx orders file <id> <docUid> --out signed.pdf   # exact path
lbx orders file <id> <docUid> --out - > signed.pdf  # bytes to stdout
```

## Output

- default: an aligned table. `null` renders as `—`, meaning "LBX has no value"
  rather than zero.
- `--json` / `-j`: the raw response body, unmodified.
- `--csv`: the same columns, but money and percentages as raw numbers (`47.91`,
  not `47.91%`) so a spreadsheet can add them up. Only list-style commands
  have a table; on a detail command `--csv` is a usage error before any
  request is made — use `--json` there.
- `--format table|json|csv` if you prefer to be explicit.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | API error (`404`, `400`, `5xx`, …) or a transport failure |
| `2` | `401` `UNAUTHORIZED` — key missing, invalid, or not provisioned on this environment |
| `3` | `403` `FORBIDDEN` / `INVESTOR_SETUP_INCOMPLETE` — the key works but the account is not eligible (suspended, not accredited, custody registration incomplete); contact LBX |
| `64` | Bad usage — unknown command, missing argument, invalid flag |
| `75` | Try again later — `confirm-signing` found the envelope not signed yet |

Errors print the API's `code`, message, `details` and the `x-request-id` to
quote to support@lbx.pro.

## Development

```sh
bun test           # unit tests, no network
bun run typecheck
```

Tests stub the transport, so the suite never touches staging. `test/helpers.ts`
records each request (method, path, query, headers, body) for assertions.
