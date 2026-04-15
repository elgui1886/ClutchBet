import "dotenv/config";
import { scrapeChannelHistory } from "../../shared/channel-scraper.js";
import type { AnalysisStateType } from "../state.js";

export async function historyScraperNode(
  state: AnalysisStateType
): Promise<Partial<AnalysisStateType>> {
  const { channel, timeRangeMonths } = state;

  if (!channel) {
    console.log("⚠️  No channel configured. Skipping history scraper.");
    return { rawPosts: [] };
  }

  const { posts, channelTitle } = await scrapeChannelHistory(channel, timeRangeMonths);

  // Analysis workflow uses only text posts — image-only posts don't contribute to narrative analysis
  const textPosts = posts.filter((p) => p.text.trim().length > 0);

  return { rawPosts: textPosts, channelTitle };
}
