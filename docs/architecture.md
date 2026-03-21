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

```
agentic-workflow/
├── src/
│   ├── nodes/
│   │   ├── scraper.ts          # Node: fetch posts from Telegram via GramJS
│   │   ├── llm-generator.ts    # Node: prompt → LLM → generated post
│   │   └── publisher.ts        # Node: publish to Sheets/Instagram
│   ├── graph.ts                # LangGraph workflow definition
│   ├── state.ts                # Shared state type flowing between nodes
│   └── index.ts                # Entry point (CLI + manual trigger)
├── config/
│   └── channels.yaml           # Channel list, topics, parameters
├── prompts/
│   └── post-generator.md       # LLM prompt template
├── package.json
├── tsconfig.json
└── .env                        # API keys (Telegram, OpenAI, etc.)
```

## LangGraph Workflow

```
[START] → [Scraper Node] → [LLM Generator Node] → [Publisher Node] → [END]
```

Each node is a TypeScript function that:

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

### Setup

1. Register an app at [my.telegram.org](https://my.telegram.org) → obtain `api_id` and `api_hash`
2. On first run, GramJS prompts for phone number + OTP code
3. Session is saved locally (string) → no re-authentication needed on subsequent runs

### Configuration

```yaml
channels:
  - name: "Public Channel"
    username: "channel_name"        # public channels → username
  - name: "Private Channel"
    id: -1001234567890              # private channels → numeric channel ID
```

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
