import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { ConnectionTCPFull } from "telegram/network";

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

  await client.connect();
  return client;
}
