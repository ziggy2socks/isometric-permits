/**
 * IsoView — OpenSeadragon isometric map view.
 * Consumes filtered permits from PermitContext.
 * Sidebar is rendered by AppShell via PermitSidebar.
 */
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { FixedSizeList as List, type ListChildComponentProps } from 'react-window';
import OpenSeadragon from 'openseadragon';
import type { Permit } from './types';
import { latlngToImagePx, IMAGE_DIMS } from './coordinates';
import {
  getJobColor, getJobEmoji, getJobLabel,
  formatAddress, formatDate,
} from './permit-data';
import { NeighborhoodLabels } from './NeighborhoodLabels';
import { fetchHelicopters, type HelicopterState } from './helicopters';
import { usePermits } from './PermitContext';
import './App.css';

// ── Tile setup ────────────────────────────────────────────────────────────────
const TILE_BASE    = '/dzi/tiles_files';
const DZI_DIMS     = { width: 123904, height: 100864 };
const MAX_LEVEL    = 8;
const TILE_SIZE    = 512;

function buildTileSource() {
  const osdMax = Math.ceil(Math.log2(Math.max(DZI_DIMS.width, DZI_DIMS.height)));
  return {
    width: DZI_DIMS.width, height: DZI_DIMS.height,
    tileSize: TILE_SIZE, tileOverlap: 0,
    minLevel: osdMax - MAX_LEVEL, maxLevel: osdMax,
    getTileUrl: (level: number, x: number, y: number) => {
      const sl = level - (osdMax - MAX_LEVEL);
      if (sl < 0 || sl > MAX_LEVEL) return '';
      return `${TILE_BASE}/${sl}/${x}_${y}.webp`;
    },
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function computeOpacities(permits: Permit[]): Map<Permit, number> {
  const times = permits.map(p => new Date(p.issued_date ?? p.approved_date ?? '').getTime());
  const valid  = times.filter(t => !isNaN(t));
  const min    = Math.min(...valid), max = Math.max(...valid);
  const map    = new Map<Permit, number>();
  permits.forEach((p, i) => {
    const t = times[i];
    map.set(p, isNaN(t) || max === min ? 1 : 0.5 + 0.5 * ((t - min) / (max - min)));
  });
  return map;
}

// ── Permit breakdown chart ────────────────────────────────────────────────────
function PermitChart({ permits }: { permits: Permit[] }) {
  const counts = new Map<string, number>();
  for (const p of permits) counts.set(p.job_type ?? 'OTH', (counts.get(p.job_type ?? 'OTH') ?? 0) + 1);
  const bars = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (bars.length === 0) return null;
  const max = bars[0][1];
  return (
    <div className="chart">
      <div className="chart-title">BREAKDOWN</div>
      <div className="chart-bars">
        {bars.map(([jt, count]) => (
          <div key={jt} className="chart-row" title={`${getJobLabel(jt)}: ${count}`}>
            <span className="chart-label">{jt}</span>
            <div className="chart-track">
              <div className="chart-bar" style={{ width: `${(count / max) * 100}%`, background: getJobColor(jt), boxShadow: `0 0 6px ${getJobColor(jt)}` }} />
            </div>
            <span className="chart-count">{count}</span>
          </div>
        ))}
      </div>
      <div className="chart-total">{permits.length.toLocaleString()} total</div>
    </div>
  );
}

// ── Permit detail drawer ──────────────────────────────────────────────────────
function PermitDrawer({ permit, onClose }: { permit: Permit; onClose: () => void }) {
  const color = getJobColor(permit.job_type ?? '');
  const cost  = permit.estimated_job_costs && Number(permit.estimated_job_costs) > 0
    ? `$${Number(permit.estimated_job_costs).toLocaleString()}` : null;
  const JUNK  = ['PR', 'Not Applicable', 'N/A', ''];
  const cleanOwner  = [permit.owner_business_name, permit.owner_name].find(v => v && !JUNK.includes(v)) ?? null;
  const contractor  = [permit.applicant_business_name, permit.applicant_first_name, permit.applicant_last_name].filter(Boolean).join(' · ') || null;
  const expediter   = permit.filing_representative_business_name
    || [permit.filing_representative_first_name, permit.filing_representative_last_name].filter(Boolean).join(' ') || null;
  return (
    <div className="drawer" style={{ '--drawer-color': color } as React.CSSProperties}>
      <div className="drawer-header">
        <div className="drawer-type" style={{ color }}>{getJobEmoji(permit.job_type ?? '')} {getJobLabel(permit.job_type ?? '')}</div>
        <button className="drawer-close" onClick={onClose}>✕</button>
      </div>
      <div className="drawer-address">{formatAddress(permit)}</div>
      {permit.borough && <div className="drawer-borough">{permit.borough}</div>}
      <div className="drawer-divider" />
      {permit.issued_date && <DrawerField label="ISSUED"      value={formatDate(permit.issued_date)} />}
      {permit.expired_date && <DrawerField label="EXPIRES"    value={formatDate(permit.expired_date)} />}
      {permit.permit_status && <DrawerField label="STATUS"    value={permit.permit_status} />}
      {permit.job_description && <DrawerField label="DESCRIPTION" value={permit.job_description} />}
      {cost          && <DrawerField label="EST. COST"   value={cost} />}
      {cleanOwner    && <DrawerField label="OWNER"       value={cleanOwner} />}
      {contractor    && <DrawerField label="CONTRACTOR"  value={contractor} />}
      {expediter     && <DrawerField label="EXPEDITER"   value={expediter} />}
      {permit.nta    && <DrawerField label="NEIGHBORHOOD" value={permit.nta} />}
      {permit.block  && <DrawerField label="BLOCK/LOT"   value={`${permit.block} / ${permit.lot}`} />}
      {permit.bin    && <DrawerField label="BIN"         value={permit.bin} mono />}
      {permit.job_filing_number && <DrawerField label="FILING #" value={permit.job_filing_number} mono />}
      <div className="drawer-divider" />
      <div className="drawer-footer">NYC DOB NOW: Build</div>
    </div>
  );
}

function DrawerField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="drawer-field">
      <div className="drawer-field-label">{label}</div>
      <div className={`drawer-field-value${mono ? ' mono' : ''}`}>{value}</div>
    </div>
  );
}

// ── Permit row (virtualized list) ─────────────────────────────────────────────
function PermitRow({ index, style, data }: ListChildComponentProps) {
  const { sortedPermits, selectedPermit, setDrawerPermit, setSelected, flyToPermit } = data as {
    sortedPermits: Permit[];
    selectedPermit: Permit | null;
    setDrawerPermit: (p: Permit) => void;
    setSelected: (p: Permit) => void;
    flyToPermit: (p: Permit) => void;
  };
  const p    = sortedPermits[index];
  const color = getJobColor(p.job_type ?? '');
  const isSelected = selectedPermit === p ||
    (selectedPermit?.job_filing_number && selectedPermit.job_filing_number === p.job_filing_number);
  return (
    <div style={style}
      className={`permit-row${isSelected ? ' permit-row--selected' : ''}`}
      onClick={() => { setSelected(p); setDrawerPermit(p); flyToPermit(p); }}>
      <span className="permit-row-dot" style={{ background: color, color, boxShadow: `0 0 4px 1px ${color}` }} />
      <div className="permit-row-content">
        <div className="permit-row-top">
          <span className="permit-row-type" style={{ color }}>{p.job_type}</span>
          <span className="permit-row-date">{formatDate(p.issued_date ?? p.approved_date)?.split(',')[0]}</span>
        </div>
        <div className="permit-row-address">{formatAddress(p)}</div>
      </div>
    </div>
  );
}

// ── IsoView ───────────────────────────────────────────────────────────────────
interface IsoViewProps {
  flyRef?: React.MutableRefObject<((p: Permit) => void) | null>;
}

export default function IsoView({ flyRef }: IsoViewProps) {
  const { filtered, mapPermits, selected, setSelected } = usePermits();

  const viewerRef          = useRef<HTMLDivElement>(null);
  const osdRef             = useRef<OpenSeadragon.Viewer | null>(null);
  const overlayMarkersRef  = useRef<Map<string, HTMLElement>>(new Map());
  const markerGenRef       = useRef(0);
  const labelsRef          = useRef<NeighborhoodLabels | null>(null);
  const markerRafRef       = useRef<number | null>(null);
  const heliOverlaysRef    = useRef<Map<string, HTMLElement>>(new Map());
  const heliTrackRef       = useRef<Map<string, number>>(new Map());
  const heliPositionsRef   = useRef<Map<string, { fromX: number; fromY: number; toX: number; toY: number; startTime: number; duration: number }>>(new Map());
  const heliRafRef         = useRef<number | null>(null);
  const heliActiveRef      = useRef(false);
  const listRef            = useRef<List>(null);
  const permitListWrapRef  = useRef<HTMLDivElement>(null);

  const [dziLoaded,        setDziLoaded]      = useState(false);
  const [drawerPermit,     setDrawerPermit]   = useState<Permit | null>(null);
  const [tooltip,          setTooltip]        = useState<{ permit: Permit; x: number; y: number } | null>(null);
  // Use a ref for setDrawerPermit so marker click closures always get the latest version
  const setDrawerRef = useRef<(p: Permit | null) => void>(setDrawerPermit);
  const setSelectedRef = useRef<(p: Permit | null) => void>(setSelected);
  useEffect(() => { setDrawerRef.current = setDrawerPermit; }, [setDrawerPermit]);
  useEffect(() => { setSelectedRef.current = setSelected; }, [setSelected]);

  // OSD init
  useEffect(() => {
    if (!viewerRef.current || osdRef.current) return;
    const viewer = OpenSeadragon({
      element: viewerRef.current,
      prefixUrl: '',
      showNavigationControl: false,
      showNavigator: window.innerWidth > 768,
      navigatorPosition: 'BOTTOM_RIGHT',
      navigatorSizeRatio: 0.12,
      navigatorBackground: '#0a0c14',
      animationTime: 0.3, blendTime: 0.1,
      crossOriginPolicy: 'Anonymous',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tileSources: buildTileSource() as any,
      gestureSettingsMouse: { scrollToZoom: true, clickToZoom: false, dblClickToZoom: true },
      imageSmoothingEnabled: false,
      drawer: 'canvas',
    });
    viewer.addHandler('open', () => {
      setDziLoaded(true);
      labelsRef.current = new NeighborhoodLabels(viewer);
      viewer.viewport.panTo(new OpenSeadragon.Point(0.3637, 0.3509), true);
      viewer.viewport.zoomTo(window.innerWidth <= 768 ? 10 : 3.5, undefined, true);
    });
    osdRef.current = viewer;
    return () => {
      labelsRef.current?.destroy(); labelsRef.current = null;
      heliActiveRef.current = false;
      if (heliRafRef.current !== null) { cancelAnimationFrame(heliRafRef.current); heliRafRef.current = null; }
      viewer.destroy(); osdRef.current = null;
    };
  }, []);

  // Helicopters
  const placeHelicopters = useCallback((helis: HelicopterState[]) => {
    const viewer = osdRef.current;
    if (!viewer) return;
    const existing  = heliOverlaysRef.current;
    const positions = heliPositionsRef.current;
    const tracks    = heliTrackRef.current;
    const POLL_MS   = 12000;
    const now       = performance.now();
    const seen      = new Set<string>();
    for (const heli of helis) {
      const { hex, lat, lng, track } = heli;
      if (isNaN(lat) || isNaN(lng)) continue;
      seen.add(hex);
      const { x: imgX, y: imgY } = latlngToImagePx(lat, lng);
      const vpX = imgX / IMAGE_DIMS.width;
      const vpY = imgY / IMAGE_DIMS.width;
      const oldTrack = tracks.get(hex) ?? track;
      tracks.set(hex, track);
      let el = existing.get(hex);
      if (!el) {
        el = document.createElement('div');
        el.className = 'heli-marker';
        el.title = `${heli.flight || heli.hex} · ${Math.round(heli.alt_baro ?? 0).toLocaleString()}ft`;
        viewer.addOverlay({ element: el, location: new OpenSeadragon.Point(vpX, vpY), placement: OpenSeadragon.Placement.CENTER });
        existing.set(hex, el);
        positions.set(hex, { fromX: vpX, fromY: vpY, toX: vpX, toY: vpY, startTime: now, duration: POLL_MS });
      } else {
        const cur = positions.get(hex) ?? { fromX: vpX, fromY: vpY, toX: vpX, toY: vpY, startTime: now, duration: POLL_MS };
        const elapsed = now - cur.startTime;
        const t = Math.min(elapsed / cur.duration, 1);
        const curX = cur.fromX + (cur.toX - cur.fromX) * t;
        const curY = cur.fromY + (cur.toY - cur.fromY) * t;
        positions.set(hex, { fromX: curX, fromY: curY, toX: vpX, toY: vpY, startTime: now, duration: POLL_MS });
      }
      el.innerHTML = `<span style="display:inline-block;transform:rotate(${track}deg);font-size:14px">🚁</span>`;
      el.title = `${heli.flight || heli.hex} · ${Math.round(heli.alt_baro ?? 0).toLocaleString()}ft`;
    }
    for (const [hex, el] of existing) {
      if (!seen.has(hex)) { viewer.removeOverlay(el); existing.delete(hex); positions.delete(hex); tracks.delete(hex); }
    }
    const animate = (ts: number) => {
      if (!heliActiveRef.current) return;
      for (const [hex, pos] of positions) {
        const el = existing.get(hex);
        if (!el) continue;
        const elapsed = ts - pos.startTime;
        const t2 = Math.min(elapsed / pos.duration, 1);
        const x  = pos.fromX + (pos.toX - pos.fromX) * t2;
        const y  = pos.fromY + (pos.toY - pos.fromY) * t2;
        try { viewer.updateOverlay(el, new OpenSeadragon.Point(x, y), OpenSeadragon.Placement.CENTER); } catch {}
      }
      heliRafRef.current = requestAnimationFrame(animate);
    };
    if (heliRafRef.current !== null) cancelAnimationFrame(heliRafRef.current);
    heliRafRef.current = requestAnimationFrame(animate);
  }, []);

  useEffect(() => {
    heliActiveRef.current = true;
    const poll = async () => {
      if (!heliActiveRef.current) return;
      try { const h = await fetchHelicopters(); placeHelicopters(h); } catch {}
    };
    poll();
    const iv = setInterval(poll, 12000);
    return () => { heliActiveRef.current = false; clearInterval(iv); };
  }, [placeHelicopters]);

  // Place permit markers
  const placeMarkers = useCallback(() => {
    const viewer = osdRef.current;
    if (!viewer) return;
    const gen = ++markerGenRef.current;
    if (markerRafRef.current !== null) cancelAnimationFrame(markerRafRef.current);
    overlayMarkersRef.current.forEach(el => viewer.removeOverlay(el));
    overlayMarkersRef.current.clear();
    if (mapPermits.length === 0) return;
    const opacities = computeOpacities(mapPermits);
    const CHUNK = 50; let i = 0;
    const addChunk = () => {
      if (gen !== markerGenRef.current) return;
      const end = Math.min(i + CHUNK, mapPermits.length);
      for (; i < end; i++) {
        const permit = mapPermits[i];
        const lat = parseFloat(permit.latitude ?? '');
        const lng = parseFloat(permit.longitude ?? '');
        if (isNaN(lat) || isNaN(lng)) continue;
        const { x: imgX, y: imgY } = latlngToImagePx(lat, lng);
        const vpX = imgX / IMAGE_DIMS.width;
        const vpY = imgY / IMAGE_DIMS.width;
        const el = document.createElement('div');
        el.className = 'permit-marker';
        const color = getJobColor(permit.job_type ?? '');
        el.style.cssText = `width:10px;height:10px;border-radius:50%;background:${color};--color:${color};opacity:${opacities.get(permit) ?? 1};cursor:pointer;pointer-events:auto;`;
        const key = permit.job_filing_number ? `job-${permit.job_filing_number}` : `idx-${i}`;
        el.addEventListener('mouseenter', (e) => { setTooltip({ permit, x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY }); });
        el.addEventListener('mouseleave', () => setTooltip(null));
        el.addEventListener('mousemove',  (e) => setTooltip(t => t ? { ...t, x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY } : null));
        el.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.stopImmediatePropagation(); });
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          e.stopImmediatePropagation();
          setDrawerRef.current(permit);
          setSelectedRef.current(permit);
        });
        viewer.addOverlay({ element: el, location: new OpenSeadragon.Point(vpX, vpY), placement: OpenSeadragon.Placement.CENTER });
        overlayMarkersRef.current.set(key, el);
      }
      if (i < mapPermits.length) markerRafRef.current = requestAnimationFrame(addChunk);
    };
    markerRafRef.current = requestAnimationFrame(addChunk);
  }, [mapPermits, setSelected]);

  // Single debounce ref — any dependency change resets the same timer
  const markerDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!dziLoaded) return;
    // Always cancel the pending timer — only one placeMarkers call wins
    if (markerDebounceRef.current) clearTimeout(markerDebounceRef.current);
    markerDebounceRef.current = setTimeout(placeMarkers, 300);
    return () => { if (markerDebounceRef.current) clearTimeout(markerDebounceRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dziLoaded, mapPermits]); // placeMarkers is stable via useCallback

  const flyToPermit = useCallback((permit: Permit) => {
    const viewer = osdRef.current;
    if (!viewer) return;
    const lat = parseFloat(permit.latitude ?? '');
    const lng = parseFloat(permit.longitude ?? '');
    if (isNaN(lat) || isNaN(lng)) return;
    const { x: imgX, y: imgY } = latlngToImagePx(lat, lng);
    viewer.viewport.panTo(new OpenSeadragon.Point(imgX / IMAGE_DIMS.width, imgY / IMAGE_DIMS.width));
    viewer.viewport.zoomTo(viewer.viewport.getZoom() > 4 ? viewer.viewport.getZoom() : 6);
  }, []);

  // Expose flyToPermit via ref so AppShell can call it from sidebar list clicks
  useEffect(() => {
    if (flyRef) flyRef.current = flyToPermit;
  }, [flyRef, flyToPermit]);

  const sortedPermits = useMemo(() => [...filtered].sort((a, b) =>
    new Date(b.issued_date ?? b.approved_date ?? '').getTime() -
    new Date(a.issued_date ?? a.approved_date ?? '').getTime()
  ), [filtered]);

  // Permit list height
  useEffect(() => {
    const el = permitListWrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) setPermitListHeight(e.contentRect.height);
    });
    ro.observe(el); return () => ro.disconnect();
  }, []);

  // Scroll to selected
  useEffect(() => {
    if (!selected || !listRef.current) return;
    const idx = sortedPermits.findIndex(p =>
      (p.job_filing_number && p.job_filing_number === selected.job_filing_number) || p === selected);
    if (idx >= 0) listRef.current.scrollToItem(idx, 'smart');
  }, [selected, sortedPermits]);

  // Highlight selected marker
  useEffect(() => {
    overlayMarkersRef.current.forEach(el => el.classList.remove('permit-marker--selected'));
    if (!selected?.job_filing_number) return;
    const el = overlayMarkersRef.current.get(`job-${selected.job_filing_number}`);
    if (el) el.classList.add('permit-marker--selected');
  }, [selected]);

  return (
    <div className="iso-view">
      <div ref={viewerRef} className="viewer" />

      {!dziLoaded && (
        <div className="loading-overlay">
          <div className="loading-spinner" />
          <div className="loading-text">Loading NYC Permit Pulse...</div>
        </div>
      )}

      {/* Controls are rendered in sidebar header via AppShell headerActions slot */}

      {/* Permit detail drawer */}
      {drawerPermit && (
        <PermitDrawer permit={drawerPermit} onClose={() => { setDrawerPermit(null); setSelected(null); }} />
      )}

      {/* Info modal */}
      {/* Info modal rendered in AppShell so it works in both iso and map views */}

      {/* Hover tooltip */}
      {tooltip && (
        <div className="tooltip" style={{ left: tooltip.x, top: tooltip.y - 8, transform: 'translate(-50%,-100%)' }}>
          <div className="tooltip-type" style={{ color: getJobColor(tooltip.permit.job_type ?? '') }}>
            {getJobEmoji(tooltip.permit.job_type ?? '')} {getJobLabel(tooltip.permit.job_type ?? '')}
          </div>
          <div className="tooltip-address">{formatAddress(tooltip.permit)}</div>
          {tooltip.permit.owner_business_name && <div className="tooltip-owner">{tooltip.permit.owner_business_name}</div>}
          <div className="tooltip-date">{formatDate(tooltip.permit.issued_date ?? tooltip.permit.approved_date)}</div>
          <div className="tooltip-hint">click for details</div>
        </div>
      )}
    </div>
  );
}
