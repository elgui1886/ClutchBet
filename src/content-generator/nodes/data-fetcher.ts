import type { ContentStateType, Fixture, FixtureOdds } from "../state.js";

const API_FOOTBALL_BASE = "https://v3.football.api-sports.io";

interface ApiFixture {
  fixture: {
    id: number;
    date: string;
    venue?: { name?: string };
    referee?: string;
  };
  league: { name: string };
  teams: {
    home: { name: string };
    away: { name: string };
  };
}

interface ApiOddsValue {
  value: string;
  odd: string;
}

interface ApiOddsBet {
  id: number;
  name: string;
  values: ApiOddsValue[];
}

interface ApiOddsBookmaker {
  id: number;
  name: string;
  bets: ApiOddsBet[];
}

interface ApiOddsResponse {
  fixture: { id: number };
  bookmakers: ApiOddsBookmaker[];
}

/**
 * Data-fetcher node — fetches today's fixtures from API-Football.
 * Falls back gracefully if the API key is missing or the request fails.
 */
export async function dataFetcherNode(
  state: ContentStateType
): Promise<Partial<ContentStateType>> {
  const { date, leagueId, leagueSeason, scheduledFormats, profile } = state;

  // Check if any scheduled format requires fixture data
  const formatsRequiringData = profile?.formats.filter(
    (f) =>
      scheduledFormats.includes(f.slug) &&
      f.requires_data.some((d) =>
        ["fixtures", "odds", "team_stats", "referee_stats", "player_cards"].includes(d)
      )
  );

  if (!formatsRequiringData || formatsRequiringData.length === 0) {
    console.log("ℹ️  No scheduled formats require sports data. Skipping fetch.");
    return { fixtures: [] };
  }

  const apiKey = process.env.FOOTBALL_API_KEY;

  if (!apiKey) {
    console.log(
      "⚠️  FOOTBALL_API_KEY not set in .env. Using mock fixtures for development.\n" +
        "   Set FOOTBALL_API_KEY to get real fixture data from API-Football."
    );
    return { fixtures: getMockFixtures(date) };
  }

  try {
    console.log(`⚽ Fetching fixtures for ${date} (League ${leagueId}, Season ${leagueSeason})...`);

    const url = new URL(`${API_FOOTBALL_BASE}/fixtures`);
    url.searchParams.set("league", String(leagueId));
    url.searchParams.set("season", String(leagueSeason));
    url.searchParams.set("date", date);

    const response = await fetch(url.toString(), {
      headers: {
        "x-apisports-key": apiKey,
      },
    });

    if (!response.ok) {
      console.error(`❌ API-Football responded with ${response.status}: ${response.statusText}`);
      console.log("   Falling back to mock fixtures.");
      return { fixtures: getMockFixtures(date) };
    }

    const data = (await response.json()) as { response: ApiFixture[] };
    const fixtureIds = data.response.map((item) => item.fixture.id);

    // Fetch odds for all fixtures
    const oddsMap = await fetchOdds(apiKey, fixtureIds);

    const fixtures: Fixture[] = data.response.map((item) => ({
      homeTeam: item.teams.home.name,
      awayTeam: item.teams.away.name,
      league: item.league.name,
      date: date,
      time: new Date(item.fixture.date).toLocaleTimeString("it-IT", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }),
      venue: item.fixture.venue?.name,
      referee: item.fixture.referee ?? undefined,
      odds: oddsMap.get(item.fixture.id),
    }));

    console.log(`✅ Found ${fixtures.length} fixture(s) for ${date}`);
    for (const f of fixtures) {
      const oddsStr = f.odds
        ? ` — 1: ${f.odds.home} | X: ${f.odds.draw} | 2: ${f.odds.away}`
        : " — odds: n/a";
      console.log(`   ${f.homeTeam} vs ${f.awayTeam} — ${f.time}${oddsStr}`);
    }

    // Filter scheduled formats: if no fixtures, drop formats that require data
    if (fixtures.length === 0) {
      console.log("\nℹ️  No fixtures today. Removing data-dependent formats.");
      const noDataFormats = state.scheduledFormats.filter((slug) => {
        const format = profile?.formats.find((f) => f.slug === slug);
        return !format?.requires_data.some((d) =>
          ["fixtures", "odds", "team_stats", "referee_stats", "player_cards"].includes(d)
        );
      });
      return { fixtures: [], scheduledFormats: noDataFormats };
    }

    return { fixtures };
  } catch (err) {
    console.error("❌ Failed to fetch fixtures:", err);
    console.log("   Falling back to mock fixtures.");
    return { fixtures: getMockFixtures(date) };
  }
}

/**
 * Returns mock fixtures for development/testing when no API key is available.
 */
function getMockFixtures(date: string): Fixture[] {
  console.log("🔧 Using mock fixture data for development\n");
  return [
    {
      homeTeam: "Napoli",
      awayTeam: "Roma",
      league: "Serie A",
      date,
      time: "20:45",
      venue: "Stadio Diego Armando Maradona",
      referee: "Mariani",
      odds: { home: 1.75, draw: 3.60, away: 4.50, over25: 1.85, under25: 1.95, btts_yes: 1.70, btts_no: 2.10, bookmaker: "Mock" },
    },
    {
      homeTeam: "Juventus",
      awayTeam: "Fiorentina",
      league: "Serie A",
      date,
      time: "18:00",
      venue: "Allianz Stadium",
      referee: "Doveri",
      odds: { home: 1.55, draw: 4.00, away: 5.50, over25: 1.90, under25: 1.88, btts_yes: 1.80, btts_no: 1.95, bookmaker: "Mock" },
    },
    {
      homeTeam: "Milan",
      awayTeam: "Atalanta",
      league: "Serie A",
      date,
      time: "15:00",
      venue: "San Siro",
      referee: "Orsato",
      odds: { home: 2.20, draw: 3.30, away: 3.10, over25: 1.65, under25: 2.20, btts_yes: 1.60, btts_no: 2.25, bookmaker: "Mock" },
    },
  ];
}

/**
 * Fetches odds for a list of fixture IDs from API-Football.
 * Returns a Map of fixtureId → FixtureOdds.
 */
async function fetchOdds(
  apiKey: string,
  fixtureIds: number[]
): Promise<Map<number, FixtureOdds>> {
  const oddsMap = new Map<number, FixtureOdds>();

  if (fixtureIds.length === 0) return oddsMap;

  console.log(`📊 Fetching odds for ${fixtureIds.length} fixture(s)...`);

  // API-Football /odds supports one fixture at a time
  for (const fixtureId of fixtureIds) {
    try {
      const url = new URL(`${API_FOOTBALL_BASE}/odds`);
      url.searchParams.set("fixture", String(fixtureId));

      const response = await fetch(url.toString(), {
        headers: { "x-apisports-key": apiKey },
      });

      if (!response.ok) {
        console.warn(`   ⚠️  Odds fetch failed for fixture ${fixtureId}: ${response.status}`);
        continue;
      }

      const data = (await response.json()) as { response: ApiOddsResponse[] };

      if (data.response.length === 0) continue;

      const bookmakers = data.response[0].bookmakers;
      if (bookmakers.length === 0) continue;

      // Prefer well-known bookmakers, fall back to the first available
      const preferred = ["Bet365", "Unibet", "1xBet", "Bwin"];
      const bookmaker =
        bookmakers.find((b) => preferred.includes(b.name)) ?? bookmakers[0];

      const odds = parseBookmakerOdds(bookmaker);
      if (odds) {
        odds.bookmaker = bookmaker.name;
        oddsMap.set(fixtureId, odds);
      }

      // Rate limiting: small delay between requests
      await new Promise((r) => setTimeout(r, 300));
    } catch {
      console.warn(`   ⚠️  Failed to fetch odds for fixture ${fixtureId}`);
    }
  }

  console.log(`✅ Odds fetched for ${oddsMap.size}/${fixtureIds.length} fixture(s)\n`);
  return oddsMap;
}

/**
 * Parses odds from a single bookmaker's bet list.
 */
function parseBookmakerOdds(bookmaker: ApiOddsBookmaker): FixtureOdds | null {
  const result: Partial<FixtureOdds> = {};

  for (const bet of bookmaker.bets) {
    // Match Winner (1X2)
    if (bet.name === "Match Winner") {
      for (const v of bet.values) {
        if (v.value === "Home") result.home = parseFloat(v.odd);
        if (v.value === "Draw") result.draw = parseFloat(v.odd);
        if (v.value === "Away") result.away = parseFloat(v.odd);
      }
    }
    // Over/Under 2.5
    if (bet.name === "Goals Over/Under" || bet.name === "Over/Under 2.5") {
      for (const v of bet.values) {
        if (v.value === "Over 2.5") result.over25 = parseFloat(v.odd);
        if (v.value === "Under 2.5") result.under25 = parseFloat(v.odd);
      }
    }
    // Both Teams Score (Goal/NoGoal)
    if (bet.name === "Both Teams Score") {
      for (const v of bet.values) {
        if (v.value === "Yes") result.btts_yes = parseFloat(v.odd);
        if (v.value === "No") result.btts_no = parseFloat(v.odd);
      }
    }
  }

  if (result.home == null || result.draw == null || result.away == null) {
    return null;
  }

  return result as FixtureOdds;
}
