import "dotenv/config";
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions";
import { ConnectionTCPFull } from "telegram/network";
import bigInt from "big-integer";

/**
 * Resolve a channel identifier from various formats:
 *  - Telegram Web URL: https://web.telegram.org/k/#-1001259302052
 *  - t.me link: https://t.me/channelname
 *  - @username: @channelname
 *  - Numeric ID: 1259302052
 */
export function resolvePeer(channel: string): string | Api.PeerChannel {
  // Telegram Web URL → extract numeric ID (the `-` prefix means it's a channel/group)
  const webMatch = channel.match(/web\.telegram\.org\/.*#-?(\d+)/);
  if (webMatch) {
    return new Api.PeerChannel({ channelId: bigInt(webMatch[1]) });
  }

  // t.me link → extract username
  const tmeMatch = channel.match(/t\.me\/([a-zA-Z0-9_]+)/);
  if (tmeMatch) {
    return `@${tmeMatch[1]}`;
  }

  // Pure numeric ID → treat as channel
  if (/^\d+$/.test(channel)) {
    return new Api.PeerChannel({ channelId: bigInt(channel) });
  }

  // Already an @username or other string
  return channel;
}

/**
 * Create and connect a Telegram client using credentials from environment variables.
 * Suppresses the GramJS update loop to avoid TIMEOUT errors.
 */
export async function createTelegramClient(): Promise<TelegramClient> {
  const apiId = parseInt(process.env.TELEGRAM_API_ID ?? "");
  const apiHash = process.env.TELEGRAM_API_HASH ?? "";
  const sessionStr = process.env.TELEGRAM_SESSION ?? "";

  if (!apiId || !apiHash || !sessionStr) {
    throw new Error(
      "Missing TELEGRAM_API_ID, TELEGRAM_API_HASH or TELEGRAM_SESSION in environment.\n" +
        "Run: npx tsx src/setup-telegram.ts"
    );
  }

  const client = new TelegramClient(new StringSession(sessionStr), apiId, apiHash, {
    connectionRetries: 5,
    connection: ConnectionTCPFull,
  });

  // Prevent GramJS update loop from starting (not needed, causes TIMEOUT errors)
  (client as any)._loopStarted = true;
  await client.connect();

  return client;
}
