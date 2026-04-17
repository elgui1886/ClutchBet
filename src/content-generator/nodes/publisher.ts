import "dotenv/config";
import { CustomFile } from "telegram/client/uploads";
import { createTelegramClient, resolvePeer } from "../../shared/telegram-utils.js";
import { addBets, profileSlugFromPath, type TrackedBet } from "../../shared/bet-tracker.js";
import {
  saveContentItems,
  markContentPublished,
  updateContentGenerated,
  contentItemId,
} from "../../shared/content-store.js";
import { generateSingleFormat } from "./content-writer.js";
import { fetchOfficialLineups } from "./data-fetcher.js";
import type { ContentStateType, ContentItem, Fixture } from "../state.js";

const MAX_CAPTION = 1024;

/**
 * Publisher node — waits for each scheduled time slot, generates content
 * just-in-time, then sends to Telegram.
 *
 * Content is NOT pre-generated. At each time slot:
 * 1. Wait until the scheduled publish time
 * 2. Generate content for that format (LLM call, bet extraction, image rendering)
 * 3. Save generated content to DB
 * 4. Publish to Telegram
 *
 * This ensures lineup-dependent formats (marcatori, cartellini) use the most
 * current data, avoiding the risk of citing players who subsequently don't play.
 */
export async function publisherNode(
  state: ContentStateType
): Promise<Partial<ContentStateType>> {
  const { contentItems, publishChannel, reviewBeforePublish, profilePath, timezone, profile, fixtures } = state;
  const profileSlug = profileSlugFromPath(profilePath);
  const tz = timezone || "Europe/Rome";

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

  // Persist plan items to DB before publishing (survives restarts)
  const today = state.date || new Date().toISOString().split("T")[0];
  saveContentItems(sorted, profileSlug, today);
  console.log(`💾 ${sorted.length} plan item(s) saved to content store`);

  console.log(`\n📤 Just-in-time publishing to: ${publishChannel}`);
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
        await waitUntil(item.publishTime, item.formatName, tz);
      }

      try {
        // ── Just-in-time content generation ──
        if (!item.text) {
          const format = profile?.formats.find((f) => f.slug === item.formatSlug);
          if (!format) {
            console.log(`  ⚠️  Format "${item.formatSlug}" not found in profile. Skipping.`);
            results.push(`⚠️ ${item.formatName}: format not found, skipped`);
            continue;
          }

          console.log(`\n  🔄 Generating content just-in-time for: ${item.formatName}...`);
          try {
            // For lineup-dependent formats, wait for official lineups before generating.
            // Publishing with squad data (not confirmed starters) risks citing non-playing players.
            if (format.publish_before_match) {
              const lineupStatus = await waitForOfficialLineups(fixtures, item.formatName);
              if (lineupStatus === "timeout") {
                console.log(`  ⏭️  ${item.formatName}: skipped — official lineups not released in time.`);
                results.push(`⏭️ ${item.formatName}: skipped — official lineups not released`);
                continue;
              }
              if (lineupStatus === "unavailable") {
                console.log(`  ⚠️  ${item.formatName}: proceeding with squad data (FD lineup check unavailable).`);
              }
            }

            const generated = await generateSingleFormat(
              format,
              profile!,
              profilePath,
              fixtures,
            );
            item.text = generated.text;
            item.imageBase64 = generated.imageBase64;
            item.bets = generated.bets;

            // Update the DB record with generated content
            updateContentGenerated(
              contentItemId(today, profileSlug, item.formatSlug),
              generated.text,
              generated.imageBase64,
              generated.bets ? JSON.stringify(generated.bets) : undefined,
            );
          } catch (genErr) {
            console.error(`  ❌ Content generation failed for ${item.formatName}:`, genErr);
            results.push(`❌ ${item.formatName}: generation failed — ${genErr}`);
            continue;
          }
        }

        console.log(`  📨 Sending: ${item.formatName}...`);

        if (item.imageBase64) {
          const imageBuffer = Buffer.from(item.imageBase64, "base64");
          const file = new CustomFile("post.png", imageBuffer.length, "", imageBuffer);

          if (item.text.length <= MAX_CAPTION) {
            await client.sendFile(peer, { file, caption: item.text });
          } else {
            await client.sendFile(peer, { file });
            await client.sendMessage(peer, { message: item.text });
          }
        } else {
          await client.sendMessage(peer, { message: item.text });
        }

        item.published = true;
        markContentPublished(contentItemId(today, profileSlug, item.formatSlug));
        results.push(`✅ ${item.formatName}: published at ${item.publishTime ?? "now"}${item.imageBase64 ? " (with image)" : ""}`);
        console.log(`  ✅ ${item.formatName} published${item.imageBase64 ? " (with image)" : ""}\n`);

        // Track bets for result checking
        if (item.bets && item.bets.length > 0) {
          trackPublishedBets(item, profileSlug);
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
 * Returns the current hours and minutes in the given IANA timezone.
 */
function nowInTimezone(tz: string): { hours: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  const hours = Number(parts.find((p) => p.type === "hour")!.value);
  const minutes = Number(parts.find((p) => p.type === "minute")!.value);
  return { hours, minutes };
}

/**
 * Waits until the specified time (HH:MM) in the given timezone.
 * If the time has already passed, publishes immediately.
 */
async function waitUntil(timeStr: string, formatName: string, tz: string): Promise<void> {
  const [targetH, targetM] = timeStr.split(":").map(Number);
  const { hours: nowH, minutes: nowM } = nowInTimezone(tz);

  const targetMinutes = targetH * 60 + targetM;
  const nowMinutes = nowH * 60 + nowM;
  const diffMin = targetMinutes - nowMinutes;

  if (diffMin <= 0) {
    console.log(`  ⏰ ${formatName}: scheduled for ${timeStr} (${tz}), already passed — publishing now`);
    return;
  }

  const diffMs = diffMin * 60 * 1000;
  const diffH = Math.floor(diffMin / 60);
  const remMin = diffMin % 60;
  const waitLabel = diffH > 0 ? `${diffH}h ${remMin}m` : `${remMin}m`;

  console.log(`  ⏳ ${formatName}: waiting until ${timeStr} (${tz}, ${waitLabel} from now)...`);
  await new Promise((resolve) => setTimeout(resolve, diffMs));
  console.log(`  ⏰ ${formatName}: it's ${timeStr} (${tz}) — publishing now`);
}

/**
 * Waits for official lineups to be released by football-data.org.
 * Polls every 5 minutes, up to 30 minutes.
 *
 * Returns:
 * - "confirmed"   → official lineups loaded into fixtures (safe to generate)
 * - "unavailable" → no FD API key or no match IDs (proceed with squad data + warning)
 * - "timeout"     → lineups not released after 30 min (skip the format)
 */
async function waitForOfficialLineups(
  fixtures: Fixture[],
  formatName: string,
): Promise<"confirmed" | "unavailable" | "timeout"> {
  const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  const MAX_WAIT_MIN = 30;

  // Already confirmed from a previous format's check
  if (fixtures.some((f) => f.hasOfficialLineup)) {
    console.log(`  ✅ Official lineups already confirmed.`);
    return "confirmed";
  }

  const hasFDKey = !!process.env.FOOTBALL_DATA_API_KEY;
  const hasMatchIds = fixtures.some((f) => f.sport !== "tennis" && f.fdMatchId);

  if (!hasFDKey || !hasMatchIds) {
    console.log(
      `  ⚠️  Lineup check unavailable for ${formatName}: ` +
        (!hasFDKey ? "FOOTBALL_DATA_API_KEY not set." : "no FD match IDs found."),
    );
    return "unavailable";
  }

  console.log(`  🔍 Checking official lineups for ${formatName}...`);

  const startMs = Date.now();
  const maxMs = MAX_WAIT_MIN * 60 * 1000;

  // First immediate attempt
  const gotLineups = await fetchOfficialLineups(fixtures);
  if (gotLineups) {
    console.log(`  ✅ Official lineups confirmed.`);
    return "confirmed";
  }

  // Poll until lineups are released or timeout
  while (Date.now() - startMs < maxMs) {
    const waitedMin = Math.round((Date.now() - startMs) / 60000);
    console.log(
      `  ⏳ Lineups not yet released for ${formatName} (${waitedMin}/${MAX_WAIT_MIN} min). Retrying in 5 min...`,
    );
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    const got = await fetchOfficialLineups(fixtures);
    if (got) {
      const elapsed = Math.round((Date.now() - startMs) / 60000);
      console.log(`  ✅ Official lineups confirmed after ~${elapsed} min.`);
      return "confirmed";
    }
  }

  console.log(`  ❌ Official lineups not released after ${MAX_WAIT_MIN} min. Skipping ${formatName}.`);
  return "timeout";
}

/**
 * Saves published bets to the tracker for later result checking.
 */
function trackPublishedBets(item: ContentItem, profileSlug: string): void {
  const today = new Date().toISOString().split("T")[0];
  const slipId = `${today}_${item.formatSlug}`;

  const tracked: TrackedBet[] = (item.bets ?? []).map((bet, i) => ({
    id: `${today}_${item.formatSlug}_${i}`,
    slipId,
    profile: profileSlug,
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
