import { useEffect, useRef, useState, useCallback } from 'react';
import OpenSeadragon from 'openseadragon';
import type { Permit, FilterState, MapConfig } from './types';
import { latlngToQuadrantCoords, quadrantToImagePixel } from './coordinates';
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
const MAP_CONFIG: MapConfig = {
  seed: { lat: 40.7484, lng: -73.9857 }, // ~Empire State Building area
  camera_azimuth_degrees: -15,
  camera_elevation_degrees: -45,
  width_px: 1024,
  height_px: 1024,
  view_height_meters: 300,
  tile_step: 0.5,
};

// The DZI tiles are served from Cloudflare R2 via the isometric.nyc worker
const DZI_URL = 'https://isometric-nyc-tiles.cannoneyed.com/dzi/image.dzi';
// Fallback: try the snow version which we know exists based on app source
const DZI_URL_SNOW = 'https://isometric-nyc-tiles.cannoneyed.com/dzi/snow.dzi';

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
  const [tickerCollapsed, setTickerCollapsed] = useState(false);
  const [filterCollapsed, setFilterCollapsed] = useState(false);
  const [dziLoaded, setDziLoaded] = useState(false);
  const [dziDimensions, setDziDimensions] = useState<{ width: number; height: number } | null>(null);

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

  // Fetch DZI dimensions
  useEffect(() => {
    async function loadDzi() {
      const urls = [DZI_URL, DZI_URL_SNOW];
      for (const url of urls) {
        try {
          const res = await fetch(url);
          if (res.ok) {
            const text = await res.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(text, 'text/xml');
            const img = doc.querySelector('Image');
            const size = doc.querySelector('Size');
            if (img && size) {
              const width = parseInt(size.getAttribute('Width') ?? '0');
              const height = parseInt(size.getAttribute('Height') ?? '0');
              setDziDimensions({ width, height });
              console.log(`DZI loaded: ${width}x${height} from ${url}`);
              return url;
            }
          }
        } catch (e) {
          console.warn(`Failed to load DZI from ${url}:`, e);
        }
      }
      return null;
    }
    loadDzi();
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
      tileSources: {
        type: 'legacy-image-pyramid',
        levels: [{
          url: 'https://isometric-nyc-tiles.cannoneyed.com/dzi/image_files/10/0_0.jpg',
          width: 1024,
          height: 1024,
        }],
      },
      gestureSettingsMouse: {
        scrollToZoom: true,
        clickToZoom: false,
        dblClickToZoom: true,
      },
      imageSmoothingEnabled: false,
    });

    // Try to load the real DZI
    async function tryLoadDzi() {
      const urls = [
        'https://isometric-nyc-tiles.cannoneyed.com/dzi/image.dzi',
        'https://isometric-nyc-tiles.cannoneyed.com/dzi/snow.dzi',
        'https://isometric-nyc-tiles.cannoneyed.com/dzi/nyc.dzi',
      ];

      for (const url of urls) {
        try {
          const res = await fetch(url);
          if (res.ok) {
            const text = await res.text();
            if (text.includes('Image') && text.includes('Size')) {
              console.log(`Loading DZI: ${url}`);
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              viewer.open(url as any);
              viewer.addHandler('open', () => {
                setDziLoaded(true);
                const src = viewer.world.getItemAt(0)?.source;
                if (src) {
                  setDziDimensions({ width: src.dimensions.x, height: src.dimensions.y });
                }
              });
              return;
            }
          }
        } catch {
          // try next
        }
      }

      // If all DZI fail, just mark as loaded with fallback dims
      console.warn('No DZI found, using fallback dimensions');
      setDziLoaded(true);
      setDziDimensions({ width: 32768, height: 32768 }); // estimated full NYC map
    }

    tryLoadDzi();

    viewer.addHandler('open', () => setDziLoaded(true));
    osdRef.current = viewer;

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

    const imageWidth = dziDimensions.width;
    const imageHeight = dziDimensions.height;

    // The seed point should map to the center-ish of the image
    // We need to figure out the offset of the seed in image space
    // Based on generation config: seed is at quadrant (0,0)
    // The image is the assembled grid of all quadrants
    // We need to find where quadrant (0,0) maps to in the full image
    // For the full NYC map (~32k x 32k px), seed point is approximately at center
    const seedImageX = imageWidth * 0.45; // approximate - center-ish
    const seedImageY = imageHeight * 0.45;

    let placed = 0;
    filteredPermits.forEach(permit => {
      const lat = parseFloat(permit.gis_latitude ?? '');
      const lng = parseFloat(permit.gis_longitude ?? '');
      if (isNaN(lat) || isNaN(lng)) return;

      const { qx, qy } = latlngToQuadrantCoords(MAP_CONFIG, lat, lng);
      const { x: px, y: py } = quadrantToImagePixel(qx, qy);

      // Position in image space: seed is at (seedImageX, seedImageY)
      const imageX = seedImageX + px;
      const imageY = seedImageY + py;

      // Bounds check
      if (imageX < 0 || imageX > imageWidth || imageY < 0 || imageY > imageHeight) return;

      // Convert to viewport coordinates (0-1 range)
      const vpX = imageX / imageWidth;
      const vpY = imageY / imageHeight;

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

    const { qx, qy } = latlngToQuadrantCoords(MAP_CONFIG, lat, lng);
    const { x: px, y: py } = quadrantToImagePixel(qx, qy);

    const seedImageX = dziDimensions.width * 0.45;
    const seedImageY = dziDimensions.height * 0.45;

    const vpX = (seedImageX + px) / dziDimensions.width;
    const vpY = (seedImageY + py) / dziDimensions.height;

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
    .sort((a, b) => new Date(b.filing_date ?? 0).getTime() - new Date(a.filing_date ?? 0).getTime())
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
                <span className="ticker-date">{formatDate(p.filing_date)?.split(',')[0]}</span>
              </div>
            ))}
          </div>
        )}
      </div>

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
          <div className="tooltip-date">{formatDate(tooltip.permit.filing_date)}</div>
        </div>
      )}
    </div>
  );
}
