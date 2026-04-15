import { Annotation } from "@langchain/langgraph";

/** Odds for a single fixture */
export interface FixtureOdds {
  home: number;       // 1
  draw: number;       // X
  away: number;       // 2
  over25?: number;    // Over 2.5
  under25?: number;   // Under 2.5
  btts_yes?: number;  // Goal (both teams to score)
  btts_no?: number;   // NoGoal
  bookmaker?: string; // Source bookmaker name
}

/** A player in a team squad */
export interface SquadPlayer {
  name: string;
  position: string;   // e.g. "Goalkeeper", "Defence", "Midfield", "Offence", "Centre-Back", etc.
}

/** A football fixture from the sports API */
export interface Fixture {
  homeTeam: string;
  awayTeam: string;
  league: string;
  date: string;       // YYYY-MM-DD
  time: string;       // HH:MM
  venue?: string;
  referee?: string;
  odds?: FixtureOdds;
  sport?: string;     // "football" | "tennis" — defaults to "football"
  homeSquad?: SquadPlayer[];
  awaySquad?: SquadPlayer[];
}

/** Branding configuration for image generation */
export interface BrandingConfig {
  primary_color: string;     // Main brand color (e.g. "#D4AF37" gold)
  accent_color: string;      // Secondary color (e.g. "#1a1a2e" navy)
  bg_prompt_hint: string;    // Hint for DALL-E background generation (e.g. "stadium atmosphere, golden lighting")
  logo_svg?: string;         // Inline SVG logo (optional)
  tagline?: string;          // Short tagline displayed on images
}

/** A single format definition from the parsed YAML profile */
export interface FormatConfig {
  name: string;
  slug: string;
  frequency: string;
  type: string;
  description: string;
  requires_data: string[];
  generate_image: boolean;  // Whether this format should include a bet-slip image
  template: string;
  publish_time?: string;  // HH:MM — preferred publish time (e.g. "14:00")
  publish_before_match?: number; // Minutes before earliest kickoff to publish (for lineup-dependent formats)
  example_posts?: string[];  // Concrete example posts to guide LLM style
}

/** The full parsed YAML profile */
export interface ProfileConfig {
  profile: {
    name: string;
    handle: string;
    claim: string;
    universe: Array<{ name: string; role: string }>;
  };
  tone: {
    principles: string[];
    forbidden_phrases: string[];
    example_phrases: string[];
    emoji_max: number;
    register: string;
    uppercase_rule: string;
  };
  formats: FormatConfig[];
  branding: BrandingConfig;
  scheduling: {
    match_day: {
      max_posts: number;
      formats: string[];
    };
    no_match_day: {
      max_posts: number;
      formats: string[];
    };
    special: Array<{
      trigger: string;
      formats: string[];
    }>;
  };
  losses: {
    principles: string[];
    responsible_gambling_reminders: string[];
    post_loss_template: string;
  };
  /** Publishing & league configuration (per-profile) */
  config?: {
    publishChannel?: string;
    reviewBeforePublish?: boolean;
    timezone?: string;
    league?: {
      id?: number;
      season?: number;
      country?: string;
    };
    /** Competitions this profile covers (drives data fetching & results) */
    competitions?: {
      oddsApi: Array<{ key: string; label: string }>;
      footballData: Array<{ code: string; label: string }>;
    };
    affiliate?: {
      link: string;
      name: string;
      cta: string;
    };
  };
}

/** A bet selection extracted from generated content */
export interface BetSelection {
  homeTeam: string;
  awayTeam: string;
  league: string;
  kickoff: string;     // HH:MM
  selection: string;   // e.g. "Over 2.5", "1", "Goal"
  odds: number;
}

/** A generated content item (one per editorial format) */
export interface ContentItem {
  formatSlug: string;
  formatName: string;
  text: string;
  imageBase64?: string;    // PNG bet-slip image (base64) — only for bet-containing formats
  publishTime?: string;  // HH:MM — scheduled publish time
  bets?: BetSelection[]; // structured bets for tracking
  approved: boolean;
  published: boolean;
}

export const ContentState = Annotation.Root({
  /** Path to the YAML profile */
  profilePath: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),
  /** Parsed profile configuration */
  profile: Annotation<ProfileConfig | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
  /** Telegram channel to publish to */
  publishChannel: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),
  /** League config for sports API */
  leagueId: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 135,
  }),
  leagueSeason: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 2025,
  }),
  /** Competitions for The Odds API */
  oddsApiCompetitions: Annotation<Array<{ key: string; label: string }>>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  /** Competitions for football-data.org */
  footballDataCompetitions: Annotation<Array<{ code: string; label: string }>>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  /** Today's date (ISO) */
  date: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => new Date().toISOString().split("T")[0],
  }),
  /** Fetched fixtures for today */
  fixtures: Annotation<Fixture[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  /** Format slugs selected by the scheduler */
  scheduledFormats: Annotation<string[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  /** Generated content items */
  contentItems: Annotation<ContentItem[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  /** Whether to show human review before publishing */
  reviewBeforePublish: Annotation<boolean>({
    reducer: (_prev, next) => next,
    default: () => false,
  }),
  /** IANA timezone for publish scheduling (e.g. "Europe/Rome") */
  timezone: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "Europe/Rome",
  }),
  /** Overall publish result summary */
  publishResult: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),
});

export type ContentStateType = typeof ContentState.State;
