/**
 * Utility script to list all Telegram channels and groups you're a member of.
 * Shows the display name and numeric ID you can use in channels.yaml.
 *
 * Usage:
 *   npx tsx src/list-channels.ts
 */

import "dotenv/config";
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions";
import { ConnectionTCPFull } from "telegram/network";

async function main() {
  const apiId = parseInt(process.env.TELEGRAM_API_ID ?? "");
  const apiHash = process.env.TELEGRAM_API_HASH ?? "";
  const sessionStr = process.env.TELEGRAM_SESSION ?? "";

  if (!apiId || !apiHash || !sessionStr) {
    console.error(
      "❌ Missing TELEGRAM_API_ID, TELEGRAM_API_HASH or TELEGRAM_SESSION in .env\n" +
        "   Run first: npx tsx src/setup-telegram.ts"
    );
    process.exit(1);
  }

  const client = new TelegramClient(new StringSession(sessionStr), apiId, apiHash, {
    connectionRetries: 5,
    connection: ConnectionTCPFull,
  });

  await client.connect();

  const dialogs = await client.getDialogs({ limit: 200 });

  console.log("\n📋 Your Telegram channels and groups:\n");
  console.log("─".repeat(80));
  console.log(`${"Type".padEnd(12)} ${"Name".padEnd(40)} ${"ID".padEnd(16)} Username`);
  console.log("─".repeat(80));

  for (const dialog of dialogs) {
    const entity = dialog.entity;
    if (!entity) continue;

    let type = "";
    let name = "";
    let id = "";
    let username = "";

    if (entity instanceof Api.Channel) {
      type = entity.megagroup ? "🔵 Group" : "📢 Channel";
      name = entity.title ?? "";
      id = entity.id.toString();
      username = entity.username ? `@${entity.username}` : "(no username)";
    } else if (entity instanceof Api.Chat) {
      type = "💬 Chat";
      name = entity.title ?? "";
      id = entity.id.toString();
      username = "(no username)";
    } else {
      continue; // skip users
    }

    console.log(`${type.padEnd(12)} ${name.slice(0, 38).padEnd(40)} ${id.padEnd(16)} ${username}`);
  }

  console.log("─".repeat(80));
  console.log("\n💡 Use the ID or @username in config/channels.yaml");
  console.log("   For channels without @username, use the numeric ID.\n");

  await client.disconnect();
}

main().catch((err) => {
  console.error("❌ Failed:", err);
  process.exit(1);
});
