# Architecture Document

## Project Overview

The project contains **two independent LangGraph workflows** within a single codebase:

### Generation Workflow (`npm run generation`)
An automated workflow that:
1. **Scrapes** Telegram channels (public and private) for the latest posts related to a configurable topic
2. **Generates** a new optimized betting slip (image + caption) via LLM, built in similarity to the collected posts
3. **Publishes** the generated post to a configured Telegram channel

### Analysis Workflow (`npm run analysis`)
A one-off analysis tool that:
1. **Scrapes** the full history of a single Telegram channel (configurable time range, e.g. 3–4 months)
2. **Analyzes** the posts via GPT-4o using a chunked approach (batch analysis → meta-analysis)
3. **Produces** a Markdown document with tone of voice, editorial plan, recurring patterns, publishing frequency, and content style

## Architecture Decision

### Evaluated Options

| Option | Verdict |
|---|---|
| **N8N** | Good for rapid prototyping, but limited for complex logic (e.g. semantic topic filtering). Telegram scraping requires Client API (Telethon/GramJS), which N8N doesn't natively support. Hard to version control. |
| **LangChain / LangGraph (Python)** | Powerful and mature, but requires learning both Python and LangGraph simultaneously. Double learning curve. |
| **Plain Python scripts** | Maximum flexibility, minimal abstraction. Excellent ecosystem for Telegram (Telethon) and Instagram (Instagrapi). However, no framework learning value and requires Python knowledge. |
| **LangGraph.js (TypeScript)** | Same graph-based architecture as the Python version, but leverages existing TypeScript expertise. One new concept to learn (agentic graphs) instead of two (Python + graphs). Transferable knowledge to Python version if needed later. |
| **Prefect / Temporal** | Overkill for a 3-step linear workflow at this stage. Worth revisiting if the project grows significantly. |

### Chosen Architecture: TypeScript + LangGraph.js

**Rationale:**

- Developer has strong TypeScript/Angular background — immediate productivity on business logic
- LangGraph.js provides the same conceptual model as the Python version (stateful graphs, nodes, edges, conditional branching)
- Learn one new thing (LangGraph) rather than two (Python + LangGraph)
- Knowledge is transferable to LangGraph Python if ever needed
- Type safety, familiar tooling, easy refactoring

## Tech Stack

| Component | Technology | Purpose |
|---|---|---|
| **Language** | TypeScript | Primary development language |
| **Workflow Engine** | LangGraph.js | Graph-based workflow orchestration |
| **Telegram Scraping** | GramJS (`telegram` on npm) | Telegram Client API — read messages from public and private channels |
| **Telegram Publishing** | GramJS (`telegram` on npm) | Send generated posts (image + caption) to a target Telegram channel |
| **LLM** | OpenAI SDK (`@langchain/openai`) | GPT-4o / GPT-4o-mini via GitHub Models endpoint for filtering, analysis, optimization, caption generation |
| **Image Rendering** | Puppeteer (headless Chrome) | Renders HTML/CSS bet-slip template to PNG screenshot |
| **Publishing** | Telegram channel | Generated post sent directly to a configured Telegram channel |
| **Trigger** | CLI (`tsx`) | Manual execution via `npm start` |
| **Scheduling (Future)** | node-cron / system cron | Daily automated execution |
| **Configuration** | YAML + .env | Channels, topics, API keys |

## Project Structure

```
ClutchBet/
├── src/
│   ├── index.ts                       # CLI dispatcher: routes to generation or analysis workflow
│   ├── list-channels.ts               # Utility: list Telegram channels/groups with IDs
│   ├── setup-telegram.ts              # One-time: obtain Telegram session string
│   ├── shared/
│   │   ├── telegram-utils.ts          # Shared: resolvePeer(), createTelegramClient()
│   │   └── llm-utils.ts              # Shared: loadPrompt()
│   ├── generation/
│   │   ├── state.ts                   # Generation workflow state (WorkflowState)
│   │   ├── graph.ts                   # Generation graph: scraper → llm_generator → publisher
│   │   ├── index.ts                   # Generation entry point (loads channels.yaml)
│   │   ├── image-renderer.ts          # Puppeteer bet-slip renderer
│   │   ├── templates/
│   │   │   └── bet-slip.html          # HTML/CSS template for betting slip
│   │   └── nodes/
│   │       ├── scraper.ts             # Telegram scraper + LLM filter
│   │       ├── llm-generator.ts       # Image analysis + bet optimization + caption
│   │       └── publisher.ts           # Publish to Telegram channel
│   └── analysis/
│       ├── state.ts                   # Analysis workflow state (AnalysisState)
│       ├── graph.ts                   # Analysis graph: history_scraper → channel_analyzer → report_writer
│       ├── index.ts                   # Analysis entry point (loads analysis.yaml)
│       └── nodes/
│           ├── history-scraper.ts     # Paginated Telegram history scraper
│           ├── channel-analyzer.ts    # GPT-4o chunked analysis (2-level)
│           └── report-writer.ts       # Save MD to output/analysis/
├── config/
│   ├── channels.yaml                  # Generation config: topic, channels, publish target
│   └── analysis.yaml                  # Analysis config: channel, months
├── prompts/
│   ├── telegram-filter.md             # LLM: is this post about active Italian football?
│   ├── image-analysis.md              # LLM: extract bets from betting slip images
│   ├── bet-optimizer.md               # LLM: generate optimized bet slip JSON
│   ├── post-generator.md              # LLM: write caption for generated slip
│   ├── channel-analysis-chunk.md      # LLM: analyze a batch of channel posts
│   └── channel-analysis-final.md      # LLM: meta-analysis → final channel report
├── output/                            # Generated outputs (gitignored)
│   └── analysis/                      # Channel analysis reports (*.md)
├── temp/                              # Downloaded images at runtime (gitignored)
├── package.json
├── tsconfig.json
└── .env                               # API keys (Telegram, OpenAI/GitHub Models)
```

## LangGraph Workflows

### Generation Workflow

```
[START] → [scraper] → (inputPosts empty?) → [END]
                ↓
          (posts found)
                ↓
        [llm_generator] → [publisher] → [END]
```

### Analysis Workflow

```
[START] → [history_scraper] → (rawPosts empty?) → [END]
                  ↓
            (posts found)
                  ↓
         [channel_analyzer] → [report_writer] → [END]
```

Each node is a TypeScript async function that:

- Receives the current **graph state**
- Executes its logic
- Returns the **updated state**

This pattern allows:

- Independent testing of each node in isolation
- Future addition of conditional branching, loops, human-in-the-loop, or retry logic per node
- Clean separation of concerns

## Telegram Access Strategy

Authentication uses the **Telegram Client API** (not Bot API), which means the app authenticates as a real user account.

| Channel Type | Access | Requirement |
|---|---|---|
| **Public** | Yes | None — accessible to everyone |
| **Private** | Yes | The Telegram account used must be a **member** of the channel |

### Setup (one-time)

1. Register an app at [my.telegram.org](https://my.telegram.org) → obtain `api_id` and `api_hash`
2. Add them to `.env` as `TELEGRAM_API_ID` and `TELEGRAM_API_HASH`
3. Run: `npx tsx src/setup-telegram.ts` — enter phone number + OTP (+ 2FA if enabled)
4. Copy the printed session string into `.env` as `TELEGRAM_SESSION`
5. No re-authentication needed on subsequent runs — session persists

### Configuration

```yaml
# config/channels.yaml
topic: "Betting Serie A - prossima giornata di campionato"

telegramChannels:
  - "@channel_username"   # public or private channels (must be a member)
  - "1234567890"          # numeric channel ID also supported
```

### Post Filtering

The scraper does **not** blindly pass all posts to the LLM generator. For each post retrieved from Telegram, GPT-4o evaluates (via `prompts/telegram-filter.md`) whether:
- The post is about **Italian football** (Serie A, Serie B, Coppa Italia, Nazionale)
- The referenced match/event is still **upcoming or in progress** (not concluded)

Only posts that pass both criteria are included in `inputPosts`. If none pass, the workflow exits cleanly with a log message.

### Best Practices

- Use a **dedicated Telegram account** (separate phone number) for scraping to avoid risking the personal account
- With 5-10 channels and 1 daily execution, rate limits are not a concern
- Telegram's Client API allows this usage as long as it's not massive/abusive

### Channel Analysis (Chunked Approach)

The analysis workflow handles potentially large volumes of posts (3–4 months of history) by using a **two-level chunking strategy**:

1. **Batch analysis**: posts are split into chunks of ~50. Each chunk is analyzed by GPT-4o using `prompts/channel-analysis-chunk.md`, producing a partial summary
2. **Meta-analysis**: all chunk summaries are fed to GPT-4o using `prompts/channel-analysis-final.md`, which synthesizes a comprehensive Markdown document

This approach keeps each LLM call within context window limits while still producing a coherent, holistic analysis.

## Execution Model

### Generation Workflow
- **Trigger**: `npm run generation` (CLI), scheduled via cron (future)
- **Frequency**: Once per day
- **Volume**: 5–10 Telegram channels per execution
- **Output**: Generated post (PNG + MD) saved to `output/`, published to Telegram

### Analysis Workflow
- **Trigger**: `npm run analysis` (CLI) — one-off tool
- **Frequency**: Once per channel (run on demand)
- **Volume**: 1 channel, 3–4 months of history
- **Output**: Channel analysis document saved to `output/analysis/<channel-name>.md`
- **Config**: Edit `config/analysis.yaml` before running

## MVP Roadmap

### Release 1 — LLM Node (Generation)
Posts hardcoded in sample folders. LLM agent generates a new post in similarity. Output saved to `output/`.

### Release 2 ✅ — Scraper Node (Generation)
Replace hardcoded posts with a Telegram scraper. Given N channels and a topic, fetch and filter relevant posts.

### Release 3 ✅ — Publisher Node (Generation)
Generated post published to a configured Telegram channel via GramJS.

### Release 4 ✅ — Channel Analysis Workflow
New one-off workflow: scrape a channel's history, analyze with GPT-4o (chunked), produce a Markdown analysis document.
