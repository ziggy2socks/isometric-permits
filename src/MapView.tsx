/**
 * MapView — flat MapLibre map view.
 * Consumes shared state from PermitContext.
 * No sidebar — sidebar is rendered by AppShell via PermitSidebar.
 */
import { useEffect, useRef, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { usePermits } from './PermitContext';
import {

  getJobColor, getJobLabel, formatAddress, formatDate,
} from './permit-data';
import type { Permit } from './types';
import './MapView.css';

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
    { id: 'carto-base',   type: 'raster' as const, source: 'carto',        paint: { 'raster-opacity': 1 } },
    { id: 'carto-labels', type: 'raster' as const, source: 'carto_labels', paint: { 'raster-opacity': 0.6 } },
  ],
};

// const LEGEND_TYPES = ['NB', 'DM', 'GC', 'PL', 'ME'];

export default function MapView() {
  const { mapPermits, selected, setSelected } = usePermits();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef          = useRef<maplibregl.Map | null>(null);
  const popupRef        = useRef<maplibregl.Popup | null>(null);

  // Init map once
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
      map.addSource('permits', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'permit-dots',
        type: 'circle',
        source: 'permits',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3, 14, 6, 17, 10],
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.85,
          'circle-stroke-width': 0.5,
          'circle-stroke-color': 'rgba(0,0,0,0.4)',
        },
      });
      map.on('click', 'permit-dots', (e) => {
        const feat = e.features?.[0];
        if (!feat) return;
        const permit: Permit = JSON.parse((feat.properties as Record<string, string>)._raw ?? '{}');
        selectPermit(permit, map);
      });
      map.on('mouseenter', 'permit-dots', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'permit-dots', () => { map.getCanvas().style.cursor = ''; });
    });

    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Update dots when mapPermits changes (capped for performance)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const setData = () => {
      const src = map.getSource('permits') as maplibregl.GeoJSONSource | undefined;
      if (!src) return;
      src.setData({
        type: 'FeatureCollection',
        features: mapPermits
          .filter(p => p.latitude && p.longitude)
          .map(p => ({
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: [parseFloat(p.longitude!), parseFloat(p.latitude!)] },
            properties: {
              color: getJobColor(p.job_type ?? ''),
              _raw: JSON.stringify(p),
            },
          })),
      });
    };
    if (map.isStyleLoaded()) setData();
    else map.once('load', setData);
  }, [mapPermits]);

  const selectPermit = useCallback((permit: Permit, map?: maplibregl.Map) => {
    setSelected(permit);
    const m = map ?? mapRef.current;
    if (m && permit.latitude && permit.longitude) {
      const lng = parseFloat(permit.longitude);
      const lat = parseFloat(permit.latitude);
      m.flyTo({ center: [lng, lat], zoom: Math.max(m.getZoom(), 15), duration: 600 });
      popupRef.current?.remove();
      popupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: '280px' })
        .setLngLat([lng, lat])
        .setHTML(buildPopupHTML(permit))
        .addTo(m);
    }
  }, [setSelected]);

  // Sync external selection (from sidebar list click)
  useEffect(() => {
    if (selected) selectPermit(selected);
  }, [selected]);

  return (
    <div className="map-view">
      <div ref={mapContainerRef} className="map-view-canvas" />



      {/* Detail panel */}
      {selected && (
        <div className="map-detail">
          <div className="map-detail-header">
            <div className="map-detail-type" style={{ color: getJobColor(selected.job_type ?? '') }}>
              {getJobLabel(selected.job_type ?? '')}
            </div>
            <button className="map-detail-close"
              onClick={() => { setSelected(null); popupRef.current?.remove(); }}>×</button>
          </div>
          <div className="map-detail-address">{formatAddress(selected)}</div>
          <div className="map-detail-date">{formatDate(selected.issued_date)}</div>
          <div className="map-detail-divider" />
          <DR label="Borough"    value={selected.borough} />
          <DR label="Block / Lot" value={selected.block && selected.lot ? `${selected.block} / ${selected.lot}` : undefined} />
          <DR label="BIN"        value={selected.bin} />
          <DR label="Status"     value={selected.permit_status} />
          <DR label="Description" value={selected.job_description} />
          <DR label="Est. Cost"  value={selected.estimated_job_costs ? `$${parseInt(selected.estimated_job_costs).toLocaleString()}` : undefined} />
          <DR label="Owner"      value={selected.owner_business_name || selected.owner_name} />
          <DR label="Applicant"  value={selected.applicant_business_name || [selected.applicant_first_name, selected.applicant_last_name].filter(Boolean).join(' ')} />
          <DR label="Expires"    value={formatDate(selected.expired_date)} />
          <DR label="Filing #"   value={selected.job_filing_number} mono />
          <div className="map-detail-divider" />
          <div className="drawer-links">
            {selected.bin && (
              <a className="drawer-link" href={`https://a810-bisweb.nyc.gov/bisweb/PropertyProfileOverviewServlet?bin=${selected.bin}`} target="_blank" rel="noopener noreferrer">🏛 DOB BIS</a>
            )}
            {selected.bbl && (
              <a className="drawer-link" href={`https://zola.planning.nyc.gov/l/lot/${selected.bbl.slice(0,1)}/${selected.bbl.slice(1,6)}/${selected.bbl.slice(6)}`} target="_blank" rel="noopener noreferrer">🗺 ZoLa</a>
            )}
            {selected.latitude && selected.longitude && (
              <a className="drawer-link" href={`https://www.google.com/maps?q=${selected.latitude},${selected.longitude}`} target="_blank" rel="noopener noreferrer">📍 Maps</a>
            )}
            {selected.latitude && selected.longitude && (
              <a className="drawer-link" href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${selected.latitude},${selected.longitude}`} target="_blank" rel="noopener noreferrer">🚶 Street View</a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DR({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  if (!value) return null;
  return (
    <div className="map-detail-row">
      <span className="map-detail-label">{label}</span>
      <span className={`map-detail-value${mono ? ' mono' : ''}`}>{value}</span>
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
