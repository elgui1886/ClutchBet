import "dotenv/config";
import { createTelegramClient, resolvePeer } from "../../shared/telegram-utils.js";
import { addBets, type TrackedBet } from "../../shared/bet-tracker.js";
import type { ContentStateType, ContentItem } from "../state.js";

/**
 * Publisher node — sends approved content items to Telegram.
 * If a content item has a publishTime (HH:MM), waits until that time before sending.
 * Items are sorted by publishTime and sent in chronological order.
 */
export async function publisherNode(
  state: ContentStateType
): Promise<Partial<ContentStateType>> {
  const { contentItems, publishChannel, reviewBeforePublish } = state;

  // When review is disabled, treat all items as approved
  const approved = reviewBeforePublish
    ? contentItems.filter((item) => item.approved)
    : contentItems.map((item) => ({ ...item, approved: true }));

  if (approved.length === 0) {
    console.log("ℹ️  No approved content to publish.");
    return { publishResult: "skipped: no approved content" };
  }

  if (!publishChannel) {
    console.log("⚠️  No publish channel configured. Saving locally only.");
    return {
      publishResult: "skipped: no publishChannel configured",
      contentItems: contentItems.map((item) => ({
        ...item,
        published: false,
      })),
    };
  }

  // Sort by publishTime (items without time go first, then chronologically)
  const sorted = [...approved].sort((a, b) => {
    if (!a.publishTime && !b.publishTime) return 0;
    if (!a.publishTime) return -1;
    if (!b.publishTime) return 1;
    return a.publishTime.localeCompare(b.publishTime);
  });

  console.log(`\n📤 Publishing to: ${publishChannel}`);
  console.log(`📅 Schedule:\n`);
  for (const item of sorted) {
    console.log(`   ${item.publishTime ?? "now"} — ${item.formatName}`);
  }
  console.log();

  const client = await createTelegramClient();

  try {
    const peer = resolvePeer(publishChannel);
    const results: string[] = [];

    for (const item of sorted) {
      // Wait for the scheduled time if set
      if (item.publishTime) {
        await waitUntil(item.publishTime, item.formatName);
      }

      try {
        console.log(`  📨 Sending: ${item.formatName}...`);
        await client.sendMessage(peer, { message: item.text });
        item.published = true;
        results.push(`✅ ${item.formatName}: published at ${item.publishTime ?? "now"}`);
        console.log(`  ✅ ${item.formatName} published\n`);

        // Track bets for result checking
        if (item.bets && item.bets.length > 0) {
          trackPublishedBets(item);
        }
      } catch (err) {
        results.push(`❌ ${item.formatName}: ${err}`);
        console.error(`  ❌ ${item.formatName} failed:`, err);
      }
    }

    const summary = results.join("\n");
    console.log(`\n📊 Publish summary:\n${summary}`);

    return {
      publishResult: summary,
      contentItems: contentItems.map((ci) => {
        const published = sorted.find((s) => s.formatSlug === ci.formatSlug);
        return { ...ci, published: published?.published ?? ci.published };
      }),
    };
  } catch (err) {
    console.error("❌ Failed to connect to Telegram:", err);
    return { publishResult: `error: ${err}` };
  } finally {
    await client.disconnect();
  }
}

/**
 * Waits until the specified time (HH:MM) today.
 * If the time has already passed, publishes immediately.
 */
async function waitUntil(timeStr: string, formatName: string): Promise<void> {
  const [hours, minutes] = timeStr.split(":").map(Number);
  const now = new Date();
  const target = new Date();
  target.setHours(hours, minutes, 0, 0);

  const diffMs = target.getTime() - now.getTime();

  if (diffMs <= 0) {
    console.log(`  ⏰ ${formatName}: scheduled for ${timeStr}, already passed — publishing now`);
    return;
  }

  const diffMin = Math.round(diffMs / 60000);
  const diffH = Math.floor(diffMin / 60);
  const remMin = diffMin % 60;
  const waitLabel = diffH > 0 ? `${diffH}h ${remMin}m` : `${remMin}m`;

  console.log(`  ⏳ ${formatName}: waiting until ${timeStr} (${waitLabel} from now)...`);
  await new Promise((resolve) => setTimeout(resolve, diffMs));
  console.log(`  ⏰ ${formatName}: it's ${timeStr} — publishing now`);
}

/**
 * Saves published bets to the tracker for later result checking.
 */
function trackPublishedBets(item: ContentItem): void {
  const today = new Date().toISOString().split("T")[0];
  const slipId = `${today}_${item.formatSlug}`;

  const tracked: TrackedBet[] = (item.bets ?? []).map((bet, i) => ({
    id: `${today}_${item.formatSlug}_${i}`,
    slipId,
    date: today,
    formatSlug: item.formatSlug,
    formatName: item.formatName,
    postText: item.text,
    homeTeam: bet.homeTeam,
    awayTeam: bet.awayTeam,
    league: bet.league,
    kickoff: bet.kickoff,
    selection: bet.selection,
    odds: bet.odds,
  }));

  addBets(tracked);
  console.log(`  📊 ${tracked.length} bet(s) saved to tracker`);
}
