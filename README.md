# NYC Permit Pulse

**[permitpulse.nyc](https://permitpulse.nyc) · A live NYC DOB permit overlay for [isometric.nyc](https://isometric.nyc).**

Built as an open-source add-on to [@cannoneyed](https://github.com/cannoneyed)'s pixel-art isometric map of New York City. Plots active building permits directly onto the illustration, with neighborhood labels, real-time filtering, and permit detail drill-down.

![NYC Permit Pulse screenshot](https://raw.githubusercontent.com/ziggy2socks/isometric-permits/main/public/screenshot.jpg)

---

## Features

- **Live permit data** from NYC DOB NOW (updated daily via NYC Open Data)
- **Color-coded markers** by permit type: New Building, Demolition, General Construction, Plumbing, Mechanical, Solar, and more
- **Recency fade** — newer permits glow brighter, older ones dim
- **Neighborhood labels** at three zoom levels: borough → major neighborhoods → all 197 NTAs
- **Permit detail drawer** — address, description, contractor, owner, cost, filing info
- **Live ticker** — cycles through recent permits, click to fly to location
- **Breakdown chart** — permit type distribution for the current filter set
- **Filters** — by permit type, borough, and date range (24h / 7d / 30d)
- **Two data sources merged** — approved work permits + job filings (NB/DM)

---

## Data Sources

All data is public and fetched client-side from [NYC Open Data](https://opendata.cityofnewyork.us/):

| Dataset | Socrata ID | Contents |
|---|---|---|
| DOB NOW: Build – Approved Permits | `rbx6-tga4` | Work permits (GC, PL, ME, SOL, etc.) |
| DOB NOW: Build – Job Filings | `w9ak-ipjd` | New Building + Full Demolition filings |
| 2020 Neighborhood Tabulation Areas | `9nt8-h7nd` | NTA boundaries (used to compute centroids) |

> **Note:** DOB NOW data lags approximately 24 hours. The "24h" filter queries 48 hours back to account for this.

> **Note:** Socrata's `$where` / `$order` parameters must be passed as raw query strings — `URLSearchParams` encodes `$` as `%24` which the API silently ignores, returning unfiltered results.

---

## Coordinate Projection

Permits are geo-located (lat/lng) and projected onto the isometric pixel canvas using a port of the `latlng_to_quadrant_coords()` function from isometric.nyc's Python generation code.

Calibration used 15 ground-truth points across all 5 boroughs, solved via least-squares for the seed pixel position:

```
SEED_PX = { x: 45059, y: 43479 }   # ~Empire State Building
MPP     ≈ 0.293 m/px (isotropic)
azimuth = -15°  |  elevation = -45°
```

RMS residual: **28px (~8m)** across the full NYC metro. Max error: 63px (~18m).

**Critical OSD note:** OpenSeadragon uses image *width* as the unit for *both* viewport axes. To convert image pixels to OSD viewport coordinates:
```ts
vpX = imgX / IMAGE_DIMS.width  // ✓
vpY = imgY / IMAGE_DIMS.width  // ✓ — divide by width, not height!
```

---

## Tech Stack

- [Vite](https://vitejs.dev/) + [React](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- [OpenSeadragon](https://openseadragon.github.io/) for deep-zoom tile rendering
- [Tailwind CSS](https://tailwindcss.com/) v4
- NYC Open Data / Socrata API (no API key required)

---

## Getting Started

```bash
git clone https://github.com/yourusername/isometric-permits
cd isometric-permits
npm install
npm run dev
# → http://localhost:5177
```

The Vite dev server proxies tile requests and API calls to avoid CORS:

| Proxy path | Target |
|---|---|
| `/dzi/*` | `https://isometric-nyc-tiles.cannoneyed.com` |
| `/api/permits` | `https://data.cityofnewyork.us/resource/rbx6-tga4.json` |
| `/api/jobs` | `https://data.cityofnewyork.us/resource/w9ak-ipjd.json` |

---

## Production / Vercel Deployment

The Vite proxy only runs in dev. For production, deploy with a `vercel.json` that rewrites API and tile paths:

```json
{
  "rewrites": [
    { "source": "/api/permits/:path*", "destination": "https://data.cityofnewyork.us/resource/rbx6-tga4.json/:path*" },
    { "source": "/api/jobs/:path*",    "destination": "https://data.cityofnewyork.us/resource/w9ak-ipjd.json/:path*" },
    { "source": "/dzi/:path*",         "destination": "https://isometric-nyc-tiles.cannoneyed.com/dzi/:path*" }
  ]
}
```

---

## Project Structure

```
src/
  App.tsx              # Main app — OSD viewer, sidebar, filters, ticker, drawer
  App.css              # All styles — dark terminal aesthetic
  coordinates.ts       # Lat/lng → isometric pixel projection
  permits.ts           # API fetch, normalization, color/label/emoji maps
  types.ts             # Permit, MapConfig, FilterState interfaces
  NeighborhoodLabels.ts # LOD neighborhood label system
  nta_centroids.json   # 197 NYC NTA centroids (computed from NYC Open Data)
```

---

## Acknowledgements

- **[@cannoneyed](https://github.com/cannoneyed)** — creator of [isometric.nyc](https://isometric.nyc) and the tile server this overlay runs on. An incredible piece of work.
- **NYC Department of Buildings** / **NYC Open Data** — for making permit data publicly accessible.

---

## License

MIT
