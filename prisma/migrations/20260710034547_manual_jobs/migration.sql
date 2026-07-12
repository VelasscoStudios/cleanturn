-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookingId" TEXT,
    "propertyId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "costCents" INTEGER NOT NULL,
    "cleanerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'unassigned',
    "sameDayTurnover" BOOLEAN NOT NULL DEFAULT false,
    "nextCheckinNote" TEXT,
    "arrivedAt" DATETIME,
    "leftAt" DATETIME,
    "cleanedAt" DATETIME,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "paidAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Job_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Job_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Job_cleanerId_fkey" FOREIGN KEY ("cleanerId") REFERENCES "Cleaner" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Job" ("arrivedAt", "bookingId", "cleanedAt", "cleanerId", "costCents", "createdAt", "date", "id", "leftAt", "nextCheckinNote", "paid", "paidAt", "propertyId", "sameDayTurnover", "status", "updatedAt") SELECT "arrivedAt", "bookingId", "cleanedAt", "cleanerId", "costCents", "createdAt", "date", "id", "leftAt", "nextCheckinNote", "paid", "paidAt", "propertyId", "sameDayTurnover", "status", "updatedAt" FROM "Job";
DROP TABLE "Job";
ALTER TABLE "new_Job" RENAME TO "Job";
CREATE UNIQUE INDEX "Job_bookingId_key" ON "Job"("bookingId");
CREATE INDEX "Job_date_idx" ON "Job"("date");
CREATE INDEX "Job_cleanerId_date_idx" ON "Job"("cleanerId", "date");
CREATE INDEX "Job_status_paid_idx" ON "Job"("status", "paid");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
