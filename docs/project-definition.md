## Progetto

Il progetto contiene **tre workflow LangGraph** più utility commands all'interno di una singola codebase. Architettura: **TypeScript + LangGraph.js**.

| Workflow / Comando | Descrizione | Comando |
|---|---|---|
| **Generation** | Scraping Telegram → LLM genera post simili → pubblica | `npm run generation` |
| **Analysis** | Analisi storica di un canale Telegram → report MD | `npm run analysis` |
| **Content Generator** | Pipeline editoriale: profilo → dati reali → post → review → pubblica | `npm run content` |
| **Check Results** | Verifica risultati scommesse → genera recap | `npm run check-results` |
| **Watch Results** | Daemon che fa polling automatico dei risultati | `npm run watch-results` |
| **Parse Profile** | Converte profilo MD → YAML strutturato | `npm run parse-profile` |
| **Daemon** | Un processo pm2 per profilo, cron giornaliero | `pm2 start ecosystem.config.cjs` |
| **Reset** | Pulisce database e content-history | `npm run reset` |
| **Setup Telegram** | Autenticazione Telegram (una tantum) | `npx tsx src/setup-telegram.ts` |
| **List Channels** | Elenca i canali Telegram accessibili | `npx tsx src/list-channels.ts` |

> Documentazione: [architecture.md](architecture.md) · [project-structure.md](project-structure.md) · [content-generator.md](content-generator.md) · [deploy.md](deploy.md)
