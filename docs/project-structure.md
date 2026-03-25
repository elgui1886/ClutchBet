# Project Structure

```
agentic-workflow/
├── src/
│   ├── nodes/
│   │   ├── scraper.ts          # Telegram scraper + LLM filter node
│   │   ├── llm-generator.ts    # Bet analysis + optimization + image render + caption node
│   │   └── publisher.ts        # Publish generated post to Telegram channel
│   ├── templates/
│   │   └── bet-slip.html       # HTML/CSS template for betting slip image rendering
│   ├── graph.ts                # LangGraph workflow definition
│   ├── image-renderer.ts       # Puppeteer-based betting slip image renderer
│   ├── state.ts                # Shared state type flowing between nodes
│   ├── list-channels.ts        # Utility: list all Telegram channels/groups with IDs
│   ├── setup-telegram.ts       # One-time auth script (run manually)
│   └── index.ts                # Entry point (CLI + manual trigger)
├── config/
│   └── channels.yaml           # Telegram channels + topic + publish channel
├── prompts/
│   ├── telegram-filter.md      # LLM filter: Italian football + active event? (with {today_date})
│   ├── image-analysis.md       # LLM: extract bets from betting slip images via GPT-4o vision
│   ├── bet-optimizer.md        # LLM: generate optimized bet slip JSON (totalOdd = product, cap ≤ 35)
│   └── post-generator.md       # LLM: write caption with ALL bet details (text must be self-sufficient)
├── samples/                    # Reference samples (Release 1, kept for reference)
│   ├── sample1/
│   ├── sample2/
│   ├── sample3/
│   └── sample4/
├── temp/                       # Telegram downloaded images — auto-created, gitignored
├── output/                     # Generated posts — auto-created, gitignored
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

## Source Code (`src/`)

### `state.ts`

Defines the shared **LangGraph state** and TypeScript interfaces:

- `SamplePost` — a single input post: `images: string[]` (file paths) + `text: string`
- `GeneratedPost` — output: `imageBase64: string` (PNG) + `text: string` (caption)
- `WorkflowState` — the LangGraph annotation root with `telegramChannels`, `publishChannel`, `inputPosts`, `topic`, `generatedPost`, `publishResult`

### `graph.ts`

Builds and compiles the **LangGraph workflow**:

```
[START] → [scraper] → (inputPosts empty?) → [END]
                ↓
          (posts found)
                ↓
        [llm_generator] → [publisher] → [END]
```

The conditional edge after `scraper` checks `state.inputPosts.length`. If zero relevant posts were found on Telegram, the workflow exits cleanly. Otherwise, proceeds to LLM generation and then publishing.

### `image-renderer.ts`

Generates betting slip images using **Puppeteer** (headless Chrome). Takes a `BetSlip` JSON (title, bets, totalOdd) and renders the HTML/CSS template (`src/templates/bet-slip.html`) to a PNG screenshot. The template features a dark gradient background with purple/green accent glow effects, an SVG cinghiale (boar) logo, glassmorphism bet cards, and neon-style quota badges.

Exports:
- `BetSlip` interface: `{ title, bets: [{ homeTeam, awayTeam, betType, odd }], totalOdd }`
- `renderBetSlipImage(slip: BetSlip): Promise<Buffer>` — async, returns PNG buffer

### `setup-telegram.ts`

One-time CLI script to authenticate with Telegram and obtain a persistent session string. Run once:
```bash
npx tsx src/setup-telegram.ts
```
Enter phone number + OTP (and 2FA password if enabled). The printed session string goes into `.env` as `TELEGRAM_SESSION`.

### `list-channels.ts`

Utility script to list all Telegram channels/groups you're a member of, with their names, numeric IDs, and @usernames. Useful for finding channel identifiers to add to `channels.yaml`:
```bash
npx tsx src/list-channels.ts
```

### `index.ts`

CLI entry point. Responsible for:

1. Loading `topic`, `telegramChannels`, and `publishChannel` from `config/channels.yaml`
2. Invoking the LangGraph workflow (scraper → conditional → llm_generator → publisher)
3. Saving generated output (PNG image + MD text) to `output/`

### `nodes/scraper.ts`

The Telegram scraper node. Two-phase architecture to avoid GramJS TIMEOUT errors:

**Phase 1 — Download (Telegram connected):**
1. Connects to Telegram via GramJS (using `TELEGRAM_SESSION` from `.env`)
2. For each channel, fetches the **last 10 messages** that contain a photo
3. Downloads relevant images to `temp/<timestamp>/`
4. Disconnects from Telegram

**Phase 2 — Filter (Telegram disconnected):**
5. For each candidate, calls GPT with `prompts/telegram-filter.md` (with `{today_date}` injected) to check if the post is about **Italian football** and the event is **still active**
6. Returns `{ inputPosts: SamplePost[] }` — empty array if nothing matched

Supports channel identifiers in 4 formats: Telegram Web URL, t.me link, @username, numeric ID. Uses `Api.PeerChannel` with `big-integer` for numeric IDs.

### `nodes/llm-generator.ts`

The LLM generation node. Performs 4 internal steps:

1. **Image analysis** — GPT-4o vision reads betting slip images and extracts matches, bet types, odds
2. **Bet optimization** — GPT generates an optimized bet slip as structured JSON. `totalOdd` is recalculated in code as the exact product of individual odds. If it exceeds 35, the highest-odd bet is iteratively removed until under the cap
3. **Image rendering** — Puppeteer renders the HTML/CSS template into a professional PNG image
4. **Text generation** — GPT writes a caption that includes ALL bet details (teams, bet types, individual odds, total) so the text is self-sufficient without the image

### `nodes/publisher.ts`

The Telegram publisher node:

1. Connects to Telegram via GramJS (same session as scraper)
2. Resolves the `publishChannel` identifier (supports same 4 formats as scraper)
3. Sends the generated PNG image with caption to the target channel
4. If caption exceeds Telegram's 1024-char limit, sends truncated caption on the image + full text as a follow-up message
5. Returns `{ publishResult: string }` with success/skip/error status

## Configuration (`config/`)

### `channels.yaml`

Defines the workflow parameters:

- `topic` — the subject for post generation (used by the LLM generator)
- `telegramChannels` — list of Telegram channel usernames or numeric IDs to scrape (e.g. `@channelname` or `1234567890`)

## Prompts (`prompts/`)

### `image-analysis.md`

Instructs GPT-4o vision to analyze betting slip images and extract structured data: matches, bet types, odds, slip codes.

### `bet-optimizer.md`

Instructs GPT-4o to combine and optimize bets from all analyzed slips into a single new optimized slip, returned as JSON (`BetSlip` format).

### `post-generator.md`

Instructs GPT-4o to write a caption for the generated bet slip, coherent with the actual bets, styled after the sample texts.

### `telegram-filter.md`

Instructs GPT-4o to evaluate a Telegram post text and return a JSON `{ relevant: boolean, reason: string }` indicating whether the post is about Italian football (Serie A, Serie B, Coppa Italia, Nazionale) and whether the referenced event is still active (not concluded).

## Samples (`samples/`)

Hardcoded sample posts used in Release 1, kept for reference. Each subfolder represents one Telegram post and contains:

- One or more **images** (`.jpeg`, `.png`) — screenshots of betting slips
- One **text file** (`.txt`) — the promotional text accompanying the image

## Temp (`temp/`)

Auto-created directory where the scraper node saves images downloaded from Telegram during a workflow run. Organized in timestamped subfolders (`temp/<ISO-timestamp>/`). Listed in `.gitignore`.

## Output (`output/`)

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

# 4. Configure Telegram channels in config/channels.yaml
# Add your channel usernames under telegramChannels:

# 5. Run the workflow
npm start
```
