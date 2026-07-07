import { z } from "zod";

/**
 * An http(s) URL. Plain `z.string().url()` accepts dangerous schemes such as
 * `javascript:`, `data:` and `vbscript:` — which, if later rendered into an
 * anchor href, become an XSS sink. Restrict to http/https and cap length.
 */
export const httpUrlSchema = z
  .string()
  .max(2048)
  .refine((v) => {
    try {
      const proto = new URL(v).protocol;
      return proto === "http:" || proto === "https:";
    } catch {
      return false;
    }
  }, "must be an http(s) URL");

/** YYYY-MM-DD date-only string. */
export const dateStrSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be a YYYY-MM-DD date string");

/** YYYY-MM month-only string. */
export const monthStrSchema = z
  .string()
  .regex(/^\d{4}-\d{2}$/, "must be a YYYY-MM month string");

/** HH:MM time-of-day string (24h). */
export const timeStrSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "must be an HH:MM time string");

export const jobStatusSchema = z.enum([
  "unassigned",
  "assigned",
  "in_progress",
  "awaiting_confirm",
  "done",
  "cancelled",
]);

// ---------------------------------------------------------------------------
// GET /api/schedule
// ---------------------------------------------------------------------------
export const scheduleQuerySchema = z.object({
  from: dateStrSchema.optional(),
  to: dateStrSchema.optional(),
  propertyId: z.string().min(1).max(64).optional(),
  cleanerId: z.string().min(1).max(64).optional(),
  unassigned: z
    .union([z.literal("true"), z.literal("false")])
    .optional()
    .transform((v) => v === "true"),
});
export type ScheduleQuery = z.infer<typeof scheduleQuerySchema>;

// ---------------------------------------------------------------------------
// PATCH /api/jobs/[id]/assign
// ---------------------------------------------------------------------------
export const assignJobSchema = z.object({
  cleanerId: z.string().min(1).max(64).nullable(),
});
export type AssignJobInput = z.infer<typeof assignJobSchema>;

// ---------------------------------------------------------------------------
// PATCH /api/jobs/[id]/status
// ---------------------------------------------------------------------------
export const setJobStatusSchema = z.object({
  status: jobStatusSchema,
});
export type SetJobStatusInput = z.infer<typeof setJobStatusSchema>;

// ---------------------------------------------------------------------------
// PATCH /api/jobs/[id]/paid
// ---------------------------------------------------------------------------
export const setJobPaidSchema = z.object({
  paid: z.boolean(),
});
export type SetJobPaidInput = z.infer<typeof setJobPaidSchema>;

// ---------------------------------------------------------------------------
// GET /api/billing
// ---------------------------------------------------------------------------
export const billingQuerySchema = z.object({
  ownerId: z.string().min(1).max(64).optional(),
  status: z.enum(["paid", "unpaid"]).optional(),
  month: monthStrSchema.optional(),
});
export type BillingQuery = z.infer<typeof billingQuerySchema>;

// ---------------------------------------------------------------------------
// POST /api/billing/mark-owner-paid
// ---------------------------------------------------------------------------
export const markOwnerPaidSchema = z.object({
  ownerId: z.string().min(1).max(64),
  month: monthStrSchema.optional(),
});
export type MarkOwnerPaidInput = z.infer<typeof markOwnerPaidSchema>;

// ---------------------------------------------------------------------------
// Properties CRUD
// ---------------------------------------------------------------------------
export const createPropertySchema = z.object({
  ownerId: z.string().min(1).max(64),
  nickname: z.string().min(1).max(200),
  address: z.string().min(1).max(500),
  icalUrl: httpUrlSchema,
  // Money in cents: bounded so a typo/overflow can't create absurd invoices.
  cleanCostCents: z.number().int().nonnegative().max(100_000_000),
  directions: z.string().max(2000).optional().default(""),
  mapsUrl: httpUrlSchema.optional().nullable(),
  accessCode: z.string().max(200).optional().default(""),
  arriveTime: timeStrSchema,
  outByTime: timeStrSchema,
  notes: z.string().max(2000).optional().default(""),
});
export type CreatePropertyInput = z.infer<typeof createPropertySchema>;

export const updatePropertySchema = createPropertySchema.partial().extend({
  active: z.boolean().optional(),
});
export type UpdatePropertyInput = z.infer<typeof updatePropertySchema>;

// ---------------------------------------------------------------------------
// Owners CRUD
// ---------------------------------------------------------------------------
export const createOwnerSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().max(320),
  phone: z.string().max(40).optional().nullable(),
  billingNotes: z.string().max(2000).optional().default(""),
});
export type CreateOwnerInput = z.infer<typeof createOwnerSchema>;

export const updateOwnerSchema = createOwnerSchema.partial().extend({
  active: z.boolean().optional(),
});
export type UpdateOwnerInput = z.infer<typeof updateOwnerSchema>;

// ---------------------------------------------------------------------------
// Cleaners CRUD
// ---------------------------------------------------------------------------
export const createCleanerSchema = z.object({
  name: z.string().min(1).max(200),
  phone: z.string().min(1).max(40),
  email: z.string().email().max(320).optional().nullable(),
});
export type CreateCleanerInput = z.infer<typeof createCleanerSchema>;

export const updateCleanerSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  phone: z.string().min(1).max(40).optional(),
  email: z.string().email().max(320).optional().nullable(),
  active: z.boolean().optional(),
  resetPin: z.boolean().optional(),
});
export type UpdateCleanerInput = z.infer<typeof updateCleanerSchema>;

// ---------------------------------------------------------------------------
// GET /api/my/jobs — no body/query to validate today (session-scoped) but
// kept here in case filters are added later.
// ---------------------------------------------------------------------------
export const myJobsQuerySchema = z.object({});
export type MyJobsQuery = z.infer<typeof myJobsQuerySchema>;
