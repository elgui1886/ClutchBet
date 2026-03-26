# Project Structure

```
ClutchBet/
├── src/
│   ├── index.ts                       # CLI dispatcher
│   ├── list-channels.ts               # Utility: list Telegram channels
│   ├── setup-telegram.ts              # One-time Telegram auth
│   ├── shared/
│   │   ├── telegram-utils.ts          # resolvePeer(), createTelegramClient()
│   │   └── llm-utils.ts              # loadPrompt()
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
│   └── analysis/
│       ├── state.ts                   # AnalysisState
│       ├── graph.ts                   # history_scraper → channel_analyzer → report_writer
│       ├── index.ts                   # Entry point (loads analysis.yaml)
│       └── nodes/
│           ├── history-scraper.ts     # Paginated history scraper
│           ├── channel-analyzer.ts    # GPT-4o chunked analysis
│           └── report-writer.ts       # Save MD report
├── config/
│   ├── channels.yaml                  # Generation: topic, channels, publish target
│   └── analysis.yaml                  # Analysis: channel, months
├── prompts/
│   ├── telegram-filter.md             # Filter: Italian football + active event?
│   ├── image-analysis.md              # Extract bets from slip images
│   ├── bet-optimizer.md               # Generate optimized bet slip JSON
│   ├── post-generator.md              # Write caption for generated slip
│   ├── channel-analysis-chunk.md      # Analyze a batch of channel posts
│   └── channel-analysis-final.md      # Meta-analysis → final report
├── samples/                           # Reference samples (Release 1)
│   ├── sample1/ ... sample4/
├── temp/                              # Downloaded images (gitignored)
├── output/                            # Generated outputs (gitignored)
│   └── analysis/                      # Channel analysis reports
├── docs/
│   ├── architecture.md
│   ├── project-definition.md
│   └── project-structure.md
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

## CLI Dispatcher (`src/index.ts`)

Routes to the correct workflow based on `process.argv[2]`:

```bash
npm start -- generation    # or: npm run generation
npm start -- analysis      # or: npm run analysis
```

Dynamically imports `./generation/index.js` or `./analysis/index.js` and calls `main()`.

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

## Prompts (`prompts/`)

### Generation Prompts
- **`telegram-filter.md`** — evaluates if a post is about Italian football + active event → `{ relevant, reason }`
- **`image-analysis.md`** — GPT-4o vision extracts structured bet data from slip images
- **`bet-optimizer.md`** — generates optimized bet slip as JSON
- **`post-generator.md`** — writes caption with all bet details

### Analysis Prompts
- **`channel-analysis-chunk.md`** — analyzes a batch of posts for themes, tone, format, patterns, engagement, frequency
- **`channel-analysis-final.md`** — synthesizes chunk summaries into a comprehensive Markdown report with sections: Overview, Tone of Voice, Piano Editoriale, Pattern Ricorrenti, Frequenza di Pubblicazione, Stile dei Contenuti, Punti di Forza/Debolezze, Raccomandazioni

## Samples (`samples/`)

Hardcoded sample posts from Release 1, kept for reference. Each subfolder contains images + text of a Telegram betting post.

## Output (`output/`)

Auto-created directory for generated outputs:

- `output/post-<timestamp>.png` — rendered betting slip (generation workflow)
- `output/post-<timestamp>.md` — generated caption (generation workflow)
- `output/analysis/<channel-name>.md` — channel analysis report (analysis workflow)

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
```
