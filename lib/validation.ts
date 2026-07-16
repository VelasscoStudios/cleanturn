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
  "assigned",
  "in_progress",
  "completed",
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
export const billingQuerySchema = z
  .object({
    ownerId: z.string().min(1).max(64).optional(),
    status: z.enum(["paid", "unpaid"]).optional(),
    from: dateStrSchema.optional(),
    to: dateStrSchema.optional(),
  })
  .refine((d) => !d.from || !d.to || d.from <= d.to, {
    message: "from must be on or before to",
  });
export type BillingQuery = z.infer<typeof billingQuerySchema>;

// ---------------------------------------------------------------------------
// POST /api/billing/mark-paid — bulk-mark completed cleans paid at the cleaner
// or owner-within-cleaner level. cleanerId null targets unassigned cleans;
// cleanerId omitted means "any cleaner". At least one scope must be present.
// from/to optionally bound the range, both ends inclusive.
// ---------------------------------------------------------------------------
export const markPaidSchema = z
  .object({
    cleanerId: z.string().min(1).max(64).nullable().optional(),
    ownerId: z.string().min(1).max(64).optional(),
    from: dateStrSchema.optional(),
    to: dateStrSchema.optional(),
  })
  .refine((d) => "cleanerId" in d || d.ownerId !== undefined, {
    message: "cleanerId or ownerId is required",
  })
  .refine((d) => !d.from || !d.to || d.from <= d.to, {
    message: "from must be on or before to",
  });
export type MarkPaidInput = z.infer<typeof markPaidSchema>;

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
export const cleanerLanguageSchema = z.enum(["en", "uk"]);
export type CleanerLanguage = z.infer<typeof cleanerLanguageSchema>;

export const createCleanerSchema = z.object({
  name: z.string().min(1).max(200),
  phone: z.string().min(1).max(40),
  email: z.string().email().max(320).optional().nullable(),
  language: cleanerLanguageSchema.optional().default("en"),
});
export type CreateCleanerInput = z.infer<typeof createCleanerSchema>;

export const updateCleanerSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  phone: z.string().min(1).max(40).optional(),
  email: z.string().email().max(320).optional().nullable(),
  language: cleanerLanguageSchema.optional(),
  active: z.boolean().optional(),
  resetPin: z.boolean().optional(),
});
export type UpdateCleanerInput = z.infer<typeof updateCleanerSchema>;

// ---------------------------------------------------------------------------
// PATCH /api/my/language — cleaner updates their own UI language
// ---------------------------------------------------------------------------
export const updateMyLanguageSchema = z.object({
  language: cleanerLanguageSchema,
});
export type UpdateMyLanguageInput = z.infer<typeof updateMyLanguageSchema>;

// ---------------------------------------------------------------------------
// Admin users (staff) CRUD
// ---------------------------------------------------------------------------
// Same floor the seed enforces (12+ chars); capped at 200 to match the login
// schema so no one can set a password they then can't type at login.
const adminPasswordSchema = z
  .string()
  .min(12, "password must be at least 12 characters")
  .max(200);

export const createAdminUserSchema = z.object({
  // Stored lowercase; the login route lowercases before lookup, so the pair
  // stays case-insensitive end to end.
  email: z.string().trim().toLowerCase().pipe(z.string().email().max(320)),
  password: adminPasswordSchema,
});
export type CreateAdminUserInput = z.infer<typeof createAdminUserSchema>;

export const changeAdminPasswordSchema = z.object({
  password: adminPasswordSchema,
});
export type ChangeAdminPasswordInput = z.infer<typeof changeAdminPasswordSchema>;

// ---------------------------------------------------------------------------
// POST /api/jobs — manual clean, not backed by an iCal booking
// ---------------------------------------------------------------------------
export const createManualJobSchema = z.object({
  propertyId: z.string().min(1).max(64),
  date: dateStrSchema,
  // Omitted → snapshot the property's cleanCostCents, same as synced jobs.
  costCents: z.number().int().nonnegative().max(100_000_000).optional(),
  cleanerId: z.string().min(1).max(64).optional().nullable(),
});
export type CreateManualJobInput = z.infer<typeof createManualJobSchema>;

// ---------------------------------------------------------------------------
// GET /api/my/jobs — no body/query to validate today (session-scoped) but
// kept here in case filters are added later.
// ---------------------------------------------------------------------------
export const myJobsQuerySchema = z.object({});
export type MyJobsQuery = z.infer<typeof myJobsQuerySchema>;

// ---------------------------------------------------------------------------
// Notes CRUD — a note links to at most one of {cleaner, job}; both null is a
// general note. Enforced here via refine, not at the DB level.
// ---------------------------------------------------------------------------
const notesExclusiveLinkRefine = (data: {
  cleanerId?: string | null;
  jobId?: string | null;
}) => !(data.cleanerId && data.jobId);
const notesExclusiveLinkMessage: { message: string; path: (string | number)[] } = {
  message: "A note can link to a cleaner or a job, not both",
  path: ["jobId"],
};

export const createNoteSchema = z
  .object({
    body: z.string().trim().min(1).max(4000),
    date: dateStrSchema.optional().nullable(),
    cleanerId: z.string().min(1).max(64).optional().nullable(),
    jobId: z.string().min(1).max(64).optional().nullable(),
  })
  .refine(notesExclusiveLinkRefine, notesExclusiveLinkMessage);
export type CreateNoteInput = z.infer<typeof createNoteSchema>;

export const updateNoteSchema = z
  .object({
    body: z.string().trim().min(1).max(4000).optional(),
    date: dateStrSchema.optional().nullable(),
    cleanerId: z.string().min(1).max(64).optional().nullable(),
    jobId: z.string().min(1).max(64).optional().nullable(),
  })
  .refine(notesExclusiveLinkRefine, notesExclusiveLinkMessage);
export type UpdateNoteInput = z.infer<typeof updateNoteSchema>;
