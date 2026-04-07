# ClutchBet

Automated Telegram content generation and publishing platform for sports betting, built with **TypeScript + LangGraph.js**.

## What it does

| Workflow / Command | Description | Command |
|---|---|---|
| **Content Generator** | Pipeline editoriale: profilo → dati reali → post → review → pubblica | `npm run content` |
| **Generation** | Scraping Telegram → LLM genera post simili → pubblica | `npm run generation` |
| **Analysis** | Analisi storica di un canale Telegram → report MD | `npm run analysis` |
| **Check Results** | Verifica risultati scommesse → genera recap | `npm run check-results` |
| **Watch Results** | Daemon che fa polling automatico dei risultati | `npm run watch-results` |
| **Daemon** | Orchestratore cron giornaliero (pm2) | `npm run daemon` |
| **Parse Profile** | Converte profilo MD → YAML strutturato | `npm run parse-profile` |
| **Reset** | Pulisce database e content-history | `npm run reset` |

## Tech Stack

| Component | Technology |
|---|---|
| Language | TypeScript |
| Workflow Engine | LangGraph.js |
| Telegram | GramJS (Client API) |
| LLM | OpenAI SDK (GPT-4o / GPT-4o-mini) |
| Image Rendering | Puppeteer (headless Chrome) |
| Sports Data | API-Football (api-sports.io) |
| Database | SQLite (better-sqlite3) |
| Process Manager | pm2 |
| Configuration | YAML + .env |

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your API keys (see .env.example for all variables)

# 3. Authenticate with Telegram (one-time)
npx tsx src/setup-telegram.ts

# 4. Parse an editorial profile (one-time per profile)
npm run parse-profile -- output/profiles/il-capitano.md
# Configure the generated YAML in config/profiles/il-capitano.yaml

# 5. Generate and publish today's content
npm run content -- --profile=config/profiles/il-capitano.yaml

# 6. Check bet results after matches
npm run check-results -- --profile=config/profiles/il-capitano.yaml
```

For production deployment with automated daily execution:

```bash
# Start the daemon (cron at 08:00 daily, configurable)
pm2 start ecosystem.config.cjs
```

## Documentation

| Document | Content |
|---|---|
| [docs/project-definition.md](docs/project-definition.md) | Overview del progetto e comandi disponibili |
| [docs/architecture.md](docs/architecture.md) | Architettura, tech stack, diagrammi dei workflow, strategie Telegram |
| [docs/project-structure.md](docs/project-structure.md) | Struttura file, moduli, API interne, configurazione, prompts |
| [docs/content-generator.md](docs/content-generator.md) | Guida operativa: setup, flusso giornaliero, resume, note operative |
| [docs/deploy.md](docs/deploy.md) | Deploy su VPS con pm2, troubleshooting |

## Project Structure

```
src/
├── index.ts                    # CLI dispatcher
├── daemon.ts                   # pm2 daemon (cron orchestrator)
├── check-results.ts            # One-shot bet results checker
├── watch-results.ts            # Polling bet results watcher
├── parse-profile.ts            # MD → YAML profile converter
├── reset.ts                    # Full data reset
├── generation/                 # Workflow: scraper → llm_generator → publisher
├── analysis/                   # Workflow: history_scraper → channel_analyzer → report_writer
├── content-generator/          # Workflow: scheduler → data_fetcher → content_writer → reviewer → publisher
└── shared/                     # Shared modules (Telegram, LLM, bet tracking, content store)

config/
├── channels.yaml               # Generation: topic, channels
├── analysis.yaml               # Analysis: channel, months
├── content.yaml                # Content generator defaults
└── profiles/                   # Parsed YAML editorial profiles

prompts/                        # LLM prompt templates
data/                           # Runtime data: SQLite DB + content history (gitignored)
```

## License

Private repository.
