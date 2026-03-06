import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { FixedSizeList as List, type ListChildComponentProps } from 'react-window';
import OpenSeadragon from 'openseadragon';
import type { Permit, FilterState } from './types';
import { latlngToImagePx, IMAGE_DIMS } from './coordinates';
import {
  fetchPermits,
  getJobColor,
  getJobEmoji,
  getJobLabel,
  formatAddress,
  formatDate,
  ALL_JOB_TYPES,
  ALL_BOROUGHS,
} from './permits';
import { NeighborhoodLabels } from './NeighborhoodLabels';
import { fetchHelicopters, type HelicopterState } from './helicopters';
import './App.css';

// Always use the proxy path — in dev Vite proxies it, in prod Vercel rewrites handle it.
// Direct requests to isometric-nyc-tiles.cannoneyed.com are CORS-blocked to cannoneyed.com only.
const TILE_BASE = '/dzi/tiles_files';
const DZI_DIMENSIONS = { width: 123904, height: 100864 };
const MAX_LEVEL = 8;
const TILE_SIZE = 512;
const HELI_BASE_ZOOM = 3.5; // zoom level where heli size looks good — counter-scale above this

function buildTileSource() {
  const osdMaxLevel = Math.ceil(Math.log2(Math.max(DZI_DIMENSIONS.width, DZI_DIMENSIONS.height)));
  return {
    width: DZI_DIMENSIONS.width,
    height: DZI_DIMENSIONS.height,
    tileSize: TILE_SIZE,
    tileOverlap: 0,
    minLevel: osdMaxLevel - MAX_LEVEL,
    maxLevel: osdMaxLevel,
    getTileUrl: (level: number, x: number, y: number) => {
      const serverLevel = level - (osdMaxLevel - MAX_LEVEL);
      if (serverLevel < 0 || serverLevel > MAX_LEVEL) return '';
      return `${TILE_BASE}/${serverLevel}/${x}_${y}.webp`;
    },
  };
}

const BOROUGH_ABBR: Record<string, string> = {
  'MANHATTAN': 'MAN', 'BROOKLYN': 'BKN', 'QUEENS': 'QNS',
  'BRONX': 'BRX', 'STATEN ISLAND': 'SI',
};

// ── Permit breakdown chart ──
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
              <div className="chart-bar" style={{
                width: `${(count / max) * 100}%`,
                background: getJobColor(jt),
                boxShadow: `0 0 6px ${getJobColor(jt)}`,
              }} />
            </div>
            <span className="chart-count">{count}</span>
          </div>
        ))}
      </div>
      <div className="chart-total">{permits.length.toLocaleString()} total</div>
    </div>
  );
}

// ── Permit detail drawer ──
function PermitDrawer({ permit, onClose }: { permit: Permit; onClose: () => void }) {
  const color = getJobColor(permit.job_type ?? '');
  const cost = permit.estimated_job_costs && Number(permit.estimated_job_costs) > 0
    ? `$${Number(permit.estimated_job_costs).toLocaleString()}`
    : null;
  const JUNK = ['PR', 'Not Applicable', 'N/A', ''];
  const cleanOwner = [permit.owner_business_name, permit.owner_name]
    .find(v => v && !JUNK.includes(v)) ?? null;
  const contractor = [permit.applicant_business_name, permit.applicant_first_name, permit.applicant_last_name]
    .filter(Boolean).join(' · ') || null;
  const expediter = permit.filing_representative_business_name
    || [permit.filing_representative_first_name, permit.filing_representative_last_name].filter(Boolean).join(' ')
    || null;
  const neighborhood = permit.nta ?? null;

  return (
    <div className="drawer" style={{ '--drawer-color': color } as React.CSSProperties}>
      <div className="drawer-header">
        <div className="drawer-type" style={{ color }}>
          {getJobEmoji(permit.job_type ?? '')} {getJobLabel(permit.job_type ?? '')}
        </div>
        <button className="drawer-close" onClick={onClose}>✕</button>
      </div>

      <div className="drawer-address">{formatAddress(permit)}</div>
      <div className="drawer-location">
        {[neighborhood, permit.borough, permit.zip_code].filter(Boolean).join(' · ')}
      </div>

      {permit.job_description && (
        <>
          <div className="drawer-divider" />
          <div className="drawer-field">
            <div className="drawer-field-label">DESCRIPTION</div>
            <div className="drawer-field-value drawer-description">{permit.job_description}</div>
          </div>
        </>
      )}

      <div className="drawer-divider" />
      <div className="drawer-grid">
        {permit.filing_reason && (
          <div className="drawer-field">
            <div className="drawer-field-label">FILING TYPE</div>
            <div className="drawer-field-value">{permit.filing_reason}</div>
          </div>
        )}
        {permit.permit_status && (
          <div className="drawer-field">
            <div className="drawer-field-label">STATUS</div>
            <div className="drawer-field-value">{permit.permit_status}</div>
          </div>
        )}
        {permit.issued_date && (
          <div className="drawer-field">
            <div className="drawer-field-label">ISSUED</div>
            <div className="drawer-field-value">{formatDate(permit.issued_date)}</div>
          </div>
        )}
        {permit.expired_date && (
          <div className="drawer-field">
            <div className="drawer-field-label">EXPIRES</div>
            <div className="drawer-field-value">{formatDate(permit.expired_date)}</div>
          </div>
        )}
        {cost && (
          <div className="drawer-field">
            <div className="drawer-field-label">EST. COST</div>
            <div className="drawer-field-value drawer-cost">{cost}</div>
          </div>
        )}
        {permit.work_on_floor && (
          <div className="drawer-field">
            <div className="drawer-field-label">FLOORS</div>
            <div className="drawer-field-value">{permit.work_on_floor}</div>
          </div>
        )}
      </div>

      {cleanOwner && (
        <>
          <div className="drawer-divider" />
          <div className="drawer-field">
            <div className="drawer-field-label">OWNER</div>
            <div className="drawer-field-value">{cleanOwner}</div>
          </div>
        </>
      )}

      {contractor && (
        <div className="drawer-field">
          <div className="drawer-field-label">CONTRACTOR</div>
          <div className="drawer-field-value">{contractor}</div>
        </div>
      )}

      {expediter && (
        <div className="drawer-field">
          <div className="drawer-field-label">EXPEDITER</div>
          <div className="drawer-field-value drawer-muted">{expediter}</div>
        </div>
      )}

      <div className="drawer-divider" />
      <div className="drawer-meta-row">
        {permit.job_filing_number && (
          <span className="drawer-meta-item">Filing: {permit.job_filing_number}</span>
        )}
        {permit.bin && (
          <span className="drawer-meta-item">BIN: {permit.bin}</span>
        )}
        {permit.community_board && (
          <span className="drawer-meta-item">CB: {permit.community_board}</span>
        )}
      </div>

      {/* External links */}
      <div className="drawer-divider" />
      <div className="drawer-links">
        {permit.bin && (
          <a className="drawer-link" href={`https://a810-bisweb.nyc.gov/bisweb/PropertyProfileOverviewServlet?bin=${permit.bin}`} target="_blank" rel="noopener noreferrer">
            🏛 DOB BIS
          </a>
        )}
        {permit.bbl && (
          <a className="drawer-link" href={`https://zola.planning.nyc.gov/l/lot/${permit.bbl.slice(0,1)}/${permit.bbl.slice(1,6)}/${permit.bbl.slice(6)}`} target="_blank" rel="noopener noreferrer">
            🗺 ZoLa
          </a>
        )}
        {permit.latitude && permit.longitude && (
          <a className="drawer-link" href={`https://www.google.com/maps?q=${permit.latitude},${permit.longitude}`} target="_blank" rel="noopener noreferrer">
            📍 Maps
          </a>
        )}
        {permit.latitude && permit.longitude && (
          <a className="drawer-link" href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${permit.latitude},${permit.longitude}`} target="_blank" rel="noopener noreferrer">
            🚶 Street View
          </a>
        )}
      </div>
    </div>
  );
}

// ── Virtualized permit list row ──
type PermitRowData = {
  sortedPermits: Permit[];
  selectedPermit: Permit | null;
  setDrawerPermit: (p: Permit) => void;
  setSelectedPermit: (p: Permit) => void;
  flyToPermit: (p: Permit) => void;
};

function PermitRow({ index, style, data }: ListChildComponentProps<PermitRowData>) {
  const { sortedPermits, selectedPermit, setDrawerPermit, setSelectedPermit, flyToPermit } = data;
  const p = sortedPermits[index];
  const isSelected = selectedPermit
    ? (p.job_filing_number && p.job_filing_number === selectedPermit.job_filing_number) || p === selectedPermit
    : false;
  const color = getJobColor(p.job_type ?? '');

  return (
    <div
      style={style}
      className={`permit-row ${isSelected ? 'permit-row--selected' : ''}`}
      onClick={() => {
        setDrawerPermit(p);
        setSelectedPermit(p);
        flyToPermit(p);
      }}
    >
      <span className="permit-row-dot" style={{ background: color, color }} />
      <div className="permit-row-body">
        <div className="permit-row-top">
          <span className="permit-row-type" style={{ color }}>{p.job_type}</span>
          <span className="permit-row-date">{formatDate(p.issued_date ?? p.approved_date)?.split(',')[0]}</span>
        </div>
        <div className="permit-row-addr">{formatAddress(p)}</div>
      </div>
    </div>
  );
}

// Pre-compute recency opacities for all permits in O(n)
function computeOpacities(permits: Permit[]): Map<Permit, number> {
  const times = permits.map(p =>
    new Date(p.issued_date ?? p.approved_date ?? '').getTime()
  );
  const valid = times.filter(t => !isNaN(t));
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const map = new Map<Permit, number>();
  permits.forEach((p, i) => {
    const t = times[i];
    map.set(p, isNaN(t) || max === min ? 1 : 0.5 + 0.5 * ((t - min) / (max - min)));
  });
  return map;
}

export default function App() {
  const viewerRef = useRef<HTMLDivElement>(null);
  const osdRef = useRef<OpenSeadragon.Viewer | null>(null);
  const overlayMarkersRef = useRef<Map<string, HTMLElement>>(new Map());
  const markerGenRef = useRef(0);
  const labelsRef = useRef<NeighborhoodLabels | null>(null);
  const markerRafRef = useRef<number | null>(null);

  const [permits, setPermits] = useState<Permit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ permit: Permit; x: number; y: number } | null>(null);
  const [drawerPermit, setDrawerPermit] = useState<Permit | null>(null);
  const [dziLoaded, setDziLoaded] = useState(false);
  const [overlayOn, setOverlayOn] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [permitsOpen, setPermitsOpen] = useState(true);
  const [infoOpen, setInfoOpen] = useState(false);
  const [selectedPermit, setSelectedPermit] = useState<Permit | null>(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const listRef = useRef<List>(null);
  const permitListWrapRef = useRef<HTMLDivElement>(null);
  const [permitListHeight, setPermitListHeight] = useState(280);
  const heliOverlaysRef = useRef<Map<string, HTMLElement>>(new Map());
  const heliTrackRef = useRef<Map<string, number>>(new Map()); // hex -> track degrees
  const heliPositionsRef = useRef<Map<string, { fromX: number; fromY: number; toX: number; toY: number; startTime: number; duration: number }>>(new Map());
  const heliRafRef = useRef<number | null>(null);
  const heliActiveRef = useRef(false);

  const [filters, setFilters] = useState<FilterState>({
    jobTypes: new Set(ALL_JOB_TYPES),
    boroughs: new Set(['MANHATTAN']),
    daysBack: 7,
  });

  const filteredPermits = useMemo(() => permits.filter(p => {
    const jt = p.job_type?.toUpperCase() ?? 'OTHER';
    const borough = p.borough?.toUpperCase() ?? '';
    const jobTypeMatch = filters.jobTypes.has(jt) || (!ALL_JOB_TYPES.includes(jt) && filters.jobTypes.has('OTHER'));
    const boroughMatch = filters.boroughs.has(borough);
    return jobTypeMatch && boroughMatch;
  }), [permits, filters.jobTypes, filters.boroughs]);

  // Initialize OpenSeadragon
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
      animationTime: 0.3,
      blendTime: 0.1,
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
      // Start zoomed into Midtown Manhattan (Empire State Building area)
      // vpX/vpY: seed pixel (45059, 43479) / image width (123904)
      viewer.viewport.panTo(new OpenSeadragon.Point(0.3637, 0.3509), true);
      viewer.viewport.zoomTo(window.innerWidth <= 768 ? 10 : 3.5, undefined, true);
    });
    // Enforce minimum helicopter size — OSD shrinks overlays proportional to 1/zoom.
    // We counter-scale to maintain a minimum visible pixel size.
    const MIN_HELI_PX = 6;
    viewer.addHandler('zoom', () => {
      const zoom = viewer.viewport.getZoom();
      const effectiveSize = 10 * (HELI_BASE_ZOOM / zoom);
      const s = effectiveSize < MIN_HELI_PX ? MIN_HELI_PX / effectiveSize : 1;
      // Set scale on the .heli-scale inner div — OSD can't touch it
      heliOverlaysRef.current.forEach(el => {
        const scaleDiv = el.querySelector('.heli-scale') as HTMLElement;
        if (scaleDiv) scaleDiv.style.transform = `scale(${s})`;
      });
    });

    osdRef.current = viewer;
    return () => {
      labelsRef.current?.destroy();
      labelsRef.current = null;
      heliActiveRef.current = false;
      if (heliRafRef.current !== null) { cancelAnimationFrame(heliRafRef.current); heliRafRef.current = null; }
      viewer.destroy();
      osdRef.current = null;
    };
  }, []);

  // Fetch permits
  useEffect(() => {
    setPermits([]);
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchPermits(filters.daysBack);
        setPermits(data);
      } catch (e) {
        setError('Failed to load permit data.');
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    load();
    const interval = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [filters.daysBack]);

  // Helicopter live layer — smooth interpolation + directional rotation
  const placeHelicopters = useCallback((helis: HelicopterState[]) => {
    const viewer = osdRef.current;
    if (!viewer) return;
    const existing = heliOverlaysRef.current;
    const positions = heliPositionsRef.current;
    const tracks = heliTrackRef.current;
    const POLL_MS = 12000;

    // Remove stale helicopters
    const activeHexes = new Set(helis.map(h => h.hex));
    existing.forEach((el, hex) => {
      if (!activeHexes.has(hex)) {
        try { viewer.removeOverlay(el); } catch {}
        existing.delete(hex);
        positions.delete(hex);
        tracks.delete(hex);
      }
    });

    const now = performance.now();

    helis.forEach(h => {
      const { x: imgX, y: imgY } = latlngToImagePx(h.lat, h.lon);
      if (imgX < 0 || imgX > IMAGE_DIMS.width || imgY < 0 || imgY > IMAGE_DIMS.height) return;
      const toX = imgX / IMAGE_DIMS.width;
      const toY = imgY / IMAGE_DIMS.width;
      tracks.set(h.hex, h.track);

      if (existing.has(h.hex)) {
        const prev = positions.get(h.hex)!;
        const t = Math.min(1, (now - prev.startTime) / prev.duration);
        const curX = prev.fromX + (prev.toX - prev.fromX) * t;
        const curY = prev.fromY + (prev.toY - prev.fromY) * t;
        positions.set(h.hex, { fromX: curX, fromY: curY, toX, toY, startTime: now, duration: POLL_MS });
        // Update rotation immediately
        const el = existing.get(h.hex)!;
        // Flip inner span based on heading: west-ish = face left, east-ish = face right
        const flipSpan = el.querySelector('.heli-flip') as HTMLElement;
        // SVG faces RIGHT by default. Flip when heading left (west: 90 < track < 270).
        if (flipSpan) flipSpan.style.transform = (h.track > 90 && h.track < 270) ? 'scaleX(-1)' : '';
      } else {
        const el = document.createElement('div');
        el.className = 'heli-marker';
        // 🚁 emoji: faces RIGHT on Windows/Android, LEFT on Apple.
        // We target the majority (Windows/Android) — default facing is RIGHT.
        // Flip when heading west (90 < track < 270) so the heli faces its direction of travel.
        const facingLeft = (h.track > 90 && h.track < 270);
        // Structure: .heli-marker > .heli-scale (zoom compensation) > .heli-flip (direction)
        el.innerHTML = `<div class="heli-scale"><span class="heli-flip" style="display:inline-block;font-size:10px;${facingLeft ? 'transform:scaleX(-1)' : ''}">🚁</span></div>`;
        const point = new OpenSeadragon.Point(toX, toY);
        viewer.addOverlay({ element: el, location: point, placement: OpenSeadragon.Placement.CENTER });
        existing.set(h.hex, el);
        positions.set(h.hex, { fromX: toX, fromY: toY, toX, toY, startTime: now, duration: POLL_MS });
      }
    });

    // Apply current zoom scale to newly placed/updated helis
    const zoom = viewer.viewport.getZoom();
    const effectiveSize = 10 * (HELI_BASE_ZOOM / zoom);
    const s = effectiveSize < 6 ? 6 / effectiveSize : 1;
    existing.forEach(el => {
      const scaleDiv = el.querySelector('.heli-scale') as HTMLElement;
      if (scaleDiv) scaleDiv.style.transform = `scale(${s})`;
    });

    // Start RAF loop if not already running
    if (!heliActiveRef.current && existing.size > 0) {
      heliActiveRef.current = true;
      const animate = () => {
        const v = osdRef.current;
        if (!v || !heliActiveRef.current) return;
        const now2 = performance.now();
        existing.forEach((el, hex) => {
          const pos = positions.get(hex);
          if (!pos) return;
          const progress = Math.min(1, (now2 - pos.startTime) / pos.duration);
          const x = pos.fromX + (pos.toX - pos.fromX) * progress;
          const y = pos.fromY + (pos.toY - pos.fromY) * progress;
          try { v.updateOverlay(el, new OpenSeadragon.Point(x, y), OpenSeadragon.Placement.CENTER); } catch {}
        });
        heliRafRef.current = requestAnimationFrame(animate);
      };
      heliRafRef.current = requestAnimationFrame(animate);
    }
  }, []);

  // Helicopter live layer — polls every 12s, only after map is ready
  useEffect(() => {
    if (!dziLoaded) return;
    let cancelled = false;
    async function poll() {
      if (cancelled) return;
      const helis = await fetchHelicopters();
      if (!cancelled) placeHelicopters(helis);
    }
    poll();
    const interval = setInterval(poll, 12000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [dziLoaded, placeHelicopters]);

  // Place markers with recency fade
  const placeMarkers = useCallback(() => {
    const viewer = osdRef.current;
    if (!viewer) return;

    // Nuclear clear: remove every permit overlay by DOM class, not just tracked refs
    // (guards against stale elements that slipped past ref tracking)
    const allOverlayEls = viewer.element.querySelectorAll('.permit-marker');
    allOverlayEls.forEach(el => { try { viewer.removeOverlay(el as HTMLElement); } catch {} });
    overlayMarkersRef.current.forEach(el => { try { viewer.removeOverlay(el); } catch {} });
    overlayMarkersRef.current.clear();
    if (!overlayOn || filteredPermits.length === 0) return;

    // Pre-compute opacities in O(n) — avoids O(n²) min/max scan per marker
    const opacities = computeOpacities(filteredPermits);

    // Build all valid marker entries first
    const entries: Array<{ el: HTMLDivElement; vpX: number; vpY: number; permit: Permit; key: string; opacity: number }> = [];
    filteredPermits.forEach((permit, idx) => {
      const lat = parseFloat(permit.latitude ?? '');
      const lng = parseFloat(permit.longitude ?? '');
      if (isNaN(lat) || isNaN(lng)) return;
      const { x: imageX, y: imageY } = latlngToImagePx(lat, lng);
      if (imageX < 0 || imageX > IMAGE_DIMS.width || imageY < 0 || imageY > IMAGE_DIMS.height) return;

      const opacity = opacities.get(permit) ?? 1;
      const el = document.createElement('div');
      el.className = 'permit-marker';
      el.style.cssText = `width:10px;height:10px;opacity:${opacity};pointer-events:auto;`;
      el.style.setProperty('--color', getJobColor(permit.job_type ?? ''));

      const key = permit.job_filing_number ? `job-${permit.job_filing_number}` : `idx-${idx}`;
      el.dataset.key = key;

      entries.push({
        el, vpX: imageX / IMAGE_DIMS.width, vpY: imageY / IMAGE_DIMS.width,
        permit, key, opacity,
      });
    });

    // Cancel any in-flight chunk loop from a previous render
    if (markerRafRef.current !== null) {
      cancelAnimationFrame(markerRafRef.current);
      markerRafRef.current = null;
    }

    // Increment generation — stale RAF callbacks will see a mismatched gen and bail
    const gen = ++markerGenRef.current;

    // Add markers in chunks of 400 per frame to avoid blocking the main thread
    const CHUNK = 400;
    let i = 0;
    function addChunk() {
      if (!osdRef.current || markerGenRef.current !== gen) return; // stale or destroyed
      const end = Math.min(i + CHUNK, entries.length);
      for (; i < end; i++) {
        const { el, vpX, vpY, permit, key, opacity } = entries[i];

        // Attach listeners only once per element
        el.addEventListener('mouseenter', (e) => {
          const rect = (e.target as HTMLElement).getBoundingClientRect();
          setTooltip({ permit, x: rect.left + rect.width / 2, y: rect.top });
          el.style.opacity = '1';
        });
        el.addEventListener('mouseleave', () => {
          setTooltip(null);
          el.style.opacity = String(opacity);
        });
        el.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          e.stopImmediatePropagation();
        });
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          e.stopImmediatePropagation();
          setDrawerPermit(permit);
          setSelectedPermit(permit);
        });

        osdRef.current.addOverlay({
          element: el,
          location: new OpenSeadragon.Point(vpX, vpY),
          placement: OpenSeadragon.Placement.CENTER,
          checkResize: false,
        });
        overlayMarkersRef.current.set(key, el);
      }
      if (i < entries.length) {
        markerRafRef.current = requestAnimationFrame(addChunk);
      } else {
        markerRafRef.current = null;
      }
    }
    markerRafRef.current = requestAnimationFrame(addChunk);
  }, [filteredPermits, overlayOn]);

  useEffect(() => { if (dziLoaded) placeMarkers(); }, [dziLoaded, placeMarkers]);

  const flyToPermit = useCallback((permit: Permit) => {
    const viewer = osdRef.current;
    if (!viewer) return;
    const lat = parseFloat(permit.latitude ?? '');
    const lng = parseFloat(permit.longitude ?? '');
    if (isNaN(lat) || isNaN(lng)) return;
    const { x: imgX, y: imgY } = latlngToImagePx(lat, lng);
    const targetVpX = imgX / IMAGE_DIMS.width;
    const targetVpY = imgY / IMAGE_DIMS.width;
    viewer.viewport.panTo(new OpenSeadragon.Point(targetVpX, targetVpY));
    viewer.viewport.zoomTo(viewer.viewport.getZoom() > 4 ? viewer.viewport.getZoom() : 6);
  }, []);

  const toggleJobType = (jt: string) => setFilters(prev => {
    const next = new Set(prev.jobTypes);
    next.has(jt) ? next.delete(jt) : next.add(jt);
    return { ...prev, jobTypes: next };
  });

  const toggleBorough = (b: string) => setFilters(prev => {
    const next = new Set(prev.boroughs);
    next.has(b) ? next.delete(b) : next.add(b);
    return { ...prev, boroughs: next };
  });

  const sortedPermits = useMemo(() => [...filteredPermits].sort((a, b) =>
    new Date(b.issued_date ?? b.approved_date ?? '').getTime() -
    new Date(a.issued_date ?? a.approved_date ?? '').getTime()
  ), [filteredPermits]);

  // Measure permit list container height dynamically
  useEffect(() => {
    const el = permitListWrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        setPermitListHeight(entry.contentRect.height);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Scroll virtual list to selected permit
  useEffect(() => {
    if (!selectedPermit || !listRef.current) return;
    const idx = sortedPermits.findIndex(p =>
      (p.job_filing_number && p.job_filing_number === selectedPermit.job_filing_number) ||
      p === selectedPermit
    );
    if (idx >= 0) listRef.current.scrollToItem(idx, 'smart');
  }, [selectedPermit, sortedPermits]);

  // Highlight selected marker dot on map
  useEffect(() => {
    // Clear previous selection
    overlayMarkersRef.current.forEach(el => el.classList.remove('permit-marker--selected'));
    if (!selectedPermit) return;
    const key = selectedPermit.job_filing_number
      ? `job-${selectedPermit.job_filing_number}`
      : null;
    if (key) {
      const el = overlayMarkersRef.current.get(key);
      if (el) el.classList.add('permit-marker--selected');
    }
  }, [selectedPermit]);

  return (
    <div className="app">
      <div ref={viewerRef} className="viewer" />

      {loading && !dziLoaded && (
        <div className="loading-overlay">
          <div className="loading-spinner" />
          <div className="loading-text">Loading NYC Permit Pulse...</div>
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}

      {/* ── Mobile sidebar toggle ── */}
      <button className="mobile-sidebar-btn" onClick={() => setMobileSidebarOpen(v => !v)}>
        {mobileSidebarOpen ? '✕' : '☰'}
      </button>

      {/* ── Mobile overlay backdrop ── */}
      {mobileSidebarOpen && <div className="mobile-backdrop" onClick={() => setMobileSidebarOpen(false)} />}

      {/* ── Sidebar ── */}
      <div className={`sidebar${mobileSidebarOpen ? ' sidebar--mobile-open' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-title-row">
            <span className="sidebar-title">NYC PERMIT PULSE</span>
            <div className="sidebar-title-actions">
              <button className="info-btn" onClick={() => setInfoOpen(true)} title="About">?</button>
              <button
                className={`overlay-toggle ${overlayOn ? 'on' : 'off'}`}
                onClick={() => setOverlayOn(v => !v)}
              >
                {overlayOn ? 'ON' : 'OFF'}
              </button>
            </div>
          </div>
          <div className="sidebar-meta">
            {loading ? '…' : `${filteredPermits.length} permits`}
            {!dziLoaded && ' · loading map'}
          </div>
        </div>

        <div className="sidebar-section">
          <button className="section-toggle" onClick={() => setFiltersOpen(v => !v)}>
            <span>FILTERS</span>
            <span className="section-caret">{filtersOpen ? '▾' : '▸'}</span>
          </button>
          {filtersOpen && (
            <div className="section-body">
              <div className="filter-group">
                <div className="filter-label">PERMIT TYPE</div>
                <div className="chips">
                  {ALL_JOB_TYPES.map(jt => (
                    <button key={jt}
                      className={`chip ${filters.jobTypes.has(jt) ? 'active' : ''}`}
                      style={{ '--chip-color': getJobColor(jt) } as React.CSSProperties}
                      onClick={() => toggleJobType(jt)} title={getJobLabel(jt)}>
                      {getJobEmoji(jt)} {jt}
                    </button>
                  ))}
                </div>
              </div>
              <div className="filter-group">
                <div className="filter-label">BOROUGH</div>
                <div className="chips">
                  {ALL_BOROUGHS.map(b => (
                    <button key={b}
                      className={`chip ${filters.boroughs.has(b) ? 'active' : ''}`}
                      onClick={() => toggleBorough(b)}>
                      {BOROUGH_ABBR[b] ?? b}
                    </button>
                  ))}
                </div>
              </div>
              <div className="filter-group">
                <div className="filter-label">DATE RANGE</div>
                <div className="chips">
                  {([7, 30] as const).map(d => (
                    <button key={d}
                      className={`chip ${filters.daysBack === d ? 'active' : ''}`}
                      onClick={() => setFilters(prev => ({ ...prev, daysBack: d }))}>
                      {d === 7 ? '7 Days' : '30 Days'}
                    </button>
                  ))}
                </div>
                <div className="filter-lag-note">⚠ DOB data lags 2–5 days</div>
              </div>
            </div>
          )}
        </div>

        <div className="sidebar-section sidebar-section--grow">
          <button className="section-toggle" onClick={() => setPermitsOpen(v => !v)}>
            <span>PERMITS <span className="section-count">{sortedPermits.length > 0 ? sortedPermits.length.toLocaleString() : ''}</span></span>
            <span className="section-caret">{permitsOpen ? '▾' : '▸'}</span>
          </button>
          {permitsOpen && (
            <div className="permit-list-wrap" ref={permitListWrapRef}>
              {sortedPermits.length === 0
                ? <div className="permit-list-empty">No permits match filters</div>
                : <List
                    ref={listRef}
                    height={permitListHeight}
                    itemCount={sortedPermits.length}
                    itemSize={48}
                    width="100%"
                    itemData={{ sortedPermits, selectedPermit, setDrawerPermit, setSelectedPermit, flyToPermit }}
                  >
                    {PermitRow}
                  </List>
              }
            </div>
          )}
        </div>

        <PermitChart permits={filteredPermits} />

        <div className="sidebar-footer">permitpulse.nyc · isometric.nyc overlay</div>
      </div>

      {/* ── Permit detail drawer ── */}
      {drawerPermit && (
        <PermitDrawer permit={drawerPermit} onClose={() => { setDrawerPermit(null); setSelectedPermit(null); }} />
      )}

      {/* ── Info modal ── */}
      {infoOpen && (
        <div className="info-backdrop" onClick={() => setInfoOpen(false)}>
          <div className="info-modal" onClick={e => e.stopPropagation()}>
            <div className="info-header">
              <span className="info-title">NYC PERMIT PULSE</span>
              <button className="info-close" onClick={() => setInfoOpen(false)}>✕</button>
            </div>
            <div className="info-body">
              <p>A live overlay of NYC Department of Buildings permit activity on the isometric pixel-art map by <a href="https://isometric.nyc" target="_blank" rel="noopener noreferrer">isometric.nyc</a>.</p>
              <p>Each dot represents an active permit — color-coded by type. Click any dot to see the full filing details, or use the sidebar to filter by permit type, borough, and date range.</p>
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
              <p className="info-note">Data sourced from NYC Open Data · DOB publishes with a 2–5 day lag</p>
            </div>
          </div>
        </div>
      )}

      {/* Hover tooltip */}
      {tooltip && (
        <div className="tooltip" style={{ left: tooltip.x, top: tooltip.y - 8, transform: 'translate(-50%, -100%)' }}>
          <div className="tooltip-type" style={{ color: getJobColor(tooltip.permit.job_type ?? '') }}>
            {getJobEmoji(tooltip.permit.job_type ?? '')} {getJobLabel(tooltip.permit.job_type ?? '')}
          </div>
          <div className="tooltip-address">{formatAddress(tooltip.permit)}</div>
          {tooltip.permit.owner_business_name && (
            <div className="tooltip-owner">{tooltip.permit.owner_business_name}</div>
          )}
          <div className="tooltip-date">{formatDate(tooltip.permit.issued_date ?? tooltip.permit.approved_date)}</div>
          <div className="tooltip-hint">click for details</div>
        </div>
      )}
    </div>
  );
}
