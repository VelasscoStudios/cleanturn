import { describe, it, expect } from "vitest";
import { mondayOf, saturdayOf, lastDayOfMonth } from "../lib/dates";

describe("mondayOf", () => {
  it("maps a mid-week date (Wednesday) to that week's Monday", () => {
    // 2026-07-15 is a Wednesday
    expect(mondayOf("2026-07-15")).toBe("2026-07-13");
  });

  it("maps a Sunday to the PREVIOUS Monday", () => {
    // 2026-07-19 is a Sunday, should map to 2026-07-13 (previous Monday)
    expect(mondayOf("2026-07-19")).toBe("2026-07-13");
  });

  it("maps a Monday to itself", () => {
    // 2026-07-13 is a Monday
    expect(mondayOf("2026-07-13")).toBe("2026-07-13");
  });

  it("handles month boundaries correctly", () => {
    // 2026-07-01 is a Wednesday, should map back to 2026-06-29 (previous Monday)
    expect(mondayOf("2026-07-01")).toBe("2026-06-29");
  });

  it("handles year boundaries correctly", () => {
    // 2026-01-04 is a Sunday, should map to 2025-12-29 (previous Monday)
    expect(mondayOf("2026-01-04")).toBe("2025-12-29");
  });
});

describe("saturdayOf", () => {
  it("maps a mid-week date (Thursday) to the pay week's Saturday", () => {
    // 2026-07-16 is a Thursday; the pay week (Sat–Fri) started 2026-07-11
    expect(saturdayOf("2026-07-16")).toBe("2026-07-11");
  });

  it("maps a Saturday to itself", () => {
    // 2026-07-11 is a Saturday
    expect(saturdayOf("2026-07-11")).toBe("2026-07-11");
  });

  it("maps a Friday (payday) to the PREVIOUS Saturday, ending its week", () => {
    // 2026-07-17 is a Friday, the last day of the week starting 2026-07-11
    expect(saturdayOf("2026-07-17")).toBe("2026-07-11");
  });

  it("maps a Sunday to the Saturday one day before", () => {
    // 2026-07-12 is a Sunday
    expect(saturdayOf("2026-07-12")).toBe("2026-07-11");
  });

  it("handles month boundaries correctly", () => {
    // 2026-07-02 is a Thursday; its pay week started Saturday 2026-06-27
    expect(saturdayOf("2026-07-02")).toBe("2026-06-27");
  });

  it("handles year boundaries correctly", () => {
    // 2026-01-01 is a Thursday; its pay week started Saturday 2025-12-27
    expect(saturdayOf("2026-01-01")).toBe("2025-12-27");
  });
});

describe("lastDayOfMonth", () => {
  it("returns the last day of a 31-day month (January)", () => {
    expect(lastDayOfMonth("2026-01-15")).toBe("2026-01-31");
  });

  it("returns the last day of a 30-day month (April)", () => {
    expect(lastDayOfMonth("2026-04-15")).toBe("2026-04-30");
  });

  it("returns the last day of February in a leap year (2028)", () => {
    expect(lastDayOfMonth("2028-02-15")).toBe("2028-02-29");
  });

  it("returns the last day of February in a non-leap year (2026)", () => {
    expect(lastDayOfMonth("2026-02-15")).toBe("2026-02-28");
  });

  it("returns the last day when given the first day of the month", () => {
    expect(lastDayOfMonth("2026-03-01")).toBe("2026-03-31");
  });

  it("returns the last day when given the last day of the month", () => {
    expect(lastDayOfMonth("2026-12-31")).toBe("2026-12-31");
  });
});
