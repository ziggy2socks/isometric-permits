/**
 * PermitSidebar — shared filter sidebar for both Iso and Map views.
 * Reads/writes via PermitContext.
 */
import React, { useRef } from 'react';
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
    filters, loading, searching, error, searchMode,
    filtered, dotLimit,
    setDateFrom, setDateTo,
    toggleJobType, setAllJobTypes, setNoJobTypes,
    toggleBorough, setSearch,
    selected, setSelected,
  } = usePermits();
  const isLoading = loading || searching;

  const listRef = useRef<HTMLDivElement>(null);

  const handleSelect = (p: Permit) => {
    setSelected(p);
    onSelectPermit?.(p);
    onMobileClose?.();
  };

  const todayStr = new Date().toISOString().split('T')[0];
  const quickDates = [
    { label: '1d', days: 1 }, { label: '7d', days: 7 },
    { label: '30d', days: 30 }, { label: '90d', days: 90 },
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
              {searchMode && <span className="ps-search-badge">SEARCH</span>}
              <span className="ps-count">{filtered.length.toLocaleString()} permits</span>
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
          <input type="date" className="ps-date-input" value={filters.dateFrom}
            onChange={e => setDateFrom(e.target.value)} />
          <span className="ps-date-sep">→</span>
          <input type="date" className="ps-date-input" value={filters.dateTo}
            onChange={e => setDateTo(e.target.value)} max={todayStr} />
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
            {searchMode ? '⚡ FULL DATABASE SEARCH' : 'SEARCH ALL PERMITS'}
          </span>
          {searchMode && (
            <button className="ps-reset-btn" onClick={() => setSearch('')}>✕ clear</button>
          )}
        </div>
        <input className="ps-search"
          placeholder="123 West 57th St · solar · owner name…"
          value={filters.search}
          onChange={e => setSearch(e.target.value)} />
        {!searchMode && (
          <div className="ps-search-hint">Any address, any date — ignores date range above</div>
        )}
      </div>

      {/* Results list */}
      <div className="ps-list" ref={listRef}>
        {filtered.slice(0, 500).map((p, i) => {
          const id = `${p.job_filing_number ?? p.tracking_number ?? 'p'}-${i}`;
          const color = getJobColor(p.job_type ?? '');
          const isSelected = selected === p ||
            (selected?.job_filing_number && selected.job_filing_number === p.job_filing_number);
          return (
            <div key={id} id={`ps-row-${id}`}
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
              {p.estimated_job_costs && parseFloat(p.estimated_job_costs) > 0 && (
                <div className="ps-row-cost">${parseInt(p.estimated_job_costs).toLocaleString()}</div>
              )}
            </div>
          );
        })}
        {filtered.length > 500 && (
          <div className="ps-overflow">
            Showing 500 of {filtered.length.toLocaleString()} — tighten filters
          </div>
        )}
        {filtered.length === 0 && !loading && (
          <div className="ps-empty">No permits match filters</div>
        )}
      </div>
      </div> {/* end ps-body */}
    </div>
  );
}
