/**
 * Database schema (Roadmap Sprint 1: data model).
 * Requirement IDs refer to the System Overview and Functional Specification v2.0.
 */
import {
  bigint,
  bigserial,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/* ------------------------------------------------------------------ */
/* Enums                                                               */
/* ------------------------------------------------------------------ */

export const electionType = pgEnum('election_type', [
  'presidential',
  'governorship',
  'senate',
  'house_of_representatives',
  'state_assembly',
  'area_council',
  'local_government',
]);
export const electionStatus = pgEnum('election_status', ['draft', 'active', 'closed']);
export const areaLevel = pgEnum('area_level', ['polling_unit', 'ward', 'lga', 'state', 'national']);
export const channel = pgEnum('channel', ['web', 'whatsapp', 'sms', 'ussd']);
export const submissionKind = pgEnum('submission_kind', ['photo', 'typed']);
export const submissionStatus = pgEnum('submission_status', ['pending', 'verified', 'needs_confirmation', 'rejected']);
export const confidenceLevel = pgEnum('confidence_level', ['low', 'medium', 'high']);
/** How strong one accepted photo is as evidence (stamp visible, code on poster matches) */
export const evidenceStrength = pgEnum('evidence_strength', ['strong', 'standard', 'low']);
export const unitStatus = pgEnum('unit_status', [
  'not_confirmed',
  'counted',
  'provisional',
  'disputed',
  'resolved',
]);
export const declarationStatus = pgEnum('declaration_status', ['pending', 'approved', 'rejected']);
export const declarationSource = pgEnum('declaration_source', [
  'collation_result_photo',
  'inec_statement',
  'broadcast',
]);
export const adminRole = pgEnum('admin_role', [
  'reviewer',
  'declarations_admin',
  'approver',
  'system_admin',
]);

/* ------------------------------------------------------------------ */
/* Geography: INEC polling unit register (CNT-01)                      */
/* ------------------------------------------------------------------ */

export const states = pgTable('states', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
});

export const lgas = pgTable(
  'lgas',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    stateId: integer('state_id').notNull().references(() => states.id),
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
  },
  (t) => [index('lgas_state_idx').on(t.stateId)],
);

export const wards = pgTable(
  'wards',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    lgaId: integer('lga_id').notNull().references(() => lgas.id),
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
  },
  (t) => [index('wards_lga_idx').on(t.lgaId)],
);

export const pollingUnits = pgTable(
  'polling_units',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    wardId: integer('ward_id').notNull().references(() => wards.id),
    /** INEC code, for example 24-05-01-003 */
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    registeredVoters: integer('registered_voters'),
  },
  (t) => [index('polling_units_ward_idx').on(t.wardId)],
);

/* ------------------------------------------------------------------ */
/* Elections and parties (VER-02, VER-04)                              */
/* ------------------------------------------------------------------ */

export const parties = pgTable('parties', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  acronym: text('acronym').notNull().unique(),
  name: text('name').notNull(),
});

export const elections = pgTable('elections', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: electionType('type').notNull(),
  title: text('title').notNull(),
  electionDate: date('election_date').notNull(),
  /** Area the election covers, for example national, or one state's code */
  scopeLevel: areaLevel('scope_level').notNull(),
  scopeCode: text('scope_code'),
  pollsCloseAt: timestamp('polls_close_at', { withTimezone: true }).notNull(),
  status: electionStatus('status').notNull().default('draft'),
  createdAt: createdAt(),
});

export const electionParties = pgTable(
  'election_parties',
  {
    electionId: uuid('election_id').notNull().references(() => elections.id),
    partyId: integer('party_id').notNull().references(() => parties.id),
    /** Parties are always displayed in ballot order, never ranked by votes */
    ballotOrder: integer('ballot_order').notNull(),
  },
  (t) => [primaryKey({ columns: [t.electionId, t.partyId] })],
);

/* ------------------------------------------------------------------ */
/* Reporters and capture sessions (CAP-02, WIT-03)                     */
/* ------------------------------------------------------------------ */

/** A voter, identified only by phone number. No account. */
export const reporters = pgTable('reporters', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Keyed hash of the phone number, used to count distinct witnesses */
  phoneHash: text('phone_hash').notNull().unique(),
  /** Encrypted phone number, readable by administrators only */
  phoneEncrypted: text('phone_encrypted').notNull(),
  consentAt: timestamp('consent_at', { withTimezone: true }),
  blockedAt: timestamp('blocked_at', { withTimezone: true }),
  createdAt: createdAt(),
});

/** One-time codes sent by SMS to verify a voter's phone number (CAP-02) */
export const voterOtps = pgTable(
  'voter_otps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    phoneHash: text('phone_hash').notNull(),
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('voter_otps_phone_idx').on(t.phoneHash, t.createdAt)],
);

/** One-time links or codes that tie a web capture to a phone number */
export const captureSessions = pgTable('capture_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  reporterId: uuid('reporter_id').notNull().references(() => reporters.id),
  tokenHash: text('token_hash').notNull().unique(),
  issuedVia: channel('issued_via').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: createdAt(),
});

/* ------------------------------------------------------------------ */
/* Submissions, versions and unit results (VER, WIT)                   */
/* ------------------------------------------------------------------ */

/** Figures read from an EC60E: party acronym -> votes, plus totals */
export type ResultFigures = {
  partyVotes: Record<string, number>;
  totalValid: number;
  /** Null when the poster does not show it */
  rejected: number | null;
  totalCast: number | null;
};

/** A distinct set of figures reported for one polling unit */
export const resultVersions = pgTable(
  'result_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    electionId: uuid('election_id').notNull().references(() => elections.id),
    pollingUnitId: integer('polling_unit_id').notNull().references(() => pollingUnits.id),
    /** Hash of the canonical figures; identical figures share a version (WIT-02) */
    figuresHash: text('figures_hash').notNull(),
    figures: jsonb('figures').$type<ResultFigures>().notNull(),
    /** Distinct phone numbers with a verified photograph of these figures */
    witnessCount: integer('witness_count').notNull().default(0),
    /** Typed submissions matching these figures; never decide selection (WIT-06) */
    typedSupportCount: integer('typed_support_count').notNull().default(0),
    confidence: confidenceLevel('confidence'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('result_versions_unit_figures_uq').on(t.electionId, t.pollingUnitId, t.figuresHash),
  ],
);

export const submissions = pgTable(
  'submissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    electionId: uuid('election_id').notNull().references(() => elections.id),
    /** Null until the unit code has been read from the photograph */
    pollingUnitId: integer('polling_unit_id').references(() => pollingUnits.id),
    reporterId: uuid('reporter_id').notNull().references(() => reporters.id),
    kind: submissionKind('kind').notNull(),
    channel: channel('channel').notNull(),
    status: submissionStatus('status').notNull().default('pending'),
    capturedAt: timestamp('captured_at', { withTimezone: true }),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    /** Storage key and SHA-256 of the photograph; empty for typed submissions (EVD-01) */
    imageKey: text('image_key'),
    imageSha256: text('image_sha256'),
    extracted: jsonb('extracted').$type<ResultFigures>(),
    voterConfirmed: boolean('voter_confirmed').notNull().default(false),
    versionId: uuid('version_id').references(() => resultVersions.id),
    /** Generated on the phone; makes offline-queue retries safe (one submission per clientId) */
    clientId: uuid('client_id'),
    imageBytes: integer('image_bytes'),
    imageType: text('image_type'),
    /** Reported GPS accuracy in metres */
    locationAccuracy: doublePrecision('location_accuracy'),
    /** Evidence strength of an accepted photo; used by the confidence engine */
    evidenceStrength: evidenceStrength('evidence_strength'),
    /** AI reading of the photo and the checks applied (VER), kept for audit */
    verification: jsonb('verification'),
    /** Plain-language reason shown to the voter when a retake, confirmation or rejection is needed */
    reviewReason: text('review_reason'),
    /** True when the voter is asked to retake rather than simply rejected */
    retakeRequested: boolean('retake_requested').notNull().default(false),
    processingAttempts: integer('processing_attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    /** AI model that read the photo */
    model: text('model'),
  },
  (t) => [
    index('submissions_unit_idx').on(t.electionId, t.pollingUnitId),
    index('submissions_reporter_idx').on(t.reporterId, t.receivedAt),
    index('submissions_pending_idx').on(t.status, t.nextAttemptAt),
    uniqueIndex('submissions_reporter_client_uq').on(t.reporterId, t.clientId),
  ],
);

/** Rejected images are not stored; only this log entry is kept (VER-05) */
export const rejectionLog = pgTable('rejection_log', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  reporterId: uuid('reporter_id').notNull().references(() => reporters.id),
  electionId: uuid('election_id').references(() => elections.id),
  reason: text('reason').notNull(),
  createdAt: createdAt(),
});

/** Current state of each polling unit after version selection (WIT-05, WIT-08) */
export const unitResults = pgTable(
  'unit_results',
  {
    electionId: uuid('election_id').notNull().references(() => elections.id),
    pollingUnitId: integer('polling_unit_id').notNull().references(() => pollingUnits.id),
    status: unitStatus('status').notNull().default('not_confirmed'),
    countedVersionId: uuid('counted_version_id').references(() => resultVersions.id),
    resolvedBy: uuid('resolved_by').references(() => adminUsers.id),
    resolutionReason: text('resolution_reason'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.electionId, t.pollingUnitId] })],
);

/* ------------------------------------------------------------------ */
/* Declared results (CMP)                                              */
/* ------------------------------------------------------------------ */

export const declarations = pgTable(
  'declarations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    electionId: uuid('election_id').notNull().references(() => elections.id),
    level: areaLevel('level').notNull(),
    /** Code of the ward, LGA or state; null for national */
    areaCode: text('area_code'),
    figures: jsonb('figures').$type<ResultFigures>().notNull(),
    /** Optional per-unit figures listed in the declaration (CMP-08) */
    unitFigures: jsonb('unit_figures').$type<Record<string, ResultFigures>>(),
    declaredAt: timestamp('declared_at', { withTimezone: true }).notNull(),
    sourceKind: declarationSource('source_kind').notNull(),
    sourceUrl: text('source_url'),
    sourceFileKey: text('source_file_key'),
    sourceSha256: text('source_sha256'),
    status: declarationStatus('status').notNull().default('pending'),
    enteredBy: uuid('entered_by').notNull().references(() => adminUsers.id),
    approvedBy: uuid('approved_by').references(() => adminUsers.id),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('declarations_area_idx').on(t.electionId, t.level, t.areaCode)],
);

/* ------------------------------------------------------------------ */
/* Administrators and audit (ADM-05, ADM-06)                           */
/* ------------------------------------------------------------------ */

export const adminUsers = pgTable('admin_users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  role: adminRole('role').notNull(),
  passwordHash: text('password_hash').notNull(),
  /** Encrypted TOTP secret; two-factor authentication is mandatory */
  totpSecretEncrypted: text('totp_secret_encrypted'),
  /** Set once the administrator has confirmed their authenticator app */
  totpEnabledAt: timestamp('totp_enabled_at', { withTimezone: true }),
  /** Last accepted TOTP time step, so a code cannot be used twice */
  totpLastStep: bigint('totp_last_step', { mode: 'number' }),
  failedLogins: integer('failed_logins').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  disabledAt: timestamp('disabled_at', { withTimezone: true }),
  createdAt: createdAt(),
});

/** Server-side admin sessions; the browser holds only an opaque token in an HTTP-only cookie */
export const adminSessions = pgTable(
  'admin_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adminUserId: uuid('admin_user_id').notNull().references(() => adminUsers.id),
    tokenHash: text('token_hash').notNull().unique(),
    /** False while the administrator still has to set up or enter their TOTP code */
    mfaVerified: boolean('mfa_verified').notNull().default(false),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [index('admin_sessions_user_idx').on(t.adminUserId)],
);

export const auditLog = pgTable('audit_log', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  adminUserId: uuid('admin_user_id').references(() => adminUsers.id),
  action: text('action').notNull(),
  targetType: text('target_type').notNull(),
  targetId: text('target_id'),
  details: jsonb('details'),
  createdAt: createdAt(),
});

/* ------------------------------------------------------------------ */
/* Append-only hash chain (EVD-02, EVD-03)                             */
/* ------------------------------------------------------------------ */

export const chainEntries = pgTable('chain_entries', {
  /** Position in the chain; gaps are not allowed */
  seq: bigserial('seq', { mode: 'number' }).primaryKey(),
  entryType: text('entry_type').notNull(),
  refId: text('ref_id').notNull(),
  /** SHA-256 of the canonical payload being recorded */
  payloadSha256: text('payload_sha256').notNull(),
  prevHash: text('prev_hash').notNull(),
  /** SHA-256(seq | entryType | refId | payloadSha256 | prevHash | createdAt) */
  hash: text('hash').notNull().unique(),
  createdAt: createdAt(),
});
