/** Levels at which results are collated, from smallest to largest. */
export const AREA_LEVELS = ['polling_unit', 'ward', 'lga', 'state', 'national'] as const;
export type AreaLevel = (typeof AREA_LEVELS)[number];

/** Levels at which an official declaration can be recorded (Specification CMP-01). */
export const DECLARATION_LEVELS = ['ward', 'lga', 'state', 'national'] as const;
export type DeclarationLevel = (typeof DECLARATION_LEVELS)[number];
