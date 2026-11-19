import { z } from 'zod';

/**
 * What the vision model reports about a photo. It only describes what it sees;
 * TrustElect's own rules (decide.ts) turn this into accept, retake or reject.
 */
export const IMAGE_QUALITY = ['good', 'blurred', 'cropped', 'too_dark', 'glare', 'too_far'] as const;

export const ec60eReadingSchema = z.object({
  is_ec60e: z.boolean(),
  /** What the image shows, in a few words (useful when it is not an EC60E) */
  document_description: z.string(),
  image_quality: z.enum(IMAGE_QUALITY),
  stamp_visible: z.boolean(),
  signature_present: z.boolean(),
  /** Election as printed on the form, for example "Governorship" */
  election_type_on_form: z.string().nullable(),
  polling_unit_code: z.string().nullable(),
  polling_unit_name: z.string().nullable(),
  party_results: z.array(
    z.object({
      party: z.string(),
      votes: z.number().int().min(0).nullable(),
      legible: z.boolean(),
    }),
  ),
  total_valid_votes: z.number().int().min(0).nullable(),
  rejected_votes: z.number().int().min(0).nullable(),
  total_votes_cast: z.number().int().min(0).nullable(),
  notes: z.string(),
});

export type Ec60eReading = z.infer<typeof ec60eReadingSchema>;

const nullableInt = { type: ['integer', 'null'], minimum: 0 };
const nullableString = { type: ['string', 'null'] };

/** JSON Schema sent to the model (strict structured output). Mirrors ec60eReadingSchema. */
export const EC60E_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'is_ec60e',
    'document_description',
    'image_quality',
    'stamp_visible',
    'signature_present',
    'election_type_on_form',
    'polling_unit_code',
    'polling_unit_name',
    'party_results',
    'total_valid_votes',
    'rejected_votes',
    'total_votes_cast',
    'notes',
  ],
  properties: {
    is_ec60e: { type: 'boolean', description: 'True only if this is an INEC EC60E result poster (Publication of Result of Poll).' },
    document_description: { type: 'string', description: 'What the image shows, in at most 15 words.' },
    image_quality: { type: 'string', enum: [...IMAGE_QUALITY], description: 'good if every figure can be read with confidence.' },
    stamp_visible: { type: 'boolean', description: 'An official INEC/presiding officer stamp impression is visible on the form.' },
    signature_present: { type: 'boolean', description: 'A handwritten signature is present on the form.' },
    election_type_on_form: { ...nullableString, description: 'Election as printed, e.g. Presidential, Governorship, Senate.' },
    polling_unit_code: { ...nullableString, description: 'Polling unit code exactly as written, e.g. 24/05/01/003.' },
    polling_unit_name: nullableString,
    party_results: {
      type: 'array',
      description: 'Every party row on the form, in the order printed.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['party', 'votes', 'legible'],
        properties: {
          party: { type: 'string', description: 'Party acronym as printed.' },
          votes: { ...nullableInt, description: 'Votes in figures. Use the words to resolve unclear figures. Null if unreadable.' },
          legible: { type: 'boolean', description: 'False if you are not certain of this number.' },
        },
      },
    },
    total_valid_votes: { ...nullableInt, description: 'As written on the form, not computed. Null if not shown.' },
    rejected_votes: { ...nullableInt, description: 'As written on the form. Null if not shown.' },
    total_votes_cast: { ...nullableInt, description: 'As written on the form. Null if not shown.' },
    notes: { type: 'string', description: 'Anything unusual: corrections, overwriting, missing rows. Empty if none.' },
  },
} as const;

export const EC60E_PROMPT = `You are reading a photograph submitted by a Nigerian voter for TrustElect, a citizen election evidence platform.
The photo should show an INEC Form EC60E, the "Publication of Result of Poll" poster pasted at a polling unit after counting.
The Presiding Officer fills it in by hand, signs it, dates it and stamps it.

Report only what you can actually see. Never guess or invent a number: if a figure is unclear, set legible to false,
and set votes to null if you cannot read it at all. Where a score is written in both figures and words, use the words
to resolve an unclear figure. Do not compute totals: copy them exactly as written, or null if absent.
If the image is not an EC60E poster (for example an EC8A sheet, a screenshot, a different document, or a person),
set is_ec60e to false and describe what it is.`;

/* ------------------------------------------------------------------ */
/* Declared results: collation sheets and official announcements      */
/* ------------------------------------------------------------------ */

export const declarationReadingSchema = z.object({
  is_result_document: z.boolean(),
  document_type: z.enum(['EC8B', 'EC8C', 'EC8D', 'EC8E', 'announcement', 'other']),
  document_description: z.string(),
  area_name: z.string().nullable(),
  image_quality: z.enum(IMAGE_QUALITY),
  party_results: z.array(z.object({ party: z.string(), votes: z.number().int().min(0).nullable(), legible: z.boolean() })),
  total_valid_votes: z.number().int().min(0).nullable(),
  rejected_votes: z.number().int().min(0).nullable(),
  total_votes_cast: z.number().int().min(0).nullable(),
  notes: z.string(),
});

export type DeclarationReading = z.infer<typeof declarationReadingSchema>;

export const DECLARATION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'is_result_document',
    'document_type',
    'document_description',
    'area_name',
    'image_quality',
    'party_results',
    'total_valid_votes',
    'rejected_votes',
    'total_votes_cast',
    'notes',
  ],
  properties: {
    is_result_document: { type: 'boolean', description: 'True if this shows an official collated or declared election result.' },
    document_type: {
      type: 'string',
      enum: ['EC8B', 'EC8C', 'EC8D', 'EC8E', 'announcement', 'other'],
      description: 'EC8B ward, EC8C LGA, EC8D state collation, EC8E declaration; announcement for a statement or broadcast screenshot.',
    },
    document_description: { type: 'string', description: 'What the image shows, in at most 15 words.' },
    area_name: { ...nullableString, description: 'Ward, LGA or state the result is for, as written.' },
    image_quality: { type: 'string', enum: [...IMAGE_QUALITY] },
    party_results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['party', 'votes', 'legible'],
        properties: {
          party: { type: 'string', description: 'Party acronym as written.' },
          votes: { ...nullableInt, description: 'Total votes for the party in this area. Null if unreadable.' },
          legible: { type: 'boolean' },
        },
      },
    },
    total_valid_votes: { ...nullableInt, description: 'As written, not computed.' },
    rejected_votes: nullableInt,
    total_votes_cast: nullableInt,
    notes: { type: 'string', description: 'Corrections, overwriting or anything unusual. Empty if none.' },
  },
} as const;

export const DECLARATION_PROMPT = `You are reading an official Nigerian election result document for TrustElect, to help an administrator
record a declared result. It may be an INEC collation form (EC8B ward, EC8C LGA, EC8D state, EC8E declaration)
or a screenshot of an official announcement. Report only what you can see. Never guess a number: if a figure is unclear,
set legible to false, or votes to null if unreadable. Copy totals exactly as written; do not compute them.`;
