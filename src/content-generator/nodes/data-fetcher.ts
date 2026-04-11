import type { ContentStateType, Fixture } from "../state.js";

// football-data.org — free tier, covers current Serie A season
const FOOTBALL_DATA_BASE = "https://api.football-data.org/v4";
const SERIE_A_CODE = "SA";

interface FDMatch {
  id: number;
  utcDate: string;
  status: string;
  venue?: string;
  homeTeam: { name: string; shortName?: string };
  awayTeam: { name: string; shortName?: string };
  competition: { name: string };
}

interface FDMatchesResponse {
  matches: FDMatch[];
  errorCode?: number;
  message?: string;
}

/**
 * Data-fetcher node — fetches today's fixtures from football-data.org.
 * Falls back gracefully if the API key is missing or the request fails.
 */
export async function dataFetcherNode(
  state: ContentStateType
): Promise<Partial<ContentStateType>> {
  const { date, scheduledFormats, profile } = state;

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

  const apiKey = process.env.FOOTBALL_DATA_API_KEY;

  if (!apiKey) {
    console.log(
      "⚠️  FOOTBALL_DATA_API_KEY not set in .env. Using mock fixtures for development.\n" +
        "   Register at football-data.org to get a free API key."
    );
    return { fixtures: getMockFixtures(date) };
  }

  try {
    console.log(`⚽ Fetching fixtures for ${date} (Serie A — football-data.org)...`);

    const url = new URL(`${FOOTBALL_DATA_BASE}/competitions/${SERIE_A_CODE}/matches`);
    url.searchParams.set("dateFrom", date);
    url.searchParams.set("dateTo", date);

    const response = await fetch(url.toString(), {
      headers: {
        "X-Auth-Token": apiKey,
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error(`❌ football-data.org responded with ${response.status}: ${body}`);
      console.log("   Falling back to mock fixtures.");
      return { fixtures: getMockFixtures(date) };
    }

    const data = (await response.json()) as FDMatchesResponse;

    if (data.errorCode) {
      console.error(`❌ football-data.org error: ${data.message}`);
      console.log("   Falling back to mock fixtures.");
      return { fixtures: getMockFixtures(date) };
    }

    const fixtures: Fixture[] = data.matches
      .filter((m) => ["SCHEDULED", "TIMED", "IN_PLAY", "PAUSED", "FINISHED"].includes(m.status))
      .map((m) => ({
        homeTeam: m.homeTeam.name,
        awayTeam: m.awayTeam.name,
        league: m.competition.name,
        date,
        time: new Date(m.utcDate).toLocaleTimeString("it-IT", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
          timeZone: "Europe/Rome",
        }),
        venue: m.venue ?? undefined,
        referee: undefined, // not available on free tier
        odds: undefined,    // not available on free tier
      }));

    console.log(`✅ Found ${fixtures.length} fixture(s) for ${date}`);
    for (const f of fixtures) {
      console.log(`   ${f.homeTeam} vs ${f.awayTeam} — ${f.time}`);
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
