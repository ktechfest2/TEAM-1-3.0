/**
 * What the assistant may say (INF-01, INF-07). Each fact names its source. The assistant answers
 * only from these facts and from TrustElect's own data; for anything else it refers voters to INEC.
 * Sprint 11 moves this into an admin-managed knowledge base, reviewed against official INEC sources.
 */
export const KNOWLEDGE: { topic: string; fact: string; source: string }[] = [
  {
    topic: 'About TrustElect',
    fact: 'TrustElect collects photographs of the EC60E result posters pasted at polling units, checks them, and adds them up from the polling unit to ward, LGA, state and national level. Its figures are citizen-collated and unofficial. TrustElect is not INEC and does not declare winners. Official results are declared by INEC.',
    source: 'TrustElect',
  },
  {
    topic: 'Sending a result',
    fact: 'After counting, photograph the EC60E result poster at the polling unit with the live camera in the TrustElect web app. Send the word PHOTO on WhatsApp to get a one-time camera link. Photos sent as WhatsApp attachments are not accepted, because they can be old, forwarded or edited.',
    source: 'TrustElect',
  },
  {
    topic: 'Typed figures',
    fact: 'If you cannot use the camera, you can type the figures: PU, the polling unit code, then each party and its votes, for example "PU 24-05-01-003 APC 112 LP 98 PDP 140". Typed figures support a photographed result but never count on their own.',
    source: 'TrustElect',
  },
  {
    topic: 'Confidence',
    fact: 'A polling unit result has high confidence when 4 or more independent people photographed the same figures, medium with 2 or 3, and low with 1, or when no stamp is visible on the poster. When witnesses report different figures the unit is provisional or disputed and a reviewer checks it.',
    source: 'TrustElect',
  },
  {
    topic: 'EC60E poster',
    fact: 'The EC60E is the result poster the Presiding Officer pastes at the polling unit after votes are counted. It shows the votes for each party at that polling unit, so anyone present can see the result.',
    source: 'INEC Regulations and Guidelines for the Conduct of Elections',
  },
  {
    topic: 'What to bring',
    fact: 'To vote you need your Permanent Voter Card (PVC). You vote at the polling unit where you registered; the polling unit code is printed on your PVC.',
    source: 'Electoral Act 2022; INEC',
  },
  {
    topic: 'Accreditation',
    fact: 'Before voting, each voter is accredited with the Bimodal Voter Accreditation System (BVAS), which checks the voter\'s fingerprint or face against the register.',
    source: 'INEC Regulations and Guidelines for the Conduct of Elections, 2022',
  },
  {
    topic: 'Polling hours',
    fact: 'In recent general elections INEC set polling from 8:30 am to 2:30 pm, and voters already on the queue at closing time are allowed to vote. INEC announces the hours for each election, so check INEC\'s notice for this one.',
    source: 'INEC Regulations and Guidelines for the Conduct of Elections, 2022',
  },
  {
    topic: 'Official results online',
    fact: 'INEC publishes images of polling unit result sheets on its Result Viewing portal (IReV) at https://inecelectionresults.ng.',
    source: 'INEC',
  },
  {
    topic: 'Secret ballot and vote buying',
    fact: 'Your vote is secret: do not show your marked ballot to anyone. Buying or selling votes is an offence under the Electoral Act 2022.',
    source: 'Electoral Act 2022',
  },
  {
    topic: 'More information',
    fact: 'For anything about registration, your polling unit, candidates or election dates, check INEC\'s official website https://inecnigeria.org.',
    source: 'INEC',
  },
];

export const EMERGENCY_TEXT =
  'If you or anyone is in danger, move to safety and call 112 (Nigeria\'s emergency number) now. ' +
  'Tell the police officers at the polling unit, and report election offences to INEC (https://inecnigeria.org). ' +
  'TrustElect cannot send help.';

export const LANGUAGES = { en: 'English', pcm: 'Nigerian Pidgin', ha: 'Hausa', yo: 'Yoruba', ig: 'Igbo' } as const;
export type Language = keyof typeof LANGUAGES;
