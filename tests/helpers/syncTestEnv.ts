// Side-effect-only module: points DATABASE_URL at a throwaway SQLite file
// BEFORE anything imports "@/lib/db". Must be the FIRST import in the test
// file (see notesTestEnv.ts for why ordering works).
import os from "node:os";
import path from "node:path";

export const TEST_DB_PATH = path.join(
  os.tmpdir(),
  `cleanturn-test-sync-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);

process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
process.env.NOTIFICATIONS_ENABLED = "false";
process.env.APP_TIMEZONE = "America/Edmonton";
