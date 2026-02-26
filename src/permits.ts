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

export async function fetchPermits(daysBack: number = 30): Promise<Permit[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  // Scale limit by date range — 1d ~400, 7d ~3500, 30d ~12k, 90d ~36k
  // Cap at 5000 for performance; prioritize recency (ORDER BY DESC)
  const limit = daysBack <= 1 ? 500 : daysBack <= 7 ? 2000 : 5000;

  // Fetch work-type permits (GC, PL, etc.)
  const workParams = new URLSearchParams({
    '$order': 'issued_date DESC',
    '$limit': String(limit),
    '$where': `issued_date >= '${cutoffStr}' AND latitude IS NOT NULL AND longitude IS NOT NULL`,
  });

  // Fetch NB + Full Demolition job filings
  const jobParams = new URLSearchParams({
    '$order': 'approved_date DESC',
    '$limit': String(Math.round(limit * 0.1)), // NB+DM are ~10% of total
    '$where': `job_type IN('New Building', 'Full Demolition') AND latitude IS NOT NULL AND approved_date >= '${cutoffStr}'`,
  });

  const [workRes, jobRes] = await Promise.all([
    fetch(`${PERMITS_BASE}?${workParams}`),
    fetch(`${JOBS_BASE}?${jobParams}`),
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

  // Normalize job filings — map field names to match Permit interface
  const jobPermits: Permit[] = jobRaw.map(p => ({
    job_filing_number: p.job_filing_number,
    house_no: p.house_no,
    street_name: p.street_name,
    borough: p.borough,
    zip_code: p.zip_code,
    work_type: p.job_type,                         // "New Building" / "Full Demolition"
    job_type: p.job_type === 'New Building' ? 'NB' : 'DM',
    permit_status: p.permit_status,
    issued_date: p.approved_date,                  // use approved_date as the date
    approved_date: p.approved_date,
    owner_name: p.owner_name,
    owner_business_name: p.owner_business_name,
    applicant_business_name: p.applicant_business_name,
    latitude: p.latitude,
    longitude: p.longitude,
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
  NB:  '#00ff88',
  DM:  '#ff3333',
  GC:  '#ff8800',
  PL:  '#7777ff',
  ME:  '#00ccff',
  SOL: '#ffff00',
  SHD: '#aaaaaa',
  SCF: '#bbbbbb',
  FNC: '#999999',
  SG:  '#ff77ff',
  FND: '#cc8844',
  STR: '#ff9944',
  BLR: '#ff6644',
  SPR: '#44ccff',
  EW:  '#88ff44',
  ANT: '#cc44ff',
  CC:  '#888888',
  STP: '#4488ff',
  OTH: '#666666',
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
