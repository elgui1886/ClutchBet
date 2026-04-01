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
}

/** A single format definition from the parsed YAML profile */
export interface FormatConfig {
  name: string;
  slug: string;
  frequency: string;
  type: string;
  description: string;
  requires_data: string[];
  template: string;
  publish_time?: string;  // HH:MM — preferred publish time (e.g. "14:00")
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
  /** Overall publish result summary */
  publishResult: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),
});

export type ContentStateType = typeof ContentState.State;
