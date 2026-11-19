import type { Metadata } from 'next';
import Link from 'next/link';
import { CONFIDENCE_THRESHOLDS, UNOFFICIAL_LABEL } from '@trustelect/shared';
import { API_URL } from '@/lib/api-url';
import { RegisterForm } from './register-form';

export const metadata: Metadata = {
  title: 'API for developers',
  description:
    'Public, read-only TrustElect API: citizen-collated election results, polling unit lookups, incident reports and the evidence hash chain.',
};

const E = '{electionId}';

type Param = [name: string, where: 'path' | 'query', description: string];
type Endpoint = {
  id: string;
  method: 'GET';
  path: string;
  summary: string;
  params?: Param[];
  notes?: string;
  example: string;
  response?: string;
};
type Group = { id: string; title: string; intro: string; endpoints: Endpoint[] };

const GROUPS: Group[] = [
  {
    id: 'elections',
    title: 'Elections',
    intro: 'Elections that are active or closed. Drafts are never returned.',
    endpoints: [
      {
        id: 'list-elections',
        method: 'GET',
        path: '/elections',
        summary: 'List elections.',
        example: '/elections',
        response: `[
  {
    "id": "6f1c0e2a-…",
    "type": "governorship",
    "title": "Lagos Governorship Election 2027",
    "electionDate": "2027-03-06",
    "scopeLevel": "state",
    "scopeCode": "24",
    "pollsCloseAt": "2027-03-06T13:30:00.000Z",
    "status": "active",
    "parties": 18
  }
]`,
        notes:
          'type is one of presidential, governorship, senate, house_of_representatives, state_assembly, area_council, local_government. status is active or closed.',
      },
      {
        id: 'get-election',
        method: 'GET',
        path: `/elections/${E}`,
        summary: 'One election with its ballot (parties in ballot order).',
        params: [['electionId', 'path', 'Election id (UUID) from the list above']],
        example: `/elections/${E}`,
      },
    ],
  },
  {
    id: 'results',
    title: 'Results',
    intro: `Citizen-collated totals, counted from polling unit results that voters photographed and TrustElect verified. Every figure is ${UNOFFICIAL_LABEL.toLowerCase()}: show that label wherever you display it.`,
    endpoints: [
      {
        id: 'area-totals',
        method: 'GET',
        path: `/results/elections/${E}`,
        summary: 'Totals for the whole election area, or a smaller area within it, with a row for each child area.',
        params: [
          ['electionId', 'path', 'Election id (UUID)'],
          ['level', 'query', 'Optional: national, state, lga or ward. Defaults to the election’s own area'],
          ['code', 'query', 'Required with level: the state (24), LGA (24-05) or ward (24-05-01) code'],
        ],
        example: `/results/elections/${E}?level=lga&code=24-05`,
        response: `{
  "election": { "id": "…", "title": "…", "type": "governorship", "electionDate": "2027-03-06", "status": "active" },
  "parties": [{ "acronym": "A", "name": "Accord" }, …],
  "area": { "level": "lga", "code": "24-05", "name": "APAPA", "path": [{ "level": "state", "code": "24", "name": "Lagos" }, …] },
  "childLevel": "ward",
  "totals": {
    "code": "24-05", "name": "APAPA",
    "totalUnits": 215, "countedUnits": 132,
    "mix": { "high": 70, "medium": 41, "low": 21, "provisional": 3, "disputed": 1, "notConfirmed": 83 },
    "partyVotes": { "A": 1520, "APC": 30214, … },
    "totalValid": 61873, "rejected": 912, "rejectedReportedUnits": 120,
    "comparison": {
      "status": "match_so_far",
      "disputeExists": false, "fullCoverage": false,
      "parties": [{ "party": "APC", "declared": 45120, "citizen": 30214, "exceedsDeclared": false }, …],
      "reasons": ["…"], "unitDifferences": []
    }
  },
  "children": [ { "code": "24-05-01", "name": "APAPA I …", "totalUnits": 22, "countedUnits": 15, … } ],
  "generatedAt": "2027-03-06T19:42:10.511Z"
}`,
        notes:
          'countedUnits out of totalUnits is the coverage: always show it beside totals. mix counts counted units by confidence. comparison appears where a declared result has been entered and approved.',
      },
      {
        id: 'unit-result',
        method: 'GET',
        path: '/results/units/{code}',
        summary: 'The result recorded for one polling unit, in every published election that covers it.',
        params: [['code', 'path', 'Polling unit code, e.g. 24-05-01-003']],
        example: '/results/units/24-05-01-003',
        response: `{
  "unit": {
    "code": "24-05-01-003", "name": "BADAGRY ROAD",
    "wardCode": "24-05-01", "wardName": "APAPA I (MARINE RD. & ENVIRONS)",
    "lgaCode": "24-05", "lgaName": "APAPA", "stateCode": "24", "stateName": "Lagos"
  },
  "results": [
    {
      "election": { "id": "…", "title": "…", "electionDate": "2027-03-06", "status": "active" },
      "status": "counted",
      "confidence": "high",
      "witnessCount": 4, "stampedWitnesses": 4, "strongWitnesses": 3, "versionCount": 1,
      "updatedAt": "2027-03-06T17:05:44.120Z",
      "parties": [{ "acronym": "A", "name": "Accord" }, …],
      "figures": { "partyVotes": { "A": 12, "APC": 201, … }, "totalValid": 388, "rejected": 6, "totalCast": 394 }
    }
  ]
}`,
        notes:
          'status is not_confirmed, counted, provisional, disputed or resolved. figures is null until the unit is counted.',
      },
      {
        id: 'stream',
        method: 'GET',
        path: `/results/elections/${E}/stream`,
        summary: 'Live updates (Server-Sent Events). Sends an "update" event whenever this election’s results change.',
        params: [['electionId', 'path', 'Election id (UUID)']],
        example: `/results/elections/${E}/stream`,
        response: `event: update
data: {"electionId":"…","at":"2027-03-06T19:42:10.511Z"}`,
        notes:
          'The event carries no figures: fetch the totals again when it arrives. A comment line every 25 seconds keeps the connection open. Not rate limited; please hold one connection, not one per user.',
      },
    ],
  },
  {
    id: 'register',
    title: 'Polling unit register',
    intro:
      "INEC's public register of states, LGAs, wards and polling units (176,846 units). Codes follow the voter's card: state-LGA-ward-unit, e.g. 24-05-01-003.",
    endpoints: [
      {
        id: 'geo-summary',
        method: 'GET',
        path: '/geo/summary',
        summary: 'How many areas of each kind the register holds.',
        example: '/geo/summary',
        response: '{ "states": 37, "lgas": 774, "wards": 8809, "pollingUnits": 176846 }',
      },
      {
        id: 'geo-states',
        method: 'GET',
        path: '/geo/states',
        summary: 'All states and the FCT.',
        example: '/geo/states',
        response: '[{ "code": "01", "name": "Abia", "lgas": 17 }, { "code": "02", "name": "Adamawa", "lgas": 21 }, …]',
      },
      {
        id: 'geo-lgas',
        method: 'GET',
        path: '/geo/states/{code}/lgas',
        summary: 'LGAs in a state.',
        params: [['code', 'path', 'State code, e.g. 24']],
        example: '/geo/states/24/lgas',
        response: '[{ "code": "24-01", "name": "AGEGE", "wards": 11 }, …]',
      },
      {
        id: 'geo-wards',
        method: 'GET',
        path: '/geo/lgas/{code}/wards',
        summary: 'Wards in an LGA.',
        params: [['code', 'path', 'LGA code, e.g. 24-05']],
        example: '/geo/lgas/24-05/wards',
      },
      {
        id: 'geo-units',
        method: 'GET',
        path: '/geo/wards/{code}/units',
        summary: 'Polling units in a ward.',
        params: [['code', 'path', 'Ward code, e.g. 24-05-01']],
        example: '/geo/wards/24-05-01/units',
      },
      {
        id: 'geo-unit',
        method: 'GET',
        path: '/geo/units/{code}',
        summary: 'One polling unit with its ward, LGA and state.',
        params: [['code', 'path', 'Polling unit code, e.g. 24-05-01-003']],
        example: '/geo/units/24-05-01-003',
        response: `{
  "code": "24-05-01-003", "name": "BADAGRY ROAD", "registeredVoters": null,
  "ward": { "code": "24-05-01", "name": "APAPA I (MARINE RD. & ENVIRONS)" },
  "lga": { "code": "24-05", "name": "APAPA" },
  "state": { "code": "24", "name": "Lagos" }
}`,
      },
    ],
  },
  {
    id: 'incidents',
    title: 'Incident reports',
    intro:
      'Reports voters sent with a photo (late officials, BVAS problems, vote-buying and others). Only published reports are returned; serious ones are reviewed by a person first. Labels describe the evidence, never "true" or "fake".',
    endpoints: [
      {
        id: 'list-incidents',
        method: 'GET',
        path: '/incidents',
        summary: 'Published reports, newest first.',
        params: [
          ['code', 'query', 'Optional: a state, LGA, ward or polling unit code to filter by'],
          ['limit', 'query', 'Optional: 1 to 100 (default 50)'],
        ],
        example: '/incidents?code=24-05&limit=20',
        response: `[
  {
    "reference": "TE-7KQ2MX",
    "typeText": "Vote-buying",
    "claim": "Money shared near the queue",
    "label": "supported", "labelText": "Supported by evidence",
    "channel": "web", "corroboration": 2,
    "receivedAt": "2027-03-06T10:14:03.000Z",
    "unitCode": "24-05-01-003", "unitName": "BADAGRY ROAD", "wardName": "…", "lgaName": "APAPA"
  }
]`,
        notes: 'label is supported, partly_supported, not_supported, unconfirmed or under_review.',
      },
      {
        id: 'incident-ref',
        method: 'GET',
        path: '/incidents/ref/{reference}',
        summary: 'Follow one report by the reference given to the person who sent it.',
        params: [['reference', 'path', 'Report reference, e.g. TE-7KQ2MX']],
        example: '/incidents/ref/TE-7KQ2MX',
      },
    ],
  },
  {
    id: 'evidence',
    title: 'Evidence and the hash chain',
    intro:
      'Every accepted photo, unit result, declared result and administrator action is written to an append-only hash chain. Anyone can download it and check that nothing was changed, without trusting TrustElect.',
    endpoints: [
      {
        id: 'chain-head',
        method: 'GET',
        path: '/chain/head',
        summary: 'The latest chain entry and the latest published anchor.',
        example: '/chain/head',
        response: `{
  "head": { "seq": 1, "hash": "1f4cb664…22a5a", "createdAt": "2026-11-19T02:55:46.237Z" },
  "latestAnchor": { "id": 1, "seq": 1, "hash": "1f4cb664…22a5a", "createdAt": "2026-11-19T03:02:58.282Z", "externalProvider": "opentimestamps" }
}`,
      },
      {
        id: 'chain-entries',
        method: 'GET',
        path: '/chain/entries',
        summary: 'Chain entries in order. Each entry’s hash covers the one before it.',
        params: [
          ['from', 'query', 'Optional: first sequence number (default 1)'],
          ['limit', 'query', 'Optional: 1 to 5000 (default 1000)'],
        ],
        example: '/chain/entries?from=1&limit=1000',
        response: `[
  {
    "seq": 1, "entryType": "audit", "refId": "1",
    "payloadSha256": "4c68868e…5c68",
    "prevHash": "0000000000000000000000000000000000000000000000000000000000000000",
    "hash": "1f4cb664…22a5a",
    "createdAt": "2026-11-19T02:55:46.237Z"
  }
]`,
        notes: 'entryType is submission, unit_result, declaration, incident or audit. Hashes only: no record contents.',
      },
      {
        id: 'chain-anchors',
        method: 'GET',
        path: '/chain/anchors',
        summary: 'Published anchors: the chain head at regular intervals, timestamped on the Bitcoin blockchain via OpenTimestamps.',
        params: [['limit', 'query', 'Optional: 1 to 500 (default 50)']],
        example: '/chain/anchors?limit=10',
      },
      {
        id: 'anchor-files',
        method: 'GET',
        path: '/chain/anchors/{id}/{file}',
        summary: 'Download an anchor record (record.txt) and its OpenTimestamps proof (record.txt.ots).',
        params: [
          ['id', 'path', 'Anchor id'],
          ['file', 'path', 'record.txt or record.txt.ots'],
        ],
        example: '/chain/anchors/1/record.txt',
        notes: 'Check the proof yourself with the OpenTimestamps client: ots verify trustelect-anchor-1.txt.ots',
      },
      {
        id: 'pack-unit',
        method: 'GET',
        path: `/evidence/elections/${E}/units/{code}`,
        summary: 'Evidence pack (ZIP) for one polling unit: photos, records, chain entries and a manifest.',
        params: [
          ['electionId', 'path', 'Election id (UUID)'],
          ['code', 'path', 'Polling unit code'],
        ],
        example: `/evidence/elections/${E}/units/24-05-01-003`,
        notes: 'Limited to 20 downloads a minute. Check a pack in the browser at /verify.',
      },
      {
        id: 'pack-ward',
        method: 'GET',
        path: `/evidence/elections/${E}/wards/{code}`,
        summary: 'Evidence pack (ZIP) for every polling unit in a ward.',
        params: [
          ['electionId', 'path', 'Election id (UUID)'],
          ['code', 'path', 'Ward code, e.g. 24-05-01'],
        ],
        example: `/evidence/elections/${E}/wards/24-05-01`,
        notes: 'Limited to 5 downloads a minute.',
      },
    ],
  },
  {
    id: 'status',
    title: 'Service status',
    intro: 'For monitoring your integration.',
    endpoints: [
      {
        id: 'health-ready',
        method: 'GET',
        path: '/health/ready',
        summary: 'Whether the API is serving. 503 when it is down. No key needed.',
        example: '/health/ready',
        response: '{ "status": "ok", "database": "up", "ai": "configured", "verification": { "pending": 0, "oldestMinutes": 0, "behind": false } }',
        notes: 'status is degraded when photos are waiting more than 15 minutes for verification; results are still served.',
      },
    ],
  },
];

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-xl bg-[#0f1b2d] p-4 text-[0.8125rem] leading-relaxed text-[#e6edf3]">
      <code>{children}</code>
    </pre>
  );
}

function EndpointCard({ e }: { e: Endpoint }) {
  return (
    <article id={e.id} aria-labelledby={`${e.id}-h`} className="grid scroll-mt-24 gap-4 rounded-2xl border border-divider bg-surface p-5">
      <div className="grid gap-1.5">
        <h4 id={`${e.id}-h`} className="flex flex-wrap items-center gap-2 font-mono text-[0.9375rem] font-semibold break-all">
          <span className="rounded-md bg-surface-tint px-2 py-0.5 text-xs font-bold text-brand-strong">{e.method}</span>
          {e.path}
        </h4>
        <p className="text-ink-muted">{e.summary}</p>
      </div>
      {e.params && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <thead className="text-ink-muted">
              <tr>
                <th scope="col" className="py-1.5 pr-4 font-semibold">Parameter</th>
                <th scope="col" className="py-1.5 pr-4 font-semibold">In</th>
                <th scope="col" className="py-1.5 font-semibold">Description</th>
              </tr>
            </thead>
            <tbody>
              {e.params.map(([name, where, desc]) => (
                <tr key={name} className="border-t border-divider align-top">
                  <td className="py-1.5 pr-4 font-mono">{name}</td>
                  <td className="py-1.5 pr-4 text-ink-muted">{where}</td>
                  <td className="py-1.5">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="grid gap-2">
        <p className="text-sm font-semibold">Example</p>
        <Code>{e.path.startsWith('/health') ? `curl "${API_URL}${e.example}"` : `curl -H "X-API-Key: $TRUSTELECT_API_KEY" \\
  "${API_URL}${e.example}"`}</Code>
      </div>
      {e.response && (
        <div className="grid gap-2">
          <p className="text-sm font-semibold">Response</p>
          <Code>{e.response}</Code>
        </div>
      )}
      {e.notes && <p className="text-sm text-ink-muted">{e.notes}</p>}
    </article>
  );
}

export default function DevelopersPage() {
  return (
    <div className="mx-auto grid max-w-6xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <nav aria-label="API sections" className="hidden lg:block">
        <ul className="sticky top-[calc(var(--header-height)+1.5rem)] grid gap-1 text-sm">
          <li><a href="#overview" className="block rounded-lg px-3 py-1.5 text-ink-muted hover:bg-surface-muted hover:text-ink">Overview</a></li>
          <li><a href="#register" className="block rounded-lg px-3 py-1.5 text-ink-muted hover:bg-surface-muted hover:text-ink">Get an API key</a></li>
          {GROUPS.map((g) => (
            <li key={g.id}>
              <a href={`#${g.id}`} className="block rounded-lg px-3 py-1.5 text-ink-muted hover:bg-surface-muted hover:text-ink">{g.title}</a>
            </li>
          ))}
          <li><a href="#terms" className="block rounded-lg px-3 py-1.5 text-ink-muted hover:bg-surface-muted hover:text-ink">Terms of use</a></li>
        </ul>
      </nav>

      <div className="grid min-w-0 gap-12">
        <section id="overview" aria-labelledby="overview-h" className="grid scroll-mt-24 gap-5">
          <div className="grid gap-3">
            <p className="text-sm font-semibold text-verified">For developers</p>
            <h1 id="overview-h" className="text-3xl font-bold tracking-tight">TrustElect API</h1>
            <p className="max-w-[65ch] text-lg text-ink-muted">
              Newsrooms, observer groups, civil society and researchers can use the same data as this site: citizen-collated
              results counted from the polling unit up, polling unit lookups, incident reports and the evidence hash chain.
            </p>
          </div>

          <dl className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1 rounded-2xl border border-divider bg-surface p-5">
              <dt className="text-sm font-semibold text-ink-muted">Base URL</dt>
              <dd className="font-mono break-all">{API_URL}</dd>
            </div>
            <div className="grid gap-1 rounded-2xl border border-divider bg-surface p-5">
              <dt className="text-sm font-semibold text-ink-muted">Access</dt>
              <dd>Registered organisations only. Send your approved key in the <code className="font-mono text-sm">X-API-Key</code> header. Read-only JSON over HTTPS.</dd>
            </div>
            <div className="grid gap-1 rounded-2xl border border-divider bg-surface p-5">
              <dt className="text-sm font-semibold text-ink-muted">Rate limit</dt>
              <dd>1,200 requests a minute per key. Over the limit you get 429: wait a minute and retry.</dd>
            </div>
            <div className="grid gap-1 rounded-2xl border border-divider bg-surface p-5">
              <dt className="text-sm font-semibold text-ink-muted">Freshness</dt>
              <dd>Totals are cached for 5 seconds, unit results for 15. Use the live stream instead of polling fast.</dd>
            </div>
          </dl>

          <div className="grid gap-3">
            <h2 className="text-xl font-semibold">Before you start</h2>
            <ul className="grid max-w-[70ch] list-disc gap-2 pl-5 text-ink-muted">
              <li>
                <strong className="text-ink">Register, then keep your key secret.</strong> Call the API from your server and serve the
                data to your readers. Never put the key in a web page or app: anyone could copy it, and TrustElect will revoke keys
                that leak or are misused.
              </li>
              <li>
                <strong className="text-ink">Errors</strong> come back as JSON with an HTTP status: 400 for a malformed parameter (with
                an <code className="font-mono text-sm">issues</code> list), 401 when the key is missing, wrong or revoked, 403 while it
                waits for approval, 404 when the election, area or unit does not exist, 429 when rate limited.
              </li>
              <li>
                <strong className="text-ink">Confidence</strong> comes from independent witnesses: {CONFIDENCE_THRESHOLDS.medium} matching
                witnesses make medium confidence, {CONFIDENCE_THRESHOLDS.high} or more make high. A unit without a stamped photo stays
                low.
              </li>
              <li>
                <strong className="text-ink">Comparison status</strong> is one of <code className="font-mono text-sm">match</code>,{' '}
                <code className="font-mono text-sm">match_so_far</code>, <code className="font-mono text-sm">does_not_match</code>,{' '}
                <code className="font-mono text-sm">possible_mismatch_low_confidence</code>,{' '}
                <code className="font-mono text-sm">conflicting_declarations</code> or{' '}
                <code className="font-mono text-sm">awaiting_data</code>. See{' '}
                <Link href="/#labels-heading" className="font-semibold text-brand-strong hover:underline">reading the results</Link>.
              </li>
            </ul>
          </div>

          <div className="grid gap-2">
            <h2 className="text-xl font-semibold">Quick start</h2>
            <p className="text-ink-muted">Find an election, then read its national totals and one polling unit.</p>
            <Code>{`export TRUSTELECT_API_KEY="te_live_…"   # from the registration below
curl -H "X-API-Key: $TRUSTELECT_API_KEY" "${API_URL}/elections"
curl -H "X-API-Key: $TRUSTELECT_API_KEY" "${API_URL}/results/elections/{electionId}"
curl -H "X-API-Key: $TRUSTELECT_API_KEY" "${API_URL}/results/units/24-05-01-003"`}</Code>
          </div>
        </section>

        <section id="register" aria-labelledby="register-h" className="grid scroll-mt-24 gap-4 rounded-2xl border-2 border-brand bg-surface p-6">
          <div className="grid gap-2">
            <h2 id="register-h" className="text-2xl font-bold tracking-tight">Get an API key</h2>
            <p className="max-w-[70ch] text-ink-muted">
              Tell us who you are and how you will use the data. You get your key straight away; it starts working once TrustElect
              approves the registration. Approved keys can be revoked if they are misused.
            </p>
          </div>
          <RegisterForm />
        </section>

        {GROUPS.map((g) => (
          <section key={g.id} id={g.id} aria-labelledby={`${g.id}-title`} className="grid scroll-mt-24 gap-5">
            <div className="grid gap-2">
              <h2 id={`${g.id}-title`} className="text-2xl font-bold tracking-tight">{g.title}</h2>
              <p className="max-w-[70ch] text-ink-muted">{g.intro}</p>
            </div>
            <div className="grid gap-5">
              {g.endpoints.map((e) => (
                <EndpointCard key={e.id} e={e} />
              ))}
            </div>
          </section>
        ))}

        <section id="terms" aria-labelledby="terms-h" className="grid scroll-mt-24 gap-3 rounded-2xl border-2 border-brand bg-surface-tint p-6">
          <h2 id="terms-h" className="text-xl font-semibold">Terms of use</h2>
          <ul className="grid max-w-[70ch] list-disc gap-2 pl-5">
            <li>
              Label every figure <strong>&ldquo;{UNOFFICIAL_LABEL}&rdquo;</strong> and credit TrustElect. TrustElect is not INEC; official
              results are declared by INEC.
            </li>
            <li>Always show coverage (counted units out of total) and confidence beside totals.</li>
            <li>Do not present a comparison as proof of rigging, or totals as a projection of the winner.</li>
            <li>The API returns no personal data: no phone numbers, no names of the people who sent photos.</li>
            <li>Keep your key secret and do not share it. One key per organisation; TrustElect may revoke a key at any time.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
