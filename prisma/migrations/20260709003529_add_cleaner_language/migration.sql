-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Cleaner" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "pinHash" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Cleaner" ("active", "createdAt", "email", "id", "name", "phone", "pinHash") SELECT "active", "createdAt", "email", "id", "name", "phone", "pinHash" FROM "Cleaner";
DROP TABLE "Cleaner";
ALTER TABLE "new_Cleaner" RENAME TO "Cleaner";
CREATE UNIQUE INDEX "Cleaner_phone_key" ON "Cleaner"("phone");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
