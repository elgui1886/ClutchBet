# Tips Extractor

The Tips Extractor scrapes a Telegram channel's post history and uses an LLM to classify and extract structured betting data. Results are saved to `data/tips-analysis.db`.

## Usage

```bash
npm run tips -- --channel=<channel_url_or_username> [--limit=100]
```

Example:

```bash
npm run tips -- --channel=https://t.me/example_tipster --limit=200
```

## What it does

1. **Scrapes** the last N posts from a public Telegram channel via the Telegram client
2. **Analyzes** posts in batches using an LLM (configured via `OPENAI_MODEL` / `OPENAI_BASE_URL`)
3. **Saves** structured data to `data/tips-analysis.db`

## Database schema (3-level hierarchy)

The data is organized in three levels:

```
post_db  →  tips_db  →  selections_db
```

### `post_db` — one row per Telegram message

| Column | Type | Description |
|--------|------|-------------|
| `post_id` | INTEGER | Auto-incrementing primary key |
| `telegram_msg_id` | INTEGER | Original Telegram message ID |
| `post_affiliate_name` | TEXT | Channel name/title |
| `post_publication_timestamp` | TEXT | ISO 8601 UTC publish time |
| `post_type` | TEXT | `tips_new` / `tips_update` / `interaction` |
| `is_tips` | INTEGER | 1 if post contains new betting tips |
| `post_text` | TEXT | Full post text |
| `post_image` | INTEGER | 1 if post has an attached image |
| `tips_first_event_timestamp` | TEXT | Earliest event time across all tips in this post |
| `tips_distance_timestamp` | TEXT | HH:MM between publication and first event |
| `tips_event_count` | INTEGER | Number of distinct tips (giocate) in this post |

### `tips_db` — one row per tip/giocata within a post

A single post may contain multiple independent tips (e.g. "BOMBER Q.12", "CARTELLINI Q.22", "MULTIGOL Q.8").

| Column | Type | Description |
|--------|------|-------------|
| `tip_id` | INTEGER | Auto-incrementing primary key |
| `post_id` | INTEGER | FK → `post_db.post_id` |
| `tip_position` | INTEGER | Order within the post (1, 2, 3…) |
| `tip_topic` | TEXT | Named category/rubrica (e.g. "La Bomba", "I Cartellini") |
| `tip_odds` | REAL | Total odds for this tip |
| `tip_selections_count` | INTEGER | Number of legs/scommesse in this tip |

### `selections_db` — one row per individual bet within a tip

| Column | Type | Description |
|--------|------|-------------|
| `selection_id` | INTEGER | Auto-incrementing primary key |
| `tip_id` | INTEGER | FK → `tips_db.tip_id` |
| `post_id` | INTEGER | FK → `post_db.post_id` (denormalized for convenience) |
| `selections_id` | TEXT | Random 6-char ID (Italian alphabet) |
| `selections_sport` | TEXT | `football` / `tennis` / `basket` / `other` |
| `selections_competition` | TEXT | Full competition name (e.g. "Champions League") |
| `selections_event` | TEXT | "TeamA - TeamB" or "PlayerA - PlayerB" |
| `selections_timestamp` | TEXT | ISO 8601 UTC event time |
| `selections_market` | TEXT | Standardized market (e.g. "1X2", "Over 2.5", "Cartellino Giallo") |
| `selections_outcome` | TEXT | Selected outcome (e.g. "1", "Over", "Goal") |
| `selections_odds` | REAL | Decimal odds for this selection |

## Example queries

### Posts with tips, with their tip count

```sql
SELECT post_id, post_publication_timestamp, tips_event_count, post_text
FROM post_db
WHERE is_tips = 1
ORDER BY post_publication_timestamp DESC;
```

### All tips with their selection counts

```sql
SELECT t.tip_id, p.post_publication_timestamp, t.tip_topic, t.tip_odds, t.tip_selections_count
FROM tips_db t
JOIN post_db p ON p.post_id = t.post_id
ORDER BY p.post_publication_timestamp DESC;
```

### Distribution of tips by number of legs (scommesse)

```sql
SELECT tip_selections_count, COUNT(*) as n
FROM tips_db
GROUP BY tip_selections_count
ORDER BY tip_selections_count;
```

### All selections for a specific tip

```sql
SELECT s.*
FROM selections_db s
WHERE s.tip_id = <tip_id>;
```

## Post types

| Type | Description |
|------|-------------|
| `tips_new` | New betting tip/giocata proposed |
| `tips_update` | Update on a previous tip (result, recap) |
| `interaction` | Community interaction (greetings, promos, polls) |

## Configuration

Uses the same `.env` variables as the main daemon:

```env
OPENAI_API_KEY=ghp_...          # GitHub Models token
OPENAI_BASE_URL=https://models.inference.ai.azure.com
OPENAI_MODEL=gpt-4.1
```
