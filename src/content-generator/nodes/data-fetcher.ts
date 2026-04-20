import type { ContentStateType, Fixture, FixtureOdds, SquadPlayer } from "../state.js";

// ── The Odds API (primary: fixtures + odds) ──────────────────
const THE_ODDS_API_BASE = "https://api.the-odds-api.com/v4";

// Football competitions — defaults (used when profile doesn't specify)
const DEFAULT_ODDS_API_COMPETITIONS: Array<{ key: string; label: string }> = [
  { key: "soccer_italy_serie_a", label: "Serie A" },
  { key: "soccer_uefa_champs_league", label: "Champions League" },
  { key: "soccer_italy_coppa_italia", label: "Coppa Italia" },
  { key: "soccer_uefa_europa_league", label: "Europa League" },
];

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

// football-data.org competition codes — defaults (used when profile doesn't specify)
const DEFAULT_FD_COMPETITIONS: Array<{ code: string; label: string }> = [
  { code: "SA", label: "Serie A" },
  { code: "CL", label: "Champions League" },
  { code: "CI", label: "Coppa Italia" },
];

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

// ── football-data.org lineup types ───────────────────────────

interface FDLineupPlayer {
  id: number;
  name: string;
  position: string | null;
  shirtNumber?: number;
}

interface FDMatchSingle {
  homeTeam: { lineup: FDLineupPlayer[]; bench: FDLineupPlayer[] };
  awayTeam: { lineup: FDLineupPlayer[]; bench: FDLineupPlayer[] };
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
/** Preferred bookmakers in priority order. */
const PREFERRED_BOOKMAKERS = ["bet365", "betfair", "unibet", "williamhill", "pinnacle"];

/** Picks the best bookmaker: tries preferred list first, then falls back to first available. */
function pickBookmaker(bookmakers: OddsBookmaker[]): OddsBookmaker | undefined {
  if (bookmakers.length === 0) return undefined;
  for (const pref of PREFERRED_BOOKMAKERS) {
    const found = bookmakers.find((b) => b.key === pref);
    if (found) return found;
  }
  return bookmakers[0];
}

function extractOddsFromEvent(
  bookmakers: OddsBookmaker[],
  homeTeam: string,
  awayTeam: string,
): FixtureOdds | undefined {
  const bm = pickBookmaker(bookmakers);
  if (!bm) return undefined;

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

async function fetchFromOddsApi(
  date: string,
  sportKeys: Array<{ key: string; label: string }> = DEFAULT_ODDS_API_COMPETITIONS,
): Promise<Fixture[] | null> {
  const apiKey = process.env.THE_ODDS_API_KEY;
  if (!apiKey) return null;

  const allFixtures: Fixture[] = [];
  let anySuccess = false;

  for (const { key: sportKey, label } of sportKeys) {
    try {
      console.log(`⚽ Fetching fixtures + odds from The Odds API (${label})...`);

      const url = new URL(`${THE_ODDS_API_BASE}/sports/${sportKey}/odds`);
      url.searchParams.set("apiKey", apiKey);
      url.searchParams.set("regions", "eu");
      url.searchParams.set("markets", "h2h,totals");
      url.searchParams.set("dateFormat", "iso");
      url.searchParams.set("oddsFormat", "decimal");

      const response = await fetch(url.toString());

      if (!response.ok) {
        // 404 or similar = competition not active/available
        if (response.status === 404 || response.status === 422) {
          console.log(`   ℹ️  ${label}: not available (HTTP ${response.status}, skipped)`);
          continue;
        }
        const body = await response.text().catch(() => "");
        console.error(`   ❌ ${label}: The Odds API responded with ${response.status}: ${body}`);
        continue;
      }

      const remaining = response.headers.get("x-requests-remaining");
      const used = response.headers.get("x-requests-used");
      if (remaining != null) {
        console.log(`   API usage: ${used ?? "?"} used, ${remaining} remaining this month`);
      }

      anySuccess = true;
      const events = (await response.json()) as OddsEvent[];

      const fixtures = events
        .filter((e) => {
          const eventDate = utcToRomeDate(e.commence_time);
          const eventTime = utcToRomeTime(e.commence_time);
          return eventDate === date && isNotStarted(eventTime);
        })
        .map((e) => ({
          homeTeam: e.home_team,
          awayTeam: e.away_team,
          league: label,
          date,
          time: utcToRomeTime(e.commence_time),
          odds: extractOddsFromEvent(e.bookmakers, e.home_team, e.away_team),
        }));

      if (fixtures.length > 0) {
        console.log(`   Found ${fixtures.length} match(es) for ${label}`);
      }
      allFixtures.push(...fixtures);
    } catch (err) {
      console.error(`   ❌ ${label} fetch failed:`, err);
    }
  }

  if (!anySuccess) return null;

  return allFixtures.sort((a, b) => a.time.localeCompare(b.time));
}

async function fetchFromFootballData(
  date: string,
  competitions: Array<{ code: string; label: string }> = DEFAULT_FD_COMPETITIONS,
): Promise<Fixture[] | null> {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  if (!apiKey) return null;

  console.log(`⚽ Fallback: fetching fixtures from football-data.org (no odds)...`);

  const allFixtures: Fixture[] = [];
  let anySuccess = false;

  for (const { code, label } of competitions) {
    try {
      const url = new URL(`${FOOTBALL_DATA_BASE}/competitions/${code}/matches`);
      url.searchParams.set("dateFrom", date);
      url.searchParams.set("dateTo", date);

      const response = await fetch(url.toString(), {
        headers: { "X-Auth-Token": apiKey },
      });

      if (!response.ok) {
        // Free tier may not include all competitions
        if (response.status === 403 || response.status === 404) {
          console.log(`   ℹ️  ${label}: not available on free tier (HTTP ${response.status}, skipped)`);
          continue;
        }
        const body = await response.text().catch(() => "");
        console.error(`   ❌ football-data.org ${label} ${response.status}: ${body}`);
        continue;
      }

      const data = (await response.json()) as FDMatchesResponse;
      if (data.errorCode) {
        console.error(`   ❌ football-data.org ${label} error: ${data.message}`);
        continue;
      }

      anySuccess = true;
      const fixtures = data.matches
        .filter((m) => ["SCHEDULED", "TIMED"].includes(m.status))
        .map((m) => ({
          homeTeam: m.homeTeam.name,
          awayTeam: m.awayTeam.name,
          league: label,
          date,
          time: utcToRomeTime(m.utcDate),
        }))
        .filter((f) => isNotStarted(f.time));

      if (fixtures.length > 0) {
        console.log(`   Found ${fixtures.length} match(es) for ${label}`);
      }
      allFixtures.push(...fixtures);
    } catch (err) {
      console.error(`   ❌ ${label} fetch failed:`, err);
    }
  }

  if (!anySuccess) return null;

  return allFixtures.sort((a, b) => a.time.localeCompare(b.time));
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
  } catch (err) {
    console.log(`   ⚠️  Tennis sports listing failed: ${err}. Trying default sport keys.`);
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
      if (!response.ok) {
        console.log(`   ⚠️  Tennis ${sportKey}: HTTP ${response.status} (skipped)`);
        continue;
      }

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
    } catch (err) {
      console.log(`   ⚠️  Tennis ${sportKey} fetch failed: ${err}`);
      continue;
    }
  }

  console.log(`   Found ${allFixtures.length} tennis match(es) for ${date}`);
  return allFixtures.sort((a, b) => a.time.localeCompare(b.time));
}

// ── Squad data from football-data.org ────────────────────────

interface FDSquadPlayer {
  name: string;
  position: string | null;
}

interface FDTeam {
  name: string;
  shortName: string;
  squad: FDSquadPlayer[];
}

interface FDTeamsResponse {
  teams: FDTeam[];
  errorCode?: number;
}

/** In-memory cache for squad data (one fetch per competition per day is enough) */
const squadCache = new Map<string, Map<string, SquadPlayer[]>>();

/**
 * Fetches all squads for a competition from football-data.org and caches them.
 * Returns a map of team name -> players.
 */
async function fetchSquadsForCompetition(
  competitionCode: string,
): Promise<Map<string, SquadPlayer[]>> {
  const cached = squadCache.get(competitionCode);
  if (cached) return cached;

  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  if (!apiKey) return new Map();

  try {
    const url = new URL(
      `${FOOTBALL_DATA_BASE}/competitions/${competitionCode}/teams`,
    );
    url.searchParams.set("season", "2025");

    const response = await fetch(url.toString(), {
      headers: { "X-Auth-Token": apiKey },
    });

    if (!response.ok) {
      console.log(
        `   ℹ️  Squad data for ${competitionCode}: HTTP ${response.status} (skipped)`,
      );
      return new Map();
    }

    const data = (await response.json()) as FDTeamsResponse;
    if (data.errorCode) return new Map();

    const result = new Map<string, SquadPlayer[]>();
    for (const team of data.teams) {
      const players: SquadPlayer[] = (team.squad ?? [])
        .filter((p) => p.position != null)
        .map((p) => ({ name: p.name, position: p.position! }));

      // Index by full name and short name for fuzzy matching
      result.set(team.name.toLowerCase(), players);
      result.set(team.shortName.toLowerCase(), players);
    }

    squadCache.set(competitionCode, result);
    console.log(
      `   📋 Loaded squads for ${data.teams.length} teams (${competitionCode})`,
    );
    return result;
  } catch (err) {
    console.log(`   ⚠️  Squad fetch failed for ${competitionCode}: ${err}`);
    return new Map();
  }
}

/**
 * Find squad for a team name by fuzzy-matching against cached squad data.
 */
function findSquad(
  teamName: string,
  squadsMap: Map<string, SquadPlayer[]>,
): SquadPlayer[] | undefined {
  const lower = teamName.toLowerCase();

  // Exact match
  if (squadsMap.has(lower)) return squadsMap.get(lower);

  // Partial match: check if any key is contained in the team name or vice versa
  for (const [key, squad] of squadsMap) {
    if (lower.includes(key) || key.includes(lower)) return squad;
  }

  return undefined;
}

/**
 * Enriches fixtures with current squad data from football-data.org.
 */
async function enrichFixturesWithSquads(
  fixtures: Fixture[],
  fdCompetitions: Array<{ code: string; label: string }> = DEFAULT_FD_COMPETITIONS,
): Promise<void> {
  const footballFixtures = fixtures.filter((f) => f.sport !== "tennis");
  if (footballFixtures.length === 0) return;

  console.log(`\n📋 Fetching current squad data for today's teams...`);

  // Determine which competitions we need squads for
  const competitionCodes = new Set<string>();
  for (const fixture of footballFixtures) {
    for (const { code, label } of fdCompetitions) {
      if (fixture.league.toLowerCase().includes(label.toLowerCase())) {
        competitionCodes.add(code);
      }
    }
  }

  // Fetch squads for all needed competitions
  const allSquads = new Map<string, SquadPlayer[]>();
  for (const code of competitionCodes) {
    const squads = await fetchSquadsForCompetition(code);
    for (const [key, val] of squads) {
      allSquads.set(key, val);
    }
  }

  if (allSquads.size === 0) {
    console.log(`   ⚠️  No squad data available. Player names won't be injected.`);
    return;
  }

  // Attach squads to fixtures
  let enriched = 0;
  for (const fixture of footballFixtures) {
    const homeSquad = findSquad(fixture.homeTeam, allSquads);
    const awaySquad = findSquad(fixture.awayTeam, allSquads);
    if (homeSquad) { fixture.homeSquad = homeSquad; enriched++; }
    if (awaySquad) { fixture.awaySquad = awaySquad; enriched++; }
  }

  console.log(
    `   ✅ Enriched ${enriched} team(s) with current squad data`,
  );
}

/** Fuzzy team name match — handles abbreviations and minor differences. */
function teamsMatch(a: string, b: string): boolean {
  const al = a.toLowerCase().trim();
  const bl = b.toLowerCase().trim();
  return al === bl || al.includes(bl) || bl.includes(al);
}

/**
 * Enriches fixtures with football-data.org match IDs by cross-referencing today's FD schedule.
 * Match IDs are needed to fetch official lineups at publishing time.
 * Called after fixtures are fetched from any source.
 */
async function enrichFixturesWithFDMatchIds(
  fixtures: Fixture[],
  fdCompetitions: Array<{ code: string; label: string }>,
  date: string,
): Promise<void> {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  if (!apiKey) return;

  const footballFixtures = fixtures.filter((f) => f.sport !== "tennis" && !f.fdMatchId);
  if (footballFixtures.length === 0) return;

  for (const { code } of fdCompetitions) {
    try {
      const url = new URL(`${FOOTBALL_DATA_BASE}/competitions/${code}/matches`);
      url.searchParams.set("dateFrom", date);
      url.searchParams.set("dateTo", date);

      const response = await fetch(url.toString(), {
        headers: { "X-Auth-Token": apiKey },
      });
      if (!response.ok) {
        console.log(`   ⚠️  FD match ID fetch (${code}): HTTP ${response.status} (skipped)`);
        continue;
      }

      const data = (await response.json()) as FDMatchesResponse;
      if (data.errorCode) {
        console.log(`   ⚠️  FD match ID fetch (${code}): API error ${data.errorCode} (skipped)`);
        continue;
      }

      for (const match of data.matches) {
        for (const fixture of footballFixtures) {
          if (fixture.fdMatchId) continue;
          if (
            teamsMatch(fixture.homeTeam, match.homeTeam.name) &&
            teamsMatch(fixture.awayTeam, match.awayTeam.name)
          ) {
            fixture.fdMatchId = match.id;
            break;
          }
        }
      }
    } catch (err) {
      console.log(`   ⚠️  FD match ID fetch (${code}) failed: ${err}`);
    }
  }

  const mapped = footballFixtures.filter((f) => f.fdMatchId).length;
  if (mapped > 0) {
    console.log(`   🔖 Mapped ${mapped} fixture(s) to FD match IDs for lineup support`);
  }
}

/**
 * Fetches official starting lineups from football-data.org for fixtures that have FD match IDs.
 * Mutates fixtures in place: when a lineup is released, replaces homeSquad/awaySquad
 * with confirmed starters and marks hasOfficialLineup = true.
 *
 * Returns true if at least one fixture received an official lineup.
 */
export async function fetchOfficialLineups(fixtures: Fixture[]): Promise<boolean> {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  if (!apiKey) return false;

  const targets = fixtures.filter(
    (f) => f.sport !== "tennis" && f.fdMatchId && !f.hasOfficialLineup,
  );
  if (targets.length === 0) {
    // Already fetched previously
    return fixtures.some((f) => f.hasOfficialLineup === true);
  }

  let anyFound = false;

  for (const fixture of targets) {
    try {
      const response = await fetch(
        `${FOOTBALL_DATA_BASE}/matches/${fixture.fdMatchId}`,
        { headers: { "X-Auth-Token": apiKey } },
      );
      if (!response.ok) {
        console.log(`   ⚠️  Lineup fetch for match ${fixture.fdMatchId} (${fixture.homeTeam}-${fixture.awayTeam}): HTTP ${response.status}`);
        continue;
      }

      const data = (await response.json()) as FDMatchSingle;

      if (data.homeTeam.lineup?.length > 0) {
        fixture.homeSquad = data.homeTeam.lineup.map((p) => ({
          name: p.name,
          position: p.position ?? "Unknown",
        }));
        fixture.hasOfficialLineup = true;
        anyFound = true;
      }
      if (data.awayTeam.lineup?.length > 0) {
        fixture.awaySquad = data.awayTeam.lineup.map((p) => ({
          name: p.name,
          position: p.position ?? "Unknown",
        }));
        fixture.hasOfficialLineup = true;
        anyFound = true;
      }
    } catch (err) {
      console.log(`   ⚠️  Lineup fetch for match ${fixture.fdMatchId} (${fixture.homeTeam}-${fixture.awayTeam}) failed: ${err}`);
      continue;
    }
  }

  return anyFound;
}

// ── Player props (anytime scorer, cards) from The Odds API ───

/** Player prop market types we fetch. */
const PLAYER_PROP_MARKETS = "player_anytime_td,player_to_be_carded";

/**
 * Fetches player prop odds (anytime scorer, cards) for today's fixtures.
 * Enriches fixtures in-place with anytimeScorers and playerCards data.
 *
 * NEVER invents data: if the API call fails, is unavailable, or returns
 * no data, fixtures remain unchanged. Only real API data is used.
 */
async function enrichFixturesWithPlayerProps(
  fixtures: Fixture[],
  sportKeys: Array<{ key: string; label: string }>,
  date: string,
): Promise<void> {
  const apiKey = process.env.THE_ODDS_API_KEY;
  if (!apiKey) {
    console.log(`   ℹ️  Player props: THE_ODDS_API_KEY not set. Skipping.`);
    return;
  }

  const footballFixtures = fixtures.filter((f) => f.sport !== "tennis" && f.odds);
  if (footballFixtures.length === 0) return;

  console.log(`\n🎯 Fetching player props (scorers, cards) from The Odds API...`);

  for (const { key: sportKey, label } of sportKeys) {
    try {
      const url = new URL(`${THE_ODDS_API_BASE}/sports/${sportKey}/odds`);
      url.searchParams.set("apiKey", apiKey);
      url.searchParams.set("regions", "eu");
      url.searchParams.set("markets", PLAYER_PROP_MARKETS);
      url.searchParams.set("dateFormat", "iso");
      url.searchParams.set("oddsFormat", "decimal");

      const response = await fetch(url.toString());

      if (!response.ok) {
        if (response.status === 404 || response.status === 422) {
          // Player props not available for this competition — normal, not an error
          continue;
        }
        if (response.status === 429) {
          console.error(`   ❌ Player props (${label}): API rate limit reached. Skipping.`);
          return; // stop all further requests
        }
        console.error(`   ❌ Player props (${label}): HTTP ${response.status}. Skipping.`);
        continue;
      }

      const events = (await response.json()) as OddsEvent[];
      let enriched = 0;

      for (const event of events) {
        const eventDate = utcToRomeDate(event.commence_time);
        if (eventDate !== date) continue;

        // Find the matching fixture
        const fixture = footballFixtures.find(
          (f) =>
            teamsMatch(f.homeTeam, event.home_team) &&
            teamsMatch(f.awayTeam, event.away_team),
        );
        if (!fixture || !fixture.odds) continue;

        const bm = pickBookmaker(event.bookmakers);
        if (!bm) continue;

        // Extract anytime scorers
        const scorerMarket = bm.markets.find((m) => m.key === "player_anytime_td");
        if (scorerMarket && scorerMarket.outcomes.length > 0) {
          fixture.odds.anytimeScorers = scorerMarket.outcomes
            .filter((o) => o.price > 0)
            .sort((a, b) => a.price - b.price) // lowest odds = most likely
            .slice(0, 10) // top 10 most likely scorers
            .map((o) => ({ player: o.name, odds: o.price }));
        }

        // Extract player cards
        const cardsMarket = bm.markets.find((m) => m.key === "player_to_be_carded");
        if (cardsMarket && cardsMarket.outcomes.length > 0) {
          fixture.odds.playerCards = cardsMarket.outcomes
            .filter((o) => o.price > 0)
            .sort((a, b) => a.price - b.price)
            .slice(0, 10)
            .map((o) => ({ player: o.name, odds: o.price }));
        }

        if (fixture.odds.anytimeScorers || fixture.odds.playerCards) {
          enriched++;
        }
      }

      if (enriched > 0) {
        console.log(`   ✅ ${label}: enriched ${enriched} fixture(s) with player props`);
      }
    } catch (err) {
      console.error(`   ❌ Player props (${label}) fetch failed:`, err);
      // Continue with other competitions — never invent data
    }
  }
}

/**
 * Standalone fixture-fetch function for use outside the graph (e.g. resume mode).
 * Fetches football + tennis fixtures for the given date and enriches with squad data.
 */
export async function fetchFixturesForDate(
  date: string,
  oddsApiComps?: Array<{ key: string; label: string }>,
  fdComps?: Array<{ code: string; label: string }>,
): Promise<Fixture[]> {
  let allFixtures: Fixture[] = [];

  // Football
  let fixtures: Fixture[] | null = null;
  try { fixtures = await fetchFromOddsApi(date, oddsApiComps); } catch (err) {
    console.error(`❌ fetchFixturesForDate: The Odds API failed:`, err);
  }
  if (!fixtures) {
    try { fixtures = await fetchFromFootballData(date, fdComps); } catch (err) {
      console.error(`❌ fetchFixturesForDate: football-data.org fallback failed:`, err);
    }
  }
  if (fixtures) allFixtures.push(...fixtures);

  // Tennis
  try {
    const tennis = await fetchTennisFromOddsApi(date);
    allFixtures.push(...tennis);
  } catch (err) {
    console.error(`❌ fetchFixturesForDate: tennis fetch failed:`, err);
  }

  // Enrich with squad data
  await enrichFixturesWithSquads(allFixtures, fdComps);

  // Enrich with FD match IDs for official lineup support
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Rome" });
  await enrichFixturesWithFDMatchIds(allFixtures, fdComps ?? DEFAULT_FD_COMPETITIONS, today);

  // Enrich with player props (scorers, cards)
  if (oddsApiComps && allFixtures.some((f) => f.sport !== "tennis" && f.odds)) {
    await enrichFixturesWithPlayerProps(allFixtures, oddsApiComps, date);
  }

  return allFixtures;
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
  const { date, scheduledFormats, profile, oddsApiCompetitions, footballDataCompetitions } = state;

  // Use profile competitions or fall back to defaults
  const oddsComps = oddsApiCompetitions.length > 0 ? oddsApiCompetitions : DEFAULT_ODDS_API_COMPETITIONS;
  const fdComps = footballDataCompetitions.length > 0 ? footballDataCompetitions : DEFAULT_FD_COMPETITIONS;

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
      fixtures = await fetchFromOddsApi(date, oddsComps);
    } catch (err) {
      console.error("❌ The Odds API fetch failed:", err);
    }

    // Fallback to football-data.org (fixtures only, no odds)
    if (!fixtures) {
      try {
        fixtures = await fetchFromFootballData(date, fdComps);
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

  // ── Enrich football fixtures with current squad data ──
  await enrichFixturesWithSquads(allFixtures, fdComps);

  // ── Enrich with FD match IDs for official lineup support ──
  await enrichFixturesWithFDMatchIds(allFixtures, fdComps, date);

  // ── Enrich with player props (scorers, cards) if any format needs them ──
  const needsPlayerProps = formatsRequiringData.some((f) =>
    f.requires_data.some((d) => ["player_cards", "odds"].includes(d))
  );
  if (needsPlayerProps && footballFixtures.length > 0) {
    await enrichFixturesWithPlayerProps(allFixtures, oddsComps, date);
  }

  return { fixtures: allFixtures, scheduledFormats: updatedFormats };
}

