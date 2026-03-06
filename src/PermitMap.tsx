import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './PermitMap.css';
import type { Permit } from './permit-types';
import {
  fetchPermits,
  WORK_TYPE_LABELS,
  WORK_TYPE_COLORS,
  ALL_JOB_TYPES,
  ALL_BOROUGHS,
  formatAddress,
  formatDate,
  getJobLabel,
  getJobColor,
} from './permit-data';

const RESULT_LIMIT = 2500;

const MAP_STYLE = {
  version: 8 as const,
  glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
  sources: {
    carto: {
      type: 'raster' as const,
      tiles: ['https://a.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}@2x.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap © CartoDB',
    },
    carto_labels: {
      type: 'raster' as const,
      tiles: ['https://a.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}@2x.png'],
      tileSize: 256,
    },
  },
  layers: [
    { id: 'carto-base', type: 'raster' as const, source: 'carto', paint: { 'raster-opacity': 1 } },
    { id: 'carto-labels', type: 'raster' as const, source: 'carto_labels', paint: { 'raster-opacity': 0.6 } },
  ],
};

type SortField = 'date' | 'cost' | 'address';
type SortDir = 'asc' | 'desc';

export default function PermitMap() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);

  // Filter state
  const [dateFrom, setDateFrom] = useState<string>(() => {
    const d = new Date(); d.setDate(d.getDate() - 7);
    return d.toISOString().split('T')[0];
  });
  const [dateTo, setDateTo] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set(ALL_JOB_TYPES));
  const [selectedBoroughs, setSelectedBoroughs] = useState<Set<string>>(new Set(ALL_BOROUGHS));
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Data state
  const [allPermits, setAllPermits] = useState<Permit[]>([]);
  const [filtered, setFiltered] = useState<Permit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPermit, setSelectedPermit] = useState<Permit | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // Init map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: MAP_STYLE,
      center: [-73.98, 40.73],
      zoom: 11,
      maxBounds: [[-74.6, 40.2], [-73.1, 41.2]],
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    mapRef.current = map;

    map.on('load', () => {
      // Add permit source + layer
      map.addSource('permits', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      // One circle layer per job type for color coding
      map.addLayer({
        id: 'permit-dots',
        type: 'circle',
        source: 'permits',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3, 14, 6, 17, 10],
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.85,
          'circle-stroke-width': 0.5,
          'circle-stroke-color': 'rgba(0,0,0,0.3)',
        },
      });

      map.on('click', 'permit-dots', (e) => {
        const feat = e.features?.[0];
        if (!feat) return;
        const props = feat.properties as Record<string, string>;
        const permit: Permit = JSON.parse(props._raw ?? '{}');
        selectPermit(permit, map);
      });

      map.on('mouseenter', 'permit-dots', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'permit-dots', () => { map.getCanvas().style.cursor = ''; });
    });

    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Fetch data when date range changes
  useEffect(() => {
    loadPermits();
  }, [dateFrom, dateTo]);

  const loadPermits = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const permits = await fetchPermits(dateFrom, dateTo, RESULT_LIMIT);
      setAllPermits(permits);
      // totalCount removed — was unused
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  // Apply client-side filters
  useEffect(() => {
    let result = allPermits;

    // Type filter
    if (selectedTypes.size < ALL_JOB_TYPES.length) {
      result = result.filter(p => selectedTypes.has(p.job_type ?? ''));
    }

    // Borough filter
    if (selectedBoroughs.size < ALL_BOROUGHS.length) {
      result = result.filter(p => {
        const b = (p.borough ?? '').toUpperCase();
        return selectedBoroughs.has(b);
      });
    }

    // Search
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(p =>
        formatAddress(p).toLowerCase().includes(q) ||
        (p.job_description ?? '').toLowerCase().includes(q) ||
        (p.owner_business_name ?? '').toLowerCase().includes(q) ||
        (p.applicant_business_name ?? '').toLowerCase().includes(q)
      );
    }

    // Sort
    result = [...result].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'date') {
        cmp = (a.issued_date ?? '').localeCompare(b.issued_date ?? '');
      } else if (sortField === 'cost') {
        cmp = parseFloat(a.estimated_job_costs ?? '0') - parseFloat(b.estimated_job_costs ?? '0');
      } else if (sortField === 'address') {
        cmp = formatAddress(a).localeCompare(formatAddress(b));
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });

    setFiltered(result);
    updateMapDots(result);
  }, [allPermits, selectedTypes, selectedBoroughs, search, sortField, sortDir]);

  const updateMapDots = useCallback((permits: Permit[]) => {
    const map = mapRef.current;
    if (!map || !map.getSource('permits')) return;
    const features = permits
      .filter(p => p.latitude && p.longitude)
      .map(p => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [parseFloat(p.longitude!), parseFloat(p.latitude!)] },
        properties: {
          color: getJobColor(p.job_type ?? ''),
          type: p.job_type ?? '',
          address: formatAddress(p),
          date: p.issued_date ?? '',
          _raw: JSON.stringify(p),
        },
      }));
    (map.getSource('permits') as maplibregl.GeoJSONSource).setData({
      type: 'FeatureCollection',
      features,
    });
  }, []);

  const selectPermit = useCallback((permit: Permit, map?: maplibregl.Map) => {
    setSelectedPermit(permit);
    setSidebarOpen(false); // close sidebar on mobile when selecting
    const m = map ?? mapRef.current;
    if (m && permit.latitude && permit.longitude) {
      const lng = parseFloat(permit.longitude);
      const lat = parseFloat(permit.latitude);
      m.flyTo({ center: [lng, lat], zoom: Math.max(m.getZoom(), 15), duration: 600 });
      if (popupRef.current) popupRef.current.remove();
      popupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: '280px' })
        .setLngLat([lng, lat])
        .setHTML(buildPopupHTML(permit))
        .addTo(m);
    }
    // Scroll result into view
    setTimeout(() => {
      const el = document.getElementById(`permit-row-${permit.job_filing_number ?? permit.tracking_number}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 100);
  }, []);

  const toggleType = (type: string) => {
    setSelectedTypes(prev => {
      const next = new Set(prev);
      next.has(type) ? next.delete(type) : next.add(type);
      return next;
    });
  };

  const toggleBorough = (b: string) => {
    setSelectedBoroughs(prev => {
      const next = new Set(prev);
      next.has(b) ? next.delete(b) : next.add(b);
      return next;
    });
  };

  const BOROUGH_LABELS: Record<string, string> = {
    MANHATTAN: 'MN', BROOKLYN: 'BK', QUEENS: 'QN', BRONX: 'BX', 'STATEN ISLAND': 'SI',
  };

  const overLimit = allPermits.length >= RESULT_LIMIT;

  return (
    <div className="permit-app">
      {/* Mobile map toggle */}
      <button className="permit-mobile-toggle" onClick={() => setSidebarOpen(o => !o)}>
        {sidebarOpen ? '✕' : '☰ Filters'}
        {!sidebarOpen && filtered.length > 0 && <span className="permit-mobile-count">{filtered.length.toLocaleString()}</span>}
      </button>

      {/* Sidebar */}
      <div className={`permit-sidebar${sidebarOpen ? ' permit-sidebar--open' : ''}`}>
        <div className="permit-sidebar-header">
          <div className="permit-header-row">
            <span className="permit-title-main">NYC PERMIT PULSE</span>
            <div className="permit-header-actions">
              <a href="/" className="permit-view-switch" title="Switch to isometric view">ISO</a>
            </div>
          </div>
          <a href="/" className="permit-view-link">ISO VIEW →</a>
        </div>

        {/* Date range */}
        <div className="permit-section">
          <div className="permit-section-label">Date Range</div>
          <div className="permit-date-row">
            <input type="date" className="permit-date-input" value={dateFrom}
              onChange={e => setDateFrom(e.target.value)} max={dateTo} />
            <span className="permit-date-sep">→</span>
            <input type="date" className="permit-date-input" value={dateTo}
              onChange={e => setDateTo(e.target.value)} min={dateFrom} />
          </div>
          <div className="permit-quick-dates">
            {[
              { label: '1d', days: 1 }, { label: '7d', days: 7 },
              { label: '30d', days: 30 }, { label: '90d', days: 90 },
            ].map(({ label, days }) => {
              const from = new Date(); from.setDate(from.getDate() - days);
              const fromStr = from.toISOString().split('T')[0];
              const todayStr = new Date().toISOString().split('T')[0];
              const active = dateFrom === fromStr && dateTo === todayStr;
              return (
                <button key={label} className={`permit-quick-btn${active ? ' active' : ''}`}
                  onClick={() => { setDateFrom(fromStr); setDateTo(todayStr); }}>
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Permit types */}
        <div className="permit-section">
          <div className="permit-section-label">
            Type
            <button className="permit-toggle-all" onClick={() =>
              setSelectedTypes(selectedTypes.size === ALL_JOB_TYPES.length ? new Set() : new Set(ALL_JOB_TYPES))}>
              {selectedTypes.size === ALL_JOB_TYPES.length ? 'None' : 'All'}
            </button>
          </div>
          <div className="permit-type-grid">
            {ALL_JOB_TYPES.map(t => (
              <button key={t}
                className={`permit-type-chip${selectedTypes.has(t) ? ' active' : ''}`}
                style={selectedTypes.has(t) ? { backgroundColor: WORK_TYPE_COLORS[t] + '22', borderColor: WORK_TYPE_COLORS[t], color: WORK_TYPE_COLORS[t] } : {}}
                onClick={() => toggleType(t)}>
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Boroughs */}
        <div className="permit-section">
          <div className="permit-section-label">Borough</div>
          <div className="permit-borough-row">
            {ALL_BOROUGHS.map(b => (
              <button key={b}
                className={`permit-borough-chip${selectedBoroughs.has(b) ? ' active' : ''}`}
                onClick={() => toggleBorough(b)}>
                {BOROUGH_LABELS[b]}
              </button>
            ))}
          </div>
        </div>

        {/* Search */}
        <div className="permit-section">
          <input
            className="permit-search"
            placeholder="Search address, description, owner…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* Result count + warning */}
        <div className="permit-count-bar">
          {loading ? (
            <span className="permit-loading">Loading…</span>
          ) : error ? (
            <span className="permit-error">⚠ {error}</span>
          ) : (
            <>
              <span className="permit-count">{filtered.length.toLocaleString()} permits</span>
              {overLimit && (
                <span className="permit-limit-warn" title="Tighten filters (date range, type, borough) to see all results.">
                  ⚠ map capped at 2,500
                </span>
              )}
            </>
          )}
        </div>

        {/* Sort */}
        <div className="permit-sort-bar">
          {(['date', 'cost', 'address'] as SortField[]).map(f => (
            <button key={f}
              className={`permit-sort-btn${sortField === f ? ' active' : ''}`}
              onClick={() => { if (sortField === f) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortField(f); setSortDir('desc'); } }}>
              {f}{sortField === f ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
            </button>
          ))}
        </div>

        {/* Results list */}
        <div className="permit-list" ref={listRef}>
          {filtered.slice(0, 500).map(p => {
            const id = p.job_filing_number ?? p.tracking_number ?? Math.random().toString();
            const color = getJobColor(p.job_type ?? '');
            const isSelected = selectedPermit === p ||
              (selectedPermit?.job_filing_number && selectedPermit.job_filing_number === p.job_filing_number);
            return (
              <div key={id} id={`permit-row-${id}`}
                className={`permit-row${isSelected ? ' selected' : ''}`}
                onClick={() => selectPermit(p)}>
                <div className="permit-row-top">
                  <span className="permit-row-type" style={{ color, borderColor: color + '66', backgroundColor: color + '18' }}>
                    {p.job_type}
                  </span>
                  <span className="permit-row-date">{formatDate(p.issued_date)}</span>
                </div>
                <div className="permit-row-address">{formatAddress(p)}</div>
                {p.job_description && (
                  <div className="permit-row-desc">{p.job_description.slice(0, 80)}{p.job_description.length > 80 ? '…' : ''}</div>
                )}
                {p.estimated_job_costs && parseFloat(p.estimated_job_costs) > 0 && (
                  <div className="permit-row-cost">${parseInt(p.estimated_job_costs).toLocaleString()}</div>
                )}
              </div>
            );
          })}
          {filtered.length > 500 && (
            <div className="permit-list-overflow">Showing 500 of {filtered.length.toLocaleString()} — tighten filters to narrow results</div>
          )}
        </div>
      </div>

      {/* Map */}
      <div className="permit-map-wrap">
        <div ref={mapContainerRef} className="permit-map" />

        {/* Legend */}
        <div className="permit-legend">
          {['NB', 'DM', 'GC', 'PL', 'ME'].map(t => (
            <div key={t} className="permit-legend-item">
              <span className="permit-legend-dot" style={{ backgroundColor: WORK_TYPE_COLORS[t] }} />
              <span className="permit-legend-label">{WORK_TYPE_LABELS[t]}</span>
            </div>
          ))}
          <div className="permit-legend-item">
            <span className="permit-legend-dot" style={{ backgroundColor: '#888' }} />
            <span className="permit-legend-label">Other</span>
          </div>
        </div>
      </div>

      {/* Detail panel (right) */}
      {selectedPermit && (
        <div className="permit-detail">
          <div className="permit-detail-header">
            <div className="permit-detail-type" style={{ color: getJobColor(selectedPermit.job_type ?? '') }}>
              {getJobLabel(selectedPermit.job_type ?? '')}
            </div>
            <button className="permit-detail-close" onClick={() => { setSelectedPermit(null); popupRef.current?.remove(); }}>×</button>
          </div>
          <div className="permit-detail-address">{formatAddress(selectedPermit)}</div>
          <div className="permit-detail-date">{formatDate(selectedPermit.issued_date)}</div>
          <div className="permit-detail-divider" />
          <DetailRow label="Borough" value={selectedPermit.borough} />
          <DetailRow label="Block / Lot" value={selectedPermit.block && selectedPermit.lot ? `${selectedPermit.block} / ${selectedPermit.lot}` : undefined} />
          <DetailRow label="BIN" value={selectedPermit.bin} />
          <DetailRow label="Status" value={selectedPermit.permit_status} />
          <DetailRow label="Description" value={selectedPermit.job_description} />
          <DetailRow label="Est. Cost" value={selectedPermit.estimated_job_costs ? `$${parseInt(selectedPermit.estimated_job_costs).toLocaleString()}` : undefined} />
          <DetailRow label="Owner" value={selectedPermit.owner_business_name || selectedPermit.owner_name} />
          <DetailRow label="Applicant" value={selectedPermit.applicant_business_name || [selectedPermit.applicant_first_name, selectedPermit.applicant_last_name].filter(Boolean).join(' ')} />
          <DetailRow label="Expires" value={formatDate(selectedPermit.expired_date)} />
          <DetailRow label="Filing #" value={selectedPermit.job_filing_number} mono />
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  if (!value) return null;
  return (
    <div className="permit-detail-row">
      <span className="permit-detail-label">{label}</span>
      <span className={`permit-detail-value${mono ? ' mono' : ''}`}>{value}</span>
    </div>
  );
}

function buildPopupHTML(p: Permit): string {
  const color = getJobColor(p.job_type ?? '');
  return `
    <div style="font-family:'Courier New',monospace;font-size:11px;line-height:1.5;min-width:200px;color:#e0e8ff">
      <div style="font-weight:bold;color:${color};margin-bottom:4px;letter-spacing:1px;text-shadow:0 0 8px ${color}">${getJobLabel(p.job_type ?? '').toUpperCase()}</div>
      <div style="font-weight:bold;margin-bottom:2px;letter-spacing:0.3px">${formatAddress(p)}</div>
      <div style="color:#556688;font-size:10px;margin-bottom:6px;letter-spacing:1px">${formatDate(p.issued_date)}</div>
      ${p.job_description ? `<div style="font-size:10px;color:#8899aa;margin-bottom:4px">${p.job_description.slice(0, 120)}${p.job_description.length > 120 ? '…' : ''}</div>` : ''}
      ${p.estimated_job_costs && parseFloat(p.estimated_job_costs) > 0 ? `<div style="font-size:10px;color:#556688;letter-spacing:0.5px">$${parseInt(p.estimated_job_costs).toLocaleString()}</div>` : ''}
    </div>
  `;
}
