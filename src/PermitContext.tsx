/**
 * PermitContext — shared state between Isometric and Map views.
 *
 * Design:
 * - `filtered`    = full client-filtered list (all results, for sidebar list/search)
 * - `mapPermits`  = capped at MAP_LIMIT (most recent first), for map dot rendering
 * - API fetch cap = LIST_LIMIT (large enough to cover any reasonable search)
 */
import { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef, type ReactNode } from 'react';
import type { Permit } from './types';
import { fetchPermits, ALL_JOB_TYPES, ALL_BOROUGHS, workTypeToCode } from './permit-data';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ViewMode = 'iso' | 'map';

export interface PermitFilters {
  dateFrom: string;
  dateTo:   string;
  jobTypes: Set<string>;
  boroughs: Set<string>;
  search:   string;
}

export interface PermitContextValue {
  view:      ViewMode;
  setView:   (v: ViewMode) => void;

  allPermits:     Permit[];
  loading:        boolean;
  error:          string | null;
  totalFetched:   number;     // how many the API returned (may be < LIST_LIMIT)
  reload:         () => void;

  filters:        PermitFilters;
  setDateFrom:    (d: string) => void;
  setDateTo:      (d: string) => void;
  toggleJobType:  (t: string) => void;
  setAllJobTypes: () => void;
  setNoJobTypes:  () => void;
  toggleBorough:  (b: string) => void;
  setSearch:      (s: string) => void;

  filtered:       Permit[];   // full filtered list — for sidebar
  mapPermits:     Permit[];   // capped at MAP_LIMIT — for dot rendering

  selected:       Permit | null;
  setSelected:    (p: Permit | null) => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const LIST_LIMIT = 10_000;  // max fetched from API (covers any realistic date range)
const MAP_LIMIT  = 2_000;   // max dots rendered on map (performance cap)

function todayStr() { return new Date().toISOString().split('T')[0]; }
function daysAgoStr(n: number) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

// ── Context ───────────────────────────────────────────────────────────────────

const PermitContext = createContext<PermitContextValue | null>(null);

export function PermitProvider({ children }: { children: ReactNode }) {
  const [view, setViewState] = useState<ViewMode>(
    window.location.pathname.startsWith('/map') ? 'map' : 'iso'
  );
  const setView = useCallback((v: ViewMode) => {
    setViewState(v);
    window.history.pushState({}, '', v === 'map' ? '/map' : '/');
  }, []);

  // Filters
  const [dateFrom, setDateFrom] = useState(daysAgoStr(7));
  const [dateTo,   setDateTo]   = useState(todayStr());
  const [jobTypes, setJobTypes] = useState<Set<string>>(new Set(ALL_JOB_TYPES));
  const [boroughs, setBoroughs] = useState<Set<string>>(new Set(['MANHATTAN']));
  const [search,   setSearch]   = useState('');

  // Data
  const [allPermits,   setAllPermits]   = useState<Permit[]>([]);
  const [totalFetched, setTotalFetched] = useState(0);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const fetchKey = useRef(0);

  const load = useCallback(async () => {
    const key = ++fetchKey.current;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPermits(dateFrom, dateTo, LIST_LIMIT);
      if (key !== fetchKey.current) return;
      setAllPermits(data);
      setTotalFetched(data.length);
    } catch (e) {
      if (key !== fetchKey.current) return;
      setError((e as Error).message);
    } finally {
      if (key === fetchKey.current) setLoading(false);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  // Full client-side filter — for sidebar list (no cap)
  const filtered = useMemo(() => {
    let r = allPermits;
    if (jobTypes.size < ALL_JOB_TYPES.length) {
      r = r.filter(p => {
        const jt = p.job_type ?? workTypeToCode(p.work_type ?? '');
        return jobTypes.has(jt) || (!ALL_JOB_TYPES.includes(jt) && jobTypes.has('OTH'));
      });
    }
    if (boroughs.size < ALL_BOROUGHS.length) {
      r = r.filter(p => boroughs.has((p.borough ?? '').toUpperCase()));
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      r = r.filter(p =>
        (p.house_no ?? '').toLowerCase().includes(q) ||
        (p.street_name ?? '').toLowerCase().includes(q) ||
        (p.borough ?? '').toLowerCase().includes(q) ||
        (p.job_description ?? '').toLowerCase().includes(q) ||
        (p.owner_business_name ?? '').toLowerCase().includes(q) ||
        (p.applicant_business_name ?? '').toLowerCase().includes(q)
      );
    }
    return r;
  }, [allPermits, jobTypes, boroughs, search]);

  // Map cap — most recent first, hard capped at MAP_LIMIT
  const mapPermits = useMemo(() => {
    if (filtered.length <= MAP_LIMIT) return filtered;
    return filtered.slice(0, MAP_LIMIT); // already sorted DESC by issued_date from API
  }, [filtered]);

  // Selection
  const [selected, setSelected] = useState<Permit | null>(null);

  // Filter helpers
  const toggleJobType = useCallback((t: string) => {
    setJobTypes(prev => { const n = new Set(prev); n.has(t) ? n.delete(t) : n.add(t); return n; });
  }, []);
  const setAllJobTypes = useCallback(() => setJobTypes(new Set(ALL_JOB_TYPES)), []);
  const setNoJobTypes  = useCallback(() => setJobTypes(new Set()), []);
  const toggleBorough  = useCallback((b: string) => {
    setBoroughs(prev => { const n = new Set(prev); n.has(b) ? n.delete(b) : n.add(b); return n; });
  }, []);

  const filters: PermitFilters = { dateFrom, dateTo, jobTypes, boroughs, search };

  return (
    <PermitContext.Provider value={{
      view, setView,
      allPermits, loading, error, totalFetched, reload: load,
      filters,
      setDateFrom, setDateTo,
      toggleJobType, setAllJobTypes, setNoJobTypes,
      toggleBorough,
      setSearch,
      filtered,
      mapPermits,
      selected, setSelected,
    }}>
      {children}
    </PermitContext.Provider>
  );
}

export function usePermits() {
  const ctx = useContext(PermitContext);
  if (!ctx) throw new Error('usePermits must be used inside PermitProvider');
  return ctx;
}
