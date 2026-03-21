# Project Structure

```
agentic-workflow/
├── src/
│   ├── nodes/
│   │   └── llm-generator.ts
│   ├── graph.ts
│   ├── image-renderer.ts
│   ├── state.ts
│   └── index.ts
├── config/
│   └── channels.yaml
├── prompts/
│   ├── image-analysis.md
│   ├── bet-optimizer.md
│   └── post-generator.md
├── samples/
│   ├── sample1/               # Each sample = folder with images + text
│   │   ├── sample1.jpeg
│   │   └── sample1.txt
│   ├── sample2/
│   ├── sample3/
│   └── sample4/
├── output/                     # Auto-generated at runtime
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
- `WorkflowState` — the LangGraph annotation root with `inputPosts`, `topic`, `generatedPost`, `publishResult`

### `graph.ts`

Builds and compiles the **LangGraph workflow**. Current flow:

```
[START] → [llm_generator] → [END]
```

Future releases will add `scraper` and `publisher` nodes.

### `image-renderer.ts`

Generates betting slip images programmatically using **node-canvas**. Takes a `BetSlip` JSON (title, bets, totalOdd) and renders a professional-looking PNG with dark theme, gold accents, green odd badges, and clean layout.

### `index.ts`

CLI entry point. Responsible for:

1. Loading configuration from `config/channels.yaml`
2. Reading sample directories (images + text per folder)
3. Invoking the LangGraph workflow
4. Saving generated output (PNG image + MD text) to `output/`

### `nodes/llm-generator.ts`

The LLM generation node. Performs 4 internal steps:

1. **Image analysis** — GPT-4o vision reads betting slip images and extracts matches, bet types, odds
2. **Bet optimization** — GPT-4o generates an optimized bet slip as structured JSON
3. **Image rendering** — Canvas renders the JSON into a professional PNG image
4. **Text generation** — GPT-4o writes a caption coherent with the generated bet slip, styled after the sample texts

## Configuration (`config/`)

### `channels.yaml`

Defines the workflow parameters:

- `topic` — the subject for post generation
- `sampleDirs` — list of directories containing sample posts (Release 1: hardcoded; Release 2: replaced by Telegram scraper)

## Prompts (`prompts/`)

### `image-analysis.md`

Instructs GPT-4o vision to analyze betting slip images and extract structured data: matches, bet types, odds, slip codes.

### `bet-optimizer.md`

Instructs GPT-4o to combine and optimize bets from all analyzed slips into a single new optimized slip, returned as JSON (`BetSlip` format).

### `post-generator.md`

Instructs GPT-4o to write a caption for the generated bet slip, coherent with the actual bets, styled after the sample texts.

## Samples (`samples/`)

Hardcoded sample posts for Release 1. Each subfolder represents one Telegram post and contains:

- One or more **images** (`.jpeg`, `.png`) — screenshots of betting slips
- One **text file** (`.txt`) — the promotional text accompanying the image

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

## Running the Project

```bash
# 1. Copy and configure environment
cp .env.example .env
# Edit .env with your OpenAI API key

# 2. Install dependencies
npm install

# 3. Run the workflow
npm start
```
