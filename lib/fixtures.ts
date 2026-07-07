export type DemoOwner = {
  name: string;
  email: string;
  phone: string;
  billingNotes: string;
};

export type DemoPropertyKey =
  | "sunset-loft"
  | "palm-villa"
  | "marina-studio"
  | "old-town-2br"
  | "garden-house"
  | "beach-flat-5";

export type DemoProperty = {
  key: DemoPropertyKey;
  nickname: string;
  address: string;
  cleanCostCents: number;
  accessCode: string;
  arriveTime: string;
  outByTime: string;
  directions: string;
  notes: string;
  ownerName: string;
};

export const demoOwners: DemoOwner[] = [
  {
    name: "David Kim",
    email: "david.kim@mail.com",
    phone: "+1 555-0201",
    billingNotes: "Pays monthly by bank transfer",
  },
  {
    name: "Elena Rossi",
    email: "elena.r@mail.com",
    phone: "+1 555-0202",
    billingNotes: "Pays per clean, Revolut",
  },
  {
    name: "Mueller Family",
    email: "j.mueller@mail.com",
    phone: "+1 555-0203",
    billingNotes: "Invoice at month end",
  },
];

export const demoProperties: DemoProperty[] = [
  {
    key: "sunset-loft",
    nickname: "Sunset Loft",
    address: "142 Sunset Blvd, Apt 3B",
    cleanCostCents: 6500,
    accessCode: "Door 4821#",
    arriveTime: "11:00",
    outByTime: "15:00",
    directions: "Entrance on side street; free parking behind building",
    notes: "Linen in hall closet.",
    ownerName: "David Kim",
  },
  {
    key: "palm-villa",
    nickname: "Palm Villa",
    address: "88 Palm Grove Dr",
    cleanCostCents: 9000,
    accessCode: "Lockbox 0455",
    arriveTime: "10:00",
    outByTime: "14:00",
    directions: "Gravel driveway after the white fence; park inside gate",
    notes: "Pool towels ×6.",
    ownerName: "David Kim",
  },
  {
    key: "marina-studio",
    nickname: "Marina Studio",
    address: "7 Marina Walk, Unit 12",
    cleanCostCents: 5000,
    accessCode: "Fob at front desk",
    arriveTime: "10:00",
    outByTime: "15:00",
    directions: "Paid parking only — use marina lot, 2h free with fob",
    notes: "Ask desk for unit 12 fob.",
    ownerName: "Elena Rossi",
  },
  {
    key: "old-town-2br",
    nickname: "Old Town 2BR",
    address: "23 Cathedral Ln",
    cleanCostCents: 7500,
    accessCode: "Key safe 2210#",
    arriveTime: "11:00",
    outByTime: "16:00",
    directions: "Pedestrian street — park at Plaza garage, 5 min walk",
    notes: "Steep stairs — vacuum stays upstairs.",
    ownerName: "Elena Rossi",
  },
  {
    key: "garden-house",
    nickname: "Garden House",
    address: "310 Rosemary St",
    cleanCostCents: 8500,
    accessCode: "Gate 7712 / Door 3390#",
    arriveTime: "11:00",
    outByTime: "16:00",
    directions: "Blue gate behind the bakery; ring bell if code fails",
    notes: "Water plants on terrace.",
    ownerName: "Mueller Family",
  },
  {
    key: "beach-flat-5",
    nickname: "Beach Flat 5",
    address: "5 Shoreline Ave, #5",
    cleanCostCents: 6000,
    accessCode: "Lockbox 8841",
    arriveTime: "11:00",
    outByTime: "15:00",
    directions: "Street parking on Shoreline Ave; entrance faces beach",
    notes: "Sand: mop twice.",
    ownerName: "Mueller Family",
  },
];

export type DemoEvent = {
  uid: string;
  checkin: string; // YYYY-MM-DD
  checkout: string; // YYYY-MM-DD
};

function addDaysLocal(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + n);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * Deterministic offsets per property, relative to `today` (YYYY-MM-DD).
 * Designed so that across the portfolio there are at least 3 same-day
 * turnover pairs (one booking's checkout == another booking's checkin at
 * the same property).
 */
export function demoEvents(key: string, today: string): DemoEvent[] {
  const off = (n: number) => addDaysLocal(today, n);

  const plans: Record<string, [number, number][]> = {
    // [checkinOffset, checkoutOffset] pairs, chained so many checkouts
    // become the next booking's checkin (same-day turnover).
    "sunset-loft": [
      [-13, -9],
      [-9, -5],
      [-5, -1],
      [-1, 0], // checkout today; same-day with next
      [0, 3],
      [3, 6],
    ],
    "palm-villa": [
      [-12, -7],
      [-7, -3],
      [-3, 1],
      [1, 4],
    ],
    "marina-studio": [
      [-11, -6],
      [-6, -4],
      [-4, 0], // checkout today
      [0, 2], // same-day turnover with previous
      [2, 5],
    ],
    "old-town-2br": [
      [-10, -6],
      [-6, -2],
      [-2, 2],
      [2, 5],
    ],
    "garden-house": [
      [-14, -8],
      [-8, -3],
      [-3, 0], // checkout today
      [0, 4], // same-day turnover with previous
      [4, 6],
    ],
    "beach-flat-5": [
      [-9, -4],
      [-4, -1],
      [-1, 3],
      [3, 6],
    ],
  };

  const plan = plans[key] || [];
  return plan.map(([ci, co], idx) => ({
    uid: `${key}-${idx + 1}@cleanturn.demo`,
    checkin: off(ci),
    checkout: off(co),
  }));
}

function toIcsDate(d: string): string {
  return d.replace(/-/g, "");
}

export function eventsToIcs(events: DemoEvent[]): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CleanTurn//Demo Feed//EN",
    "CALSCALE:GREGORIAN",
  ];

  for (const ev of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${ev.uid}`,
      `DTSTART;VALUE=DATE:${toIcsDate(ev.checkin)}`,
      `DTEND;VALUE=DATE:${toIcsDate(ev.checkout)}`,
      "SUMMARY:Reserved",
      "END:VEVENT"
    );
  }

  // A "Not available" block the parser must skip — not a real booking.
  lines.push(
    "BEGIN:VEVENT",
    `UID:blocked-${Date.now()}@cleanturn.demo`,
    `DTSTART;VALUE=DATE:${toIcsDate(events[0]?.checkout || "2026-01-01")}`,
    `DTEND;VALUE=DATE:${toIcsDate(
      events[0] ? addDaysLocal(events[0].checkout, 1) : "2026-01-02"
    )}`,
    "SUMMARY:Airbnb (Not available)",
    "END:VEVENT"
  );

  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}
