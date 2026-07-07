/**
 * EXAMPLE portfolio — safe, fake data only. Do not put real listings here:
 * this file is committed and the repo is public.
 *
 * The real portfolio lives in lib/portfolio.local.json (gitignored). When that
 * file exists, prisma/import-portfolio.ts loads it instead of these examples.
 * Import/re-import any time with:  npm run import:portfolio  (idempotent — upserts by icalUrl)
 *
 * Rules applied by prisma/import-portfolio.ts:
 * - nickname, address, listingTitle are authoritative here and overwrite the DB row.
 * - ownerName and costDollars apply only when a property is first created;
 *   costs and owners already set in the app are never overwritten.
 * - costDollars: null = price unknown → created INACTIVE so sync cannot
 *   snapshot wrong job costs. Set the real cost in the UI, then activate.
 */
export type PortfolioEntry = {
  nickname: string;
  listingTitle: string;
  address: string;
  icalUrl: string;
  ownerName: string;
  costDollars: number | null;
  note?: string;
};

export const examplePortfolio: PortfolioEntry[] = [
  {
    nickname: "Sunset Loft",
    listingTitle: "Bright Downtown Loft, 5 Mins To Everything!",
    address: "142 Sunset Blvd, Apt 3B",
    icalUrl: "https://www.airbnb.com/calendar/ical/00000001.ics?s=EXAMPLE-TOKEN-1",
    ownerName: "David Kim",
    costDollars: 65,
  },
  {
    nickname: "Palm Villa",
    listingTitle: "Spacious Villa With Pool + Free Parking",
    address: "88 Palm Grove Dr",
    icalUrl: "https://www.airbnb.com/calendar/ical/00000002.ics?s=EXAMPLE-TOKEN-2",
    ownerName: "David Kim",
    costDollars: 90,
  },
  {
    nickname: "Marina Studio",
    listingTitle: "Cozy Studio Steps From The Marina",
    address: "7 Marina Walk, Unit 12",
    icalUrl: "https://www.airbnb.com/calendar/ical/00000003.ics?s=EXAMPLE-TOKEN-3",
    ownerName: "Elena Rossi",
    costDollars: null,
  },
];
