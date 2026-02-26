/**
 * NeighborhoodLabels — LOD neighborhood labels drawn on a plain div overlay.
 *
 * We intentionally avoid OSD's addOverlay() system, which wraps every element
 * in a wrapper div and calls drawHTML() every animation frame — clobbering
 * transforms and fighting us for control of element styles.
 *
 * Instead: one absolutely-positioned container div sits above the OSD canvas,
 * and we position each label manually using viewport.pixelFromPoint().
 * We hook OSD's 'update-viewport' event to reposition on every frame.
 *
 * Zoom tiers:
 *   zoom < 1.5  → 5 borough labels
 *   zoom 1.5–4  → ~40 major neighborhoods
 *   zoom > 4    → all 197 NTAs
 */

import OpenSeadragon from 'openseadragon';
import { latlngToImagePx, IMAGE_DIMS } from './coordinates';
import ntaData from './nta_centroids.json';

const BOROUGH_LABELS = [
  { name: 'MANHATTAN',     lat: 40.7831, lng: -73.9712 },
  { name: 'BROOKLYN',      lat: 40.6501, lng: -73.9496 },
  { name: 'QUEENS',        lat: 40.7282, lng: -73.7949 },
  { name: 'BRONX',         lat: 40.8448, lng: -73.8648 },
  { name: 'STATEN ISLAND', lat: 40.6050, lng: -74.0800 },
];

const MAJOR_NTA_CODES = new Set([
  'MN2501','MN1701','MN2301','MN2701','MN2001','MN3301','MN2401','MN1301',
  'MN0901','MN1101','MN1001','MN2101','MN2201','MN1601','MN1501',
  'BK0101','BK0901','BK7301','BK9101','BK4501','BK8801','BK6101','BK5501','BK7701','BK3101',
  'QN3101','QN2601','QN4901','QN6301','QN5301','QN7101','QN4101','QN5701',
  'BX0101','BX3101','BX6301','BX0901','BX5301',
  'SI0101','SI0501','SI2501',
]);

interface LabelEntry {
  name: string;
  vpX: number;  // OSD viewport X (0–1 range using image width as unit)
  vpY: number;
  tier: 'borough' | 'major' | 'nta';
  el: HTMLSpanElement;
}

export class NeighborhoodLabels {
  private viewer: OpenSeadragon.Viewer;
  private container: HTMLDivElement;
  private labels: LabelEntry[] = [];
  private currentTier: 0 | 1 | 2 | -1 = -1;
  private enabled = true;
  private rafId: number | null = null;

  constructor(viewer: OpenSeadragon.Viewer) {
    this.viewer = viewer;

    // Create a container div that sits on top of the OSD canvas
    this.container = document.createElement('div');
    this.container.style.cssText = `
      position: absolute;
      inset: 0;
      pointer-events: none;
      overflow: hidden;
      z-index: 200;
    `;
    // Insert into OSD's element (the viewer container), above everything
    viewer.element.appendChild(this.container);

    this.buildLabels();

    // Reposition on every viewport update
    viewer.addHandler('update-viewport', () => this.draw());
    viewer.addHandler('zoom', () => this.updateTier());
    viewer.addHandler('pan', () => this.draw());

    this.updateTier();
  }

  setEnabled(val: boolean) {
    this.enabled = val;
    this.container.style.display = val ? '' : 'none';
    if (val) { this.currentTier = -1; this.updateTier(); }
  }

  private toVp(lat: number, lng: number) {
    const { x, y } = latlngToImagePx(lat, lng);
    return {
      vpX: x / IMAGE_DIMS.width,
      vpY: y / IMAGE_DIMS.width,
    };
  }

  private buildLabels() {
    for (const b of BOROUGH_LABELS) {
      const { vpX, vpY } = this.toVp(b.lat, b.lng);
      const el = this.makeEl(b.name, 'borough');
      this.labels.push({ name: b.name, vpX, vpY, tier: 'borough', el });
    }
    for (const nta of ntaData) {
      const { vpX, vpY } = this.toVp(nta.lat, nta.lng);
      const isMajor = MAJOR_NTA_CODES.has(nta.code);
      const tier = isMajor ? 'major' : 'nta';
      const el = this.makeEl(nta.name, tier);
      this.labels.push({ name: nta.name, vpX, vpY, tier, el });
    }
    // All labels start hidden
    for (const l of this.labels) {
      l.el.style.display = 'none';
      this.container.appendChild(l.el);
    }
  }

  private makeEl(text: string, tier: 'borough' | 'major' | 'nta'): HTMLSpanElement {
    const el = document.createElement('span');
    el.className = `nta-label nta-label--${tier}`;
    el.textContent = text;
    return el;
  }

  private updateTier() {
    const zoom = this.viewer.viewport?.getZoom() ?? 1;
    let tier: 0 | 1 | 2;
    if (zoom < 1.5) tier = 0;
    else if (zoom < 4) tier = 1;
    else tier = 2;

    if (tier === this.currentTier) return;
    this.currentTier = tier;

    for (const l of this.labels) {
      const show =
        (tier === 0 && l.tier === 'borough') ||
        (tier === 1 && (l.tier === 'borough' || l.tier === 'major')) ||
        (tier === 2);
      l.el.style.display = show ? '' : 'none';
    }

    this.draw();
  }

  private draw() {
    if (!this.enabled) return;
    const viewport = this.viewer.viewport;
    if (!viewport) return;

    for (const l of this.labels) {
      if (l.el.style.display === 'none') continue;
      // Convert OSD viewport point → screen pixel
      const px = viewport.pixelFromPoint(new OpenSeadragon.Point(l.vpX, l.vpY), true);
      l.el.style.left = `${px.x}px`;
      l.el.style.top  = `${px.y}px`;
    }
  }

  destroy() {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.container.remove();
  }
}
