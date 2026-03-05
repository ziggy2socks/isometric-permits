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
import './PermitSidebar.css';
import './AppShell.css';

export default function AppShell() {
  const { view } = usePermits();
  const isoFlyRef = useRef<((p: Permit) => void) | null>(null);
  // Iso-specific controls — lifted here so they render in sidebar header slot
  const [overlayOn, setOverlayOn] = useState(true);
  const [infoOpen,  setInfoOpen]  = useState(false);

  const handleSidebarSelect = (p: Permit) => {
    if (view === 'iso') isoFlyRef.current?.(p);
  };

  const isoHeaderActions = view === 'iso' ? (
    <>
      <button className="info-btn" onClick={() => setInfoOpen(true)} title="About">?</button>
      <button className={`overlay-toggle ${overlayOn ? 'on' : 'off'}`}
        onClick={() => setOverlayOn(v => !v)}>
        {overlayOn ? 'ON' : 'OFF'}
      </button>
    </>
  ) : null;

  return (
    <div className="shell">
      <PermitSidebar onSelectPermit={handleSidebarSelect} headerActions={isoHeaderActions} />
      <div className="shell-view">
        {view === 'iso'
          ? <IsoView flyRef={isoFlyRef} overlayOn={overlayOn} infoOpen={infoOpen} setInfoOpen={setInfoOpen} />
          : <MapView />}
      </div>
    </div>
  );
}
