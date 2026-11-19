/** Incident report types (INC-01) */
export const INCIDENT_TYPES = {
  late_officials: 'Late officials or materials',
  bvas_problem: 'BVAS problems',
  vote_buying: 'Vote buying',
  intimidation_violence: 'Intimidation or violence',
  ballot_snatching: 'Ballot snatching',
  missing_ec60e: 'Missing EC60E poster',
  other: 'Other',
} as const;
export type IncidentType = keyof typeof INCIDENT_TYPES;

/** Table 5 labels: never "true" or "fake" */
export const INCIDENT_LABELS = {
  supported: 'Supported by evidence',
  partly_supported: 'Partly supported',
  not_supported: 'Not supported by evidence',
  unconfirmed: 'Unconfirmed',
  under_review: 'Under review',
} as const;
export type IncidentLabel = keyof typeof INCIDENT_LABELS;

/**
 * INC-05: serious reports are held for a person whatever the AI says. "Other" is held too,
 * because nobody has said what it is.
 */
export const SERIOUS: ReadonlySet<IncidentType> = new Set(['intimidation_violence', 'ballot_snatching', 'vote_buying', 'other']);

/** INC-06: these get the emergency reply at once */
export const DANGER: ReadonlySet<IncidentType> = new Set(['intimidation_violence', 'ballot_snatching']);

export type Assessment = {
  /** Does the photo show what the claim states? */
  shows_claim: 'yes' | 'partly' | 'no' | 'unclear';
  signs_of_editing: boolean;
  /** A screenshot, a photo of a screen, or an image with forwarding marks */
  screenshot_or_forwarded: boolean;
  /** Names or clearly identifies a private person: never published without review */
  identifies_private_person: boolean;
  description: string;
};

export type LabelInput = {
  type: IncidentType;
  channel: 'web' | 'whatsapp' | 'sms' | 'ussd';
  assessment: Assessment | null;
  /** The same image was already used in another report or as a result photo */
  reused: boolean;
  /** Independent people who reported the same type at the same unit around the same time */
  corroboration: number;
};

/**
 * Label and publication for a report (INC-03 to INC-05). The evidence label is always computed;
 * serious reports, and reports naming private people, are held with "Under review".
 */
export function decideLabel(i: LabelInput): { label: IncidentLabel; suggested: IncidentLabel; status: 'published' | 'held' } {
  let suggested: IncidentLabel;
  const a = i.assessment;
  if (i.reused || a?.signs_of_editing) suggested = 'not_supported';
  else if (!a || a.shows_claim === 'unclear') suggested = i.corroboration >= 2 ? 'partly_supported' : 'unconfirmed';
  else if (a.shows_claim === 'no') suggested = 'not_supported';
  else if (a.shows_claim === 'partly') suggested = i.corroboration >= 2 && i.channel === 'web' ? 'supported' : 'partly_supported';
  else {
    // WhatsApp images lose capture time and place (INC-02): full support needs corroboration
    const weaker = i.channel !== 'web' || a.screenshot_or_forwarded;
    suggested = weaker && i.corroboration < 1 ? 'partly_supported' : 'supported';
  }
  const hold = SERIOUS.has(i.type) || !!a?.identifies_private_person;
  return hold ? { label: 'under_review', suggested, status: 'held' } : { label: suggested, suggested, status: 'published' };
}

const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** Reference numbers like TE-K7Q2MX: no 0/O or 1/I to misread */
export function newReference(random: (n: number) => Uint8Array) {
  return `TE-${[...random(6)].map((b) => REF_ALPHABET[b % REF_ALPHABET.length]).join('')}`;
}
