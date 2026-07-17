// Integration test: exercises the real Prisma client + real POST route
// handler for bulk "mark paid" against a throwaway SQLite DB, following the
// beforeAll/afterAll/beforeEach pattern tests/notes.test.ts established (see
// that file's header comment for the rationale).
//
// "@/lib/auth"'s requireAdminApi is mocked (session/cookie plumbing isn't
// something a route-handler test should need to fake end-to-end); its
// assertFetchHeader is left real since it's a pure header check.
import { TEST_DB_PATH } from "./helpers/notesTestEnv";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from "vitest";

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    requireAdminApi: vi.fn(),
  };
});

import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth";
import { POST } from "@/app/api/billing/mark-paid/route";

const REPO_ROOT = path.resolve(__dirname, "..");

function markPaidReq(body: unknown, withFetchHeader = true): Request {
  return new Request("http://localhost/api/billing/mark-paid", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(withFetchHeader ? { "X-Requested-With": "fetch" } : {}),
    },
    body: JSON.stringify(body),
  });
}

let adminId: string;
let cleanerId: string;
let ownerId: string;
let propertyId: string;

beforeAll(() => {
  execSync("npx prisma migrate deploy", {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL: `file:${TEST_DB_PATH}` },
    stdio: "pipe",
  });
});

afterAll(async () => {
  await prisma.$disconnect();
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    const p = `${TEST_DB_PATH}${suffix}`;
    if (fs.existsSync(p)) fs.rmSync(p);
  }
});

beforeEach(async () => {
  vi.mocked(requireAdminApi).mockReset();

  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const admin = await prisma.adminUser.create({
    data: { email: `admin-${unique}@test.local`, passwordHash: "x" },
  });
  adminId = admin.id;

  const cleaner = await prisma.cleaner.create({
    data: { name: "Test Cleaner", phone: `555-${unique}`, pinHash: "x" },
  });
  cleanerId = cleaner.id;

  const owner = await prisma.owner.create({
    data: { name: "Test Owner", email: `owner-${unique}@test.local` },
  });
  ownerId = owner.id;

  const property = await prisma.property.create({
    data: {
      ownerId,
      nickname: "Test Property",
      address: "123 Test St",
      icalUrl: `https://example.com/${unique}.ics`,
      cleanCostCents: 5000,
      arriveTime: "10:00",
      outByTime: "14:00",
    },
  });
  propertyId = property.id;
});

function asAdmin() {
  vi.mocked(requireAdminApi).mockResolvedValue({ role: "admin", id: adminId });
}
function asUnauthenticated() {
  vi.mocked(requireAdminApi).mockResolvedValue(null);
}

describe("POST /api/billing/mark-paid", () => {
  it("401s when there is no admin session", async () => {
    asUnauthenticated();
    const res = await POST(markPaidReq({ ownerId }));
    expect(res.status).toBe(401);
  });

  it("403s a request missing the X-Requested-With: fetch header", async () => {
    asAdmin();
    const res = await POST(markPaidReq({ ownerId }, false));
    expect(res.status).toBe(403);
  });

  it("400s a scope-less body (neither cleanerId nor ownerId)", async () => {
    asAdmin();
    const res = await POST(markPaidReq({ from: "2026-07-01", to: "2026-07-31" }));
    expect(res.status).toBe(400);
  });

  it("marks the right jobs paid and reports markedCount as rows actually flipped", async () => {
    asAdmin();
    const jobA = await prisma.job.create({
      data: { propertyId, cleanerId, date: "2026-07-10", costCents: 5000, status: "completed" },
    });
    const jobB = await prisma.job.create({
      data: { propertyId, cleanerId, date: "2026-07-11", costCents: 6000, status: "completed" },
    });
    // Outside the requested range — must not be touched.
    const jobOutside = await prisma.job.create({
      data: { propertyId, cleanerId, date: "2026-08-01", costCents: 7000, status: "completed" },
    });

    const res = await POST(
      markPaidReq({ cleanerId, ownerId, from: "2026-07-01", to: "2026-07-31" })
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.markedCount).toBe(2);
    expect(json.jobIds.sort()).toEqual([jobA.id, jobB.id].sort());

    const [a, b, outside] = await Promise.all([
      prisma.job.findUnique({ where: { id: jobA.id } }),
      prisma.job.findUnique({ where: { id: jobB.id } }),
      prisma.job.findUnique({ where: { id: jobOutside.id } }),
    ]);
    expect(a?.paid).toBe(true);
    expect(a?.paidAt).not.toBeNull();
    expect(b?.paid).toBe(true);
    expect(outside?.paid).toBe(false);
  });

  it("leaves an already-paid job's paidAt untouched and excludes it from markedCount", async () => {
    asAdmin();
    const originalPaidAt = new Date("2026-06-01T12:00:00Z");
    const alreadyPaid = await prisma.job.create({
      data: {
        propertyId,
        cleanerId,
        date: "2026-07-10",
        costCents: 5000,
        status: "completed",
        paid: true,
        paidAt: originalPaidAt,
      },
    });
    const stillOwed = await prisma.job.create({
      data: { propertyId, cleanerId, date: "2026-07-11", costCents: 6000, status: "completed" },
    });

    const res = await POST(markPaidReq({ ownerId, from: "2026-07-01", to: "2026-07-31" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.markedCount).toBe(1);
    expect(json.jobIds).toEqual([stillOwed.id]);

    const untouched = await prisma.job.findUnique({ where: { id: alreadyPaid.id } });
    expect(untouched?.paidAt?.toISOString()).toBe(originalPaidAt.toISOString());
  });
});
