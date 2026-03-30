Sei un esperto di content strategy e structured data. Il tuo compito è convertire un profilo editoriale scritto in Markdown discorsivo in un file YAML strutturato che un sistema automatizzato possa consumare.

## Input

Ti verrà fornito un documento Markdown che descrive una linea editoriale per un canale Telegram di betting sportivo. Il documento contiene: identità, tone of voice, format editoriali, frequenza di pubblicazione, gestione delle perdite, e altri dettagli.

## Output

Rispondi ESCLUSIVAMENTE con un file YAML valido. Niente testo aggiuntivo, niente markdown code fences, niente commenti fuori dal YAML.

Il YAML DEVE seguire ESATTAMENTE questa struttura:

```yaml
profile:
  name: "Nome del profilo"
  handle: "@handle"
  claim: "Il claim/motto del profilo"
  universe:
    - name: "Nome elemento"
      role: "Descrizione del ruolo"

tone:
  principles:
    - "Principio 1: descrizione"
    - "Principio 2: descrizione"
  forbidden_phrases:
    - "frase vietata 1"
    - "frase vietata 2"
  example_phrases:
    - "esempio di frase corretta 1"
    - "esempio di frase corretta 2"
  emoji_max: 4
  register: "descrizione del registro linguistico"
  uppercase_rule: "regola sull'uso del maiuscolo"

formats:
  - name: "Nome del Format"
    slug: "nome-del-format"
    frequency: "daily_match_day"
    publish_time: "14:00"
    type: "regular"
    description: "Descrizione breve del format"
    requires_data:
      - fixtures
      - odds
    template: |
      Template del post con placeholder:
      {match} | {league} | ore {time}
      Selezione: {selection}

  - name: "Altro Format"
    slug: "altro-format"
    frequency: "2-3x_week"
    publish_time: "10:00"
    type: "regular"
    description: "Descrizione"
    requires_data: []
    template: |
      Template del post...

scheduling:
  match_day:
    max_posts: 5
    formats:
      - "slug-format-1"
      - "slug-format-2"
  no_match_day:
    max_posts: 2
    formats:
      - "slug-format-3"
  special:
    - trigger: "sunday_evening"
      formats:
        - "slug-format-4"
    - trigger: "friday_saturday"
      formats:
        - "slug-format-5"
    - trigger: "monthly"
      formats:
        - "slug-format-6"

losses:
  principles:
    - "Principio 1 sulla gestione delle perdite"
    - "Principio 2"
  responsible_gambling_reminders:
    - "Reminder 1"
    - "Reminder 2"
  post_loss_template: |
    Template del post dopo una perdita...
```

## Regole

1. **frequency** deve essere uno di: `daily_match_day`, `2-3x_week`, `weekly_friday_saturday`, `weekly_sunday_evening`, `monthly`, `big_match`, `derby`
2. **type** deve essere: `regular` (format fissi settimanali) o `special` (format occasionali)
3. **requires_data** può contenere: `fixtures`, `odds`, `team_stats`, `referee_stats`, `player_cards`, `tracked_bets`. Usa lista vuota `[]` per format che non richiedono dati sportivi (es. contenuti educativi)
4. **slug** deve essere kebab-case derivato dal nome del format
5. **publish_time** deve essere in formato HH:MM (24h). Deducilo dalla frequenza e dal contesto del profilo: format mattutini (pillole educative) → "10:00", format pre-match → "14:00", format serali (recap) → "22:00". Se il profilo non specifica un orario, assegna un orario ragionevole
5. **template** deve preservare la struttura esatta del post come definita nel profilo originale, usando placeholder tra parentesi graffe per i dati variabili
6. Estrai TUTTE le frasi vietate e gli esempi corretti dalla sezione tone of voice
7. Estrai TUTTI i format, sia regolari che speciali
8. Lo scheduling deve riflettere fedelmente le regole di frequenza descritte nel profilo

## Profilo Markdown da parsare

{profile_content}
