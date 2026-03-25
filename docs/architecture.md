# Architecture Document

## Project Overview

An automated workflow that:

1. **Scrapes** Telegram channels (public and private) for the latest posts related to a configurable topic
2. **Generates** a new post via LLM, built in similarity to the collected posts
3. **Publishes** the generated post to Instagram (or Google Sheets as fallback)

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
| **LLM** | OpenAI SDK for Node.js | Post generation (GPT-4o or model of choice) |
| **Publishing (MVP)** | Google Sheets API | Store generated posts for review |
| **Publishing (Future)** | Meta Graph API | Post to Instagram (requires Business account) |
| **Trigger** | CLI (`tsx`) | Manual execution |
| **Scheduling (Future)** | node-cron / system cron | Daily automated execution |
| **Configuration** | YAML + .env | Channels, topics, API keys |

## Project Structure

The codebase is organized with clean separation between workflows and shared infrastructure:

```
agentic-workflow/
├── src/
│   ├── shared/                         # Shared modules used by both workflows
│   │   ├── telegram-client.ts          # createTelegramClient() — GramJS factory
│   │   ├── llm.ts                      # createModel() — ChatOpenAI factory
│   │   └── config.ts                   # loadYamlConfig<T>() — YAML config loader
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
│   └── setup-telegram.ts              # One-time CLI script for Telegram auth
├── config/
│   ├── channels.yaml                   # Post-generator config (topic + channels)
│   └── analysis.yaml                   # Channel-analyzer config (time range + channels)
├── prompts/
│   ├── telegram-filter.md              # LLM prompt: is this post about active Italian football?
│   ├── image-analysis.md               # LLM prompt: extract bets from betting slip images
│   ├── bet-optimizer.md                # LLM prompt: generate optimized bet slip as JSON
│   ├── post-generator.md               # LLM prompt: write caption for generated slip
│   ├── chunk-analysis.md               # LLM prompt: partial channel analysis per chunk
│   └── analysis-synthesis.md           # LLM prompt: synthesize chunks into final document
├── analysis/                           # Channel analysis output (.md per channel)
├── temp/                               # Telegram images downloaded at runtime (gitignored)
├── output/                             # Generated posts saved here (gitignored)
├── package.json
├── tsconfig.json
└── .env                                # API keys (Telegram, OpenAI, etc.)
```

## LangGraph Workflows

Both workflows follow the same LangGraph pattern: each node is a TypeScript function that receives the current **graph state**, executes its logic, and returns the **updated state**.

This pattern allows:

- Independent testing of each node in isolation
- Future addition of conditional branching, loops, human-in-the-loop, or retry logic per node
- Clean separation of concerns

### Workflow 1: Post Generator

```
[START] → [scraper] → conditional edge → [llm_generator] → [END]
                              ↓
                       (inputPosts empty) → [END]
```

Scrapes Telegram channels, filters posts via GPT-4o, then generates a new betting post (image + caption).

### Workflow 2: Channel Analyzer

```
[START] → [channel_reader] → [chunk_splitter] → [chunk_analyzer]
                                                       ↓
                                            (more chunks? loop back)
                                                  ↙           ↘
                                        [chunk_analyzer]    [synthesizer] → [END]
```

Reads all posts from a channel within a configurable time range, splits them into chunks, analyzes each chunk via GPT-4o (map phase), then synthesizes all partial analyses into a final structured markdown document (reduce phase). Uses a conditional edge loop: after each `chunk_analyzer` execution, if there are remaining chunks, it loops back; otherwise it proceeds to `synthesizer`.

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

## Execution Model

- **Trigger**: Manual via CLI (primary), scheduled via cron (future)
- **Frequency**: Once per day
- **Volume**: 5-10 Telegram channels per execution
- **Output (MVP)**: Generated post saved to markdown file for developer review
- **Output (Future)**: Published to Google Sheets, then Instagram

## MVP Roadmap

### Release 1 — LLM Node

Posts are hardcoded in 4-5 text files. Create the LLM agent/prompt that takes these posts as input and generates a new post in similarity. Output saved to a markdown file.

### Release 2 — Scraper Node

Replace hardcoded posts with a Telegram scraper node. Given N channels and a topic, fetch relevant posts and pass them to the LLM node from Release 1.

### Release 3 — Publisher Node

The generated post is published to a predefined Instagram profile or, alternatively, to a cloud spreadsheet (Google Sheets).
