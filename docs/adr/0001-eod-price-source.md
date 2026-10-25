# ADR 0001: End-of-day price source

Status: accepted (Ming, 2026-10-24)

## Context
Spec §9 Q4 asks for a primary and fallback price source after a license/terms check. The `PriceSource` interface (spec §4.3) keeps the source swappable.

## Options
| Source | Access | Terms for automated use | Notes |
|---|---|---|---|
| TCBS public API (`apipubaws.tcbs.com.vn`) | Unofficial endpoint used by TCBS's web UI, no registration | No published terms found | Ming trades on TCBS. Can change or block without notice |
| SSI FastConnect Data | Official, documented, needs registration | Not read (no access) | Most stable; needs Ming's action |
| VNDirect dchart / finfo | Unofficial public endpoints | No published terms found | Recalled as thousand VND |
| vnstock (Python) | Wrapper over other sources | Own licence verified: free community edition for personal use, upstream terms still apply | Python runtime and closed Gen 5 build; unsuitable as a dependency |
| cafef, HOSE/HNX | Scraping / licensed data | Likely forbidden / licensed | Rejected |

## Decision
Primary source: the TCBS public API, source id `tcbs-public`. **Risk accepted by Ming, 2026-10-24**: the endpoint is unlicensed for automated use and may change or block without notice. The fallback source comes later (SSI FastConnect or VNDirect), added as another `PriceSource`.

## Terms-check evidence
On 2026-10-24 the sandbox could not reach Vietnamese hosts, so no terms page or live response was read. No published terms for the TCBS endpoint were found by other means. The vnstock licence was verified.

## Constraints
- Tens of requests per day: one request per symbol, sequential, 1 s delay, 15 s timeout.
- Descriptive User-Agent (`stoktok/0.1 (personal portfolio tracker; low-volume end-of-day sync)`); no header spoofing.
- Retries only on network errors, 429 and 5xx, with backoff; the run stops after 5 consecutive failures.

## UNVERIFIED items (check on the first `--dry-run`)
- Response shape: `{ ticker, data: [{ open, high, low, close, volume, tradingDate }] }` (recalled).
- Price unit: VND (constant `TCBS_PRICE_UNIT` in `apps/worker/src/sources/tcbs.ts`). Core plausibility guards reject bars that look like thousand VND.
- Raw vs adjusted prices: assumed raw. Signals may later need an adjusted series (STK-015).
- `tradingDate` encoding: both `T00:00:00Z` and the previous day at `T17:00:00Z` are mapped to the Vietnam date.

## Swapping the source
Implement `PriceSource` (`apps/worker/src/sources/price-source.ts`) for the new source, declare its unit in one constant, and construct it in `cli.ts`. `runEodSync` does not change.
