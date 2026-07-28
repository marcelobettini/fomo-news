# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`fomo-news-ingestor` is the **ingestor** component of a future multi-component news aggregator
for local Tandil news ("Agregador de Noticias de Tandil"). It is a **single-shot CLI process**,
not a server: it fetches an Atom feed, upserts new/changed entries into MongoDB, evaluates
data-loss alarms, and exits. Periodicity comes from external system `cron` — the process never
schedules itself. Endpoint and notifier components described in the constitution do not exist
yet in this repo; only the ingestor is implemented (feature `001-news-feed-ingestion`).

The project is driven by [spec-kit](specs/001-news-feed-ingestion/): `spec.md` (requirements),
`plan.md`, `tasks.md`, `data-model.md`, `contracts/` (CLI contract + data contract), and
`quickstart.md` live under `specs/001-news-feed-ingestion/`. Read `spec.md` and
`contracts/cli-contract.md` before changing behavior — they are the source of truth for
functional requirements (FR-xxx) referenced throughout the code comments.

## Project constitution — read before making design decisions

`.specify/memory/constitution.md` defines 8 binding principles that override convention. The
codebase cites them by article number in comments (e.g. "Artículo I", "FR-013"). Skim it before
touching ingestion logic, retention, alarms, or time handling. Key ones that shape the code:

- **Article I — No eligible news is ever lost.** Dedup/novelty decisions are computed against
  the **full persisted state on every run**, never a "since last run" timestamp watermark (see
  `src/core/dedup.ts`). Do not introduce watermark-based incremental processing.
- **Article II — Components have independent clocks.** No internal scheduler; cron is external.
  Don't add a setInterval/cron-in-process.
- **Article VI — Explicit time handling.** Timezones are always IANA `Area/City` names, never
  fixed offsets (`Etc/*` zones are explicitly rejected — see `src/core/localTime.ts`). Instants
  are stored in UTC; only local-day decisions use `toLocalDateKey`.
- **Article VII — Fail loud, degrade before blocking.** A run that sees zero entries, or that
  fails to fetch/parse the source, is **never** recorded as `"success"` even without a thrown
  error (see `determineRunStatus` in `src/core/alarms.ts`). Don't add a code path where an
  empty/error result gets treated as success.
- **Article VIII — The system never generates or rewrites content.** Only whitespace
  normalization and stripping a leading `<img>` tag from the summary are allowed
  (`src/core/normalize.ts`); no LLM-based rewriting/summarization of news content, ever.
- **Article V (future)** — delivery channels don't exist yet, but when adding them the core
  must stay channel-agnostic (no channel-specific fields on the news model).

Any change that seems to conflict with a listed verification criterion in the constitution
should stop and be flagged rather than worked around.

## Commands

```bash
npm test              # tsc build + node's built-in test runner over dist/tests/unit/*.test.js
npm run build          # tsc -p tsconfig.json (outputs to dist/)
npm run ingest          # node --env-file=.env dist/src/main.js — one real run against MongoDB + live feed
```

Run a single test file (after building, or let `pretest` do it via `npm test`):

```bash
npm run build && node --test dist/tests/unit/dedup.test.js
```

There is no lint script configured; `tsc` in strict mode is the only static check.

Tests are pure unit tests over `src/core/*` logic against static XML fixtures in
`tests/fixtures/` (`tests/unit/testHelpers.ts` reads them relative to `process.cwd()`, so tests
must be run from the repo root). **No network or real database is touched in `npm test`** —
adapters (`src/adapters/*`, which do MongoDB/HTTP I/O) are exercised only by real runs, not by
the test suite. See `specs/001-news-feed-ingestion/quickstart.md` for what each fixture covers.

## Environment

Seven required env vars, no hidden defaults, validated at startup in `src/config/env.ts` (throws
and exits non-zero if any is missing/invalid): `MONGODB_URI`, `SOURCE_FEED_URL`,
`TARGET_CATEGORY`, `TIMEZONE`, `NEWS_RETENTION_MS`, `RAW_SNAPSHOT_RETENTION_MS`,
`CATEGORY_SILENCE_THRESHOLD_MS`. Full semantics, formats, and calibration guidance for each are
in [env.md](env.md) — read it before changing `src/config/env.ts` or adding a new variable.
Loaded natively via `node --env-file=.env`, no dotenv-style package.

## Architecture

**Core vs. adapters split** (`src/core/` is pure, synchronous, I/O-free business logic;
`src/adapters/` does all I/O). This split is why `src/core` can be unit-tested without a
database or network — keep new business logic in `core` and push any fetch/DB call into
`adapters`.

- `src/adapters/source.ts` — fetches raw feed body and parses Atom XML (`fast-xml-parser`).
  Fetching and parsing are deliberately separate functions: if parsing fails after a successful
  fetch, the raw body is still saved for diagnostics. A malformed individual `<entry>` is
  collected into `entryErrors` and skipped, but does not abort parsing the rest of the feed
  (Article VII: degrade, don't block).
- `src/core/mapEntry.ts` — maps a raw feed entry to the 6 business fields of a news item
  (`MappedNews`), and detects declared-category vs. link-path-category mismatches (signal only,
  not a blocking condition).
- `src/core/dedup.ts` — classifies each entry as `new` / `updated` / `unchanged` by diffing
  against **all** currently-known news for those links (not incremental).
- `src/core/alarms.ts` — evaluates the two alarm conditions (`full-window-rotation`,
  `category-silence`) and decides run status. `full-window-rotation` fires when 100% of entries
  seen this run are new — i.e., the source's fixed-size sliding window (last 20 items) likely
  rotated completely between runs, which means items were lost. Exempted on the very first
  successful run ever (FR-013).
- `src/core/localTime.ts` — IANA timezone validation and UTC→local-day-key conversion.
- `src/adapters/repository.ts` — MongoDB access. Collections: `news` (news items, `_id` = link,
  TTL index on `expiresAt`), `categories` (every category ever seen, for detecting brand-new
  categories), `state` (singleton doc tracking `lastTargetCategoryObservedAt`), `runs` (one doc
  per run: status, counts, alarms, errors — the actual source of truth for operators, not the
  process exit code), `raw_snapshots` (short-TTL raw feed body copies for diagnostics only).
- `src/adapters/lock.ts` — Mongo-doc-based mutex (`_id: "ingestor"`) so overlapping invocations
  don't run concurrently; a losing `acquireLock` call returns `false` (not a thrown error) — the
  invocation is *skipped*, which is exit code 0, not a failure. TTL on the lock is a crash-safety
  backup, not the primary release mechanism (that's the `finally` block in `main.ts`).
- `src/main.ts` — orchestrates one full run: connect → ensure indexes → acquire lock → fetch/parse
  feed → map + filter by `TARGET_CATEGORY` → dedup decide → upsert → evaluate alarms → record run
  → save raw snapshot → set exit code. Exit code 0 = success (including "no new news" and
  "skipped due to lock"); non-zero = source/parse failure, zero entries seen, or a confirmed
  alarm. See `specs/001-news-feed-ingestion/contracts/cli-contract.md` for the full exit-code
  contract — the exit code is a coarse signal only, the `runs` collection has the detail.

**Module system note**: `tsconfig.json` uses `NodeNext`/`NodeNext` — relative imports in
TypeScript source must use the `.js` extension (e.g. `import { x } from "./core/dedup.js"`)
even though the source file is `.ts`.

## Testing conventions

- One test file per behavior/scenario under `tests/unit/`, named after the scenario (e.g.
  `full-rotation-alarm.test.ts`, `category-silence.test.ts`, `zero-results.test.ts`), each
  paired with a matching XML fixture in `tests/fixtures/`.
- Tests exercise `src/core` functions directly against fixture data — no mocking of MongoDB or
  HTTP, because adapters aren't in scope for these tests at all.
