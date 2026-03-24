# Project Structure

```
agentic-workflow/
├── src/
│   ├── nodes/
│   │   ├── scraper.ts          # Telegram scraper + LLM filter node
│   │   └── llm-generator.ts    # Bet analysis + optimization + caption node
│   ├── graph.ts
│   ├── image-renderer.ts
│   ├── state.ts
│   ├── setup-telegram.ts       # One-time auth script (run manually)
│   └── index.ts
├── config/
│   └── channels.yaml
├── prompts/
│   ├── telegram-filter.md      # LLM filter: Italian football + active event?
│   ├── image-analysis.md
│   ├── bet-optimizer.md
│   └── post-generator.md
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
- `WorkflowState` — the LangGraph annotation root with `telegramChannels`, `inputPosts`, `topic`, `generatedPost`, `publishResult`

### `graph.ts`

Builds and compiles the **LangGraph workflow**. Current flow (Release 2):

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

### `setup-telegram.ts`

One-time CLI script to authenticate with Telegram and obtain a persistent session string. Run once:
```bash
npx tsx src/setup-telegram.ts
```
Enter phone number + OTP (and 2FA password if enabled). The printed session string goes into `.env` as `TELEGRAM_SESSION`.

### `index.ts`

CLI entry point. Responsible for:

1. Loading `topic` and `telegramChannels` from `config/channels.yaml`
2. Invoking the LangGraph workflow (scraper → conditional → llm_generator)
3. Saving generated output (PNG image + MD text) to `output/`, or logging and exiting if no posts were found

### `nodes/scraper.ts`

The Telegram scraper node. For each channel in `telegramChannels`:
1. Connects to Telegram via GramJS (using `TELEGRAM_SESSION` from `.env`)
2. Fetches the **last 5 messages** that contain a photo
3. For each post, calls GPT-4o with `prompts/telegram-filter.md` to check if it is about **Italian football** and the event is **still active**
4. Downloads relevant images to `temp/<timestamp>/`
5. Returns `{ inputPosts: SamplePost[] }` — empty array if nothing matched

### `nodes/llm-generator.ts`

The LLM generation node. Performs 4 internal steps:

1. **Image analysis** — GPT-4o vision reads betting slip images and extracts matches, bet types, odds
2. **Bet optimization** — GPT-4o generates an optimized bet slip as structured JSON
3. **Image rendering** — Canvas renders the JSON into a professional PNG image
4. **Text generation** — GPT-4o writes a caption coherent with the generated bet slip, styled after the sample texts

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
