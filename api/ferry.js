/**
 * Vercel serverless: proxy NYC Ferry GTFS-RT vehicle positions
 * Decodes protobuf and returns simple JSON array.
 * GET /api/ferry
 */

// Minimal protobuf field reader (same pattern as subway.js)
function readVarint(buf, pos) {
  let result = 0, shift = 0;
  while (pos < buf.length) {
    const byte = buf[pos++];
    result |= (byte & 0x7f) << shift;
    if (!(byte & 0x80)) break;
    shift += 7;
  }
  return { value: result, pos };
}

function readLenDelim(buf, pos) {
  const { value: len, pos: p } = readVarint(buf, pos);
  return { value: buf.slice(p, p + len), pos: p + len };
}

function readFloat32BE(buf, offset) {
  const view = new DataView(buf.buffer, buf.byteOffset + offset, 4);
  return view.getFloat32(0, false); // big-endian
}

function readFloat32LE(buf, offset) {
  const view = new DataView(buf.buffer, buf.byteOffset + offset, 4);
  return view.getFloat32(0, true); // little-endian
}

function parseMessage(buf) {
  const fields = {};
  let pos = 0;
  while (pos < buf.length) {
    const { value: tag, pos: p } = readVarint(buf, pos);
    pos = p;
    const fieldNum = tag >> 3;
    const wireType = tag & 0x7;
    if (wireType === 2) {
      const { value: bytes, pos: np } = readLenDelim(buf, pos);
      pos = np;
      if (!fields[fieldNum]) fields[fieldNum] = [];
      fields[fieldNum].push(bytes);
    } else if (wireType === 0) {
      const { value, pos: np } = readVarint(buf, pos);
      pos = np;
      if (!fields[fieldNum]) fields[fieldNum] = [];
      fields[fieldNum].push(value);
    } else if (wireType === 5) {
      // 32-bit fixed
      if (!fields[fieldNum]) fields[fieldNum] = [];
      fields[fieldNum].push(buf.slice(pos, pos + 4));
      pos += 4;
    } else if (wireType === 1) {
      pos += 8; // skip 64-bit
    } else {
      break; // unknown wire type, bail
    }
  }
  return fields;
}

function str(buf) { return Buffer.from(buf).toString('utf8'); }

// Read IEEE 754 float from a 4-byte Buffer (little-endian, as protobuf uses)
function f32(buf) {
  if (!buf || buf.length < 4) return 0;
  const view = new DataView(buf.buffer, buf.byteOffset, 4);
  return view.getFloat32(0, true);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const FERRY_URL = 'https://nycferry.connexionz.net/rtt/public/utility/gtfsrealtime.aspx/vehicleposition';

  try {
    const resp = await fetch(FERRY_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 permitpulse.nyc' },
    });
    if (!resp.ok) return res.status(200).json({ vessels: [] });

    const arrayBuf = await resp.arrayBuffer();
    const buf = Buffer.from(arrayBuf);

    // Parse FeedMessage: field 2 = repeated FeedEntity
    const msg = parseMessage(buf);
    const entities = msg[2] ?? [];
    const vessels = [];

    for (const entityBuf of entities) {
      const entity = parseMessage(entityBuf);
      // FeedEntity field 1 = id, field 4 = vehicle (VehiclePosition)
      const vehicleBufs = entity[4];
      if (!vehicleBufs) continue;

      for (const vBuf of vehicleBufs) {
        const v = parseMessage(vBuf);
        // VehiclePosition field 1 = trip, field 2 = vehicle (VehicleDescriptor), field 3 = position
        const posBufs = v[3];
        const descBufs = v[2];
        if (!posBufs) continue;

        const pos = parseMessage(posBufs[0]);
        // Position: field 1 = latitude (float32), field 2 = longitude (float32), field 3 = bearing
        const lat = pos[1]?.[0] ? f32(pos[1][0]) : null;
        const lon = pos[2]?.[0] ? f32(pos[2][0]) : null;
        if (!lat || !lon || Math.abs(lat) < 1) continue;

        const label = descBufs ? str(parseMessage(descBufs[0])[2]?.[0] ?? Buffer.alloc(0)) : '';

        vessels.push({ lat, lon, label });
      }
    }

    return res.status(200).json({ vessels });
  } catch (err) {
    return res.status(200).json({ vessels: [], error: String(err) });
  }
}
