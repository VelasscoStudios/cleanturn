// Integration test: exercises the real Prisma client + real route handlers
// against a throwaway SQLite DB (migrated fresh in beforeAll, deleted in
// afterAll). No existing test in this repo touches the DB or calls route
// handlers directly (they're all pure lib-function unit tests), so this
// file establishes that pattern for itself rather than mirroring one.
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
import { GET, POST } from "@/app/api/notes/route";
import { PATCH, DELETE } from "@/app/api/notes/[id]/route";

const REPO_ROOT = path.resolve(__dirname, "..");

function fetchReq(url: string, init?: RequestInit): Request {
  return new Request(url, init);
}

function jsonPost(body: unknown, withFetchHeader = true): Request {
  return fetchReq("http://localhost/api/notes", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(withFetchHeader ? { "X-Requested-With": "fetch" } : {}),
    },
    body: JSON.stringify(body),
  });
}

function jsonPatch(body: unknown, withFetchHeader = true): Request {
  return fetchReq("http://localhost/api/notes/x", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      ...(withFetchHeader ? { "X-Requested-With": "fetch" } : {}),
    },
    body: JSON.stringify(body),
  });
}

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

let adminId: string;
let cleanerId: string;
let jobId: string;

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
  const property = await prisma.property.create({
    data: {
      ownerId: owner.id,
      nickname: "Test Property",
      address: "123 Test St",
      icalUrl: `https://example.com/${unique}.ics`,
      cleanCostCents: 5000,
      arriveTime: "10:00",
      outByTime: "14:00",
    },
  });
  const job = await prisma.job.create({
    data: { propertyId: property.id, date: "2026-07-15", costCents: 5000 },
  });
  jobId = job.id;
});

function asAdmin() {
  vi.mocked(requireAdminApi).mockResolvedValue({ role: "admin", id: adminId });
}
function asUnauthenticated() {
  vi.mocked(requireAdminApi).mockResolvedValue(null);
}

describe("GET/POST /api/notes", () => {
  it("401s when there is no admin session", async () => {
    asUnauthenticated();
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("403s a POST missing the X-Requested-With: fetch header", async () => {
    asAdmin();
    const res = await POST(jsonPost({ body: "hello" }, false));
    expect(res.status).toBe(403);
  });

  it("creates a general note (no cleaner/job link)", async () => {
    asAdmin();
    const res = await POST(jsonPost({ body: "General reminder" }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.note.body).toBe("General reminder");
    expect(json.note.cleanerId).toBeNull();
    expect(json.note.jobId).toBeNull();
    expect(json.note.authorId).toBe(adminId);
  });

  it("creates a cleaner-linked note and includes cleaner {id, name}", async () => {
    asAdmin();
    const res = await POST(jsonPost({ body: "Talk to cleaner", cleanerId }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.note.cleanerId).toBe(cleanerId);
    expect(json.note.jobId).toBeNull();
    expect(json.note.cleaner).toEqual({ id: cleanerId, name: "Test Cleaner" });
  });

  it("rejects a note linking to both a cleaner and a job (400)", async () => {
    asAdmin();
    const res = await POST(jsonPost({ body: "Bad link", cleanerId, jobId }));
    expect(res.status).toBe(400);
  });

  it("lists notes newest-first with cleaner/job includes", async () => {
    asAdmin();
    await POST(jsonPost({ body: "First note" }));
    await POST(jsonPost({ body: "Second note", cleanerId }));

    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.notes.length).toBeGreaterThanOrEqual(2);
    expect(json.notes[0].body).toBe("Second note");
    expect(json.notes[0].cleaner).toEqual({ id: cleanerId, name: "Test Cleaner" });
  });
});

describe("PATCH /api/notes/[id]", () => {
  it("switches a cleaner-linked note to a job link, clearing cleanerId", async () => {
    asAdmin();
    const created = await POST(jsonPost({ body: "Switch me", cleanerId }));
    const { note } = await created.json();
    expect(note.cleanerId).toBe(cleanerId);

    const res = await PATCH(jsonPatch({ jobId }), paramsFor(note.id));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.note.jobId).toBe(jobId);
    expect(json.note.cleanerId).toBeNull();
  });

  it("404s when the note does not exist", async () => {
    asAdmin();
    const res = await PATCH(jsonPatch({ body: "nope" }), paramsFor("does-not-exist"));
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/notes/[id]", () => {
  it("hard-deletes a note (round trip)", async () => {
    asAdmin();
    const created = await POST(jsonPost({ body: "Delete me" }));
    const { note } = await created.json();

    const delRes = await DELETE(
      fetchReq(`http://localhost/api/notes/${note.id}`, {
        method: "DELETE",
        headers: { "X-Requested-With": "fetch" },
      }),
      paramsFor(note.id)
    );
    expect(delRes.status).toBe(200);
    expect(await delRes.json()).toEqual({ ok: true });

    const gone = await prisma.note.findUnique({ where: { id: note.id } });
    expect(gone).toBeNull();

    // Deleting again 404s — confirms the delete was real, not a soft flag.
    const secondDelete = await DELETE(
      fetchReq(`http://localhost/api/notes/${note.id}`, {
        method: "DELETE",
        headers: { "X-Requested-With": "fetch" },
      }),
      paramsFor(note.id)
    );
    expect(secondDelete.status).toBe(404);
  });
});
