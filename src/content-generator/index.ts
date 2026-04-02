import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { buildContentGraph } from "./graph.js";
import type { ProfileConfig, ContentItem } from "./state.js";

interface ContentConfig {
  profile: string;
  publishChannel?: string;
  reviewBeforePublish?: boolean;
  league?: {
    id?: number;
    season?: number;
  };
}

function loadConfig(): ContentConfig {
  const configPath = path.resolve("config", "content.yaml");
  const raw = fs.readFileSync(configPath, "utf-8");
  return parseYaml(raw) as ContentConfig;
}

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
  console.log("🚀 Starting content-generator workflow...\n");

  const config = loadConfig();

  // Allow CLI override: npm run content -- --profile config/profiles/other.yaml
  const cliProfileArg = process.argv.find((a) => a.startsWith("--profile="));
  const profilePath = cliProfileArg
    ? cliProfileArg.split("=")[1]
    : config.profile;

  console.log(`📄 Profile: ${profilePath}`);
  const profile = loadProfile(profilePath);
  console.log(`👤 Loaded: ${profile.profile.name} — "${profile.profile.claim}"`);
  console.log(`📋 Formats: ${profile.formats.map((f) => f.name).join(", ")}\n`);

  if (config.publishChannel) {
    console.log(`📡 Publish channel: ${config.publishChannel}`);
  } else {
    console.log("⚠️  No publish channel configured. Content will be saved locally only.");
  }
  console.log();

  const graph = buildContentGraph();

  const result = await graph.invoke({
    profilePath,
    profile,
    publishChannel: config.publishChannel ?? "",
    leagueId: config.league?.id ?? 135,
    leagueSeason: config.league?.season ?? 2025,
    date: new Date().toISOString().split("T")[0],
    reviewBeforePublish: config.reviewBeforePublish ?? false,
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
