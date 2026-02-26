import type { Permit } from './types';

// DOB NOW: Build – Approved Permits
// Dataset: rbx6-tga4 — current data, updated daily through present
// Replaces legacy DOB Permit Issuance (ipu4-2q9a) which stopped updating in 2020.
const API_BASE = import.meta.env.DEV
  ? '/api/permits'
  : 'https://data.cityofnewyork.us/resource/rbx6-tga4.json';

export async function fetchPermits(daysBack: number = 30): Promise<Permit[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);
  const cutoffStr = cutoff.toISOString().split('T')[0]; // YYYY-MM-DD

  const params = new URLSearchParams({
    '$order': 'issued_date DESC',
    '$limit': '1000',
    '$where': `issued_date >= '${cutoffStr}' AND latitude IS NOT NULL AND longitude IS NOT NULL`,
  });

  const res = await fetch(`${API_BASE}?${params}`);
  if (!res.ok) throw new Error(`Permit API error: ${res.status}`);
  const raw: Permit[] = await res.json();

  // Normalize work_type → job_type code for display/filtering
  return raw.map(p => ({
    ...p,
    job_type: workTypeToCode(p.work_type ?? ''),
  }));
}

// Map verbose work_type strings → short display codes
// Groups similar work types to keep the filter UI manageable
export function workTypeToCode(workType: string): string {
  const wt = workType.toLowerCase();
  if (wt.includes('new building'))           return 'NB';
  if (wt.includes('full demolition'))        return 'DM';
  if (wt.includes('general construction'))   return 'GC';
  if (wt.includes('plumbing'))               return 'PL';
  if (wt.includes('mechanical'))             return 'ME';
  if (wt.includes('solar'))                  return 'SOL';
  if (wt.includes('sidewalk shed'))          return 'SHD';
  if (wt.includes('scaffold'))               return 'SCF';
  if (wt.includes('construction fence'))     return 'FNC';
  if (wt.includes('sign'))                   return 'SG';
  if (wt.includes('foundation'))             return 'FND';
  if (wt.includes('structural'))             return 'STR';
  if (wt.includes('boiler'))                 return 'BLR';
  if (wt.includes('sprinkler'))              return 'SPR';
  if (wt.includes('earth work'))             return 'EW';
  if (wt.includes('antenna'))                return 'ANT';
  if (wt.includes('curb cut'))               return 'CC';
  if (wt.includes('standpipe'))              return 'STP';
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
  NB:  '#00ff88',  // green   — new building
  DM:  '#ff3333',  // red     — demolition
  GC:  '#ff8800',  // orange  — general construction
  PL:  '#7777ff',  // purple  — plumbing
  ME:  '#00ccff',  // cyan    — mechanical
  SOL: '#ffff00',  // yellow  — solar
  SHD: '#aaaaaa',  // grey    — sidewalk shed
  SCF: '#bbbbbb',  // grey    — scaffold
  FNC: '#999999',  // grey    — fence
  SG:  '#ff77ff',  // pink    — sign
  FND: '#cc8844',  // brown   — foundation
  STR: '#ff9944',  // amber   — structural
  BLR: '#ff6644',  // red-orange — boiler
  SPR: '#44ccff',  // light blue — sprinklers
  EW:  '#88ff44',  // lime    — earth work
  ANT: '#cc44ff',  // violet  — antenna
  CC:  '#888888',  // grey    — curb cut
  STP: '#4488ff',  // blue    — standpipe
  OTH: '#666666',  // dark grey
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
    .filter(Boolean)
    .join(' ') || 'Unknown address';
}

export function formatDate(dateStr?: string): string {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

// Work type codes shown in the filter UI — the most meaningful/frequent ones
export const ALL_JOB_TYPES = ['NB', 'DM', 'GC', 'PL', 'ME', 'SOL', 'SHD', 'SCF', 'FNC', 'STR', 'FND', 'SG'];
export const ALL_BOROUGHS = ['MANHATTAN', 'BROOKLYN', 'QUEENS', 'BRONX', 'STATEN ISLAND'];
