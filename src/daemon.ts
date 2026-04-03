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

// ── Configuration ────────────────────────────────────────────

/** Cron expression for daily content generation (default: 08:00) */
const CONTENT_CRON = process.env.DAEMON_CONTENT_CRON ?? "0 8 * * *";

/** Delay (ms) after content generation before starting the results watcher */
const WATCHER_DELAY_MS = 5 * 60 * 1000; // 5 minutes

// ── State ────────────────────────────────────────────────────

let activeWatchers: ChildProcess[] = [];
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
  console.log(`[${ts}] ${msg}`);
}

// ── Profile discovery ────────────────────────────────────────

function discoverProfiles(): string[] {
  const dir = path.resolve("config", "profiles");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => path.join("config", "profiles", f));
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

function startWatcher(profilePath: string): void {
  const name = path.basename(profilePath, ".yaml");
  log(`👀 [${name}] Starting results watcher...`);

  const watcher = spawn("npx", ["tsx", "src/watch-results.ts", `--profile=${profilePath}`], {
    stdio: "inherit",
    cwd: process.cwd(),
    shell: true,
  });

  watcher.on("exit", (code) => {
    log(`👀 [${name}] Watcher exited (code: ${code})`);
    activeWatchers = activeWatchers.filter((w) => w !== watcher);
  });

  watcher.on("error", (err) => {
    log(`❌ [${name}] Watcher error: ${err.message}`);
    activeWatchers = activeWatchers.filter((w) => w !== watcher);
  });

  activeWatchers.push(watcher);
}

function stopAllWatchers(): void {
  for (const w of activeWatchers) {
    if (!w.killed) w.kill("SIGTERM");
  }
  activeWatchers = [];
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
    const profiles = discoverProfiles();
    if (profiles.length === 0) {
      log("⚠️  No profiles found in config/profiles/. Skipping.");
      return;
    }

    const date = today();

    // Expire old content from previous days
    const expired = expireOldContent(date);
    if (expired > 0) {
      log(`🧹 Expired ${expired} old content queue item(s) from previous days.`);
    }

    log(
      `📋 Found ${profiles.length} profile(s): ${profiles.map((p) => path.basename(p, ".yaml")).join(", ")}`
    );

    for (const profilePath of profiles) {
      const name = path.basename(profilePath, ".yaml");

      // Check if content was already generated today
      if (hasContentForDate(name, date)) {
        const pending = getPendingContent(name, date);
        if (pending.length > 0) {
          log(`\n🔄 [${name}] ${pending.length} unpublished item(s) found. Resuming...`);
          try {
            const exitCode = await runCommand("src/index.ts", [
              "content",
              `--profile=${profilePath}`,
              "--resume",
            ]);
            if (exitCode === 0) {
              log(`✅ [${name}] Resume publishing completed.`);
            } else {
              log(`⚠️  [${name}] Resume exited with code ${exitCode}`);
            }
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            log(`❌ [${name}] Resume failed: ${msg}`);
          }
        } else {
          log(`\n✅ [${name}] All content for today already published. Skipping.`);
        }
        continue;
      }

      // Normal flow: generate + publish
      log(`\n🚀 [${name}] Starting content generation...`);

      try {
        const exitCode = await runCommand("src/index.ts", [
          "content",
          `--profile=${profilePath}`,
        ]);

        if (exitCode === 0) {
          log(`✅ [${name}] Content generation completed.`);
        } else {
          log(`⚠️  [${name}] Content generation exited with code ${exitCode}`);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`❌ [${name}] Content generation failed: ${msg}`);
      }
    }

    // Start results watchers after a short delay (one per profile)
    // (gives time for bets to be saved to DB)
    log(`\n⏳ Starting results watchers in ${WATCHER_DELAY_MS / 60_000} minutes...`);
    setTimeout(() => {
      stopAllWatchers();
      for (const profilePath of profiles) {
        startWatcher(profilePath);
      }
    }, WATCHER_DELAY_MS);
  } finally {
    isRunning = false;
  }
}

// ── Main ─────────────────────────────────────────────────────

function main(): void {
  log("════════════════════════════════════════════════════");
  log("🤖 ClutchBet Daemon");
  log("════════════════════════════════════════════════════");

  const profiles = discoverProfiles();
  const date = today();
  log(`📅 Content cron: ${CONTENT_CRON} (Europe/Rome)`);
  log(
    `📋 Profiles: ${profiles.length > 0 ? profiles.map((p) => path.basename(p, ".yaml")).join(", ") : "none found"}`
  );
  log("");

  // Expire old content from previous days
  const expired = expireOldContent(date);
  if (expired > 0) {
    log(`🧹 Expired ${expired} old content queue item(s).`);
  }

  // Check for unpublished content from today (resume after crash/restart)
  for (const profilePath of profiles) {
    const name = path.basename(profilePath, ".yaml");
    if (hasContentForDate(name, date)) {
      const pending = getPendingContent(name, date);
      if (pending.length > 0) {
        log(`🔄 [${name}] Found ${pending.length} unpublished item(s) from today. Resuming...`);
        runCommand("src/index.ts", ["content", `--profile=${profilePath}`, "--resume"])
          .then((code) => {
            if (code === 0) log(`✅ [${name}] Resume publishing completed.`);
            else log(`⚠️  [${name}] Resume exited with code ${code}`);
          })
          .catch((err) => log(`❌ [${name}] Resume failed: ${err}`));
      } else {
        log(`✅ [${name}] All content for today already published.`);
      }
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
    stopAllWatchers();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
