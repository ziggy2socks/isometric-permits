import type { Permit } from './permit-types';

// Proxy paths — Vite dev server proxies these, Vercel rewrites handle prod
const PERMITS_BASE = '/api/permits';
const JOBS_BASE    = '/api/jobs';

// ── Fetch ────────────────────────────────────────────────────────────────────

export async function fetchPermits(
  dateFrom: string,
  dateTo: string,
  limit: number = 2000,
): Promise<Permit[]> {
  // Build Socrata query strings manually — URLSearchParams encodes $ → %24 which breaks API
  const toISO = (s: string) => `${s}T00:00:00.000`;
  const fromStr = toISO(dateFrom);
  // Add 1 day to dateTo to make it inclusive
  const toDate = new Date(dateTo); toDate.setDate(toDate.getDate() + 1);
  const toStr = toDate.toISOString().split('T')[0] + 'T00:00:00.000';

  const workQuery = [
    `$order=issued_date+DESC`,
    `$limit=${limit}`,
    `$where=issued_date+>=+'${fromStr}'+AND+issued_date+<+'${toStr}'+AND+latitude+IS+NOT+NULL+AND+longitude+IS+NOT+NULL`,
  ].join('&');

  const jobQuery = [
    `$order=approved_date+DESC`,
    `$limit=${Math.max(100, Math.round(limit * 0.15))}`,
    `$where=job_type+IN('New+Building','Full+Demolition')+AND+latitude+IS+NOT+NULL+AND+approved_date+>=+'${fromStr}'+AND+approved_date+<+'${toStr}'`,
  ].join('&');

  const [workRes, jobRes] = await Promise.all([
    fetch(`${PERMITS_BASE}?${workQuery}`, { cache: 'no-store' }),
    fetch(`${JOBS_BASE}?${jobQuery}`, { cache: 'no-store' }),
  ]);

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

// ── Work type normalization ───────────────────────────────────────────────────

export function workTypeToCode(workType: string): string {
  const wt = workType.toLowerCase();
  if (wt.includes('new building'))          return 'NB';
  if (wt.includes('full demolition'))       return 'DM';
  if (wt.includes('general construction'))  return 'GC';
  if (wt.includes('plumbing'))              return 'PL';
  if (wt.includes('mechanical'))            return 'ME';
  if (wt.includes('solar'))                 return 'SOL';
  if (wt.includes('sidewalk shed'))         return 'SHD';
  if (wt.includes('scaffold'))              return 'SCF';
  if (wt.includes('construction fence'))    return 'FNC';
  if (wt.includes('sign'))                  return 'SG';
  if (wt.includes('foundation'))            return 'FND';
  if (wt.includes('structural'))            return 'STR';
  if (wt.includes('boiler'))                return 'BLR';
  if (wt.includes('sprinkler'))             return 'SPR';
  if (wt.includes('earth work'))            return 'EW';
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
