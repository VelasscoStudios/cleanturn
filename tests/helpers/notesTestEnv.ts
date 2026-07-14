// Side-effect-only module: points DATABASE_URL at a throwaway SQLite file
// BEFORE anything imports "@/lib/db" (which constructs its PrismaClient
// singleton at module-load time, reading DATABASE_URL then). Must be the
// FIRST import in any test file that exercises real route handlers — ES
// module evaluation runs a leaf import's side effects before the importing
// file moves on to its next import, which is what gives us ordering here.
import os from "node:os";
import path from "node:path";

export const TEST_DB_PATH = path.join(
  os.tmpdir(),
  `cleanturn-test-notes-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);

process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
