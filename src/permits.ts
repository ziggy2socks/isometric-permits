import type { Permit } from './types';

// Use local proxy in dev to avoid CORS; direct URL works in production (Vercel etc.)
const API_BASE = import.meta.env.DEV
  ? '/api/permits'
  : 'https://data.cityofnewyork.us/resource/ipu4-2q9a.json';

export async function fetchPermits(daysBack: number = 30): Promise<Permit[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);
  // issuance_date format in this dataset is MM/DD/YYYY
  const month = String(cutoff.getMonth() + 1).padStart(2, '0');
  const day = String(cutoff.getDate()).padStart(2, '0');
  const year = cutoff.getFullYear();
  const cutoffStr = `${month}/${day}/${year}`;

  const params = new URLSearchParams({
    '$order': 'issuance_date DESC',
    '$limit': '1000',
    '$where': `issuance_date >= '${cutoffStr}' AND gis_latitude IS NOT NULL AND gis_longitude IS NOT NULL`,
  });

  const url = `${API_BASE}?${params}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Permit API error: ${res.status}`);
  const data: Permit[] = await res.json();
  return data;
}

export const JOB_TYPE_LABELS: Record<string, string> = {
  NB: 'New Building',
  DM: 'Demolition',
  A1: 'Major Alteration',
  A2: 'Minor Alteration',
  A3: 'Minor Alteration',
  EW: 'Equipment Work',
  PL: 'Plumbing',
  SG: 'Sign',
};

export const JOB_TYPE_COLORS: Record<string, string> = {
  NB: '#00ff88',   // bright green
  DM: '#ff3333',   // red
  A1: '#ff8800',   // orange
  A2: '#ffcc00',   // yellow
  A3: '#ffcc00',   // yellow
  EW: '#00ccff',   // cyan
  PL: '#7777ff',   // blue-purple
  SG: '#ff77ff',   // pink
};

export const JOB_TYPE_EMOJIS: Record<string, string> = {
  NB: '🏗',
  DM: '💥',
  A1: '🔨',
  A2: '🔧',
  A3: '🔩',
  EW: '⚙️',
  PL: '🔵',
  SG: '📋',
};

export function getJobColor(jobType: string): string {
  return JOB_TYPE_COLORS[jobType] ?? '#aaaaaa';
}

export function getJobEmoji(jobType: string): string {
  return JOB_TYPE_EMOJIS[jobType] ?? '📌';
}

export function getJobLabel(jobType: string): string {
  return JOB_TYPE_LABELS[jobType] ?? jobType;
}

export function formatAddress(permit: Permit): string {
  const parts = [permit.house__, permit.street_name, permit.borough]
    .filter(Boolean)
    .join(' ');
  return parts || 'Unknown address';
}

export function formatDate(dateStr?: string): string {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

// PL and EW don't exist in this DOB endpoint; SG data is pre-2011 only.
// Keeping the label/color/emoji maps for completeness but not showing in filters.
export const ALL_JOB_TYPES = ['NB', 'DM', 'A1', 'A2', 'A3'];
export const ALL_BOROUGHS = ['MANHATTAN', 'BROOKLYN', 'QUEENS', 'BRONX', 'STATEN ISLAND'];
