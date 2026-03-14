/**
 * Vercel serverless: proxy NYC Ferry GTFS-RT vehicle positions JSON
 * GET /api/ferry
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const endpoints = [
    'https://s3.amazonaws.com/bktransit-gtfs/nyc-ferry/vehiclepositions.json',
    'https://dctu6gk73d2vg.cloudfront.net/gtfs-realtime/ferry-gtfs-rt/vehiclepositions.json',
  ];
  for (const url of endpoints) {
    try {
      const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (!resp.ok) continue;
      const data = await resp.json();
      return res.status(200).json(data);
    } catch { /* try next */ }
  }
  return res.status(200).json({ entity: [] });
}
