# Architecture Document

## Project Overview

An automated workflow that:

1. **Scrapes** Telegram channels (public and private) for the latest posts related to a configurable topic
2. **Generates** a new optimized betting slip (image + caption) via LLM, built in similarity to the collected posts
3. **Publishes** the generated post to a configured Telegram channel

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
agentic-workflow/
├── src/
│   ├── nodes/
│   │   ├── scraper.ts          # Node: fetch + LLM-filter posts from Telegram via GramJS
│   │   ├── llm-generator.ts    # Node: image analysis + bet optimization + image render + caption
│   │   └── publisher.ts        # Node: publish generated post to Telegram channel
│   ├── templates/
│   │   └── bet-slip.html       # HTML/CSS template for betting slip image rendering
│   ├── graph.ts                # LangGraph workflow definition (scraper → llm_generator → publisher)
│   ├── state.ts                # Shared state type flowing between nodes
│   ├── image-renderer.ts       # Puppeteer-based betting slip image renderer
│   ├── list-channels.ts        # Utility: list all Telegram channels/groups with IDs
│   ├── setup-telegram.ts       # One-time CLI script to obtain Telegram session string
│   └── index.ts                # Entry point (CLI + manual trigger)
├── config/
│   └── channels.yaml           # Telegram channel list + topic + publish channel
├── prompts/
│   ├── telegram-filter.md      # LLM prompt: is this post about active Italian football? (uses {today_date})
│   ├── image-analysis.md       # LLM prompt: extract bets from betting slip images via vision
│   ├── bet-optimizer.md        # LLM prompt: generate optimized bet slip as JSON (totalOdd = product, cap 35)
│   └── post-generator.md       # LLM prompt: write full-detail caption for generated slip
├── temp/                       # Telegram images downloaded at runtime (gitignored)
├── output/                     # Generated posts saved here (gitignored)
├── package.json
├── tsconfig.json
└── .env                        # API keys (Telegram, OpenAI/GitHub Models)
```

## LangGraph Workflow

```
[START] → [scraper] → (inputPosts empty?) → [END]
                ↓
          (posts found)
                ↓
        [llm_generator] → [publisher] → [END]
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
