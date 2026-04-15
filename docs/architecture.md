# Architecture Document

## Project Overview

The project contains **three LangGraph workflows** plus utility commands within a single codebase:

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

### Content Generator Workflow (`npm run content`)
An editorial content pipeline that turns a **profile** (editorial line definition) into real, publishable Telegram posts, using a **just-in-time generation** strategy:
1. **Fetches** real sports data (fixtures, odds) from external APIs. Competitions are configured per profile (e.g. Serie A + Champions League, or Premier League + FA Cup). Uses The Odds API as primary source, football-data.org as fallback for fixtures only
2. **Schedules** which editorial formats to generate today based on the profile's editorial plan, the day of the week, and available fixtures. Each profile defines its own rubrics (formats) — there is no fixed set of rubrics; they are fully configurable per profile
3. **Plans** the publish schedule — assigns a publish time to each format without generating content yet. Lineup-dependent formats (marcatori, cartellini) are scheduled close to kickoff (configurable `publish_before_match` in minutes)
4. **Generates + publishes just-in-time** — at each scheduled time slot, the system generates the content via LLM (using the most current data), then immediately publishes to Telegram. This prevents citing players who may not play due to late injuries or tactical changes
5. **Reviews** generated content with human-in-the-loop approval before publishing (optional, disabled by default)

### Bet Results Checker (`npm run check-results`)
A command that verifies the outcome of published bets:
1. **Reads** pending (unresolved) bets from the SQLite database (`data/clutchbet.db`)
2. **Fetches** match results from football-data.org for finished matches
3. **Evaluates** each bet (supports 1X2, Over/Under, Goal/NoGoal, Double Chance, Multigol)
4. **Filters for publication**: publishes a recap only for winning schedine, in-progress schedine, or near-misses (lost by exactly 1 event). Completely wrong schedine are silently discarded
5. **Generates** a recap post via LLM, following the profile's tone of voice and loss management rules
6. **Publishes** the recap to Telegram (with human approval)

### Bet Results Watcher (`npm run watch-results`)
A daemon/polling version of `check-results` that runs continuously:
2. **Polls** football-data.org at regular intervals (default: 1 hour) for finished matches
2. **Evaluates** pending bets automatically when results become available
3. **Generates and publishes** recap posts (with human approval)
4. **Retries** on failure (max 3 retries, 30-minute delay between retries)

Useful for hands-off operation on match days — start it before kickoff and let it resolve bets automatically.

### Profile Parser (`npm run parse-profile`)
A one-off utility that converts a human-written Markdown profile (e.g. `output/profiles/il-capitano.md`) into a structured YAML configuration file that the content generator workflow can consume deterministically.

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
| **Image Rendering** | Puppeteer (headless Chrome) | Renders HTML/CSS bet-slip template to PNG screenshot with AI-generated backgrounds |
| **AI Backgrounds** | OpenAI gpt-image-1 | Generates unique branded background images per post via DALL-E |
| **Publishing** | Telegram channel | Generated post sent directly to a configured Telegram channel |
| **Sports Data API (fixtures + odds)** | The Odds API (the-odds-api.com) | Primary source for upcoming fixtures and odds. Competitions are configurable per profile (e.g. Serie A, Premier League, La Liga). Free tier: 500 req/month |
| **Sports Data API (fallback + results)** | football-data.org | Fallback for football fixtures (no odds) + match results for bet verification. Free tier |
| **Bet Storage** | better-sqlite3 (SQLite) | Local database for bet tracking, result verification, performance analytics, and content publish queue |
| **Trigger** | CLI (`tsx`) | Manual execution via `npm start` |
| **Scheduling** | node-cron + dynamic publish times | Daily automated execution via pm2 daemon. Just-in-time generation: content is planned in the morning but generated right before each publish time. Lineup-dependent formats are generated close to kickoff (configurable `publish_before_match` per format) |
| **Configuration** | YAML + .env | Channels, topics, profiles, API keys |

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

### Content Generator Workflow

```
[START] → [scheduler] → (nothing to generate?) → [END]
                ↓
          (formats selected)
                ↓
         [data_fetcher] → [content_writer (PLANNER)] → [reviewer] → (none approved?) → [END]
                                                                          ↓
                                                                    [publisher] → [END]
                                                                    (for each time slot:
                                                                     wait → generate JIT → publish)
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

### Content Generator Workflow
- **Trigger**: `npm run content` (CLI)
- **Frequency**: Once per day (morning)
- **Input**: Parsed YAML profile + real sports data from The Odds API (+ football-data.org fallback). Competitions are configurable per profile
- **Output**: Generated posts saved to `output/content/`, published to Telegram at scheduled times
- **Config**: Profile YAML contiene tutto (publishChannel, league, tone, branding, ecc.)
- **Human-in-the-loop**: Each generated post must be approved before publishing

### Bet Results Checker
- **Trigger**: `npm run check-results` (CLI)
- **Frequency**: After matches finish (evening / end of match day)
- **Input**: Pending bets from `data/clutchbet.db` + match results from football-data.org
- **Output**: Recap post saved to `output/recaps/`, published to Telegram
- **Human-in-the-loop**: Recap must be approved before publishing

### Bet Results Watcher
- **Trigger**: `npm run watch-results` (CLI — long-running daemon)
- **Frequency**: Polls every hour until all pending bets are resolved
- **Input**: Same as check-results (pending bets + football-data.org results)
- **Output**: Same as check-results (recap post → Telegram)
- **Retry**: Max 3 retries, 30-minute delay between retries on failure

### Daemon
- **Trigger**: `pm2 start ecosystem.config.cjs`
- **Frequency**: Continuous — cron giornaliero alle 08:00 (configurabile via `DAEMON_CONTENT_CRON`)
- **Architecture**: Un processo pm2 indipendente per ogni profilo in `config/profiles/`
- **Behavior**: Ogni processo gestisce content generation + results watcher per il suo profilo
- **Resume**: Al restart, riprende la pubblicazione dei post rimasti in coda (`content_queue`)
- **Gestione**: `pm2 stop/start/restart <nome-profilo>` per controllare i profili singolarmente
- **Config**: Timezone `Europe/Rome` (hardcoded)
