# Project Structure

```
agentic-workflow/
├── src/
│   ├── shared/                         # Shared modules used by both workflows
│   │   ├── telegram-client.ts          # createTelegramClient()
│   │   ├── llm.ts                      # createModel()
│   │   └── config.ts                   # loadYamlConfig<T>()
│   ├── post-generator/                 # Workflow 1: Post generation
│   │   ├── index.ts                    # Entry point (npm run start)
│   │   ├── graph.ts                    # LangGraph workflow definition
│   │   ├── state.ts                    # WorkflowState, SamplePost, GeneratedPost
│   │   ├── image-renderer.ts           # Canvas-based betting slip image renderer
│   │   └── nodes/
│   │       ├── scraper.ts              # Telegram scraper + LLM filter node
│   │       └── llm-generator.ts        # Bet analysis + optimization + caption node
│   ├── channel-analyzer/               # Workflow 2: Channel analysis (one-off)
│   │   ├── index.ts                    # Entry point (npm run analyze)
│   │   ├── graph.ts                    # LangGraph workflow definition
│   │   ├── state.ts                    # AnalysisState, ChannelPost
│   │   └── nodes/
│   │       ├── channel-reader.ts       # Fetch all posts within time range
│   │       ├── chunk-splitter.ts       # Split posts into analysis chunks
│   │       ├── chunk-analyzer.ts       # LLM partial analysis per chunk
│   │       └── analysis-synthesizer.ts # LLM synthesis into final document
│   └── setup-telegram.ts              # One-time auth script (run manually)
├── config/
│   ├── channels.yaml                   # Post-generator config
│   └── analysis.yaml                   # Channel-analyzer config
├── prompts/
│   ├── telegram-filter.md
│   ├── image-analysis.md
│   ├── bet-optimizer.md
│   ├── post-generator.md
│   ├── chunk-analysis.md
│   └── analysis-synthesis.md
├── samples/                            # Reference samples (Release 1, kept for reference)
│   ├── sample1/
│   ├── sample2/
│   ├── sample3/
│   └── sample4/
├── analysis/                           # Channel analysis output (.md per channel, gitignored)
├── temp/                               # Telegram downloaded images (gitignored)
├── output/                             # Generated posts (gitignored)
├── docs/
│   ├── project-definition.md
│   ├── architecture.md
│   └── project-structure.md
├── .env
├── .env.example
├── .gitignore
├── tsconfig.json
└── package.json
```

## Shared Modules (`src/shared/`)

### `telegram-client.ts`

Factory function `createTelegramClient()` that reads env vars (`TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_SESSION`), creates a GramJS `TelegramClient` with `StringSession`, connects, and returns the client. Used by both the post-generator scraper and the channel-analyzer reader.

### `llm.ts`

Factory function `createModel(options?)` that creates a `ChatOpenAI` instance reading `OPENAI_MODEL` and `OPENAI_BASE_URL` from env. Accepts optional `temperature` parameter (default 0). Used by all nodes that need LLM access.

### `config.ts`

Generic YAML config loader `loadYamlConfig<T>(filename)` that reads and parses a YAML file from the `config/` directory. Used by both workflow entry points.

## Post Generator (`src/post-generator/`)

### `state.ts`

Defines the shared **LangGraph state** and TypeScript interfaces:

- `SamplePost` — a single input post: `images: string[]` (file paths) + `text: string`
- `GeneratedPost` — output: `imageBase64: string` (PNG) + `text: string` (caption)
- `WorkflowState` — the LangGraph annotation root with `telegramChannels`, `inputPosts`, `topic`, `generatedPost`, `publishResult`

### `graph.ts`

Builds and compiles the **LangGraph workflow**:

```
[START] → [scraper] → (inputPosts empty?) → [END with log]
                ↓
          (posts found)
                ↓
        [llm_generator] → [END]
```

The conditional edge after `scraper` checks `state.inputPosts.length`. If zero relevant posts were found on Telegram, the workflow exits cleanly without invoking the LLM generator.

### `image-renderer.ts`

Generates betting slip images programmatically using **node-canvas**. Takes a `BetSlip` JSON (title, bets, totalOdd) and renders a professional-looking PNG with dark theme, gold accents, green odd badges, and clean layout.

### `index.ts`

CLI entry point. Responsible for:

1. Loading `topic` and `telegramChannels` from `config/channels.yaml` via shared `loadYamlConfig()`
2. Invoking the LangGraph workflow (scraper → conditional → llm_generator)
3. Saving generated output (PNG image + MD text) to `output/`, or logging and exiting if no posts were found

### `nodes/scraper.ts`

The Telegram scraper node. For each channel in `telegramChannels`:
1. Connects to Telegram via shared `createTelegramClient()`
2. Fetches the **last 5 messages** that contain a photo
3. For each post, calls GPT-4o (via shared `createModel()`) with `prompts/telegram-filter.md` to check if it is about **Italian football** and the event is **still active**
4. Downloads relevant images to `temp/<timestamp>/`
5. Returns `{ inputPosts: SamplePost[] }` — empty array if nothing matched

### `nodes/llm-generator.ts`

The LLM generation node. Performs 4 internal steps:

1. **Image analysis** — GPT-4o vision reads betting slip images and extracts matches, bet types, odds
2. **Bet optimization** — GPT-4o generates an optimized bet slip as structured JSON
3. **Image rendering** — Canvas renders the JSON into a professional PNG image
4. **Text generation** — GPT-4o writes a caption coherent with the generated bet slip, styled after the sample texts

## Channel Analyzer (`src/channel-analyzer/`)

### `state.ts`

Defines the **LangGraph state** for channel analysis:

- `ChannelPost` — a single post: `id`, `date` (unix), `text`, `imagePaths: string[]`, `mediaType: 'photo' | 'video' | 'text' | 'other'`
- `AnalysisState` — the LangGraph annotation root with `channelId`, `timeRangeMonths`, `posts`, `chunks`, `chunkAnalyses`, `currentChunkIndex`, `finalAnalysis`

### `graph.ts`

Builds and compiles the **LangGraph analysis workflow**:

```
[START] → [channel_reader] → [chunk_splitter] → [chunk_analyzer]
                                                       ↓
                                            (more chunks? loop back)
                                                 ↙           ↘
                                       [chunk_analyzer]    [synthesizer] → [END]
```

Uses a conditional edge loop: after each `chunk_analyzer` execution, if `currentChunkIndex < chunks.length`, it loops back to process the next chunk; otherwise it proceeds to `synthesizer`.

### `index.ts`

CLI entry point. Responsible for:

1. Loading `timeRangeMonths` and `telegramChannels` from `config/analysis.yaml` via shared `loadYamlConfig()`
2. For each channel: invoking the analysis graph and saving the final document to `analysis/<channel-name>.md`
3. Logging progress per channel

### `nodes/channel-reader.ts`

Reads **all messages** from a Telegram channel within the configured time range. Uses GramJS pagination (100 messages per API call, advancing via `offsetId`) and stops when `msg.date` falls before the cutoff date. For each message:
- Extracts text content
- Identifies media type (photo, video, text, other)
- Downloads images to `temp/analysis-<channel>/`

Returns `{ posts: ChannelPost[] }` sorted chronologically (oldest first).

### `nodes/chunk-splitter.ts`

Splits `posts` into chunks of ~20 posts each, preserving chronological order. Returns `{ chunks, currentChunkIndex: 0, chunkAnalyses: [] }`.

### `nodes/chunk-analyzer.ts`

Analyzes a single chunk via GPT-4o. Sends post texts + up to 10 images (base64 data URLs) per chunk, sampled representatively if the chunk has more images. Uses `prompts/chunk-analysis.md` to extract:
- Tone of voice, temi e tipi di contenuto, pattern strutturali, stile visivo, pattern temporali, hook e engagement

Increments `currentChunkIndex` and appends the partial analysis to `chunkAnalyses`.

### `nodes/analysis-synthesizer.ts`

Receives all `chunkAnalyses` and synthesizes them into a final structured markdown document via GPT-4o using `prompts/analysis-synthesis.md`. Returns `{ finalAnalysis: string }`.

## Setup (`src/setup-telegram.ts`)

One-time CLI script to authenticate with Telegram and obtain a persistent session string. Run once:
```bash
npx tsx src/setup-telegram.ts
```
Enter phone number + OTP (and 2FA password if enabled). The printed session string goes into `.env` as `TELEGRAM_SESSION`.

## Configuration (`config/`)

### `channels.yaml`

Defines the post-generator workflow parameters:

- `topic` — the subject for post generation (used by the LLM generator)
- `telegramChannels` — list of Telegram channel usernames or numeric IDs to scrape

### `analysis.yaml`

Defines the channel-analyzer workflow parameters:

- `timeRangeMonths` — how many months of posts to analyze (default: 3)
- `telegramChannels` — list of Telegram channel usernames or numeric IDs to analyze

## Prompts (`prompts/`)

### Post Generator Prompts

- **`telegram-filter.md`** — Instructs GPT-4o to evaluate a Telegram post text and return `{ relevant: boolean, reason: string }` (Italian football + active event)
- **`image-analysis.md`** — Instructs GPT-4o vision to analyze betting slip images and extract structured data
- **`bet-optimizer.md`** — Instructs GPT-4o to combine and optimize bets into a single new slip (JSON output)
- **`post-generator.md`** — Instructs GPT-4o to write a caption styled after sample texts

### Channel Analyzer Prompts

- **`chunk-analysis.md`** — Instructs GPT-4o to analyze a batch of Telegram posts extracting tone of voice, temi, pattern, stile visivo, pattern temporali, engagement hooks. Supports `{posts}`, `{chunk_number}`, `{total_chunks}` placeholders.
- **`analysis-synthesis.md`** — Instructs GPT-4o to synthesize partial analyses into a complete channel profile document. Supports `{partial_analyses}`, `{channel_id}`, `{post_count}`, `{date_range}` placeholders.

## Samples (`samples/`)

Hardcoded sample posts used in Release 1, kept for reference. Each subfolder represents one Telegram post and contains:

- One or more **images** (`.jpeg`, `.png`) — screenshots of betting slips
- One **text file** (`.txt`) — the promotional text accompanying the image

## Output Directories

### `analysis/`

Channel analysis output. One markdown file per analyzed channel (e.g. `analysis/your_channel_here.md`). Listed in `.gitignore`.

### `temp/`

Auto-created directory where Telegram images are downloaded at runtime. Organized in timestamped subfolders for post-generator (`temp/<ISO-timestamp>/`) and channel-specific subfolders for analyzer (`temp/analysis-<channel>/`). Listed in `.gitignore`.

### `output/`

Auto-created directory where generated posts are saved as timestamped files:

- `post-<timestamp>.png` — the rendered betting slip image
- `post-<timestamp>.md` — the generated caption text

Listed in `.gitignore`.

## Environment (`.env`)

Stores sensitive configuration. Use `.env.example` as template:

| Variable | Required | Description |
|---|---|---|
| `OPENAI_API_KEY` | Yes | GitHub PAT (or OpenAI key) |
| `OPENAI_BASE_URL` | Yes | API endpoint (GitHub Models: `https://models.inference.ai.azure.com`) |
| `OPENAI_MODEL` | No | Model to use (defaults to `gpt-4o`) |
| `TELEGRAM_API_ID` | Yes | Numeric app ID from [my.telegram.org](https://my.telegram.org) |
| `TELEGRAM_API_HASH` | Yes | App hash from [my.telegram.org](https://my.telegram.org) |
| `TELEGRAM_SESSION` | Yes | Session string generated by `npx tsx src/setup-telegram.ts` |

## Running the Project

```bash
# 1. Copy and configure environment
cp .env.example .env
# Edit .env with your OpenAI API key, TELEGRAM_API_ID, TELEGRAM_API_HASH

# 2. Install dependencies
npm install

# 3. Authenticate with Telegram (one-time only)
npx tsx src/setup-telegram.ts
# Follow the prompts, then copy TELEGRAM_SESSION into .env

# 4. Configure Telegram channels
# Post generator: config/channels.yaml
# Channel analyzer: config/analysis.yaml

# 5. Run the post generator workflow
npm start

# 6. Run the channel analyzer workflow
npm run analyze
```
