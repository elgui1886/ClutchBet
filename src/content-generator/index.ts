import dotenv from "dotenv"; dotenv.config({ override: true });
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { buildContentGraph } from "./graph.js";
import { profileSlugFromPath } from "../shared/bet-tracker.js";
import {
  getPendingContent,
  expireOldContent,
} from "../shared/content-store.js";
import { publisherNode } from "./nodes/publisher.js";
import { fetchFixturesForDate } from "./nodes/data-fetcher.js";
import type { ProfileConfig, ContentItem, ContentStateType } from "./state.js";

function loadProfile(profilePath: string): ProfileConfig {
  const resolved = path.resolve(profilePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(
      `Profile not found: ${resolved}\n` +
        `Run: npm run parse-profile -- <path-to-md>\n` +
        `Example: npm run parse-profile -- output/profiles/il-capitano.md`
    );
  }
  const raw = fs.readFileSync(resolved, "utf-8");
  return parseYaml(raw) as ProfileConfig;
}

export async function main() {
  // Profile path from CLI: --profile=config/profiles/il-capitano.yaml
  const cliProfileArg = process.argv.find((a) => a.startsWith("--profile="));
  const profilePath = cliProfileArg?.split("=")[1];

  if (!profilePath) {
    console.error("❌ Usage: npm run content -- --profile=config/profiles/<name>.yaml");
    process.exit(1);
  }

  const profile = loadProfile(profilePath);
  const cfg = profile.config ?? {};
  const today = new Date().toISOString().split("T")[0];
  const profileSlug = profileSlugFromPath(profilePath);
  const isResume = process.argv.includes("--resume");

  // Expire content from previous days on every run
  expireOldContent(today);

  // ── Resume mode: publish pending items from today's queue ──
  if (isResume) {
    console.log("🔄 Resume mode: checking for unpublished content...\n");

    const pending = getPendingContent(profileSlug, today);
    if (pending.length === 0) {
      console.log("✅ No pending content to publish. Everything is up to date.");
      return;
    }

    const needsGeneration = pending.some((p) => !p.text);
    if (needsGeneration) {
      console.log(`📤 Found ${pending.length} item(s), some need just-in-time generation. Resuming...\n`);
    } else {
      console.log(`📤 Found ${pending.length} unpublished item(s) for today. Resuming...\n`);
    }

    // Re-fetch fixture data if any plan items still need content generation
    let fixtures: ContentStateType["fixtures"] = [];
    if (needsGeneration) {
      console.log("⚽ Re-fetching fixture data for just-in-time generation...\n");
      fixtures = await fetchFixturesForDate(
        today,
        cfg.competitions?.oddsApi,
        cfg.competitions?.footballData,
      );
    }

    await publisherNode({
      contentItems: pending,
      publishChannel: cfg.publishChannel ?? "",
      reviewBeforePublish: false,
      profilePath,
      timezone: cfg.timezone ?? "Europe/Rome",
      profile,
      leagueId: cfg.league?.id ?? 135,
      leagueSeason: cfg.league?.season ?? 2025,
      oddsApiCompetitions: cfg.competitions?.oddsApi ?? [],
      footballDataCompetitions: cfg.competitions?.footballData ?? [],
      date: today,
      fixtures,
      scheduledFormats: [],
      publishResult: "",
    } as ContentStateType);

    console.log("\n✅ Resume publishing complete.");
    return;
  }

  // ── Normal mode: full generation pipeline ──────────────────
  console.log("🚀 Starting content-generator workflow...\n");

  console.log(`📄 Profile: ${profilePath}`);

  console.log(`👤 Loaded: ${profile.profile.name} — "${profile.profile.claim}"`);
  console.log(`📋 Formats: ${profile.formats.map((f) => f.name).join(", ")}\n`);

  if (cfg.publishChannel) {
    console.log(`📡 Publish channel: ${cfg.publishChannel}`);
  } else {
    console.log("⚠️  No publish channel configured. Content will be saved locally only.");
  }
  console.log();

  const graph = buildContentGraph();

  const result = await graph.invoke({
    profilePath,
    profile,
    publishChannel: cfg.publishChannel ?? "",
    leagueId: cfg.league?.id ?? 135,
    leagueSeason: cfg.league?.season ?? 2025,
    oddsApiCompetitions: cfg.competitions?.oddsApi ?? [],
    footballDataCompetitions: cfg.competitions?.footballData ?? [],
    date: new Date().toISOString().split("T")[0],
    reviewBeforePublish: cfg.reviewBeforePublish ?? false,
    timezone: cfg.timezone ?? "Europe/Rome",
  });

  if (!result.contentItems || result.contentItems.length === 0) {
    console.log("⚠️  No content generated. Workflow complete.");
    process.exit(0);
  }

  const approved = result.contentItems.filter((i: ContentItem) => i.approved);
  const published = result.contentItems.filter((i: ContentItem) => i.published);
  console.log(
    `\n📊 Summary: ${result.contentItems.length} generated, ` +
      `${approved.length} approved, ${published.length} published`
  );
}
