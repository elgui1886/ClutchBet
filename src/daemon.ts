import "dotenv/config";
import cron from "node-cron";
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  hasContentForDate,
  getPendingContent,
  expireOldContent,
} from "./shared/content-store.js";

// ── Profile argument ─────────────────────────────────────────

const profileArg = process.argv.find((a) => a.startsWith("--profile="));
if (!profileArg) {
  console.error(
    "❌ Missing --profile argument.\n\n" +
      "Usage:\n" +
      "  npx tsx src/daemon.ts --profile=config/profiles/il-capitano.yaml\n" +
      "  pm2 start ecosystem.config.cjs\n"
  );
  process.exit(1);
}

const PROFILE_PATH = profileArg.split("=")[1];
if (!fs.existsSync(PROFILE_PATH)) {
  console.error(`❌ Profile not found: ${PROFILE_PATH}`);
  process.exit(1);
}

const PROFILE_NAME = path.basename(PROFILE_PATH, ".yaml");

// ── Configuration ────────────────────────────────────────────

/** Cron expression for daily content generation (default: 08:00) */
const CONTENT_CRON = process.env.DAEMON_CONTENT_CRON ?? "0 8 * * *";

/** Delay (ms) after content generation before starting the results watcher */
const WATCHER_DELAY_MS = 5 * 60 * 1000; // 5 minutes

// ── State ────────────────────────────────────────────────────

let activeWatcher: ChildProcess | null = null;
let isRunning = false;

// ── Logging ──────────────────────────────────────────────────

function log(msg: string): void {
  const ts = new Date().toLocaleString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  console.log(`[${ts}] [${PROFILE_NAME}] ${msg}`);
}

// ── Child process helpers ────────────────────────────────────

function runCommand(script: string, args: string[] = []): Promise<number> {
  return new Promise((resolve, reject) => {
    const fullArgs = ["tsx", script, ...args];
    log(`  ▶ npx ${fullArgs.join(" ")}`);

    const child = spawn("npx", fullArgs, {
      stdio: "inherit",
      cwd: process.cwd(),
      shell: true,
    });

    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

function startWatcher(): void {
  log(`👀 Starting results watcher...`);

  const watcher = spawn("npx", ["tsx", "src/watch-results.ts", `--profile=${PROFILE_PATH}`], {
    stdio: "inherit",
    cwd: process.cwd(),
    shell: true,
  });

  watcher.on("exit", (code) => {
    log(`👀 Watcher exited (code: ${code})`);
    activeWatcher = null;
  });

  watcher.on("error", (err) => {
    log(`❌ Watcher error: ${err.message}`);
    activeWatcher = null;
  });

  activeWatcher = watcher;
}

function stopWatcher(): void {
  if (activeWatcher && !activeWatcher.killed) {
    activeWatcher.kill("SIGTERM");
  }
  activeWatcher = null;
}

// ── Helpers ──────────────────────────────────────────────────

function today(): string {
  return new Date().toISOString().split("T")[0];
}

// ── Daily orchestration ──────────────────────────────────────

async function dailyRun(): Promise<void> {
  if (isRunning) {
    log("⚠️  Previous daily run still in progress. Skipping.");
    return;
  }

  isRunning = true;

  try {
    const date = today();

    // Expire old content from previous days
    const expired = expireOldContent(date);
    if (expired > 0) {
      log(`🧹 Expired ${expired} old content queue item(s) from previous days.`);
    }

    // Check if content was already generated today
    if (hasContentForDate(PROFILE_NAME, date)) {
      const pending = getPendingContent(PROFILE_NAME, date);
      if (pending.length > 0) {
        log(`🔄 ${pending.length} unpublished item(s) found. Resuming...`);
        try {
          const exitCode = await runCommand("src/index.ts", [
            "content",
            `--profile=${PROFILE_PATH}`,
            "--resume",
          ]);
          if (exitCode === 0) {
            log(`✅ Resume publishing completed.`);
          } else {
            log(`⚠️  Resume exited with code ${exitCode}`);
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          log(`❌ Resume failed: ${msg}`);
        }
      } else {
        log(`✅ All content for today already published. Skipping.`);
      }
    } else {
      // Normal flow: generate + publish
      log(`🚀 Starting content generation...`);

      try {
        const exitCode = await runCommand("src/index.ts", [
          "content",
          `--profile=${PROFILE_PATH}`,
        ]);

        if (exitCode === 0) {
          log(`✅ Content generation completed.`);
        } else {
          log(`⚠️  Content generation exited with code ${exitCode}`);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`❌ Content generation failed: ${msg}`);
      }
    }

    // Start results watcher after a short delay
    log(`⏳ Starting results watcher in ${WATCHER_DELAY_MS / 60_000} minutes...`);
    setTimeout(() => {
      stopWatcher();
      startWatcher();
    }, WATCHER_DELAY_MS);
  } finally {
    isRunning = false;
  }
}

// ── Main ─────────────────────────────────────────────────────

async function main(): Promise<void> {
  log("════════════════════════════════════════════════════");
  log(`🤖 ClutchBet Daemon — ${PROFILE_NAME}`);
  log("════════════════════════════════════════════════════");

  const date = today();
  log(`📅 Content cron: ${CONTENT_CRON} (Europe/Rome)`);
  log(`📋 Profile: ${PROFILE_PATH}`);
  log("");

  // Expire old content from previous days
  const expired = expireOldContent(date);
  if (expired > 0) {
    log(`🧹 Expired ${expired} old content queue item(s).`);
  }

  // Check for unpublished content from today (resume after crash/restart)
  if (hasContentForDate(PROFILE_NAME, date)) {
    const pending = getPendingContent(PROFILE_NAME, date);
    if (pending.length > 0) {
      log(`🔄 Found ${pending.length} unpublished item(s) from today. Resuming...`);
      try {
        const code = await runCommand("src/index.ts", [
          "content",
          `--profile=${PROFILE_PATH}`,
          "--resume",
        ]);
        if (code === 0) log(`✅ Resume publishing completed.`);
        else log(`⚠️  Resume exited with code ${code}`);
      } catch (err) {
        log(`❌ Resume failed: ${err}`);
      }
    } else {
      log(`✅ All content for today already published.`);
    }
  }

  // Validate cron
  if (!cron.validate(CONTENT_CRON)) {
    log(`❌ Invalid cron expression: "${CONTENT_CRON}"`);
    process.exit(1);
  }

  // Schedule daily run
  cron.schedule(
    CONTENT_CRON,
    () => {
      log("\n⏰ Cron triggered: daily run");
      dailyRun().catch((err) => {
        log(`❌ Daily run failed: ${err}`);
      });
    },
    { timezone: "Europe/Rome" }
  );

  log(`⏳ Waiting for next scheduled run...`);
  log("   Press Ctrl+C to stop.\n");

  // Support --now flag to trigger an immediate run (useful for testing)
  if (process.argv.includes("--now")) {
    log("🔧 --now flag detected: triggering immediate run\n");
    dailyRun().catch((err) => {
      log(`❌ Immediate run failed: ${err}`);
    });
  }

  // Graceful shutdown
  const shutdown = () => {
    log("\n🛑 Shutting down daemon...");
    stopWatcher();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
