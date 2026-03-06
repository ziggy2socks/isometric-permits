/**
 * AppShell — top-level shell that renders the shared sidebar
 * alongside whichever view is active (iso or map).
 */
import React, { useRef, useState } from 'react';
import { usePermits } from './PermitContext';
import PermitSidebar from './PermitSidebar';
import IsoView from './IsoView';
import MapView from './MapView';
import type { Permit } from './types';
import { getJobColor, getJobLabel } from './permit-data';
import './PermitSidebar.css';
import './AppShell.css';

export default function AppShell() {
  const { view } = usePermits();
  const isoFlyRef = useRef<((p: Permit) => void) | null>(null);
  // Iso-specific controls — lifted here so they render in sidebar header slot
  const [infoOpen, setInfoOpen] = useState(false);

  const handleSidebarSelect = (p: Permit) => {
    if (view === 'iso') isoFlyRef.current?.(p);
  };

  const isoHeaderActions = (
    <button className="info-btn" onClick={() => setInfoOpen(true)} title="About">?</button>
  );

  return (
    <div className="shell">
      <PermitSidebar onSelectPermit={handleSidebarSelect} headerActions={isoHeaderActions} />
      <div className="shell-view">
        {view === 'iso'
          ? <IsoView flyRef={isoFlyRef} />
          : <MapView />}
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
              <p>Real-time NYC DOB permit activity — isometric view by <a href="https://isometric.nyc" target="_blank" rel="noopener noreferrer">isometric.nyc</a>.</p>
              <p>Each dot represents an active permit, color-coded by type. Click any dot or list row for details.</p>
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
              <p className="info-note">Data: NYC Open Data · DOB publishes with a 2–5 day lag</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
