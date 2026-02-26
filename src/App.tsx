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
// Custom zoom: level 0 = zoomed out, level 8 = full resolution
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

const BOROUGH_ABBR: Record<string, string> = {
  'MANHATTAN': 'MAN',
  'BROOKLYN': 'BKN',
  'QUEENS':   'QNS',
  'BRONX':    'BRX',
  'STATEN ISLAND': 'SI',
};

interface TooltipInfo {
  permit: Permit;
  x: number;
  y: number;
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

  // Whether permit overlay is active
  const [overlayOn, setOverlayOn] = useState(true);

  // Section collapse state
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [tickerOpen, setTickerOpen] = useState(true);

  const [filters, setFilters] = useState<FilterState>({
    jobTypes: new Set(ALL_JOB_TYPES),
    boroughs: new Set(ALL_BOROUGHS),
    daysBack: 7,
  });

  const filteredPermits = permits.filter(p => {
    const jt = p.job_type?.toUpperCase() ?? 'OTHER';
    const borough = p.borough?.toUpperCase() ?? '';
    const jobTypeMatch = filters.jobTypes.has(jt) || (!ALL_JOB_TYPES.includes(jt) && filters.jobTypes.has('OTHER'));
    const boroughMatch = filters.boroughs.has(borough);
    return jobTypeMatch && boroughMatch;
  });

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

  // Place / clear markers based on overlayOn + filters
  const placeMarkers = useCallback(() => {
    const viewer = osdRef.current;
    if (!viewer) return;

    viewer.clearOverlays();
    overlayMarkersRef.current.clear();

    if (!overlayOn) return;

    let placed = 0;
    filteredPermits.forEach((permit, idx) => {
      const lat = parseFloat(permit.latitude ?? '');
      const lng = parseFloat(permit.longitude ?? '');
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

      const key = permit.job_filing_number ? `job-${permit.job_filing_number}` : `idx-${idx}`;
      overlayMarkersRef.current.set(key, el);
      placed++;
    });

    console.log(`Placed ${placed} markers`);
  }, [filteredPermits, overlayOn]);

  useEffect(() => {
    if (dziLoaded) placeMarkers();
  }, [dziLoaded, placeMarkers]);

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

  // All filtered permits sorted newest-first — ticker cycles through all of them
  const sortedPermits = [...filteredPermits]
    .sort((a, b) =>
      new Date(b.issued_date ?? b.approved_date ?? '').getTime() -
      new Date(a.issued_date ?? a.approved_date ?? '').getTime()
    );

  // Auto-scrolling ticker state
  const tickerRef = useRef<HTMLDivElement>(null);
  const [tickerIndex, setTickerIndex] = useState(0);
  const [tickerFlash, setTickerFlash] = useState<number | null>(null);
  const tickerPausedRef = useRef(false);

  useEffect(() => {
    if (!tickerOpen || sortedPermits.length === 0) return;
    const interval = setInterval(() => {
      if (tickerPausedRef.current) return;
      setTickerIndex(i => {
        const next = (i + 1) % sortedPermits.length;
        setTickerFlash(next);
        setTimeout(() => setTickerFlash(null), 600);
        // Scroll the ticker container
        const el = tickerRef.current;
        if (el) {
          const rows = el.querySelectorAll('.ticker-row');
          const row = rows[next % rows.length] as HTMLElement;
          if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
        return next;
      });
    }, 2200);
    return () => clearInterval(interval);
  }, [tickerOpen, sortedPermits.length]);

  // Visible window: show 8 rows centered around current index
  const TICKER_WINDOW = 8;
  const tickerPermits = sortedPermits.length === 0 ? [] : (() => {
    const result = [];
    for (let i = 0; i < Math.min(TICKER_WINDOW, sortedPermits.length); i++) {
      result.push({ permit: sortedPermits[(tickerIndex + i) % sortedPermits.length], slot: i });
    }
    return result;
  })();

  return (
    <div className="app">
      {/* Map */}
      <div ref={viewerRef} className="viewer" />

      {/* Loading */}
      {loading && !dziLoaded && (
        <div className="loading-overlay">
          <div className="loading-spinner" />
          <div className="loading-text">Loading NYC Permit Pulse...</div>
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}

      {/* ── Sidebar ── */}
      <div className="sidebar">

        {/* Header */}
        <div className="sidebar-header">
          <div className="sidebar-title-row">
            <span className="sidebar-title">NYC PERMIT PULSE</span>
            {/* On/off toggle */}
            <button
              className={`overlay-toggle ${overlayOn ? 'on' : 'off'}`}
              onClick={() => setOverlayOn(v => !v)}
              title={overlayOn ? 'Hide permit markers' : 'Show permit markers'}
            >
              {overlayOn ? 'ON' : 'OFF'}
            </button>
          </div>
          <div className="sidebar-meta">
            {loading ? '…' : `${filteredPermits.length} permits`}
            {!dziLoaded && ' · loading map'}
          </div>
        </div>

        {/* Filters */}
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
                  {([1, 7, 30] as const).map(d => (
                    <button
                      key={d}
                      className={`chip ${filters.daysBack === d ? 'active' : ''}`}
                      onClick={() => setFilters(prev => ({ ...prev, daysBack: d }))}
                      title={d === 1 ? 'Data updates ~24h delayed' : undefined}
                    >
                      {d === 1 ? '24h' : `${d}d`}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Live Ticker */}
        <div className="sidebar-section sidebar-section--grow">
          <button className="section-toggle" onClick={() => setTickerOpen(v => !v)}>
            <span>LIVE TICKER</span>
            <span className="section-caret">{tickerOpen ? '▾' : '▸'}</span>
          </button>
          {tickerOpen && (
            <div
              className="ticker-list"
              ref={tickerRef}
              onMouseEnter={() => { tickerPausedRef.current = true; }}
              onMouseLeave={() => { tickerPausedRef.current = false; }}
            >
              {sortedPermits.length === 0 && (
                <div className="ticker-empty">No permits match filters</div>
              )}
              {tickerPermits.map(({ permit: p, slot }) => (
                <div
                  key={`${p.job_filing_number}-${slot}`}
                  className={`ticker-row ${slot === 0 ? 'ticker-row--active' : ''} ${tickerFlash === (tickerIndex + slot) % sortedPermits.length ? 'ticker-row--flash' : ''}`}
                  onClick={() => { flyToPermit(p); }}
                >
                  <span className="ticker-dot" style={{ background: getJobColor(p.job_type ?? '') }} />
                  <span className="ticker-type" style={{ color: getJobColor(p.job_type ?? '') }}>
                    {p.job_type}
                  </span>
                  <span className="ticker-address">{formatAddress(p)}</span>
                  <span className="ticker-date">
                    {formatDate(p.issued_date ?? p.approved_date)?.split(',')[0]}
                  </span>
                </div>
              ))}
              {sortedPermits.length > 0 && (
                <div className="ticker-counter">
                  {tickerIndex + 1} / {sortedPermits.length}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="sidebar-footer">
          permit-pulse · isometric.nyc overlay
        </div>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="tooltip"
          style={{ left: tooltip.x, top: tooltip.y - 8, transform: 'translate(-50%, -100%)' }}
        >
          <div className="tooltip-type" style={{ color: getJobColor(tooltip.permit.job_type ?? '') }}>
            {getJobEmoji(tooltip.permit.job_type ?? '')} {getJobLabel(tooltip.permit.job_type ?? '')}
          </div>
          <div className="tooltip-address">{formatAddress(tooltip.permit)}</div>
          {tooltip.permit.owner_business_name && (
            <div className="tooltip-owner">{tooltip.permit.owner_business_name}</div>
          )}
          <div className="tooltip-date">
            {formatDate(tooltip.permit.issued_date ?? tooltip.permit.approved_date)}
          </div>
        </div>
      )}
    </div>
  );
}
