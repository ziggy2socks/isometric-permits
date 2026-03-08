import type { Permit } from './permit-types';

// Proxy paths — Vite dev server proxies these, Vercel rewrites handle prod
const PERMITS_BASE = '/api/permits';
const JOBS_BASE    = '/api/jobs';

// ── Fetch ────────────────────────────────────────────────────────────────────

// Reverse map: our short code → Socrata work_type strings for $where clause
// Reverse map: our code → exact Socrata work_type values (from $select=distinct+work_type)
const CODE_TO_WORK_TYPE: Record<string, string[]> = {
  NB:  ['New Building'],
  DM:  ['Full Demolition'],
  GC:  ['General Construction'],
  PL:  ['Plumbing'],
  ME:  ['Mechanical Systems', 'Protection and Mechanical Methods'],
  SOL: ['Solar'],
  SHD: ['Sidewalk Shed'],
  SCF: ['Supported Scaffold', 'Suspended Scaffold'],
  FNC: ['Construction Fence'],
  SG:  ['Sign'],
  FND: ['Foundation'],
  STR: ['Structural'],
  BLR: ['Boiler Equipment'],
  SPR: ['Sprinklers'],
  EW:  ['Earth Work', 'Support of Excavation'],
  ANT: ['Antenna'],
  CC:  ['Curb Cut'],
  STP: ['Standpipe'],
};

export async function fetchPermits(
  dateFrom: string,
  dateTo: string,
  limit: number = 2000,
  jobTypeCodes?: Set<string>,
  boroughNames?: Set<string>,
): Promise<Permit[]> {
  // Build Socrata query strings manually — URLSearchParams encodes $ → %24 which breaks API
  const toISO = (s: string) => `${s}T00:00:00.000`;
  const fromStr = toISO(dateFrom);
  // Add 1 day to dateTo to make it inclusive
  const toDate = new Date(dateTo); toDate.setDate(toDate.getDate() + 1);
  const toStr = toDate.toISOString().split('T')[0] + 'T00:00:00.000';

  // Build work_type filter for Socrata $where
  const allSelected = !jobTypeCodes || jobTypeCodes.size >= ALL_JOB_TYPES.length;
  let workTypeFilter = '';
  if (!allSelected) {
    const workTypes: string[] = [];
    for (const code of jobTypeCodes) {
      const types = CODE_TO_WORK_TYPE[code];
      if (types) workTypes.push(...types);
      if (code === 'OTH') workTypes.push('Other');
    }
    if (workTypes.length > 0) {
      workTypeFilter = `+AND+work_type+IN(${workTypes.map(t => `%27${encodeURIComponent(t)}%27`).join(',')})`;
    } else if (!jobTypeCodes.has('NB') && !jobTypeCodes.has('DM')) {
      workTypeFilter = '__SKIP_WORK__';
    }
  }

  // Build borough filter
  let boroughFilter = '';
  if (boroughNames && boroughNames.size < ALL_BOROUGHS.length) {
    const boros = [...boroughNames].map(b => `%27${encodeURIComponent(b)}%27`).join(',');
    boroughFilter = `+AND+borough+IN(${boros})`;
  }

  const fetchWork = workTypeFilter !== '__SKIP_WORK__';
  const fetchJobs = allSelected || (jobTypeCodes?.has('NB') || jobTypeCodes?.has('DM'));

  const workQuery = [
    `$order=issued_date+DESC`,
    `$limit=${limit}`,
    `$where=issued_date+>=%27${fromStr}%27+AND+issued_date+<%27${toStr}%27+AND+latitude+IS+NOT+NULL+AND+longitude+IS+NOT+NULL${workTypeFilter !== '__SKIP_WORK__' ? workTypeFilter : ''}${boroughFilter}`,
  ].join('&');

  // Jobs endpoint: NB and DM only
  const jobTypeIn = allSelected ? `%27New%20Building%27,%27Full%20Demolition%27`
    : [jobTypeCodes?.has('NB') ? `%27New%20Building%27` : '', jobTypeCodes?.has('DM') ? `%27Full%20Demolition%27` : ''].filter(Boolean).join(',');
  const jobQuery = [
    `$order=approved_date+DESC`,
    `$limit=${Math.max(100, Math.round(limit * 0.3))}`,
    `$where=job_type+IN(${jobTypeIn})+AND+latitude+IS+NOT+NULL+AND+approved_date+>=%27${fromStr}%27+AND+approved_date+<%27${toStr}%27${boroughFilter}`,
  ].join('&');

  const fetches: Promise<Response>[] = [];
  if (fetchWork) fetches.push(fetch(`${PERMITS_BASE}?${workQuery}`, { cache: 'no-store' }));
  else fetches.push(Promise.resolve(new Response('[]', { status: 200 })));
  if (fetchJobs && jobTypeIn) fetches.push(fetch(`${JOBS_BASE}?${jobQuery}`, { cache: 'no-store' }));
  else fetches.push(Promise.resolve(new Response('[]', { status: 200 })));

  const [workRes, jobRes] = await Promise.all(fetches);

  if (!workRes.ok) throw new Error(`Permits API ${workRes.status}`);
  if (!jobRes.ok)  throw new Error(`Jobs API ${jobRes.status}`);

  const workRaw: Permit[] = await workRes.json();
  const jobRaw:  Permit[] = await jobRes.json();

  const workPermits = workRaw.map(p => ({ ...p, job_type: workTypeToCode(p.work_type ?? '') }));
  const jobPermits: Permit[] = jobRaw.map(p => ({
    ...p,
    work_type: p.job_type,
    job_type: p.job_type === 'New Building' ? 'NB' : 'DM',
    issued_date: p.approved_date,
  }));

  return [...workPermits, ...jobPermits];
}

// ── Address / keyword search (full DB, no date filter) ───────────────────────
// Hits Socrata directly — CORS is open (*), bypasses Vite proxy encoding issues

const SOCRATA_PERMITS = 'https://data.cityofnewyork.us/resource/rbx6-tga4.json';
const SOCRATA_JOBS    = 'https://data.cityofnewyork.us/resource/w9ak-ipjd.json';

export async function searchPermits(query: string, limit = 2000, dateFrom?: string, dateTo?: string): Promise<Permit[]> {
  const q = query.trim();
  if (!q) return [];

  // Date clause
  const dateClause = (dateFrom && dateTo)
    ? ` AND issued_date >= '${dateFrom}T00:00:00' AND issued_date <= '${dateTo}T23:59:59'`
    : '';
  const jobDateClause = (dateFrom && dateTo)
    ? ` AND approved_date >= '${dateFrom}T00:00:00' AND approved_date <= '${dateTo}T23:59:59'`
    : '';

  // Quoted query (e.g. "oak street") → field-specific LIKE on address fields only
  // Unquoted → $q= full-text search across all fields (owner, address, description, etc.)
  const quotedMatch = q.match(/^"(.+)"$/);
  let workUrl: string;
  let jobUrl: string;

  if (quotedMatch) {
    // Exact phrase — search street_name + owner fields with LIKE
    const phrase = quotedMatch[1].toUpperCase().replace(/'/g, "''");
    const whereClause = `(upper(street_name) LIKE '%${phrase}%' OR upper(owner_business_name) LIKE '%${phrase}%' OR upper(owner_last_name) LIKE '%${phrase}%') AND latitude IS NOT NULL${dateClause}`;
    const jobWhereClause = `(upper(street_name) LIKE '%${phrase}%') AND latitude IS NOT NULL${jobDateClause}`;
    workUrl = `${SOCRATA_PERMITS}?$order=issued_date DESC&$limit=${limit}&$where=${encodeURIComponent(whereClause)}`;
    jobUrl  = `${SOCRATA_JOBS}?$order=approved_date DESC&$limit=200&$where=${encodeURIComponent(jobWhereClause)}`;
  } else {
    // Broad full-text search across all fields
    workUrl = `${SOCRATA_PERMITS}?$q=${encodeURIComponent(q)}&$order=issued_date%20DESC&$limit=${limit}&$where=latitude%20IS%20NOT%20NULL${encodeURIComponent(dateClause)}`;
    jobUrl  = `${SOCRATA_JOBS}?$q=${encodeURIComponent(q)}&$order=approved_date%20DESC&$limit=200&$where=latitude%20IS%20NOT%20NULL${encodeURIComponent(jobDateClause)}`;
  }

  // Hit Socrata directly — CORS is open (*)
  const [workRes, jobRes] = await Promise.all([
    fetch(workUrl, { cache: 'no-store' }),
    fetch(jobUrl,  { cache: 'no-store' }),
  ]);

  if (!workRes.ok) throw new Error(`Search API ${workRes.status}`);
  if (!jobRes.ok)  throw new Error(`Search API ${jobRes.status}`);

  const workRaw: Permit[] = await workRes.json();
  const jobRaw:  Permit[] = await jobRes.json();

  const workPermits = workRaw.map(p => ({ ...p, job_type: workTypeToCode(p.work_type ?? '') }));
  const jobPermits: Permit[] = jobRaw.map(p => ({
    ...p,
    work_type: p.job_type,
    job_type: p.job_type === 'New Building' ? 'NB' : 'DM',
    issued_date: p.approved_date,
  }));

  // Dedupe by job_filing_number
  const seen = new Set<string>();
  return [...workPermits, ...jobPermits].filter(p => {
    const key = p.job_filing_number ?? `${p.house_no}-${p.street_name}-${p.issued_date}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Work type normalization ───────────────────────────────────────────────────

export function workTypeToCode(workType: string): string {
  const wt = workType.toLowerCase();
  if (wt.includes('new building'))          return 'NB';
  if (wt.includes('full demolition'))       return 'DM';
  if (wt.includes('general construction'))  return 'GC';
  if (wt.includes('plumbing'))              return 'PL';
  if (wt.includes('mechanical') || wt.includes('protection and mechanical')) return 'ME';
  if (wt.includes('solar'))                 return 'SOL';
  if (wt.includes('sidewalk shed'))         return 'SHD';
  if (wt.includes('scaffold'))              return 'SCF';
  if (wt.includes('construction fence'))    return 'FNC';
  if (wt.includes('sign'))                  return 'SG';
  if (wt.includes('foundation'))            return 'FND';
  if (wt.includes('structural'))            return 'STR';
  if (wt.includes('boiler'))                return 'BLR';
  if (wt.includes('sprinkler'))             return 'SPR';
  if (wt.includes('earth work') || wt.includes('support of excavation')) return 'EW';
  if (wt.includes('antenna'))               return 'ANT';
  if (wt.includes('curb cut'))              return 'CC';
  if (wt.includes('standpipe'))             return 'STP';
  return 'OTH';
}

// ── Display helpers ───────────────────────────────────────────────────────────

export const WORK_TYPE_LABELS: Record<string, string> = {
  NB:  'New Building',
  DM:  'Demolition',
  GC:  'General Construction',
  PL:  'Plumbing',
  ME:  'Mechanical',
  SOL: 'Solar',
  SHD: 'Sidewalk Shed',
  SCF: 'Scaffold',
  FNC: 'Const. Fence',
  SG:  'Sign',
  FND: 'Foundation',
  STR: 'Structural',
  BLR: 'Boiler',
  SPR: 'Sprinklers',
  EW:  'Earth Work',
  ANT: 'Antenna',
  CC:  'Curb Cut',
  STP: 'Standpipe',
  OTH: 'Other',
};

export const WORK_TYPE_COLORS: Record<string, string> = {
  NB:  '#2d9c5e',  // green        — new building
  DM:  '#d63c3c',  // red          — demolition
  GC:  '#d4820a',  // amber        — general construction
  PL:  '#3b82c4',  // blue         — plumbing
  ME:  '#0ea5c4',  // cyan         — mechanical
  SOL: '#c4a000',  // gold         — solar
  SHD: '#8844cc',  // purple       — sidewalk shed
  SCF: '#c4448a',  // pink         — scaffold
  FNC: '#1aaa8c',  // teal         — construction fence
  SG:  '#666666',  // gray         — sign
  FND: '#8b5e3c',  // brown        — foundation
  STR: '#b85a00',  // deep orange  — structural
  BLR: '#cc2255',  // crimson      — boiler
  SPR: '#0077cc',  // sky blue     — sprinkler
  EW:  '#5a9900',  // olive        — earth work
  ANT: '#8800cc',  // violet       — antenna
  CC:  '#cc7700',  // dark amber   — curb cut
  STP: '#004faa',  // navy         — standpipe
  OTH: '#999999',  // neutral      — other
};

export const ALL_JOB_TYPES = ['NB', 'DM', 'GC', 'PL', 'ME', 'SOL', 'SHD', 'SCF', 'FNC', 'STR', 'FND', 'SG', 'BLR', 'SPR', 'EW', 'ANT', 'CC', 'STP', 'OTH'];
export const ALL_BOROUGHS  = ['MANHATTAN', 'BROOKLYN', 'QUEENS', 'BRONX', 'STATEN ISLAND'];

export function getJobColor(jobType: string): string { return WORK_TYPE_COLORS[jobType] ?? '#999'; }
export function getJobLabel(jobType: string): string { return WORK_TYPE_LABELS[jobType] ?? jobType; }

export function formatAddress(p: Permit): string {
  return [p.house_no, p.street_name, p.borough].filter(Boolean).join(' ') || 'Unknown address';
}

export function formatDate(dateStr?: string): string {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return dateStr; }
}

export const WORK_TYPE_EMOJIS: Record<string, string> = {
  NB:'🏗', DM:'💥', GC:'🔨', PL:'🔵', ME:'⚙️', SOL:'☀️',
  SHD:'🏚', SCF:'🪜', FNC:'🚧', SG:'📋', FND:'🪨', STR:'🔩',
  BLR:'🔥', SPR:'💧', EW:'🌍', ANT:'📡', CC:'🛤', STP:'🚿', OTH:'📌',
};

export function getJobEmoji(jobType: string): string { return WORK_TYPE_EMOJIS[jobType] ?? '📌'; }
