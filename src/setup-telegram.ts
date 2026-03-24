/**
 * One-time script to authenticate with Telegram and obtain a session string.
 *
 * Usage:
 *   1. Set TELEGRAM_API_ID and TELEGRAM_API_HASH in your .env file
 *   2. Run: npx tsx src/setup-telegram.ts
 *   3. Follow the prompts (phone number + OTP, optional 2FA password)
 *   4. Copy the printed session string into your .env as TELEGRAM_SESSION
 */

import "dotenv/config";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { ConnectionTCPFull } from "telegram/network";
import * as readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(prompt: string): Promise<string> {
  return new Promise((resolve) => rl.question(prompt, (answer) => resolve(answer.trim())));
}

async function main() {
  const apiId = parseInt(process.env.TELEGRAM_API_ID ?? "");
  const apiHash = process.env.TELEGRAM_API_HASH ?? "";

  if (!apiId || !apiHash) {
    console.error("❌ Missing TELEGRAM_API_ID or TELEGRAM_API_HASH in .env");
    console.error("   Get them from: https://my.telegram.org → API development tools");
    process.exit(1);
  }

  console.log("🔐 Starting Telegram authentication...\n");

  const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
    connectionRetries: 5,
    connection: ConnectionTCPFull,
  });

  await client.start({
    phoneNumber: () => ask("📱 Phone number (with country code, e.g. +39...): "),
    phoneCode: () => ask("📩 OTP code received via Telegram: "),
    password: () => ask("🔑 2FA password (press Enter to skip): "),
    onError: (err) => console.error("Auth error:", err),
  });

  const sessionString = (client.session as StringSession).save();

  console.log("\n✅ Authentication successful!");
  console.log("\nAdd the following line to your .env file:\n");
  console.log(`TELEGRAM_SESSION=${sessionString}`);
  console.log("\n");

  rl.close();
  await client.disconnect();
}

main().catch((err) => {
  console.error("❌ Setup failed:", err);
  process.exit(1);
});
