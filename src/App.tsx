import { useEffect, useRef, useState, useCallback } from 'react';
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
import './App.css';

// Tile server: isometric-nyc-tiles.cannoneyed.com/dzi/tiles_files/{level}/{x}_{y}.webp
// Custom zoom convention: level 0 = most zoomed out, level 8 = full resolution
const TILE_BASE = import.meta.env.DEV
  ? '/dzi/tiles_files'
  : 'https://isometric-nyc-tiles.cannoneyed.com/dzi/tiles_files';
const DZI_DIMENSIONS = { width: 123904, height: 100864 };
const MAX_LEVEL = 8;
const TILE_SIZE = 512;

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

// Borough abbreviations for display
const BOROUGH_ABBR: Record<string, string> = {
  'MANHATTAN': 'MAN',
  'BROOKLYN': 'BKN',
  'QUEENS': 'QNS',
  'BRONX': 'BRX',
  'STATEN ISLAND': 'SI',
};

interface TooltipInfo {
  permit: Permit;
  x: number;
  y: number;
}

interface CalibPoint {
  label: string;
  lat: number;
  lng: number;
  imgX: number;
  imgY: number;
}

export default function App() {
  const viewerRef = useRef<HTMLDivElement>(null);
  const osdRef = useRef<OpenSeadragon.Viewer | null>(null);
  const overlayMarkersRef = useRef<Map<string, HTMLElement>>(new Map());

  const [permits, setPermits] = useState<Permit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<TooltipInfo | null>(null);
  const [dziLoaded, setDziLoaded] = useState(false);
  const [dziDimensions, setDziDimensions] = useState<{ width: number; height: number } | null>(null);

  // Sidebar state
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [tickerOpen, setTickerOpen] = useState(true);

  // Calibration (dev only)
  const [calibMode, setCalibMode] = useState(false);
  const [calibPoints, setCalibPoints] = useState<CalibPoint[]>([]);
  const [calibPending, setCalibPending] = useState<{ imgX: number; imgY: number } | null>(null);
  const [calibInput, setCalibInput] = useState({ label: '', lat: '', lng: '' });

  const [filters, setFilters] = useState<FilterState>({
    jobTypes: new Set(ALL_JOB_TYPES),
    boroughs: new Set(ALL_BOROUGHS),
    daysBack: 30,
  });

  const filteredPermits = permits.filter(p => {
    const jt = p.job_type?.toUpperCase() ?? 'OTHER';
    const borough = p.borough?.toUpperCase() ?? '';
    const jobTypeMatch = filters.jobTypes.has(jt) || (!ALL_JOB_TYPES.includes(jt) && filters.jobTypes.has('OTHER'));
    const boroughMatch = filters.boroughs.has(borough);
    return jobTypeMatch && boroughMatch;
  });

  useEffect(() => { setDziDimensions(DZI_DIMENSIONS); }, []);

  // Initialize OpenSeadragon
  useEffect(() => {
    if (!viewerRef.current || osdRef.current) return;

    const viewer = OpenSeadragon({
      element: viewerRef.current,
      prefixUrl: '',
      showNavigationControl: false,
      showNavigator: true,
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
      (window as any).__osd = viewer;
    });

    viewer.addHandler('canvas-click', (event: any) => {
      if (!(window as any).__calibMode) return;
      event.preventDefaultAction = true;
      const imgCoords = viewer.viewport.viewportToImageCoordinates(
        viewer.viewport.pointFromPixel(event.position)
      );
      const imgX = Math.round(imgCoords.x);
      const imgY = Math.round(imgCoords.y);
      console.log(`[CALIB] Clicked image coords: (${imgX}, ${imgY})`);
      setCalibPending({ imgX, imgY });
    });

    osdRef.current = viewer;
    (window as any).__osd = viewer;

    return () => { viewer.destroy(); osdRef.current = null; };
  }, []);

  // Fetch permits
  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchPermits(filters.daysBack);
        setPermits(data);
      } catch (e) {
        setError('Failed to load permit data. Try refreshing.');
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    load();
    const interval = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [filters.daysBack]);

  // Place permit markers
  const placeMarkers = useCallback(() => {
    const viewer = osdRef.current;
    if (!viewer || !dziDimensions) return;

    viewer.clearOverlays();
    overlayMarkersRef.current.clear();

    let placed = 0;
    filteredPermits.forEach((permit, idx) => {
      const lat = parseFloat(permit.gis_latitude ?? '');
      const lng = parseFloat(permit.gis_longitude ?? '');
      if (isNaN(lat) || isNaN(lng)) return;

      const { x: imageX, y: imageY } = latlngToImagePx(lat, lng);
      if (imageX < 0 || imageX > IMAGE_DIMS.width || imageY < 0 || imageY > IMAGE_DIMS.height) return;

      // OSD viewport: both axes use image WIDTH as the unit
      const vpX = imageX / IMAGE_DIMS.width;
      const vpY = imageY / IMAGE_DIMS.width;

      const el = document.createElement('div');
      el.className = 'permit-marker';
      el.style.setProperty('--color', getJobColor(permit.job_type ?? ''));
      el.style.width = '10px';
      el.style.height = '10px';

      el.addEventListener('mouseenter', (e) => {
        const rect = (e.target as HTMLElement).getBoundingClientRect();
        setTooltip({ permit, x: rect.left + rect.width / 2, y: rect.top });
      });
      el.addEventListener('mouseleave', () => setTooltip(null));

      viewer.addOverlay({
        element: el,
        location: new OpenSeadragon.Point(vpX, vpY),
        placement: OpenSeadragon.Placement.CENTER,
        checkResize: false,
      });

      const key = permit.job__ ? `job-${permit.job__}` : `idx-${idx}`;
      overlayMarkersRef.current.set(key, el);
      placed++;
    });

    console.log(`Placed ${placed} markers`);
  }, [filteredPermits, dziDimensions]);

  useEffect(() => {
    if (dziLoaded) placeMarkers();
  }, [dziLoaded, placeMarkers]);

  const flyToPermit = useCallback((permit: Permit) => {
    const viewer = osdRef.current;
    if (!viewer || !dziDimensions) return;
    const lat = parseFloat(permit.gis_latitude ?? '');
    const lng = parseFloat(permit.gis_longitude ?? '');
    if (isNaN(lat) || isNaN(lng)) return;
    const { x: imgX, y: imgY } = latlngToImagePx(lat, lng);
    viewer.viewport.panTo(new OpenSeadragon.Point(imgX / IMAGE_DIMS.width, imgY / IMAGE_DIMS.width));
    viewer.viewport.zoomTo(viewer.viewport.getZoom() > 4 ? viewer.viewport.getZoom() : 6);
  }, [dziDimensions]);

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

  const recentPermits = [...filteredPermits]
    .sort((a, b) => new Date(b.issuance_date ?? b.filing_date ?? '').getTime()
                  - new Date(a.issuance_date ?? a.filing_date ?? '').getTime())
    .slice(0, 30);

  return (
    <div className="app">
      {/* Map */}
      <div ref={viewerRef} className="viewer" />

      {/* Loading overlay */}
      {loading && !dziLoaded && (
        <div className="loading-overlay">
          <div className="loading-spinner" />
          <div className="loading-text">Loading NYC Permit Pulse...</div>
        </div>
      )}

      {/* Error */}
      {error && <div className="error-banner">{error}</div>}

      {/* Sidebar toggle tab — always visible */}
      <button
        className={`sidebar-tab ${sidebarOpen ? 'open' : ''}`}
        onClick={() => setSidebarOpen(v => !v)}
        title={sidebarOpen ? 'Hide Permit Pulse' : 'Show Permit Pulse'}
      >
        {sidebarOpen ? '◀' : '▶'}
      </button>

      {/* ── Sidebar ── */}
      <div className={`sidebar ${sidebarOpen ? 'open' : ''}`}>

        {/* Sidebar header */}
        <div className="sidebar-header">
          <span className="sidebar-title">NYC PERMIT PULSE</span>
          <span className="sidebar-count">
            {loading ? '…' : `${filteredPermits.length}`}
            <span className="sidebar-count-label"> permits</span>
          </span>
        </div>

        {/* Filters section */}
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
                    <button
                      key={jt}
                      className={`chip ${filters.jobTypes.has(jt) ? 'active' : ''}`}
                      style={{ '--chip-color': getJobColor(jt) } as React.CSSProperties}
                      onClick={() => toggleJobType(jt)}
                      title={getJobLabel(jt)}
                    >
                      {getJobEmoji(jt)} {jt}
                    </button>
                  ))}
                </div>
              </div>

              <div className="filter-group">
                <div className="filter-label">BOROUGH</div>
                <div className="chips">
                  {ALL_BOROUGHS.map(b => (
                    <button
                      key={b}
                      className={`chip ${filters.boroughs.has(b) ? 'active' : ''}`}
                      onClick={() => toggleBorough(b)}
                    >
                      {BOROUGH_ABBR[b] ?? b}
                    </button>
                  ))}
                </div>
              </div>

              <div className="filter-group">
                <div className="filter-label">DATE RANGE</div>
                <div className="chips">
                  {[7, 30, 90].map(d => (
                    <button
                      key={d}
                      className={`chip ${filters.daysBack === d ? 'active' : ''}`}
                      onClick={() => setFilters(prev => ({ ...prev, daysBack: d }))}
                    >
                      {d}d
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Ticker section */}
        <div className="sidebar-section sidebar-section--grow">
          <button className="section-toggle" onClick={() => setTickerOpen(v => !v)}>
            <span>LIVE TICKER</span>
            <span className="section-caret">{tickerOpen ? '▾' : '▸'}</span>
          </button>
          {tickerOpen && (
            <div className="ticker-list">
              {recentPermits.length === 0 && (
                <div className="ticker-empty">No permits match filters</div>
              )}
              {recentPermits.map((p, i) => (
                <div
                  key={`${p.job__}-${i}`}
                  className="ticker-row"
                  onClick={() => flyToPermit(p)}
                >
                  <span className="ticker-emoji">{getJobEmoji(p.job_type ?? '')}</span>
                  <span className="ticker-type" style={{ color: getJobColor(p.job_type ?? '') }}>
                    {p.job_type}
                  </span>
                  <span className="ticker-address">{formatAddress(p)}</span>
                  <span className="ticker-date">
                    {formatDate(p.issuance_date ?? p.filing_date)?.split(',')[0]}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sidebar footer */}
        <div className="sidebar-footer">
          permit-pulse · isometric.nyc overlay
        </div>
      </div>

      {/* Dev: Calibration */}
      {import.meta.env.DEV && (
        <button
          className={`calib-toggle ${calibMode ? 'active' : ''}`}
          onClick={() => {
            const next = !calibMode;
            setCalibMode(next);
            (window as any).__calibMode = next;
            if (!next) setCalibPending(null);
          }}
        >
          {calibMode ? '🎯 CALIB ON' : '🎯 CALIB'}
        </button>
      )}

      {calibMode && calibPending && (
        <div className="calib-modal">
          <div className="calib-modal-title">📍 Tag this point</div>
          <div className="calib-modal-coords">Image: ({calibPending.imgX}, {calibPending.imgY})</div>
          <input className="calib-input" placeholder="Label (e.g. 123 Main St, Brooklyn)"
            value={calibInput.label} onChange={e => setCalibInput(p => ({ ...p, label: e.target.value }))} />
          <input className="calib-input" placeholder="Latitude"
            value={calibInput.lat} onChange={e => setCalibInput(p => ({ ...p, lat: e.target.value }))} />
          <input className="calib-input" placeholder="Longitude"
            value={calibInput.lng} onChange={e => setCalibInput(p => ({ ...p, lng: e.target.value }))} />
          <div className="calib-modal-buttons">
            <button className="calib-btn save" onClick={() => {
              const lat = parseFloat(calibInput.lat);
              const lng = parseFloat(calibInput.lng);
              if (isNaN(lat) || isNaN(lng) || !calibInput.label) return;
              const next = [...calibPoints, { label: calibInput.label, lat, lng, imgX: calibPending.imgX, imgY: calibPending.imgY }];
              setCalibPoints(next);
              setCalibPending(null);
              setCalibInput({ label: '', lat: '', lng: '' });
              (window as any).__calibPoints = next;
            }}>Save</button>
            <button className="calib-btn cancel" onClick={() => { setCalibPending(null); setCalibInput({ label: '', lat: '', lng: '' }); }}>Cancel</button>
          </div>
        </div>
      )}

      {calibMode && calibPoints.length > 0 && (
        <div className="calib-list">
          <div className="calib-list-title">CALIBRATION POINTS ({calibPoints.length})</div>
          {calibPoints.map((pt, i) => (
            <div key={i} className="calib-list-row">
              <span className="calib-list-label">{pt.label}</span>
              <span className="calib-list-coords">({pt.lat.toFixed(4)}, {pt.lng.toFixed(4)}) → img ({pt.imgX}, {pt.imgY})</span>
            </div>
          ))}
          <button className="calib-btn copy" onClick={() => {
            navigator.clipboard.writeText(JSON.stringify(calibPoints, null, 2));
          }}>📋 Copy JSON</button>
        </div>
      )}

      {/* Tooltip */}
      {tooltip && (
        <div className="tooltip" style={{ left: tooltip.x, top: tooltip.y - 8, transform: 'translate(-50%, -100%)' }}>
          <div className="tooltip-type" style={{ color: getJobColor(tooltip.permit.job_type ?? '') }}>
            {getJobEmoji(tooltip.permit.job_type ?? '')} {getJobLabel(tooltip.permit.job_type ?? '')}
          </div>
          <div className="tooltip-address">{formatAddress(tooltip.permit)}</div>
          {tooltip.permit.owner_s_business_name && (
            <div className="tooltip-owner">{tooltip.permit.owner_s_business_name}</div>
          )}
          <div className="tooltip-date">{formatDate(tooltip.permit.issuance_date ?? tooltip.permit.filing_date)}</div>
        </div>
      )}
    </div>
  );
}
