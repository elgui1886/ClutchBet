import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { buildContentGraph } from "./graph.js";
import type { ProfileConfig, ContentItem } from "./state.js";

interface ContentConfig {
  profile: string;
  publishChannel?: string;
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

function saveOutput(items: ContentItem[]): string {
  const outputDir = path.resolve("output", "content");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().split("T")[0];

  for (const item of items) {
    const filename = `${item.formatSlug}_${timestamp}.md`;
    const filePath = path.join(outputDir, filename);
    const header =
      `<!-- Format: ${item.formatName} -->\n` +
      `<!-- Date: ${timestamp} -->\n` +
      `<!-- Approved: ${item.approved} -->\n` +
      `<!-- Published: ${item.published} -->\n\n`;
    fs.writeFileSync(filePath, header + item.text, "utf-8");
  }

  return outputDir;
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
  });

  if (!result.contentItems || result.contentItems.length === 0) {
    console.log("⚠️  No content generated. Workflow complete.");
    process.exit(0);
  }

  const outputDir = saveOutput(result.contentItems);
  console.log(`\n💾 Output saved to: ${outputDir}`);

  const approved = result.contentItems.filter((i: ContentItem) => i.approved);
  const published = result.contentItems.filter((i: ContentItem) => i.published);
  console.log(
    `\n📊 Summary: ${result.contentItems.length} generated, ` +
      `${approved.length} approved, ${published.length} published`
  );
}
