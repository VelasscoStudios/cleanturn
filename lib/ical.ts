import { parseICS } from "node-ical";

export type ParsedBookingEvent = {
  uid: string;
  checkin: string; // YYYY-MM-DD
  checkout: string; // YYYY-MM-DD
};

/**
 * Format a Date produced by node-ical for a VALUE=DATE (date-only) field
 * back into a YYYY-MM-DD string.
 *
 * node-ical constructs date-only DTSTART/DTEND values using the LOCAL
 * timezone constructor (e.g. `new Date(year, month, day)`), not UTC. So we
 * must read the date parts back out with the local getters (getFullYear /
 * getMonth / getDate), never the UTC getters — otherwise the extracted
 * calendar day shifts by one depending on the machine's timezone offset.
 */
function dateOnlyToStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * node-ical types SUMMARY (and other TEXT properties) as `ParameterValue`,
 * which can be either a plain string or `{ params, val }` when the
 * property line carried parameters. Normalize to a plain string so a
 * parameterized SUMMARY doesn't silently fail the "Reserved" match.
 */
function summaryToString(summary: unknown): string | null {
  if (typeof summary === "string") return summary;
  if (
    summary &&
    typeof summary === "object" &&
    "val" in (summary as Record<string, unknown>) &&
    typeof (summary as { val: unknown }).val === "string"
  ) {
    return (summary as { val: string }).val;
  }
  return null;
}

/**
 * Parse raw ICS text and return only real Airbnb reservation events
 * (SUMMARY "Reserved"), ignoring "Airbnb (Not available)" blocks and any
 * non-VEVENT components.
 */
export function parseIcs(icsText: string): ParsedBookingEvent[] {
  const parsed = parseICS(icsText);
  const events: ParsedBookingEvent[] = [];

  for (const key of Object.keys(parsed)) {
    const component = parsed[key];
    if (!component || component.type !== "VEVENT") continue;
    if (summaryToString(component.summary) !== "Reserved") continue;
    if (!component.uid || !component.start || !component.end) continue;

    const start = component.start as unknown as Date;
    const end = component.end as unknown as Date;
    if (!(start instanceof Date) || !(end instanceof Date)) continue;
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;

    events.push({
      uid: String(component.uid),
      checkin: dateOnlyToStr(start),
      checkout: dateOnlyToStr(end),
    });
  }

  return events;
}
