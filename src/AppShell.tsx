/**
 * AppShell — top-level shell that renders the shared sidebar
 * alongside whichever view is active (iso or map).
 */
import { useRef, useState } from 'react';
import { usePermits } from './PermitContext';
import PermitSidebar from './PermitSidebar';
import IsoView from './IsoView';
import MapView from './MapView';
import type { Permit } from './types';
import { getJobColor, getJobLabel } from './permit-data';
import { useAmbientSound } from './useAmbientSound';
import './PermitSidebar.css';
import './AppShell.css';

export default function AppShell() {
  const { view } = usePermits();
  const isoFlyRef = useRef<((p: Permit) => void) | null>(null);
  const [infoOpen,     setInfoOpen]     = useState(false);
  const [mobileOpen,   setMobileOpen]   = useState(false);
  const { started, muted, toggleMute } = useAmbientSound('/nyc-ambient.mp3', 0.25);

  const handleSidebarSelect = (p: Permit) => {
    if (view === 'iso') isoFlyRef.current?.(p);
  };

  const isoHeaderActions = (
    <button className="info-btn" onClick={() => setInfoOpen(true)} title="About">?</button>
  );

  return (
    <div className="shell">
      <PermitSidebar
        onSelectPermit={handleSidebarSelect}
        headerActions={isoHeaderActions}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />
      {/* Mobile backdrop */}
      {mobileOpen && <div className="shell-mobile-backdrop" onClick={() => setMobileOpen(false)} />}
      {/* Mobile FAB — hamburger button */}
      <button className="shell-mobile-fab" onClick={() => setMobileOpen(v => !v)}>
        {mobileOpen ? '✕' : '☰'}
      </button>
      <div className="shell-view">
        {view === 'iso'
          ? <IsoView flyRef={isoFlyRef} />
          : <MapView />}
        {/* Ambient sound mute button — appears after first interaction starts audio */}
        {started && (
          <button className="ambient-btn" onClick={toggleMute} title={muted ? 'Unmute ambient sound' : 'Mute ambient sound'}>
            {muted
              ? <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M1 5H3.5L7 2V12L3.5 9H1V5Z" fill="currentColor" opacity="0.5"/>
                  <line x1="9" y1="5" x2="13" y2="9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                  <line x1="13" y1="5" x2="9" y2="9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                </svg>
              : <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M1 5H3.5L7 2V12L3.5 9H1V5Z" fill="currentColor" opacity="0.7"/>
                  <path d="M9 4.5C10.2 5.2 11 6.5 11 8C11 9.5 10.2 10.8 9 11.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" fill="none"/>
                  <path d="M10.5 2.5C12.5 3.8 13.5 5.8 13.5 8C13.5 10.2 12.5 12.2 10.5 13.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" fill="none" opacity="0.5"/>
                </svg>
            }
          </button>
        )}
      </div>

      {/* Info modal — shared across iso and map views */}
      {infoOpen && (
        <div className="info-backdrop" onClick={() => setInfoOpen(false)}>
          <div className="info-modal" onClick={e => e.stopPropagation()}>
            <div className="info-header">
              <span className="info-title">NYC PERMIT PULSE</span>
              <button className="info-close" onClick={() => setInfoOpen(false)}>✕</button>
            </div>
            <div className="info-body">
              <p>NYC DOB permit activity, visualized two ways — an isometric pixel-art view of the city by <a href="https://isometric.nyc" target="_blank" rel="noopener noreferrer">isometric.nyc</a>, and a standard map view. Each dot is a permit, color-coded by type.</p>

              <div className="info-section-label">HOW TO USE</div>
              <ul className="info-list">
                <li><strong>ISO / MAP</strong> — switch between isometric and map views. Filters carry over.</li>
                <li><strong>Date range</strong> — browse permits issued since January 2021. Use the quick buttons or enter any date from 2021 onward.</li>
                <li><strong>Search</strong> — searches within your selected date range. Use "quotes" for exact phrase match. Try a street name, owner, or contractor.</li>
                <li><strong>Click a dot or row</strong> — opens permit details including cost, status, owner, and filing number.</li>
              </ul>

              <div className="info-section-label">PERMIT TYPES</div>
              <div className="info-legend">
                {['NB','DM','GC','PL','ME','SOL','SHD','SCF'].map(jt => (
                  <div key={jt} className="info-legend-row">
                    <span className="info-legend-dot" style={{ background: getJobColor(jt) }} />
                    <span>{getJobLabel(jt)}</span>
                  </div>
                ))}
              </div>

              <div className="info-links">
                <a href="https://github.com/ziggy2socks/isometric-permits" target="_blank" rel="noopener noreferrer">★ GitHub</a>
                <a href="https://opendata.cityofnewyork.us" target="_blank" rel="noopener noreferrer">NYC Open Data</a>
                <a href="https://isometric.nyc" target="_blank" rel="noopener noreferrer">isometric.nyc</a>
              </div>

              <p className="info-note">
                Data sourced from NYC Open Data (DOB NOW: Build), covering permits issued January 2021–present, published with a 2–5 day lag.
                New Building and General Construction categories were not recorded separately before 2021.
                Provided as-is — verify with <a href="https://www.nyc.gov/site/buildings/index.page" target="_blank" rel="noopener noreferrer">NYC DOB</a> for official permit status.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
