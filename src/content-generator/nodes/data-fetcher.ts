import type { ContentStateType, Fixture, FixtureOdds } from "../state.js";

// ── The Odds API (primary: fixtures + odds) ──────────────────
const THE_ODDS_API_BASE = "https://api.the-odds-api.com/v4";
const SPORT_KEY = "soccer_italy_serie_a";

// Tennis sport keys — fetched in order, first active tournament found wins
const TENNIS_SPORT_KEYS = [
  "tennis_atp_french_open",
  "tennis_atp_wimbledon",
  "tennis_atp_us_open",
  "tennis_atp_australian_open",
  "tennis_wta_french_open",
  "tennis_wta_wimbledon",
  "tennis_wta_us_open",
  "tennis_wta_australian_open",
];

// ── football-data.org (fallback: fixtures only) ──────────────
const FOOTBALL_DATA_BASE = "https://api.football-data.org/v4";
const SERIE_A_CODE = "SA";

// ── The Odds API response types ──────────────────────────────

interface OddsOutcome {
  name: string;
  price: number;
  point?: number;
}

interface OddsMarket {
  key: string;
  outcomes: OddsOutcome[];
}

interface OddsBookmaker {
  key: string;
  title: string;
  markets: OddsMarket[];
}

interface OddsEvent {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsBookmaker[];
}

// ── football-data.org response types ─────────────────────────

interface FDMatch {
  id: number;
  utcDate: string;
  status: string;
  venue?: string;
  homeTeam: { name: string };
  awayTeam: { name: string };
  competition: { name: string };
}

interface FDMatchesResponse {
  matches: FDMatch[];
  errorCode?: number;
  message?: string;
}

// ── Helpers ──────────────────────────────────────────────────

/** Current time in Europe/Rome as minutes since midnight. */
function nowMinutesInRome(): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Rome",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === "hour")!.value);
  const m = Number(parts.find((p) => p.type === "minute")!.value);
  return h * 60 + m;
}

/** Converts UTC ISO string to HH:MM in Europe/Rome. */
function utcToRomeTime(utcIso: string): string {
  return new Date(utcIso).toLocaleTimeString("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Europe/Rome",
  });
}

/** Converts UTC ISO string to YYYY-MM-DD in Europe/Rome. */
function utcToRomeDate(utcIso: string): string {
  return new Date(utcIso).toLocaleDateString("en-CA", { timeZone: "Europe/Rome" });
}

/** Returns true if the kickoff time (HH:MM Rome) is still in the future. */
function isNotStarted(time: string): boolean {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m > nowMinutesInRome();
}

/** Extracts odds from the first available bookmaker. */
function extractOddsFromEvent(
  bookmakers: OddsBookmaker[],
  homeTeam: string,
  awayTeam: string,
): FixtureOdds | undefined {
  if (bookmakers.length === 0) return undefined;

  const bm = bookmakers[0];
  const h2h = bm.markets.find((m) => m.key === "h2h");
  if (!h2h) return undefined;

  const homePrice = h2h.outcomes.find((o) => o.name === homeTeam)?.price ?? 0;
  const drawPrice = h2h.outcomes.find((o) => o.name === "Draw")?.price ?? 0;
  const awayPrice = h2h.outcomes.find((o) => o.name === awayTeam)?.price ?? 0;

  const totals = bm.markets.find((m) => m.key === "totals");
  const over25 = totals?.outcomes.find((o) => o.name === "Over" && o.point === 2.5)?.price;
  const under25 = totals?.outcomes.find((o) => o.name === "Under" && o.point === 2.5)?.price;

  return {
    home: homePrice,
    draw: drawPrice,
    away: awayPrice,
    over25,
    under25,
    bookmaker: bm.title,
  };
}

// ── Data sources ─────────────────────────────────────────────

async function fetchFromOddsApi(date: string): Promise<Fixture[] | null> {
  const apiKey = process.env.THE_ODDS_API_KEY;
  if (!apiKey) return null;

  console.log(`⚽ Fetching fixtures + odds from The Odds API (Serie A)...`);

  const url = new URL(`${THE_ODDS_API_BASE}/sports/${SPORT_KEY}/odds`);
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("regions", "eu");
  url.searchParams.set("markets", "h2h,totals");
  url.searchParams.set("dateFormat", "iso");
  url.searchParams.set("oddsFormat", "decimal");

  const response = await fetch(url.toString());

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.error(`❌ The Odds API responded with ${response.status}: ${body}`);
    return null;
  }

  const remaining = response.headers.get("x-requests-remaining");
  const used = response.headers.get("x-requests-used");
  if (remaining != null) {
    console.log(`   API usage: ${used ?? "?"} used, ${remaining} remaining this month`);
  }

  const events = (await response.json()) as OddsEvent[];

  return events
    .filter((e) => {
      const eventDate = utcToRomeDate(e.commence_time);
      const eventTime = utcToRomeTime(e.commence_time);
      return eventDate === date && isNotStarted(eventTime);
    })
    .map((e) => ({
      homeTeam: e.home_team,
      awayTeam: e.away_team,
      league: "Serie A",
      date,
      time: utcToRomeTime(e.commence_time),
      odds: extractOddsFromEvent(e.bookmakers, e.home_team, e.away_team),
    }))
    .sort((a, b) => a.time.localeCompare(b.time));
}

async function fetchFromFootballData(date: string): Promise<Fixture[] | null> {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  if (!apiKey) return null;

  console.log(`⚽ Fallback: fetching fixtures from football-data.org (no odds)...`);

  const url = new URL(`${FOOTBALL_DATA_BASE}/competitions/${SERIE_A_CODE}/matches`);
  url.searchParams.set("dateFrom", date);
  url.searchParams.set("dateTo", date);

  const response = await fetch(url.toString(), {
    headers: { "X-Auth-Token": apiKey },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.error(`❌ football-data.org responded with ${response.status}: ${body}`);
    return null;
  }

  const data = (await response.json()) as FDMatchesResponse;
  if (data.errorCode) {
    console.error(`❌ football-data.org error: ${data.message}`);
    return null;
  }

  return data.matches
    .filter((m) => ["SCHEDULED", "TIMED"].includes(m.status))
    .map((m) => ({
      homeTeam: m.homeTeam.name,
      awayTeam: m.awayTeam.name,
      league: m.competition.name,
      date,
      time: utcToRomeTime(m.utcDate),
    }))
    .filter((f) => isNotStarted(f.time))
    .sort((a, b) => a.time.localeCompare(b.time));
}

// ── Tennis ────────────────────────────────────────────────────

async function fetchTennisFromOddsApi(date: string): Promise<Fixture[]> {
  const apiKey = process.env.THE_ODDS_API_KEY;
  if (!apiKey) return [];

  console.log(`🎾 Fetching tennis fixtures + odds from The Odds API...`);

  // First, get the list of available tennis sports
  const sportsUrl = new URL(`${THE_ODDS_API_BASE}/sports`);
  sportsUrl.searchParams.set("apiKey", apiKey);

  let activeSportKeys: string[] = [];
  try {
    const sportsRes = await fetch(sportsUrl.toString());
    if (sportsRes.ok) {
      const sports = (await sportsRes.json()) as Array<{ key: string; active: boolean }>;
      activeSportKeys = sports
        .filter((s) => s.active && TENNIS_SPORT_KEYS.includes(s.key))
        .map((s) => s.key);
    }
  } catch {
    // If listing fails, try known keys directly
    activeSportKeys = TENNIS_SPORT_KEYS.slice(0, 2);
  }

  if (activeSportKeys.length === 0) {
    console.log(`   No active tennis tournaments found.`);
    return [];
  }

  const allFixtures: Fixture[] = [];

  for (const sportKey of activeSportKeys) {
    try {
      const url = new URL(`${THE_ODDS_API_BASE}/sports/${sportKey}/odds`);
      url.searchParams.set("apiKey", apiKey);
      url.searchParams.set("regions", "eu");
      url.searchParams.set("markets", "h2h");
      url.searchParams.set("dateFormat", "iso");
      url.searchParams.set("oddsFormat", "decimal");

      const response = await fetch(url.toString());
      if (!response.ok) continue;

      const events = (await response.json()) as OddsEvent[];
      const tournamentName = sportKey
        .replace("tennis_atp_", "ATP ")
        .replace("tennis_wta_", "WTA ")
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());

      const fixtures = events
        .filter((e) => {
          const eventDate = utcToRomeDate(e.commence_time);
          const eventTime = utcToRomeTime(e.commence_time);
          return eventDate === date && isNotStarted(eventTime);
        })
        .map((e) => {
          const h2h = e.bookmakers[0]?.markets.find((m) => m.key === "h2h");
          const odds: FixtureOdds | undefined = h2h
            ? {
                home: h2h.outcomes.find((o) => o.name === e.home_team)?.price ?? 0,
                draw: 0,
                away: h2h.outcomes.find((o) => o.name === e.away_team)?.price ?? 0,
              }
            : undefined;

          return {
            homeTeam: e.home_team,
            awayTeam: e.away_team,
            league: tournamentName,
            date,
            time: utcToRomeTime(e.commence_time),
            odds,
            sport: "tennis" as const,
          };
        });

      allFixtures.push(...fixtures);
    } catch {
      continue;
    }
  }

  console.log(`   Found ${allFixtures.length} tennis match(es) for ${date}`);
  return allFixtures.sort((a, b) => a.time.localeCompare(b.time));
}

/**
 * Data-fetcher node — fetches today's fixtures from The Odds API (with odds)
 * or football-data.org (fixtures only, as fallback).
 *
 * Only includes matches that have NOT yet started (kickoff > now).
 * Refuses to use mock/fake data — if no API is available, data-dependent
 * formats are dropped from the schedule.
 */
export async function dataFetcherNode(
  state: ContentStateType
): Promise<Partial<ContentStateType>> {
  const { date, scheduledFormats, profile } = state;

  const formatsRequiringData = profile?.formats.filter(
    (f) =>
      scheduledFormats.includes(f.slug) &&
      f.requires_data.some((d) =>
        ["fixtures", "odds", "team_stats", "referee_stats", "player_cards", "tennis_fixtures"].includes(d)
      )
  );

  if (!formatsRequiringData || formatsRequiringData.length === 0) {
    console.log("ℹ️  No scheduled formats require sports data. Skipping fetch.");
    return { fixtures: [] };
  }

  // Check if any format needs tennis data
  const needsTennis = formatsRequiringData.some((f) =>
    f.requires_data.includes("tennis_fixtures")
  );

  // Check if any format needs football data
  const needsFootball = formatsRequiringData.some((f) =>
    f.requires_data.some((d) =>
      ["fixtures", "odds", "team_stats", "referee_stats", "player_cards"].includes(d)
    )
  );

  let allFixtures: Fixture[] = [];

  // ── Fetch football fixtures ──
  if (needsFootball) {
    let fixtures: Fixture[] | null = null;
    try {
      fixtures = await fetchFromOddsApi(date);
    } catch (err) {
      console.error("❌ The Odds API fetch failed:", err);
    }

    // Fallback to football-data.org (fixtures only, no odds)
    if (!fixtures) {
      try {
        fixtures = await fetchFromFootballData(date);
        if (fixtures) {
          console.log("⚠️  Using football-data.org — fixtures only, no odds available.");
        }
      } catch (err) {
        console.error("❌ football-data.org fetch failed:", err);
      }
    }

    if (fixtures && fixtures.length > 0) {
      allFixtures.push(...fixtures);
    } else if (!fixtures) {
      console.error(
        "❌ No football data API configured or all APIs failed.\n" +
          "   Set THE_ODDS_API_KEY in .env (register at https://the-odds-api.com — free, 500 req/month).\n" +
          "   Optionally set FOOTBALL_DATA_API_KEY as fallback (register at football-data.org)."
      );
    }
  }

  // ── Fetch tennis fixtures ──
  if (needsTennis) {
    try {
      const tennisFixtures = await fetchTennisFromOddsApi(date);
      allFixtures.push(...tennisFixtures);
    } catch (err) {
      console.error("❌ Tennis fetch failed:", err);
    }
  }

  // ── Results summary ──
  const footballFixtures = allFixtures.filter((f) => f.sport !== "tennis");
  const tennisFixtures = allFixtures.filter((f) => f.sport === "tennis");

  console.log(`\n✅ Found ${footballFixtures.length} football + ${tennisFixtures.length} tennis fixture(s) for ${date}`);
  for (const f of allFixtures) {
    const sportIcon = f.sport === "tennis" ? "🎾" : "⚽";
    console.log(`   ${sportIcon} ${f.time} — ${f.homeTeam} vs ${f.awayTeam} (${f.league})${f.odds ? " (with odds)" : ""}`);
  }

  if (allFixtures.length === 0) {
    console.log("\nℹ️  No upcoming fixtures for today. Removing data-dependent formats.");
    const noDataFormats = scheduledFormats.filter((slug) => {
      const format = profile?.formats.find((f) => f.slug === slug);
      return !format?.requires_data.some((d) =>
        ["fixtures", "odds", "team_stats", "referee_stats", "player_cards", "tennis_fixtures"].includes(d)
      );
    });
    return { fixtures: [], scheduledFormats: noDataFormats };
  }

  // Remove tennis formats if no tennis data, and football formats if no football data
  let updatedFormats = [...scheduledFormats];
  if (footballFixtures.length === 0) {
    updatedFormats = updatedFormats.filter((slug) => {
      const format = profile?.formats.find((f) => f.slug === slug);
      return !format?.requires_data.some((d) =>
        ["fixtures", "odds", "team_stats", "referee_stats", "player_cards"].includes(d)
      );
    });
  }
  if (tennisFixtures.length === 0) {
    updatedFormats = updatedFormats.filter((slug) => {
      const format = profile?.formats.find((f) => f.slug === slug);
      return !format?.requires_data.includes("tennis_fixtures");
    });
  }

  return { fixtures: allFixtures, scheduledFormats: updatedFormats };
}

