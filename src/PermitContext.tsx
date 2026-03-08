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
import { fetchPermits, searchPermits, ALL_JOB_TYPES, ALL_BOROUGHS, workTypeToCode } from './permit-data';

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
  searching:      boolean;    // true when a search query is in-flight
  error:          string | null;
  totalFetched:   number;
  searchMode:     boolean;    // true when search query is active
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
  mapPermits:     Permit[];   // capped at dotLimit — for dot rendering
  dotLimit:       number;     // active cap (ISO_LIMIT or MAP_LIMIT)

  selected:       Permit | null;
  setSelected:    (p: Permit | null) => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const LIST_LIMIT = 50_000;  // max fetched from API (Socrata cap)
const ISO_LIMIT  = 1_000;   // OSD overlays are expensive — keep iso snappy
const MAP_LIMIT  = 3_000;   // MapLibre GL points are cheap, higher cap fine

// Earliest date with full permit type coverage (NB, GC, DM all available from 2021)
export const MIN_DATE = '2021-01-01';

function todayStr() { return new Date().toISOString().split('T')[0]; }
function daysAgoStr(n: number) {
  const d = new Date(); d.setDate(d.getDate() - n);
  const s = d.toISOString().split('T')[0];
  return s < MIN_DATE ? MIN_DATE : s;
}
function clampDate(s: string) { return s < MIN_DATE ? MIN_DATE : s; }

// ── Context ───────────────────────────────────────────────────────────────────

const PermitContext = createContext<PermitContextValue | null>(null);

export function PermitProvider({ children }: { children: ReactNode }) {
  // Base path — supports both standalone ('/') and nested ('/permits') deployments
  const basePath = window.location.pathname.startsWith('/permits') ? '/permits' : '';

  const [view, setViewState] = useState<ViewMode>(
    window.location.pathname.endsWith('/map') ? 'map' : 'iso'
  );
  const setDateFromClamped = useCallback((d: string) => setDateFrom(clampDate(d)), []);
  const setView = useCallback((v: ViewMode) => {
    setViewState(v);
    window.history.pushState({}, '', v === 'map' ? `${basePath}/map` : basePath || '/');
  }, [basePath]);

  // Filters
  const [dateFrom, setDateFrom] = useState(daysAgoStr(7));
  const [dateTo,   setDateTo]   = useState(todayStr());
  const [jobTypes, setJobTypes] = useState<Set<string>>(new Set(ALL_JOB_TYPES));
  const [boroughs, setBoroughs] = useState<Set<string>>(new Set(['MANHATTAN']));
  const [search, setSearch] = useState('');

  // Data — date-range results
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
      const data = await fetchPermits(dateFrom, dateTo, LIST_LIMIT, jobTypes, boroughs);
      if (key !== fetchKey.current) return;
      setAllPermits(data);
      setTotalFetched(data.length);
    } catch (e) {
      if (key !== fetchKey.current) return;
      setError((e as Error).message);
    } finally {
      if (key === fetchKey.current) setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, jobTypes, boroughs]);

  // Debounce filter changes — 400ms after last filter toggle before fetching
  const loadDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (loadDebounce.current) clearTimeout(loadDebounce.current);
    loadDebounce.current = setTimeout(load, 800); // 800ms — enough time to edit both date fields
    return () => { if (loadDebounce.current) clearTimeout(loadDebounce.current); };
  }, [load]);

  // Search — separate API query, no date filter
  const [searchResults, setSearchResults] = useState<Permit[]>([]);
  const [searching,     setSearching]     = useState(false);
  const searchKey = useRef(0);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    const q = search.trim();
    if (!q) { setSearchResults([]); setSearching(false); return; }
    setSearching(true);
    searchDebounce.current = setTimeout(async () => {
      const key = ++searchKey.current;
      try {
        // Pass date bounds unless "all time" is toggled
        const data = await searchPermits(q, LIST_LIMIT, dateFrom, dateTo);
        if (key !== searchKey.current) return;
        setSearchResults(data);
      } catch (e) {
        if (key !== searchKey.current) return;
        setError((e as Error).message);
      } finally {
        if (key === searchKey.current) setSearching(false);
      }
    }, 800);
    return () => { if (searchDebounce.current) clearTimeout(searchDebounce.current); };
  }, [search, dateFrom, dateTo]);

  const searchMode = search.trim().length > 0;

  // Full client-side filter — for sidebar list (no cap)
  // In search mode: use searchResults (full DB) filtered by borough+type only
  // In normal mode: use allPermits filtered by all criteria
  const filtered = useMemo(() => {
    let r = searchMode ? searchResults : allPermits;
    if (jobTypes.size < ALL_JOB_TYPES.length) {
      r = r.filter(p => {
        const jt = p.job_type ?? workTypeToCode(p.work_type ?? '');
        return jobTypes.has(jt) || (!ALL_JOB_TYPES.includes(jt) && jobTypes.has('OTH'));
      });
    }
    if (boroughs.size < ALL_BOROUGHS.length) {
      r = r.filter(p => boroughs.has((p.borough ?? '').toUpperCase()));
    }
    return r;
  }, [searchMode, searchResults, allPermits, jobTypes, boroughs]);

  // View-specific cap — iso uses OSD overlays (expensive), map uses GL points (cheap)
  const dotLimit  = view === 'iso' ? ISO_LIMIT : MAP_LIMIT;
  const mapPermits = useMemo(() => {
    if (filtered.length <= dotLimit) return filtered;
    return filtered.slice(0, dotLimit);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, dotLimit]);

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
      allPermits, loading, searching, error, totalFetched, searchMode, reload: load,
      filters,
      setDateFrom: setDateFromClamped, setDateTo,
      toggleJobType, setAllJobTypes, setNoJobTypes,
      toggleBorough,
      setSearch,
      filtered,
      mapPermits,
      dotLimit,
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
