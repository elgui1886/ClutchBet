import * as fs from "node:fs";
import * as path from "node:path";
import Database from "better-sqlite3";

const DATA_DIR = path.resolve("data");
const DB_PATH = path.join(DATA_DIR, "clutchbet.db");
const HISTORY_DIR = path.join(DATA_DIR, "content-history");

console.log("🧹 Reset ClutchBet — pulizia completa...\n");

// 1. Pulisci tabelle DB
if (fs.existsSync(DB_PATH)) {
  const db = new Database(DB_PATH);
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all() as Array<{ name: string }>;

  for (const { name } of tables) {
    db.exec(`DELETE FROM "${name}"`);
    console.log(`  🗑️  Tabella "${name}" svuotata`);
  }
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.exec("VACUUM");
  db.close();
  console.log("  ✅ Database pulito\n");
} else {
  console.log("  ℹ️  Nessun database trovato\n");
}

// 2. Pulisci content history
if (fs.existsSync(HISTORY_DIR)) {
  const files = fs.readdirSync(HISTORY_DIR).filter((f) => f.endsWith(".json"));
  for (const file of files) {
    fs.unlinkSync(path.join(HISTORY_DIR, file));
  }
  console.log(`  🗑️  ${files.length} file di storico contenuti rimossi`);
  console.log("  ✅ Content history pulito\n");
} else {
  console.log("  ℹ️  Nessun content history trovato\n");
}

console.log("🔄 Reset completato. Foglio bianco!");
