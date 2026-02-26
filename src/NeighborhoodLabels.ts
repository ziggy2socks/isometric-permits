/**
 * NeighborhoodLabels — adds LOD neighborhood labels as OSD overlays.
 *
 * Zoom tiers (OSD zoom units, not tile level):
 *   < 1.5  → borough labels only (5 labels)
 *   1.5–4  → major neighborhoods (~40, one per "district" area)
 *   > 4    → all 197 NTAs
 *
 * Labels render below permit markers (z-index 10 vs markers at default).
 */

import OpenSeadragon from 'openseadragon';
import { latlngToImagePx, IMAGE_DIMS } from './coordinates';
import ntaData from './nta_centroids.json';

// Borough centroids (manually placed at geographic center)
const BOROUGH_LABELS = [
  { name: 'MANHATTAN',   lat: 40.7831, lng: -73.9712 },
  { name: 'BROOKLYN',    lat: 40.6501, lng: -73.9496 },
  { name: 'QUEENS',      lat: 40.7282, lng: -73.7949 },
  { name: 'BRONX',       lat: 40.8448, lng: -73.8648 },
  { name: 'STATEN ISLAND', lat: 40.5795, lng: -74.1502 },
];

// NTAs to highlight at medium zoom — roughly one per recognizable district.
// Hand-selected for geographic spread and name recognition.
const MAJOR_NTA_CODES = new Set([
  // Manhattan
  'MN2501', // Midtown-Midtown South
  'MN1701', // Upper East Side-Carnegie Hill
  'MN2301', // West Village
  'MN2701', // Financial District-Battery Park City
  'MN2001', // Chelsea-Hudson Yards
  'MN3301', // Inwood
  'MN2401', // SoHo-TriBeCa-Civic Center-Little Italy
  'MN1301', // Washington Heights North
  'MN0901', // Morningside Heights-Hamilton Heights
  'MN1101', // Central Harlem North-Polo Grounds
  'MN1001', // East Harlem South
  'MN2101', // Gramercy
  'MN2201', // Murray Hill-Kips Bay
  'MN1601', // Upper West Side
  'MN1501', // Lincoln Square
  // Brooklyn
  'BK0101', // Greenpoint
  'BK0901', // Park Slope-Gowanus
  'BK7301', // Williamsburg
  'BK9101', // Crown Heights North
  'BK4501', // Flatbush
  'BK8801', // Bay Ridge
  'BK6101', // Sheepshead Bay-Gerritsen Beach-Manhattan Beach
  'BK5501', // Sunset Park West
  'BK7701', // Bushwick North
  'BK3101', // DUMBO-Vinegar Hill-Downtown Brooklyn-Boerum Hill
  // Queens
  'QN3101', // Astoria
  'QN2601', // Long Island City-Hunters Point
  'QN4901', // Jackson Heights
  'QN6301', // Flushing
  'QN5301', // Jamaica
  'QN7101', // Far Rockaway-Bayswater
  'QN4101', // Elmhurst
  'QN5701', // Bayside-Bayside Hills
  // Bronx
  'BX0101', // Mott Haven-Port Morris
  'BX3101', // Fordham South
  'BX6301', // Co-op City
  'BX0901', // Highbridge
  'BX5301', // Pelham Parkway
  // Staten Island
  'SI0101', // St. George-New Brighton
  'SI0501', // Stapleton-Rosebank
  'SI2501', // Tottenville-Charleston
]);

type LabelEl = { el: HTMLDivElement; vpX: number; vpY: number };

export class NeighborhoodLabels {
  private viewer: OpenSeadragon.Viewer;
  private boroughEls: LabelEl[] = [];
  private majorEls: LabelEl[] = [];
  private allEls: LabelEl[] = [];
  private currentTier: 0 | 1 | 2 | -1 = -1;
  private enabled = true;

  constructor(viewer: OpenSeadragon.Viewer) {
    this.viewer = viewer;
    this.buildLabels();
    console.log(`[labels] built: ${this.boroughEls.length} borough, ${this.majorEls.length} major, ${this.allEls.length} NTA`);
    viewer.addHandler('zoom', () => this.update());
    // 'open' has already fired by the time we're constructed — call update() directly
    this.update();
  }

  setEnabled(val: boolean) {
    this.enabled = val;
    if (!val) {
      this.hideAll();
    } else {
      this.currentTier = -1; // force re-render
      this.update();
    }
  }

  private makeLabel(text: string, tier: 'borough' | 'major' | 'nta'): HTMLDivElement {
    const el = document.createElement('div');
    el.className = `nta-label nta-label--${tier}`;
    el.textContent = text;
    el.style.pointerEvents = 'none';
    el.style.zIndex = '10';
    el.style.position = 'absolute';
    el.style.whiteSpace = 'nowrap';
    return el;
  }

  private toVp(lat: number, lng: number): { vpX: number; vpY: number } {
    const { x, y } = latlngToImagePx(lat, lng);
    return {
      vpX: x / IMAGE_DIMS.width,
      vpY: y / IMAGE_DIMS.width,
    };
  }

  private buildLabels() {
    // Borough labels
    for (const b of BOROUGH_LABELS) {
      const { vpX, vpY } = this.toVp(b.lat, b.lng);
      const el = this.makeLabel(b.name, 'borough');
      this.boroughEls.push({ el, vpX, vpY });
    }

    // NTA labels — split into major and all
    for (const nta of ntaData) {
      const { vpX, vpY } = this.toVp(nta.lat, nta.lng);
      const isMajor = MAJOR_NTA_CODES.has(nta.code);
      const tier = isMajor ? 'major' : 'nta';
      const el = this.makeLabel(nta.name, tier);
      const entry = { el, vpX, vpY };
      if (isMajor) this.majorEls.push(entry);
      this.allEls.push(entry);
    }
  }

  private addOverlays(labels: LabelEl[]) {
    for (const { el, vpX, vpY } of labels) {
      this.viewer.addOverlay({
        element: el,
        location: new OpenSeadragon.Point(vpX, vpY),
        placement: OpenSeadragon.Placement.TOP_LEFT,
        checkResize: false,
      });
    }
  }

  private removeOverlays(labels: LabelEl[]) {
    for (const { el } of labels) {
      try { this.viewer.removeOverlay(el); } catch (_) { /* already removed */ }
    }
  }

  private hideAll() {
    this.removeOverlays(this.boroughEls);
    this.removeOverlays(this.allEls);
  }

  update() {
    if (!this.enabled) return;
    const zoom = this.viewer.viewport.getZoom();

    let tier: 0 | 1 | 2;
    if (zoom < 1.5) tier = 0;
    else if (zoom < 4) tier = 1;
    else tier = 2;

    if (tier === this.currentTier) return;
    this.currentTier = tier;
    console.log(`[labels] zoom=${zoom.toFixed(2)} tier=${tier}`);

    // Clear everything
    this.removeOverlays(this.boroughEls);
    this.removeOverlays(this.allEls);

    if (tier === 0) {
      this.addOverlays(this.boroughEls);
      console.log(`[labels] added ${this.boroughEls.length} borough labels`);
    } else if (tier === 1) {
      this.addOverlays(this.majorEls);
      console.log(`[labels] added ${this.majorEls.length} major labels`);
    } else {
      this.addOverlays(this.allEls);
      console.log(`[labels] added ${this.allEls.length} NTA labels`);
    }
  }

  destroy() {
    this.hideAll();
  }
}
