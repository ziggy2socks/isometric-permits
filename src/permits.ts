import type { Permit } from './types';

// Two DOB NOW datasets, both current and updated daily:
//
// 1. rbx6-tga4 — DOB NOW: Build – Approved Permits
//    Work-type permits: GC, PL, Mechanical, Solar, Scaffold, etc.
//    No New Building or Demolition.
//
// 2. w9ak-ipjd — DOB NOW: Build – Job Filings
//    Job-level filings: New Building, Full Demolition, Alteration.
//    We pull only NB + DM from here.

const PERMITS_BASE = import.meta.env.DEV
  ? '/api/permits'
  : 'https://data.cityofnewyork.us/resource/rbx6-tga4.json';

const JOBS_BASE = import.meta.env.DEV
  ? '/api/jobs'
  : 'https://data.cityofnewyork.us/resource/w9ak-ipjd.json';

// Cache the latest dataset date so we don't fetch it on every filter change
let _latestDateCache: { date: string; fetchedAt: number } | null = null;

async function getLatestDatasetDate(): Promise<Date> {
  const now = Date.now();
  // Cache for 10 minutes
  if (_latestDateCache && now - _latestDateCache.fetchedAt < 10 * 60 * 1000) {
    return new Date(_latestDateCache.date);
  }
  try {
    const res = await fetch(`${PERMITS_BASE}?$select=max(issued_date)`);
    const data = await res.json();
    const dateStr = data[0]?.max_issued_date ?? data[0]?.max_issued_date;
    if (dateStr) {
      _latestDateCache = { date: dateStr, fetchedAt: now };
      return new Date(dateStr);
    }
  } catch (_) { /* fall through to default */ }
  // Fallback: assume 2 days behind
  const d = new Date();
  d.setDate(d.getDate() - 2);
  return d;
}

export async function fetchPermits(daysBack: number = 30): Promise<Permit[]> {
  // Use actual latest dataset date rather than assuming N days behind.
  // The DOB NOW dataset sometimes lags 2-3 days, not just 1.
  const latestDate = await getLatestDatasetDate();
  const cutoff = new Date(latestDate);
  cutoff.setDate(cutoff.getDate() - (daysBack - 1));
  const cutoffStr = cutoff.toISOString().split('T')[0];

  // Scale limit by date range — 1d ~400, 7d ~3500, 30d ~12k
  // 30d capped at 2000 (most recent) — showing 12k markers is unusable
  const limit = daysBack <= 1 ? 500 : daysBack <= 7 ? 2000 : 2000;

  // Build query strings manually — URLSearchParams double-encodes '$' as '%24'
  // which breaks the Socrata API (requires literal $order, $where, etc.)
  const workQuery = [
    `$order=issued_date DESC`,
    `$limit=${limit}`,
    `$where=issued_date >= '${cutoffStr}' AND latitude IS NOT NULL AND longitude IS NOT NULL`,
  ].map(p => p.replace(/ /g, '+')).join('&');

  // Jobs use approved_date — use same cutoff
  const nbLimit = Math.max(50, Math.round(limit * 0.1));
  const jobQuery = [
    `$order=approved_date DESC`,
    `$limit=${nbLimit}`,
    `$where=job_type IN('New Building', 'Full Demolition') AND latitude IS NOT NULL AND approved_date >= '${cutoffStr}'`,
  ].map(p => p.replace(/ /g, '+')).join('&');

  const [workRes, jobRes] = await Promise.all([
    fetch(`${PERMITS_BASE}?${workQuery}`),
    fetch(`${JOBS_BASE}?${jobQuery}`),
  ]);

  if (!workRes.ok) throw new Error(`Permits API error: ${workRes.status}`);
  if (!jobRes.ok) throw new Error(`Jobs API error: ${jobRes.status}`);

  const workRaw: Permit[] = await workRes.json();
  const jobRaw: Permit[] = await jobRes.json();

  // Normalize work permits
  const workPermits = workRaw.map(p => ({
    ...p,
    job_type: workTypeToCode(p.work_type ?? ''),
  }));

  // Normalize job filings — spread all fields, just remap a few
  const jobPermits: Permit[] = jobRaw.map(p => ({
    ...p,
    work_type: p.job_type,                         // "New Building" / "Full Demolition"
    job_type: p.job_type === 'New Building' ? 'NB' : 'DM',
    issued_date: p.approved_date,                  // use approved_date as the issued date
  }));

  return [...workPermits, ...jobPermits];
}

export function workTypeToCode(workType: string): string {
  const wt = workType.toLowerCase();
  if (wt.includes('new building'))                return 'NB';
  if (wt.includes('full demolition'))             return 'DM';
  if (wt.includes('general construction'))        return 'GC';
  if (wt.includes('plumbing'))                    return 'PL';
  if (wt.includes('mechanical'))                  return 'ME';
  if (wt.includes('solar'))                       return 'SOL';
  if (wt.includes('sidewalk shed'))               return 'SHD';
  if (wt.includes('scaffold'))                    return 'SCF';
  if (wt.includes('construction fence'))          return 'FNC';
  if (wt.includes('sign'))                        return 'SG';
  if (wt.includes('foundation'))                  return 'FND';
  if (wt.includes('structural'))                  return 'STR';
  if (wt.includes('boiler'))                      return 'BLR';
  if (wt.includes('sprinkler'))                   return 'SPR';
  if (wt.includes('earth work'))                  return 'EW';
  if (wt.includes('antenna'))                     return 'ANT';
  if (wt.includes('curb cut'))                    return 'CC';
  if (wt.includes('standpipe'))                   return 'STP';
  return 'OTH';
}

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
  NB:  '#00ff88',  // bright green      — new building
  DM:  '#ff2222',  // red               — demolition
  GC:  '#ff8800',  // orange            — general construction
  PL:  '#4466ff',  // blue              — plumbing
  ME:  '#00ccff',  // cyan              — mechanical
  SOL: '#ffe600',  // yellow            — solar
  SHD: '#cc44ff',  // purple            — sidewalk shed
  SCF: '#ff44aa',  // pink              — scaffold
  FNC: '#44ffdd',  // teal              — construction fence
  SG:  '#ffffff',  // white             — sign
  FND: '#a0522d',  // brown             — foundation
  STR: '#ff6600',  // deep orange       — structural (distinct from GC orange)
  BLR: '#ff0066',  // hot pink-red      — boiler
  SPR: '#00aaff',  // sky blue          — sprinkler
  EW:  '#88ff00',  // yellow-green      — earth work
  ANT: '#dd00ff',  // violet            — antenna
  CC:  '#ffaa00',  // amber             — curb cut
  STP: '#0055ff',  // deep blue         — standpipe
  OTH: '#888888',  // grey              — other
};

export const WORK_TYPE_EMOJIS: Record<string, string> = {
  NB:  '🏗',
  DM:  '💥',
  GC:  '🔨',
  PL:  '🔵',
  ME:  '⚙️',
  SOL: '☀️',
  SHD: '🏚',
  SCF: '🪜',
  FNC: '🚧',
  SG:  '📋',
  FND: '🪨',
  STR: '🔩',
  BLR: '🔥',
  SPR: '💧',
  EW:  '🌍',
  ANT: '📡',
  CC:  '🛤',
  STP: '🚿',
  OTH: '📌',
};

export function getJobColor(jobType: string): string {
  return WORK_TYPE_COLORS[jobType] ?? '#666666';
}

export function getJobEmoji(jobType: string): string {
  return WORK_TYPE_EMOJIS[jobType] ?? '📌';
}

export function getJobLabel(jobType: string): string {
  return WORK_TYPE_LABELS[jobType] ?? jobType;
}

export function formatAddress(permit: Permit): string {
  return [permit.house_no, permit.street_name, permit.borough]
    .filter(Boolean).join(' ') || 'Unknown address';
}

export function formatDate(dateStr?: string): string {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  } catch { return dateStr; }
}

export const ALL_JOB_TYPES = ['NB', 'DM', 'GC', 'PL', 'ME', 'SOL', 'SHD', 'SCF', 'FNC', 'STR', 'FND', 'SG'];
export const ALL_BOROUGHS  = ['MANHATTAN', 'BROOKLYN', 'QUEENS', 'BRONX', 'STATEN ISLAND'];
