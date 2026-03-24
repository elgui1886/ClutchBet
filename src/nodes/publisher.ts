import "dotenv/config";
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions";
import { ConnectionTCPFull } from "telegram/network";
import { CustomFile } from "telegram/client/uploads";
import bigInt from "big-integer";
import type { WorkflowStateType } from "../state.js";

/**
 * Resolve a channel identifier from various formats (same logic as scraper).
 */
function resolvePeer(channel: string): string | Api.PeerChannel {
  const webMatch = channel.match(/web\.telegram\.org\/.*#-?(\d+)/);
  if (webMatch) {
    return new Api.PeerChannel({ channelId: bigInt(webMatch[1]) });
  }

  const tmeMatch = channel.match(/t\.me\/([a-zA-Z0-9_]+)/);
  if (tmeMatch) {
    return `@${tmeMatch[1]}`;
  }

  if (/^\d+$/.test(channel)) {
    return new Api.PeerChannel({ channelId: bigInt(channel) });
  }

  return channel;
}

export async function publisherNode(
  state: WorkflowStateType
): Promise<Partial<WorkflowStateType>> {
  const { generatedPost, publishChannel } = state;

  if (!publishChannel) {
    console.log("⚠️  No publish channel configured. Skipping publish.");
    return { publishResult: "skipped: no publishChannel configured" };
  }

  if (!generatedPost) {
    console.log("⚠️  No generated post to publish.");
    return { publishResult: "skipped: no generatedPost" };
  }

  const apiId = parseInt(process.env.TELEGRAM_API_ID ?? "");
  const apiHash = process.env.TELEGRAM_API_HASH ?? "";
  const sessionStr = process.env.TELEGRAM_SESSION ?? "";

  if (!apiId || !apiHash || !sessionStr) {
    throw new Error(
      "Missing TELEGRAM_API_ID, TELEGRAM_API_HASH or TELEGRAM_SESSION in environment."
    );
  }

  const client = new TelegramClient(new StringSession(sessionStr), apiId, apiHash, {
    connectionRetries: 5,
    connection: ConnectionTCPFull,
  });

  // Prevent GramJS update loop from starting (not needed, causes TIMEOUT errors)
  (client as any)._loopStarted = true;
  await client.connect();

  try {
    const peer = resolvePeer(publishChannel);
    console.log(`\n📤 Publishing to channel: ${publishChannel}`);

    const imageBuffer = Buffer.from(generatedPost.imageBase64, "base64");
    const fullText = generatedPost.text;
    const MAX_CAPTION = 1024;

    // Send image with caption (truncated if needed)
    const caption = fullText.length <= MAX_CAPTION
      ? fullText
      : fullText.slice(0, MAX_CAPTION - 3) + "...";

    await client.sendFile(peer, {
      file: new CustomFile("post.png", imageBuffer.length, "", imageBuffer),
      caption,
    });

    // If text was truncated, send the full text as a follow-up message
    if (fullText.length > MAX_CAPTION) {
      await client.sendMessage(peer, { message: fullText });
    }

    console.log("  ✅ Post published successfully!");
    return { publishResult: "published" };
  } catch (err) {
    console.error("  ❌ Failed to publish:", err);
    return { publishResult: `error: ${err}` };
  } finally {
    await client.disconnect();
  }
}
