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

// Generation config from the isometric.nyc repo (tiny-nyc / production)
// These values come from generation_config.json and define the coordinate system

// Tile server: isometric-nyc-tiles.cannoneyed.com/dzi/tiles_files/{level}/{x}_{y}.webp
// Custom zoom convention: level 0 = most zoomed out, level 8 = full resolution
// Full res: 123904 x 100864 px, 512px tiles, 242x197 tiles at level 8
// 9 zoom levels total (0..8)
const TILE_BASE = import.meta.env.DEV
  ? '/dzi/tiles_files'
  : 'https://isometric-nyc-tiles.cannoneyed.com/dzi/tiles_files';
const DZI_DIMENSIONS = { width: 123904, height: 100864 };
const MAX_LEVEL = 8;
const TILE_SIZE = 512;

// Custom OSD tile source — maps OSD level (high=full res) to server level (0=zoomed out, 8=full)
function buildTileSource() {
  const maxLevel = MAX_LEVEL; // server max
  const osdMaxLevel = Math.ceil(Math.log2(Math.max(DZI_DIMENSIONS.width, DZI_DIMENSIONS.height)));

  return {
    width: DZI_DIMENSIONS.width,
    height: DZI_DIMENSIONS.height,
    tileSize: TILE_SIZE,
    tileOverlap: 0,
    minLevel: osdMaxLevel - maxLevel,
    maxLevel: osdMaxLevel,
    getTileUrl: (level: number, x: number, y: number) => {
      // OSD level osdMaxLevel = server level 8 (full res)
      // OSD level osdMaxLevel-1 = server level 7, etc.
      const serverLevel = level - (osdMaxLevel - maxLevel);
      if (serverLevel < 0 || serverLevel > maxLevel) return '';
      return `${TILE_BASE}/${serverLevel}/${x}_${y}.webp`;
    },
  };
}

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
  const [tickerCollapsed, setTickerCollapsed] = useState(false);
  const [filterCollapsed, setFilterCollapsed] = useState(false);
  const [dziLoaded, setDziLoaded] = useState(false);
  const [dziDimensions, setDziDimensions] = useState<{ width: number; height: number } | null>(null);
  const [calibMode, setCalibMode] = useState(false);
  const [calibPoints, setCalibPoints] = useState<CalibPoint[]>([]);
  const [calibPending, setCalibPending] = useState<{ imgX: number; imgY: number } | null>(null);
  const [calibInput, setCalibInput] = useState({ label: '', lat: '', lng: '' });



  // Calibrated from 2 points: 462 First Ave + 109 Rockaway Point Blvd
  // mpp_x=0.4293 (440m wide), mpp_y=0.2930 (300m tall), seed=(45142, 43740)

  const [filters, setFilters] = useState<FilterState>({
    jobTypes: new Set(ALL_JOB_TYPES),
    boroughs: new Set(ALL_BOROUGHS),
    daysBack: 30,
  });

  const filteredPermits = permits.filter(p => {
    const jt = p.job_type?.toUpperCase() ?? 'OTHER';
    const borough = p.borough?.toUpperCase() ?? '';
    return (
      filters.jobTypes.has(jt) ||
      (jt === 'OTHER' && filters.jobTypes.has('OTHER'))
    ) && (
      filters.boroughs.size === 0 ||
      [...filters.boroughs].some(b => borough.includes(b))
    );
  });

  // DZI dimensions are known at build time — no fetch needed
  useEffect(() => {
    setDziDimensions(DZI_DIMENSIONS);
  }, []);


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
      gestureSettingsMouse: {
        scrollToZoom: true,
        clickToZoom: false,
        dblClickToZoom: true,
      },
      imageSmoothingEnabled: false,
      drawer: 'canvas',
    });

    viewer.addHandler('open', () => {
      setDziLoaded(true);
      (window as any).__osd = viewer; // expose after fully open
    });

    // Calibration click handler
    viewer.addHandler('canvas-click', (event: any) => {
      if (!(window as any).__calibMode) return;
      event.preventDefaultAction = true;
      const webPoint = event.position;
      const viewportPoint = viewer.viewport.pointFromPixel(webPoint);
      const imgCoords = viewer.viewport.viewportToImageCoordinates(viewportPoint);
      const imgX = Math.round(imgCoords.x);
      const imgY = Math.round(imgCoords.y);
      console.log(`[CALIB] Clicked image coords: (${imgX}, ${imgY})`);
      setCalibPending({ imgX, imgY });
    });

    osdRef.current = viewer;
    (window as any).__osd = viewer; // also expose immediately

    return () => {
      viewer.destroy();
      osdRef.current = null;
    };
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
    // Auto-refresh every 5 minutes
    const interval = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [filters.daysBack]);

  // Place permit markers on the map
  const placeMarkers = useCallback(() => {
    const viewer = osdRef.current;
    if (!viewer || !dziDimensions) return;

    // Remove old markers
    overlayMarkersRef.current.forEach((el, _id) => {
      viewer.removeOverlay(el);
    });
    overlayMarkersRef.current.clear();

    let placed = 0;
    filteredPermits.forEach(permit => {
      const lat = parseFloat(permit.gis_latitude ?? '');
      const lng = parseFloat(permit.gis_longitude ?? '');
      if (isNaN(lat) || isNaN(lng)) return;

      // Direct lat/lng → image pixel using calibrated projection
      const { x: imageX, y: imageY } = latlngToImagePx(lat, lng);

      // Bounds check
      if (imageX < 0 || imageX > IMAGE_DIMS.width || imageY < 0 || imageY > IMAGE_DIMS.height) return;

      const vpX = imageX / IMAGE_DIMS.width;
      const vpY = imageY / IMAGE_DIMS.height;

      const el = document.createElement('div');
      el.className = 'permit-marker';
      el.dataset.jobType = permit.job_type ?? 'OTHER';
      el.style.setProperty('--color', getJobColor(permit.job_type ?? ''));

      el.addEventListener('mouseenter', (e) => {
        const rect = (e.target as HTMLElement).getBoundingClientRect();
        setTooltip({
          permit,
          x: rect.left + rect.width / 2,
          y: rect.top,
        });
      });
      el.addEventListener('mouseleave', () => setTooltip(null));

      const loc = new OpenSeadragon.Point(vpX, vpY);
      viewer.addOverlay({
        element: el,
        location: loc,
        placement: OpenSeadragon.Placement.CENTER,
        checkResize: false,
      });

      overlayMarkersRef.current.set(permit.job__ ?? Math.random().toString(), el);
      placed++;
    });

    console.log(`Placed ${placed} markers`);
  }, [filteredPermits, dziDimensions]);

  useEffect(() => {
    if (dziLoaded) {
      placeMarkers();
    }
  }, [dziLoaded, placeMarkers]);

  const flyToPermit = useCallback((permit: Permit) => {
    const viewer = osdRef.current;
    if (!viewer || !dziDimensions) return;

    const lat = parseFloat(permit.gis_latitude ?? '');
    const lng = parseFloat(permit.gis_longitude ?? '');
    if (isNaN(lat) || isNaN(lng)) return;

    const { x: imgX, y: imgY } = latlngToImagePx(lat, lng);
    const vpX = imgX / IMAGE_DIMS.width;
    const vpY = imgY / IMAGE_DIMS.height;

    viewer.viewport.panTo(new OpenSeadragon.Point(vpX, vpY));
    viewer.viewport.zoomTo(viewer.viewport.getZoom() > 4 ? viewer.viewport.getZoom() : 6);
  }, [dziDimensions]);

  const toggleJobType = (jt: string) => {
    setFilters(prev => {
      const next = new Set(prev.jobTypes);
      if (next.has(jt)) next.delete(jt);
      else next.add(jt);
      return { ...prev, jobTypes: next };
    });
  };

  const toggleBorough = (b: string) => {
    setFilters(prev => {
      const next = new Set(prev.boroughs);
      if (next.has(b)) next.delete(b);
      else next.add(b);
      return { ...prev, boroughs: next };
    });
  };

  const recentPermits = [...filteredPermits]
    .sort((a, b) => {
      const da = a.issuance_date ?? a.filing_date ?? '';
      const db = b.issuance_date ?? b.filing_date ?? '';
      return new Date(db).getTime() - new Date(da).getTime();
    })
    .slice(0, 30);

  return (
    <div className="app">
      {/* Map */}
      <div ref={viewerRef} className="viewer" />

      {/* Loading overlay */}
      {(loading && !dziLoaded) && (
        <div className="loading-overlay">
          <div className="loading-spinner" />
          <div className="loading-text">Loading NYC Permit Pulse...</div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="error-banner">{error}</div>
      )}

      {/* Header */}
      <div className="header">
        <span className="header-title">NYC PERMIT PULSE</span>
        <span className="header-count">
          {loading ? '...' : `${filteredPermits.length} permits`}
          {dziLoaded ? '' : ' · loading map…'}
        </span>
      </div>

      {/* Filter Panel */}
      <div className={`panel filter-panel ${filterCollapsed ? 'collapsed' : ''}`}>
        <div className="panel-header" onClick={() => setFilterCollapsed(!filterCollapsed)}>
          <span>FILTERS</span>
          <span>{filterCollapsed ? '▶' : '▼'}</span>
        </div>
        {!filterCollapsed && (
          <div className="panel-body">
            <div className="filter-section">
              <div className="filter-label">PERMIT TYPE</div>
              <div className="filter-chips">
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

            <div className="filter-section">
              <div className="filter-label">BOROUGH</div>
              <div className="filter-chips">
                {ALL_BOROUGHS.map(b => (
                  <button
                    key={b}
                    className={`chip ${filters.boroughs.has(b) ? 'active' : ''}`}
                    onClick={() => toggleBorough(b)}
                  >
                    {b === 'STATEN ISLAND' ? 'SI' : b.slice(0, 3)}
                  </button>
                ))}
              </div>
            </div>

            <div className="filter-section">
              <div className="filter-label">DATE RANGE</div>
              <div className="filter-chips">
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

      {/* Live Ticker */}
      <div className={`panel ticker-panel ${tickerCollapsed ? 'collapsed' : ''}`}>
        <div className="panel-header" onClick={() => setTickerCollapsed(!tickerCollapsed)}>
          <span>LIVE TICKER</span>
          <span>{tickerCollapsed ? '▶' : '▼'}</span>
        </div>
        {!tickerCollapsed && (
          <div className="ticker-list">
            {recentPermits.length === 0 && (
              <div className="ticker-empty">No permits found</div>
            )}
            {recentPermits.map((p, i) => (
              <div
                key={`${p.job__}-${i}`}
                className="ticker-row"
                onClick={() => flyToPermit(p)}
                style={{ '--row-color': getJobColor(p.job_type ?? '') } as React.CSSProperties}
              >
                <span className="ticker-emoji">{getJobEmoji(p.job_type ?? '')}</span>
                <span className="ticker-type" style={{ color: getJobColor(p.job_type ?? '') }}>
                  {p.job_type}
                </span>
                <span className="ticker-address">{formatAddress(p)}</span>
                <span className="ticker-date">{formatDate(p.issuance_date ?? p.filing_date)?.split(',')[0]}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Calibration Mode Toggle */}
      {import.meta.env.DEV && (
        <button
          className={`calib-toggle ${calibMode ? 'active' : ''}`}
          onClick={() => {
            const next = !calibMode;
            setCalibMode(next);
            (window as any).__calibMode = next;
            if (!next) setCalibPending(null);
          }}
          title="Toggle calibration mode"
        >
          {calibMode ? '🎯 CALIB ON' : '🎯 CALIB'}
        </button>
      )}

      {/* Calibration point entry modal */}
      {calibMode && calibPending && (
        <div className="calib-modal">
          <div className="calib-modal-title">📍 Tag this point</div>
          <div className="calib-modal-coords">
            Image: ({calibPending.imgX}, {calibPending.imgY})
          </div>
          <input
            className="calib-input"
            placeholder="Label (e.g. 123 Main St, Brooklyn)"
            value={calibInput.label}
            onChange={e => setCalibInput(p => ({ ...p, label: e.target.value }))}
          />
          <input
            className="calib-input"
            placeholder="Latitude (e.g. 40.6501)"
            value={calibInput.lat}
            onChange={e => setCalibInput(p => ({ ...p, lat: e.target.value }))}
          />
          <input
            className="calib-input"
            placeholder="Longitude (e.g. -73.9496)"
            value={calibInput.lng}
            onChange={e => setCalibInput(p => ({ ...p, lng: e.target.value }))}
          />
          <div className="calib-modal-buttons">
            <button
              className="calib-btn save"
              onClick={() => {
                const lat = parseFloat(calibInput.lat);
                const lng = parseFloat(calibInput.lng);
                if (isNaN(lat) || isNaN(lng) || !calibInput.label) return;
                const pt: CalibPoint = {
                  label: calibInput.label,
                  lat,
                  lng,
                  imgX: calibPending.imgX,
                  imgY: calibPending.imgY,
                };
                const next = [...calibPoints, pt];
                setCalibPoints(next);
                setCalibPending(null);
                setCalibInput({ label: '', lat: '', lng: '' });
                console.log('[CALIB] Points so far:', JSON.stringify(next, null, 2));
                (window as any).__calibPoints = next;
              }}
            >
              Save
            </button>
            <button
              className="calib-btn cancel"
              onClick={() => { setCalibPending(null); setCalibInput({ label: '', lat: '', lng: '' }); }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Calibration points list */}
      {calibMode && calibPoints.length > 0 && (
        <div className="calib-list">
          <div className="calib-list-title">CALIBRATION POINTS ({calibPoints.length})</div>
          {calibPoints.map((pt, i) => (
            <div key={i} className="calib-list-row">
              <span className="calib-list-label">{pt.label}</span>
              <span className="calib-list-coords">
                ({pt.lat.toFixed(4)}, {pt.lng.toFixed(4)}) → img ({pt.imgX}, {pt.imgY})
              </span>
            </div>
          ))}
          <button
            className="calib-btn copy"
            onClick={() => {
              const text = JSON.stringify(calibPoints, null, 2);
              navigator.clipboard.writeText(text);
              console.log('[CALIB] Copied to clipboard:', text);
            }}
          >
            📋 Copy JSON
          </button>
        </div>
      )}

      {/* Tooltip */}
      {tooltip && (
        <div
          className="tooltip"
          style={{
            left: tooltip.x,
            top: tooltip.y - 8,
            transform: 'translate(-50%, -100%)',
          }}
        >
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
