# Project Structure

```
ClutchBet/
├── src/
│   ├── index.ts                       # CLI dispatcher
│   ├── list-channels.ts               # Utility: list Telegram channels
│   ├── setup-telegram.ts              # One-time Telegram auth
│   ├── parse-profile.ts               # One-off: MD profile → YAML config
│   ├── check-results.ts               # Check bet results + generate recap
│   ├── shared/
│   │   ├── telegram-utils.ts          # resolvePeer(), createTelegramClient()
│   │   ├── llm-utils.ts              # loadPrompt()
│   │   └── bet-tracker.ts            # Bet tracking store (SQLite — data/clutchbet.db)
│   ├── generation/
│   │   ├── state.ts                   # WorkflowState
│   │   ├── graph.ts                   # scraper → llm_generator → publisher
│   │   ├── index.ts                   # Entry point (loads channels.yaml)
│   │   ├── image-renderer.ts          # Puppeteer bet-slip renderer
│   │   ├── templates/
│   │   │   └── bet-slip.html          # HTML/CSS bet-slip template
│   │   └── nodes/
│   │       ├── scraper.ts             # Telegram scraper + LLM filter
│   │       ├── llm-generator.ts       # Image analysis + optimization + caption
│   │       └── publisher.ts           # Publish to Telegram
│   ├── analysis/
│   │   ├── state.ts                   # AnalysisState
│   │   ├── graph.ts                   # history_scraper → channel_analyzer → report_writer
│   │   ├── index.ts                   # Entry point (loads analysis.yaml)
│   │   └── nodes/
│   │       ├── history-scraper.ts     # Paginated history scraper
│   │       ├── channel-analyzer.ts    # GPT-4o chunked analysis
│   │       └── report-writer.ts       # Save MD report
│   └── content-generator/
│       ├── state.ts                   # ContentState (profile, fixtures, odds, bets)
│       ├── graph.ts                   # scheduler → data_fetcher → content_writer → reviewer → publisher
│       ├── index.ts                   # Entry point (loads content.yaml + profile)
│       └── nodes/
│           ├── scheduler.ts           # Decide which formats to generate
│           ├── data-fetcher.ts        # Fetch fixtures + odds from API-Football
│           ├── content-writer.ts      # LLM generates posts + extracts bet selections
│           ├── reviewer.ts            # Human-in-the-loop approval (s/n/edit)
│           └── publisher.ts           # Publish + save bets to tracker
├── config/
│   ├── channels.yaml                  # Generation: topic, channels, publish target
│   ├── analysis.yaml                  # Analysis: channel, months
│   ├── content.yaml                   # Content generator: profile, publish channel, league
│   └── profiles/                      # Parsed YAML profiles (from parse-profile)
│       └── il-capitano.yaml           # Example parsed profile
├── prompts/
│   ├── telegram-filter.md             # Filter: Italian football + active event?
│   ├── image-analysis.md              # Extract bets from slip images
│   ├── bet-optimizer.md               # Generate optimized bet slip JSON
│   ├── post-generator.md              # Write caption for generated slip
│   ├── channel-analysis-chunk.md      # Analyze a batch of channel posts
│   ├── channel-analysis-final.md      # Meta-analysis → final report
│   ├── profile-parser.md             # Convert MD profile → structured YAML
│   ├── content-post.md               # Generate editorial post from profile + data
│   └── bet-recap.md                   # Generate recap post after bet results
├── data/                              # Runtime data (gitignored)
│   └── clutchbet.db                   # SQLite database (bet tracking, analytics)
├── samples/                           # Reference samples (Release 1)
│   ├── sample1/ ... sample4/
├── temp/                              # Downloaded images (gitignored)
├── output/                            # Generated outputs (gitignored)
│   ├── analysis/                      # Channel analysis reports
│   ├── content/                       # Generated content posts
│   ├── recaps/                        # Generated recap posts
│   └── profiles/                      # Editorial profiles (MD)
├── docs/
│   ├── architecture.md
│   ├── project-definition.md
│   ├── project-structure.md
│   └── content-generator.md           # Content generator workflow guide
├── .env
├── .env.example
├── .gitignore
├── tsconfig.json
└── package.json
```

## Shared Code (`src/shared/`)

### `telegram-utils.ts`

Shared Telegram infrastructure used by both workflows:

- `resolvePeer(channel)` — resolves a channel identifier (Web URL, t.me link, @username, numeric ID) into a GramJS peer
- `createTelegramClient()` — creates and connects a GramJS `TelegramClient` using env vars (`TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_SESSION`). Suppresses the GramJS update loop to avoid TIMEOUT errors

### `llm-utils.ts`

- `loadPrompt(filePath)` — reads a prompt template from disk

### `bet-tracker.ts`

Bet tracking store backed by SQLite (`data/clutchbet.db`). Uses `better-sqlite3` for synchronous, high-performance queries. Automatically migrates data from legacy `data/bets.json` on first run.

Used by the content-generator publisher (to save bets) and check-results (to resolve bets and generate recaps).

- `addBets()` — insert new bets (skips duplicates by ID)
- `getPendingBets()` — bets without a result
- `updateBetResult()` — set won/lost/void + match score
- `markRecapPublished()` — flag bets as recapped
- `getWeeklyStats()` — win/loss/ROI for last 7 days
- `getStatsForPeriod(start, end)` — analytics for any date range (with breakdowns by format and selection type)
- `addBets(bets)` — add new tracked bets (skips duplicates by ID)
- `getPendingBets()` — get all unresolved bets
- `getUnrecappedBets()` — get resolved bets without a published recap
- `updateBetResult(betId, result, score)` — mark a bet as won/lost/void
- `markRecapPublished(betIds)` — flag bets as having their recap published
- `getWeeklyStats(date)` — calculate win/loss/ROI for a 7-day window

## CLI Dispatcher (`src/index.ts`)

Routes to the correct workflow based on `process.argv[2]`:

```bash
npm start -- generation      # or: npm run generation
npm start -- analysis        # or: npm run analysis
npm start -- content         # or: npm run content
npm start -- check-results   # or: npm run check-results
npm start -- parse-profile   # or: npm run parse-profile
```

Dynamically imports the appropriate module and calls `main()`.

## Generation Workflow (`src/generation/`)

### `state.ts`

Defines the LangGraph state and interfaces:

- `SamplePost` — input post: `images: string[]` (file paths) + `text: string`
- `GeneratedPost` — output: `imageBase64: string` (PNG) + `text: string` (caption)
- `WorkflowState` — LangGraph `Annotation.Root` with `telegramChannels`, `publishChannel`, `inputPosts`, `topic`, `generatedPost`, `publishResult`

### `graph.ts`

Builds the LangGraph workflow:

```
[START] → [scraper] → (inputPosts empty? → END) → [llm_generator] → [publisher] → [END]
```

### `index.ts`

Entry point. Loads `config/channels.yaml`, invokes the graph, saves generated output (PNG + MD) to `output/`.

### `image-renderer.ts`

Puppeteer-based bet-slip image generator. Takes a `BetSlip` JSON and renders `templates/bet-slip.html` to PNG.

Exports:
- `BetSlip` interface: `{ title, bets: [{ homeTeam, awayTeam, betType, odd }], totalOdd }`
- `renderBetSlipImage(slip): Promise<Buffer>`

### `nodes/scraper.ts`

Two-phase Telegram scraper:

**Phase 1 — Download** (Telegram connected): fetches last 10 messages with photos per channel, downloads images to `temp/`
**Phase 2 — Filter** (Telegram disconnected): GPT-4o evaluates each post via `telegram-filter.md` for Italian football relevance + active event

Uses `resolvePeer()` and `createTelegramClient()` from `src/shared/telegram-utils.ts`.

### `nodes/llm-generator.ts`

Four internal steps:
1. **Image analysis** — GPT-4o vision extracts matches, bet types, odds from slip images
2. **Bet optimization** — generates optimized bet slip JSON; `totalOdd` recalculated in code (cap ≤ 35)
3. **Image rendering** — Puppeteer renders HTML template to PNG
4. **Text generation** — GPT writes caption with all bet details

### `nodes/publisher.ts`

Publishes generated post to Telegram:
- Sends PNG + caption via GramJS
- Handles 1024-char caption limit (truncate + follow-up message)
- Uses shared Telegram utilities

## Analysis Workflow (`src/analysis/`)

### `state.ts`

LangGraph state for analysis:

- `RawPost` — `{ text: string, date: string, hasImage: boolean }`
- `AnalysisState` — `Annotation.Root` with `channel`, `timeRangeMonths`, `rawPosts`, `chunks`, `chunkSummaries`, `analysisDocument`

### `graph.ts`

```
[START] → [history_scraper] → (rawPosts empty? → END) → [channel_analyzer] → [report_writer] → [END]
```

### `index.ts`

Entry point. Loads `config/analysis.yaml` (single channel + months), invokes the analysis graph.

### `nodes/history-scraper.ts`

Paginated Telegram history scraper:
- Fetches messages in batches of 100 using `offsetId` pagination
- Stops when reaching the cutoff date (today − N months)
- Collects only text + date + hasImage flag (no image downloads)
- 1.5s pause between batches for rate limiting
- Sorts posts chronologically (oldest first)

### `nodes/channel-analyzer.ts`

Two-level GPT-4o analysis:
1. **Chunking**: splits posts into batches of ~50
2. **Batch analysis**: each chunk analyzed via `prompts/channel-analysis-chunk.md` → partial summaries (themes, tone, patterns, format, engagement, frequency)
3. **Meta-analysis**: all summaries synthesized via `prompts/channel-analysis-final.md` → final structured Markdown document

### `nodes/report-writer.ts`

Saves the analysis document to `output/analysis/<channel-name>.md`. Sanitizes channel identifiers to filesystem-safe names.

## Content Generator Workflow (`src/content-generator/`)

### `state.ts`

LangGraph state for content generation:

- `FixtureOdds` — `{ home, draw, away, over25?, under25?, btts_yes?, btts_no?, bookmaker? }`
- `Fixture` — `{ homeTeam, awayTeam, league, date, time, venue?, referee?, odds? }`
- `BetSelection` — `{ homeTeam, awayTeam, league, kickoff, selection, odds }` — extracted from generated content for tracking
- `FormatConfig` — includes `publish_time?` (HH:MM) for timed publishing
- `ContentItem` — `{ formatSlug, formatName, text, publishTime?, bets?, approved, published }`
- `ContentState` — `Annotation.Root` with `profilePath`, `profile` (parsed YAML), `publishChannel`, `leagueId`, `leagueSeason`, `date`, `fixtures`, `scheduledFormats`, `contentItems`, `publishResult`

### `graph.ts`

```
[START] → [scheduler] → (nothing to generate? → END) → [data_fetcher] → [content_writer] → [reviewer] → (none approved? → END) → [publisher] → [END]
```

### `index.ts`

Entry point. Loads `config/content.yaml`, reads the referenced profile YAML, invokes the content graph. Supports CLI override: `npm run content -- --profile=config/profiles/other.yaml`.

### `nodes/scheduler.ts`

Determines which editorial formats to generate today:
- Reads the profile's scheduling rules
- Checks day of week for special triggers (Sunday evening → Fischio Finale, Fri/Sat → La Lavagna)
- Schedules match-day formats + no-match-day formats (data-fetcher refines later)

### `nodes/data-fetcher.ts`

Fetches today's fixtures and real odds from API-Football:
- **Fixtures**: `GET /fixtures?date={today}&league={id}&season={year}`
- **Odds**: `GET /odds?fixture={id}` per fixture — extracts 1X2, Over/Under 2.5, Goal/NoGoal
- Prefers well-known bookmakers (Bet365, Unibet, Bwin)
- If `FOOTBALL_API_KEY` not set, falls back to mock fixtures with mock odds for development
- If no fixtures found, removes data-dependent formats from schedule

### `nodes/content-writer.ts`

LLM-powered content generation:
- For each scheduled format, builds a prompt from: profile tone rules + format template + real sports data (including odds)
- Uses `prompts/content-post.md` as the base prompt template
- Generates one post per format, respecting the profile's tone of voice and template structure
- **Bet extraction**: for formats containing bets, makes a second LLM call to extract structured bet selections (`BetSelection[]`) for tracking

### `nodes/reviewer.ts`

Human-in-the-loop approval:
- Displays each generated post in the console
- Prompts user: approve (`s`) / reject (`n`) / edit (`e`)
- Edit mode allows pasting a corrected version
- Updates `ContentItem.approved` accordingly

### `nodes/publisher.ts`

Publishes approved posts to Telegram with timed delivery:
- Sorts posts by `publishTime` (chronological)
- **Waits until the scheduled time** before sending each post (logs countdown)
- If scheduled time has passed, publishes immediately
- Uses shared GramJS utilities
- **Saves bets to tracker**: after successful publish, extracted bet selections are stored in `data/clutchbet.db` (SQLite) via `bet-tracker.ts`

## Check Results (`src/check-results.ts`)

Standalone command to verify bet outcomes and generate recap posts:

1. Reads pending bets from `data/clutchbet.db`
2. Fetches match results from API-Football (`/fixtures?status=FT`)
3. Evaluates each bet: supports 1X2, Double Chance (1X, X2, 12), Over/Under (any threshold), Goal/NoGoal, Multigol
4. Generates a recap post via LLM using `prompts/bet-recap.md` — follows the profile's tone of voice and loss management principles
5. Shows the recap for human approval
6. Publishes to Telegram and marks bets as recapped
7. Saves recap locally to `output/recaps/`

## Profile Parser (`src/parse-profile.ts`)

One-off command to convert a discursive Markdown profile into structured YAML:
- Usage: `npm run parse-profile -- <path-to-md>`
- Reads the MD file and sends it to the LLM with `prompts/profile-parser.md`
- Parses the YAML response and saves to `config/profiles/<name>.yaml`
- The YAML is deterministic and machine-readable, used by the content generator

## Configuration (`config/`)

### `channels.yaml` (Generation)

```yaml
topic: "Betting Serie A - prossima giornata di campionato"
telegramChannels:
  - "https://web.telegram.org/k/#-1259302052"
  - "@channelname"
publishChannel: "https://t.me/maremmabet"
```

### `analysis.yaml` (Analysis)

```yaml
channel: "@channelname"
months: 3
```

### `content.yaml` (Content Generator)

```yaml
profile: "config/profiles/il-capitano.yaml"
publishChannel: "https://t.me/maremmabet"
league:
  id: 135          # Serie A (API-Football league ID)
  season: 2025
  country: "Italy"
```

### `profiles/` (Parsed YAML Profiles)

Generated by `npm run parse-profile`. Each YAML file contains a structured representation of an editorial profile: identity, tone of voice, formats with templates, scheduling rules, loss management. These files are consumed by the content generator workflow.

## Prompts (`prompts/`)

### Generation Prompts
- **`telegram-filter.md`** — evaluates if a post is about Italian football + active event → `{ relevant, reason }`
- **`image-analysis.md`** — GPT-4o vision extracts structured bet data from slip images
- **`bet-optimizer.md`** — generates optimized bet slip as JSON
- **`post-generator.md`** — writes caption with all bet details

### Analysis Prompts
- **`channel-analysis-chunk.md`** — analyzes a batch of posts for themes, tone, format, patterns, engagement, frequency
- **`channel-analysis-final.md`** — synthesizes chunk summaries into a comprehensive Markdown report with sections: Overview, Tone of Voice, Piano Editoriale, Pattern Ricorrenti, Frequenza di Pubblicazione, Stile dei Contenuti, Punti di Forza/Debolezze, Raccomandazioni

### Content Generator Prompts
- **`profile-parser.md`** — LLM prompt to convert a discursive Markdown profile into a structured YAML configuration. Extracts: tone of voice rules, editorial formats with templates and `publish_time`, scheduling rules, loss management policies
- **`content-post.md`** — generic LLM prompt to generate one editorial post. Takes: profile tone rules, format template, sports data with real odds (if applicable). Works for all format types
- **`bet-recap.md`** — LLM prompt to generate a recap post after bet results are verified. Follows the profile's tone of voice and loss management principles (onestà, no scuse, analisi lucida)

## Samples (`samples/`)

Hardcoded sample posts from Release 1, kept for reference. Each subfolder contains images + text of a Telegram betting post.

## Output (`output/`)

Auto-created directory for generated outputs:

- `output/post-<timestamp>.png` — rendered betting slip (generation workflow)
- `output/post-<timestamp>.md` — generated caption (generation workflow)
- `output/analysis/<channel-name>.md` — channel analysis report (analysis workflow)
- `output/content/<format-slug>_<date>.md` — generated content post (content generator)
- `output/recaps/recap_<date>.md` — bet recap post (check-results)
- `output/profiles/<name>.md` — editorial profile definitions

Listed in `.gitignore`.

## Data (`data/`)

Runtime data directory for bet tracking:

- `data/clutchbet.db` — SQLite database with `bets` table (indexed by date, result, recap status). Supports instant queries for daily, weekly, monthly, and annual analytics

The database is created automatically on first run. If a legacy `data/bets.json` file exists, its contents are migrated automatically.

Listed in `.gitignore`.

## Temp (`temp/`)

Auto-created directory where the generation scraper saves images downloaded from Telegram. Organized in timestamped subfolders. Listed in `.gitignore`.

## Environment (`.env`)

| Variable | Required | Description |
|---|---|---|
| `OPENAI_API_KEY` | Yes | GitHub PAT (or OpenAI key) |
| `OPENAI_BASE_URL` | Yes | API endpoint (e.g. `https://models.inference.ai.azure.com`) |
| `OPENAI_MODEL` | No | Model name (defaults to `gpt-4o`) |
| `TELEGRAM_API_ID` | Yes | Numeric app ID from [my.telegram.org](https://my.telegram.org) |
| `TELEGRAM_API_HASH` | Yes | App hash from [my.telegram.org](https://my.telegram.org) |
| `TELEGRAM_SESSION` | Yes | Session string from `npx tsx src/setup-telegram.ts` |
| `FOOTBALL_API_KEY` | No | API-Football key (free tier: 100 req/day). Required for real fixture data in content generator |

## Running the Project

```bash
# 1. Copy and configure environment
cp .env.example .env
# Edit .env with your API keys

# 2. Install dependencies
npm install

# 3. Authenticate with Telegram (one-time only)
npx tsx src/setup-telegram.ts

# 4. Run the generation workflow
npm run generation
# or: npm start -- generation

# 5. Run the analysis workflow (edit config/analysis.yaml first)
npm run analysis
# or: npm start -- analysis

# 6. Utility: list your Telegram channels
npx tsx src/list-channels.ts

# 7. Parse a profile from MD to YAML (one-time per profile)
npm run parse-profile -- output/profiles/il-capitano.md

# 8. Run the content generator workflow
npm run content
# or: npm start -- content
# or with profile override: npm run content -- --profile=config/profiles/other.yaml

# 9. Check bet results and generate recap
npm run check-results
```
