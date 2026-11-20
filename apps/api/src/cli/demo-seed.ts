/**
 * Creates a demo election with sample data, for presentations and the demo video:
 * "Edo Governorship Election (demo, sample data)". Every photo is a generated sample poster
 * marked "TrustElect demo data, not a real election result".
 *
 * Sample photos go through the real pipeline (capture, verification rules, witnesses,
 * counting, the hash chain); only the AI reading is supplied by this script. Run it while no
 * verification worker is running, so the real AI never reads the samples:
 *
 *   docker compose stop api
 *   docker compose run --rm api node dist/cli/demo-seed.js
 *   docker compose start api
 *
 * After a shortened run (stopped part-way), add the declared results on their own:
 *   docker compose run --rm api node dist/cli/demo-seed.js --declarations
 *
 * It refuses to run twice (the demo election's title is checked first).
 */
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { getDrizzleToken } from '@nestjs/drizzle';
import { asc, eq, like } from 'drizzle-orm';
import { posterPhoto, random } from './demo/photo.js';
import { TEMPLATE_PARTIES } from './demo/poster-template.js';

// No background workers in this process: the script drives verification itself
process.env.VERIFICATION_WORKER = 'off';
process.env.CHAIN_ANCHOR_WORKER = 'off';
process.env.RETENTION_WORKER = 'off';

const { AppModule } = await import('../app.module.js');
const { AuthService } = await import('../auth/auth.service.js');
const { CaptureService } = await import('../capture/capture.service.js');
const { DeclarationsService } =
  await import('../declarations/declarations.service.js');
const { ElectionsService } = await import('../elections/elections.service.js');
const { VerificationService } =
  await import('../verification/verification.service.js');
const { TallyService } = await import('../tally/tally.service.js');
const { OpenRouterVisionModel } =
  await import('../verification/vision-model.js');
const schema = await import('../database/schema.js');
type Database = import('../database/database.module.js').Database;
type Ec60eReading = import('../verification/reading.js').Ec60eReading;

export const DEMO_TITLE = 'Edo Governorship Election (demo, sample data)';
const STATE = '12'; // Edo
const STORY_LGA = '12-12'; // Oredo (Benin City)

/** The real Edo governorship poster used live in the demo video (figures as printed on it) */
const LIVE_POSTER: Record<string, number> = {
  AA: 0,
  ADC: 2,
  ADP: 1,
  APC: 37,
  APGA: 0,
  APM: 0,
  APP: 0,
  LP: 1,
  NNPP: 1,
  NRM: 1,
  PDP: 147,
  SDP: 0,
  YPP: 0,
  ZLP: 0,
};

const PARTY_NAMES: Record<string, string> = {
  AA: 'Action Alliance',
  ADC: 'African Democratic Congress',
  ADP: 'Action Democratic Party',
  APC: 'All Progressives Congress',
  APGA: 'All Progressives Grand Alliance',
  APM: 'Allied Peoples Movement',
  APP: 'Action Peoples Party',
  LP: 'Labour Party',
  NNPP: 'New Nigeria Peoples Party',
  NRM: 'National Rescue Movement',
  PDP: 'Peoples Democratic Party',
  SDP: 'Social Democratic Party',
  YPP: 'Young Progressives Party',
  ZLP: 'Zenith Labour Party',
};
const PARTIES = [...TEMPLATE_PARTIES];

const rnd = random(20271);

const app = await NestFactory.createApplicationContext(AppModule, {
  logger: ['error', 'warn'],
});
const db = app.get<Database>(getDrizzleToken());
const log = (...a: unknown[]) => console.log(...a);

try {
  // --declarations: only add the declared results to an existing demo election (e.g. after a shortened run)
  const declarationsOnly = process.argv.includes('--declarations');
  const [existing] = await db
    .select({ id: schema.elections.id })
    .from(schema.elections)
    .where(eq(schema.elections.title, DEMO_TITLE))
    .limit(1);
  if (existing && !declarationsOnly) {
    log(`The demo election already exists (${existing.id}). Nothing done.`);
    process.exit(0);
  }
  if (!existing && declarationsOnly)
    throw new Error('No demo election yet: run without --declarations first');

  // The AI reading of each sample photo is supplied here; the real model is never called
  const readings: Ec60eReading[] = [];
  // (several modules have their own model instance, so the class itself is patched, in this process only)
  const proto = OpenRouterVisionModel.prototype;
  Object.defineProperty(proto, 'name', {
    get: () => 'demo-seed (sample data)',
  });
  proto.read = async () => {
    const next = readings.shift();
    if (!next) throw new Error('demo seed: no reading queued');
    return next;
  };
  proto.readDeclaration = async () => {
    throw new Error('demo seed: sample source, not read');
  };

  // Administrators: an existing system administrator enters the declarations; a demo approver
  // account (random password, never shared, cannot sign in without completing two-factor) approves them
  const [enterer] = await db
    .select()
    .from(schema.adminUsers)
    .where(eq(schema.adminUsers.role, 'system_admin'))
    .orderBy(asc(schema.adminUsers.createdAt))
    .limit(1);
  if (!enterer)
    throw new Error('Create a system administrator first (create-admin)');
  const approverEmail = 'demo-approver@trustelect.invalid';
  let [approver] = await db
    .select()
    .from(schema.adminUsers)
    .where(eq(schema.adminUsers.email, approverEmail))
    .limit(1);
  if (!approver) {
    await app.get(AuthService).createAdmin({
      email: approverEmail,
      displayName: 'Demo data approver',
      role: 'approver',
      password: randomUUID() + randomUUID(),
    });
    [approver] = await db
      .select()
      .from(schema.adminUsers)
      .where(eq(schema.adminUsers.email, approverEmail))
      .limit(1);
  }

  // Parties on the Edo poster
  await db
    .insert(schema.parties)
    .values(PARTIES.map((acronym) => ({ acronym, name: PARTY_NAMES[acronym] })))
    .onConflictDoNothing();

  let electionId = existing?.id ?? '';
  if (!existing) {
    // Held "yesterday", polls closed at 14:30 Nigerian time
    const lagos = new Date(Date.now() + 3_600_000);
    const day = new Date(lagos.getTime() - 86_400_000)
      .toISOString()
      .slice(0, 10);
    const elections = app.get(ElectionsService);
    const election = await elections.createElection(
      {
        type: 'governorship',
        title: DEMO_TITLE,
        electionDate: day,
        scopeLevel: 'state',
        scopeCode: STATE,
        pollsCloseAt: `${day}T14:30:00+01:00`,
        partyAcronyms: PARTIES,
      },
      enterer.id,
    );
    await elections.setStatus(election.id, 'active', enterer.id);
    electionId = election.id;
    log(`Election ${electionId} (${day})`);
  }

  // Every Edo polling unit, with its ward and LGA
  const units = await db
    .select({
      code: schema.pollingUnits.code,
      name: schema.pollingUnits.name,
      ward: schema.wards.code,
      lga: schema.lgas.code,
    })
    .from(schema.pollingUnits)
    .innerJoin(schema.wards, eq(schema.wards.id, schema.pollingUnits.wardId))
    .innerJoin(schema.lgas, eq(schema.lgas.id, schema.wards.lgaId))
    .where(like(schema.pollingUnits.code, `${STATE}-%`))
    .orderBy(asc(schema.pollingUnits.code));

  // Story areas in Oredo: a ward that matches its declaration, one that does not, and the ward of the live demo unit
  const oredoWards = new Map<string, number>();
  for (const u of units)
    if (u.lga === STORY_LGA)
      oredoWards.set(u.ward, (oredoWards.get(u.ward) ?? 0) + 1);
  const bySize = [...oredoWards]
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .map(([w]) => w);
  const [matchWard, mismatchWard, demoWard] = bySize;
  const demoUnit = units.find((u) => u.ward === demoWard)!;

  const sum = (v: Record<string, number>) =>
    PARTIES.reduce((a, p) => a + v[p], 0);

  if (!declarationsOnly) {
    // Voting pattern: a two-party contest that varies by LGA
    const swing = new Map<string, number>();
    for (const u of units)
      if (!swing.has(u.lga)) swing.set(u.lga, rnd() * 0.24 - 0.12);
    function figures(lga: string) {
      const pdp = 0.47 + swing.get(lga)!;
      const shares: Record<string, number> = {
        PDP: pdp,
        APC: 0.85 - pdp,
        LP: 0.07,
        ADC: 0.02,
        NNPP: 0.012,
        ADP: 0.01,
        SDP: 0.008,
        YPP: 0.006,
        ZLP: 0.005,
        AA: 0.004,
        APGA: 0.004,
        APM: 0.003,
        APP: 0.003,
        NRM: 0.003,
      };
      const voters = 60 + Math.floor(rnd() * 270);
      const partyVotes: Record<string, number> = {};
      for (const p of PARTIES)
        partyVotes[p] = Math.max(
          0,
          Math.round(
            voters * shares[p] * (0.75 + rnd() * 0.5) -
              (shares[p] < 0.02 ? rnd() * 2 : 0),
          ),
        );
      return partyVotes;
    }

    const phones = new Set<string>();
    const newPhone = () => {
      for (;;) {
        const p = `0909${String(Math.floor(rnd() * 1e7)).padStart(7, '0')}`;
        if (!phones.has(p)) return (phones.add(p), p);
      }
    };
    const capture = app.get(CaptureService);
    const verification = app.get(VerificationService);
    let photos = 0;

    async function witness(
      unit: { code: string; name: string },
      partyVotes: Record<string, number>,
      opts: { stamped: boolean; rejected: number | null },
    ) {
      const { voter } = await capture.startWithoutVerification(newPhone());
      const totalValid = sum(partyVotes);
      const bytes = await posterPhoto(
        {
          unitCode: unit.code,
          partyVotes,
          totalValid,
          rejected: opts.rejected ?? 0,
          stamped: opts.stamped,
        },
        rnd,
      );
      const ip = `10.${Math.floor(rnd() * 250)}.${Math.floor(rnd() * 250)}.${1 + Math.floor(rnd() * 250)}`;
      const sub = await capture.submitPhoto(
        voter,
        {
          electionId,
          clientId: randomUUID(),
          unitCode: unit.code,
          deviceId: randomUUID(),
          ip,
        },
        bytes,
      );
      readings.push({
        is_ec60e: true,
        document_description: 'Sample EC60E poster (demo data)',
        image_quality: 'good',
        stamp_visible: opts.stamped,
        signature_present: true,
        election_type_on_form: 'Governorship',
        polling_unit_code: unit.code,
        polling_unit_name: unit.name,
        party_results: PARTIES.map((party) => ({
          party,
          votes: partyVotes[party],
          legible: true,
        })),
        total_valid_votes: totalValid,
        rejected_votes: opts.rejected,
        total_votes_cast:
          opts.rejected === null ? null : totalValid + opts.rejected,
        notes: 'Demo seed: sample data',
      });
      const decision = await verification.process(sub.id);
      if (!decision || decision.outcome !== 'verified')
        throw new Error(
          `Sample photo for ${unit.code} was not accepted: ${JSON.stringify(decision)}`,
        );
      photos++;
    }

    /** Counted figures per unit (the version that counts), to build the declarations */
    const counted = new Map<string, Record<string, number>>();

    async function seedUnit(
      unit: (typeof units)[number],
      plan: 'full' | 'any',
    ) {
      const a = figures(unit.lga);
      const rejected = Math.floor(rnd() * 9);
      const stamped = rnd() < 0.92 || plan === 'full';
      const r = plan === 'full' ? rnd() * 0.45 : rnd();
      if (r < 0.3)
        for (let i = 0; i < 4; i++)
          await witness(unit, a, { stamped, rejected });
      else if (r < 0.45)
        for (let i = 0; i < 3; i++)
          await witness(unit, a, { stamped, rejected });
      else if (r < 0.7)
        for (let i = 0; i < 2; i++)
          await witness(unit, a, { stamped, rejected });
      else if (r < 0.93) await witness(unit, a, { stamped, rejected });
      else {
        // Two versions: a close lead (provisional) or a tie (disputed), for the review queue
        const b = {
          ...a,
          APC: a.APC + 15 + Math.floor(rnd() * 20),
          PDP: Math.max(0, a.PDP - 15),
        };
        const tie = r >= 0.965;
        for (let i = 0; i < (tie ? 2 : 3); i++)
          await witness(unit, a, { stamped, rejected });
        for (let i = 0; i < 2; i++)
          await witness(unit, b, { stamped, rejected });
        if (tie) return;
      }
      counted.set(unit.code, a);
    }

    // 1. The story areas
    for (const u of units.filter(
      (x) => x.ward === matchWard || x.ward === mismatchWard,
    ))
      await seedUnit(u, 'full');
    log(
      `Story wards seeded: ${matchWard} (match), ${mismatchWard} (does not match)`,
    );
    // 2. The live demo unit: one witness with the live poster's figures
    await witness(demoUnit, LIVE_POSTER, { stamped: true, rejected: null });
    counted.set(demoUnit.code, LIVE_POSTER);
    // 3. Coverage elsewhere: more in Oredo and its demo ward, 10-45% in other LGAs
    const coverage = new Map<string, number>();
    for (const u of units)
      if (!coverage.has(u.lga)) coverage.set(u.lga, 0.1 + rnd() * 0.35);
    for (const u of units) {
      if (
        u.ward === matchWard ||
        u.ward === mismatchWard ||
        u.code === demoUnit.code
      )
        continue;
      const p =
        u.ward === demoWard
          ? 0.6
          : u.lga === STORY_LGA
            ? 0.4
            : coverage.get(u.lga)!;
      if (rnd() < p) await seedUnit(u, 'any');
      if (photos % 250 === 0) log(`  ${photos} photos…`);
    }
    log(`Photos: ${photos}, counted units: ${counted.size}`);
  }

  const [declared] = await db
    .select({ id: schema.declarations.id })
    .from(schema.declarations)
    .where(eq(schema.declarations.electionId, electionId))
    .limit(1);
  if (declared) {
    log('Declarations already recorded. Nothing more to do.');
    process.exit(0);
  }

  // Declarations, entered by one administrator and approved by another (the real two-person flow)
  const declarations = app.get(DeclarationsService);
  // Citizen totals as the counting engine has them (counted units, every confidence level)
  const tally = app.get(TallyService);
  const totalOf = async (level: 'ward' | 'lga', code: string) => {
    const { totals } = await tally.area(electionId, level, code);
    return Object.fromEntries(
      PARTIES.map((p) => [p, totals.partyVotes[p] ?? 0]),
    ) as Record<string, number>;
  };
  async function declare(
    level: 'ward' | 'lga',
    areaCode: string,
    partyVotes: Record<string, number>,
  ) {
    const sheet = await posterPhoto(
      {
        unitCode: areaCode,
        partyVotes,
        totalValid: sum(partyVotes),
        rejected: 0,
        stamped: true,
      },
      rnd,
    );
    const { sourceFileKey } = await declarations.uploadSource(
      electionId,
      sheet,
      enterer.id,
    );
    const d = await declarations.create(
      {
        electionId,
        level,
        areaCode,
        partyVotes,
        totalValid: sum(partyVotes),
        declaredAt: new Date(Date.now() - 600_000).toISOString(),
        sourceKind: 'collation_result_photo',
        sourceFileKey,
      },
      enterer.id,
    );
    await declarations.approve(d.id, approver.id);
  }
  // Matches: exactly what witnesses recorded
  await declare('ward', matchWard, await totalOf('ward', matchWard));
  // Does not match: 120 votes moved from PDP to APC
  const moved = await totalOf('ward', mismatchWard);
  await declare('ward', mismatchWard, {
    ...moved,
    PDP: moved.PDP - 120,
    APC: moved.APC + 120,
  });
  // The LGA, partly counted: declared totals above what is counted so far
  const lga = await totalOf('lga', STORY_LGA);
  await declare(
    'lga',
    STORY_LGA,
    Object.fromEntries(PARTIES.map((p) => [p, Math.round(lga[p] * 1.7) + 3])),
  );
  log('Declarations: match, does not match, match so far');

  log('');
  log(
    `Demo unit for the live capture: ${demoUnit.code} ${demoUnit.name} (ward ${demoWard}), 1 witness with the poster's figures`,
  );
  log(`Results:  /results/election?id=${electionId}`);
  log(`Unit:     /results?unit=${demoUnit.code}`);
  log(
    `Wards:    match ${matchWard}, does not match ${mismatchWard}; LGA ${STORY_LGA} match so far`,
  );
} finally {
  await app.close();
}
