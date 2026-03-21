# Project Structure

```
agentic-workflow/
├── src/
│   ├── nodes/
│   │   └── llm-generator.ts
│   ├── graph.ts
│   ├── state.ts
│   └── index.ts
├── config/
│   └── channels.yaml
├── prompts/
│   └── post-generator.md
├── samples/
│   ├── samples1.txt
│   └── samples2.txt
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

Defines the shared **LangGraph state** that flows between nodes. Contains:

- `inputPosts` — array of raw posts collected from samples (or Telegram in future releases)
- `topic` — the theme to focus on (e.g. "Betting Serie A")
- `generatedPost` — the post produced by the LLM
- `publishResult` — outcome of the publishing step (future use)

### `graph.ts`

Builds and compiles the **LangGraph workflow**. Current flow:

```
[START] → [llm_generator] → [END]
```

Future releases will add `scraper` and `publisher` nodes.

### `index.ts`

CLI entry point. Responsible for:

1. Loading configuration from `config/channels.yaml`
2. Reading sample post files
3. Invoking the LangGraph workflow
4. Saving the generated post to `output/`

### `nodes/llm-generator.ts`

The LLM generation node. Receives sample posts and a topic via graph state, loads the prompt template, calls OpenAI, and returns the generated post.

## Configuration (`config/`)

### `channels.yaml`

Defines the workflow parameters:

- `topic` — the subject for post generation
- `sampleFiles` — list of file paths containing sample posts (Release 1: hardcoded files; Release 2: replaced by Telegram scraper)

## Prompts (`prompts/`)

### `post-generator.md`

Markdown prompt template for the LLM. Uses `{topic}` and `{posts}` placeholders that get interpolated at runtime.

## Samples (`samples/`)

Hardcoded sample posts used as input for Release 1 of the MVP. These files contain real Telegram posts that the LLM uses as style and content reference.

## Output (`output/`)

Auto-created directory where generated posts are saved as timestamped markdown files (e.g. `post-2026-03-21T10-30-00-000Z.md`). Listed in `.gitignore`.

## Environment (`.env`)

Stores sensitive configuration (API keys). Use `.env.example` as template:

| Variable | Required | Description |
|---|---|---|
| `OPENAI_API_KEY` | Yes | OpenAI API key |
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
