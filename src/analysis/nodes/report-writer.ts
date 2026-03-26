import * as fs from "node:fs";
import * as path from "node:path";
import type { AnalysisStateType } from "../state.js";

function sanitizeChannelName(channel: string): string {
  // Extract a clean name from the channel identifier
  // @username → username
  // https://t.me/username → username
  // https://web.telegram.org/k/#-1001259302052 → 1001259302052
  // 1259302052 → 1259302052
  const tmeMatch = channel.match(/t\.me\/([a-zA-Z0-9_]+)/);
  if (tmeMatch) return tmeMatch[1];

  const webMatch = channel.match(/web\.telegram\.org\/.*#-?(\d+)/);
  if (webMatch) return webMatch[1];

  if (channel.startsWith("@")) return channel.slice(1);
  if (/^\d+$/.test(channel)) return channel;

  // Fallback: sanitize whatever string we got
  return channel.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export async function reportWriterNode(
  state: AnalysisStateType
): Promise<Partial<AnalysisStateType>> {
  const { analysisDocument, channel } = state;

  if (!analysisDocument) {
    console.log("⚠️  No analysis document to save. Skipping.");
    return {};
  }

  const outputDir = path.resolve("output", "analysis");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const channelName = sanitizeChannelName(channel);
  const outputPath = path.join(outputDir, `${channelName}.md`);

  fs.writeFileSync(outputPath, analysisDocument, "utf-8");
  console.log(`💾 Analysis saved to: ${outputPath}`);

  return {};
}
