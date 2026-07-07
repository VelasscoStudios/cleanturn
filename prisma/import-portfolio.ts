/**
 * Idempotent portfolio import — upserts the portfolio into the database.
 * Run with:  npm run import:portfolio
 *
 * Data source: lib/portfolio.local.json when it exists (the real portfolio,
 * gitignored — see the example shape in lib/portfolio.ts); otherwise the
 * committed fake examples in lib/portfolio.ts.
 *
 * Existing properties (matched by icalUrl): nickname + address are updated
 * from the portfolio file; notes get the listing title only when empty;
 * cost, owner, times, access codes and active flag are left untouched.
 * New properties: created with the file's owner + cost; entries without a
 * cost are created INACTIVE so a sync can't snapshot $0 jobs.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { examplePortfolio, type PortfolioEntry } from "../lib/portfolio";

const prisma = new PrismaClient();

const LOCAL_PORTFOLIO_PATH = join(__dirname, "..", "lib", "portfolio.local.json");

const portfolioFileSchema = z.object({
  entries: z.array(
    z.object({
      nickname: z.string().min(1),
      listingTitle: z.string(),
      address: z.string().min(1),
      icalUrl: z.string().url(),
      ownerName: z.string().min(1),
      costDollars: z.number().nullable(),
      note: z.string().optional(),
    }),
  ),
});

function loadPortfolio(): PortfolioEntry[] {
  let raw: string;
  try {
    raw = readFileSync(LOCAL_PORTFOLIO_PATH, "utf8");
  } catch {
    console.warn(
      "lib/portfolio.local.json not found — importing the fake EXAMPLE portfolio " +
        "from lib/portfolio.ts. Create the local file for real data.",
    );
    return examplePortfolio;
  }
  const parsed = portfolioFileSchema.parse(JSON.parse(raw));
  console.log(`Loaded ${parsed.entries.length} entries from lib/portfolio.local.json`);
  return parsed.entries;
}

async function main() {
  const portfolio = loadPortfolio();

  const owners = await prisma.owner.findMany();
  if (owners.length === 0) {
    throw new Error("No owners exist — create one in the Owners tab first.");
  }
  const fallbackOwner = owners[0];

  let created = 0;
  let updated = 0;

  for (const entry of portfolio) {
    const existing = await prisma.property.findUnique({
      where: { icalUrl: entry.icalUrl },
    });

    if (existing) {
      await prisma.property.update({
        where: { id: existing.id },
        data: {
          nickname: entry.nickname,
          address: entry.address,
          ...(existing.notes === "" ? { notes: `Airbnb listing: ${entry.listingTitle}` } : {}),
        },
      });
      updated++;
      const renamed =
        existing.nickname !== entry.nickname
          ? `  (renamed from "${existing.nickname}")`
          : "";
      console.log(`updated  ${entry.nickname}${renamed}`);
    } else {
      const owner = owners.find((o) => o.name === entry.ownerName) ?? fallbackOwner;
      const priced = entry.costDollars !== null;
      await prisma.property.create({
        data: {
          nickname: entry.nickname,
          address: entry.address,
          icalUrl: entry.icalUrl,
          ownerId: owner.id,
          cleanCostCents: priced ? Math.round(entry.costDollars! * 100) : 0,
          active: priced,
          arriveTime: "11:00",
          outByTime: "16:00",
          notes: `Airbnb listing: ${entry.listingTitle}`,
        },
      });
      created++;
      console.log(
        `created  ${entry.nickname}  → owner ${owner.name}` +
          (priced
            ? `, $${entry.costDollars}/clean`
            : "  [INACTIVE — set cost in the UI, then activate]"),
      );
    }
  }

  console.log(`\nDone: ${created} created, ${updated} updated.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
