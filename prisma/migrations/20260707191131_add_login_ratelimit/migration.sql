-- CreateTable
CREATE TABLE "LoginRateLimit" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "count" INTEGER NOT NULL,
    "windowStart" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL
);
