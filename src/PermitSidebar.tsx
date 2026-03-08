/**
 * PermitSidebar — shared filter sidebar for both Iso and Map views.
 * Reads/writes via PermitContext.
 */
import React, { useCallback, useRef, useState } from 'react';
import { FixedSizeList as VList } from 'react-window';

/** Uncontrolled text input that commits valid YYYY-MM-DD on blur or Enter */
function DateInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const [draft, setDraft] = useState(value);
  const prevValue = useRef(value);
  // Sync draft when parent value changes (e.g. quick-date button)
  if (value !== prevValue.current) { prevValue.current = value; if (draft !== value) setDraft(value); }
  const isValid = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(new Date(v).getTime());
  const commit = () => { if (isValid(draft)) onChange(draft); else setDraft(value); };
  return (
    <input type="text" className="ps-date-input" value={draft}
      placeholder={placeholder} maxLength={10}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') commit(); }} />
  );
}
import { usePermits } from './PermitContext';
import {
  ALL_JOB_TYPES, ALL_BOROUGHS,
  WORK_TYPE_COLORS,
  getJobColor, formatAddress, formatDate,
} from './permit-data';
import type { Permit } from './types';

const BOROUGH_SHORT: Record<string, string> = {
  MANHATTAN: 'MN', BROOKLYN: 'BK', QUEENS: 'QN', BRONX: 'BX', 'STATEN ISLAND': 'SI',
};

interface Props {
  onSelectPermit?: (p: Permit) => void;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
  /** Slot for view-specific header controls (e.g. ? and ON/OFF for iso view) */
  headerActions?: React.ReactNode;
}

export default function PermitSidebar({ onSelectPermit, mobileOpen, onMobileClose, headerActions }: Props) {
  const {
    view, setView,
    filters, loading, searching, error, searchMode, searchAllTime, setSearchAllTime,
    filtered, dotLimit,
    setDateFrom, setDateTo,
    toggleJobType, setAllJobTypes, setNoJobTypes,
    toggleBorough, setSearch,
    selected, setSelected,
  } = usePermits();
  const isLoading = loading || searching;

  const [listHeight, setListHeight] = useState(400);

  // Measure list container height on mount & resize
  const listContainerRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const measure = () => setListHeight(el.clientHeight || 400);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleSelect = (p: Permit) => {
    setSelected(p);
    onSelectPermit?.(p);
    onMobileClose?.();
  };

  const todayStr = new Date().toISOString().split('T')[0];
  // DOB NOW data starts mid-2016 — no point allowing earlier dates
  const quickDates = [
    { label: '7d', days: 7 },
    { label: '30d', days: 30 }, { label: '90d', days: 90 },
    { label: '1y', days: 365 }, { label: 'ALL', days: 3650 },
  ];

  return (
    <div className={`ps-sidebar${mobileOpen ? ' ps-sidebar--open' : ''}`}>
      {/* Header */}
      <div className="ps-header">
        <div className="ps-header-row">
          <span className="ps-title">NYC PERMIT PULSE</span>
          {headerActions && <div className="ps-header-actions">{headerActions}</div>}
        </div>
        <div className="ps-view-toggle-row">
          <button
            className={`ps-view-btn${view === 'iso' ? ' active' : ''}`}
            onClick={() => setView('iso')}
            title="Isometric view">ISO VIEW</button>
          <button
            className={`ps-view-btn${view === 'map' ? ' active' : ''}`}
            onClick={() => setView('map')}
            title="Map view">MAP VIEW</button>
        </div>
        <div className="ps-count-row">
          {isLoading ? (
            <span className="ps-loading">
              <span className="ps-spinner" />
              {searching ? 'SEARCHING…' : 'LOADING…'}
            </span>
          ) : error ? (
            <span className="ps-error">⚠ {error}</span>
          ) : (
            <>
              <span className="ps-count">{filtered.length.toLocaleString()} permits</span>
              {searchMode && (
                <span className="ps-date-context">
                  {searchAllTime ? '· all time' : `· ${filters.dateFrom} – ${filters.dateTo}`}
                </span>
              )}
              {filtered.length > dotLimit && (
                <span className="ps-limit-warn" title="Tighten filters to see all on the map.">
                  ⚠ showing {dotLimit.toLocaleString()}
                </span>
              )}
            </>
          )}
        </div>
      </div>

      {/* Scrollable body — filters + results */}
      <div className="ps-body">
      {/* Date range */}
      <div className="ps-section">
        <div className="ps-section-label-row">
          <span className="ps-section-label">DATE RANGE</span>
          <button className="ps-reset-btn" title="Reset to last 7 days"
            onClick={() => {
              const d = new Date(); d.setDate(d.getDate() - 7);
              setDateFrom(d.toISOString().split('T')[0]);
              setDateTo(todayStr);
            }}>↺ 7d</button>
        </div>
        <div className="ps-date-row">
          <DateInput value={filters.dateFrom} onChange={setDateFrom} placeholder="YYYY-MM-DD" />
          <span className="ps-date-sep">→</span>
          <DateInput value={filters.dateTo} onChange={setDateTo} placeholder="YYYY-MM-DD" />
        </div>
        <div className="ps-quick-dates">
          {quickDates.map(({ label, days }) => {
            const from = new Date(); from.setDate(from.getDate() - days);
            const fromStr = from.toISOString().split('T')[0];
            const active = filters.dateFrom === fromStr && filters.dateTo === todayStr;
            return (
              <button key={label} className={`ps-quick-btn${active ? ' active' : ''}`}
                onClick={() => { setDateFrom(fromStr); setDateTo(todayStr); }}>
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Permit types */}
      <div className="ps-section">
        <div className="ps-section-label">
          TYPE
          <button className="ps-toggle-all"
            onClick={() => filters.jobTypes.size === ALL_JOB_TYPES.length ? setNoJobTypes() : setAllJobTypes()}>
            {filters.jobTypes.size === ALL_JOB_TYPES.length ? 'NONE' : 'ALL'}
          </button>
        </div>
        <div className="ps-chips">
          {ALL_JOB_TYPES.map(t => {
            const active = filters.jobTypes.has(t);
            const color = WORK_TYPE_COLORS[t];
            return (
              <button key={t}
                className={`ps-chip${active ? ' active' : ''}`}
                style={active ? { borderColor: color, color, backgroundColor: color + '18', textShadow: `0 0 6px ${color}` } : {}}
                onClick={() => toggleJobType(t)}>
                {t}
              </button>
            );
          })}
        </div>
      </div>

      {/* Boroughs */}
      <div className="ps-section">
        <div className="ps-section-label">BOROUGH</div>
        <div className="ps-borough-row">
          {ALL_BOROUGHS.map(b => (
            <button key={b}
              className={`ps-borough-chip${filters.boroughs.has(b) ? ' active' : ''}`}
              onClick={() => toggleBorough(b)}>
              {BOROUGH_SHORT[b]}
            </button>
          ))}
        </div>
      </div>

      {/* Search */}
      <div className="ps-section ps-section--search">
        <div className="ps-section-label-row">
          <span className="ps-section-label">
            {searchMode ? '⚡ SEARCH' : 'SEARCH'}
          </span>
          {searchMode && (
            <button className="ps-reset-btn" onClick={() => { setSearch(''); setSearchAllTime(false); }}>✕ clear</button>
          )}
        </div>
        <input className="ps-search"
          placeholder="oak street · contractor name · solar…"
          value={filters.search}
          onChange={e => setSearch(e.target.value)} />
        {searchMode ? (
          <div className="ps-search-controls">
            <button
              className={`ps-alltime-btn${searchAllTime ? ' active' : ''}`}
              onClick={() => setSearchAllTime(!searchAllTime)}
              title="Search entire database, ignoring date range">
              {searchAllTime ? '◉ ALL TIME' : '○ ALL TIME'}
            </button>
            <span className="ps-search-hint-inline">use "quotes" for exact phrases</span>
          </div>
        ) : (
          <div className="ps-search-hint">street · contractor · address · use "quotes" for exact phrases</div>
        )}
      </div>

      {/* Results list — virtualized */}
      <div className="ps-list" ref={listContainerRef}>
        {filtered.length === 0 && !loading && (
          <div className="ps-empty">No permits match filters</div>
        )}
        {filtered.length > 0 && (
          <VList
            height={listHeight}
            itemCount={filtered.length}
            itemSize={72}
            width="100%"
            overscanCount={5}
            style={{ overflowX: 'hidden' }}
          >
            {({ index, style }: { index: number; style: React.CSSProperties }) => {
              const p = filtered[index];
              const color = getJobColor(p.job_type ?? '');
              const isSelected = selected === p ||
                (selected?.job_filing_number && selected.job_filing_number === p.job_filing_number);
              return (
                <div style={style}
                  className={`ps-row${isSelected ? ' selected' : ''}`}
                  onClick={() => handleSelect(p)}>
                  <div className="ps-row-top">
                    <span className="ps-row-type"
                      style={{ color, borderColor: color + '88', backgroundColor: color + '18', textShadow: `0 0 6px ${color}` }}>
                      {p.job_type}
                    </span>
                    <span className="ps-row-date">{formatDate(p.issued_date)}</span>
                  </div>
                  <div className="ps-row-address">{formatAddress(p)}</div>
                  {p.job_description && (
                    <div className="ps-row-desc">
                      {p.job_description.slice(0, 80)}{p.job_description.length > 80 ? '…' : ''}
                    </div>
                  )}
                </div>
              );
            }}
          </VList>
        )}
      </div>
      </div> {/* end ps-body */}
    </div>
  );
}
