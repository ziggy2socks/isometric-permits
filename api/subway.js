/**
 * Vercel serverless function: proxy + decode MTA GTFS-RT protobuf
 * Returns JSON array of F train vehicle positions.
 * 
 * GET /api/subway?route=F
 */

// Minimal protobuf decoder — no deps, handles only what we need from GTFS-RT
// Field numbers we care about:
//   FeedMessage.entity (2) → FeedEntity
//   FeedEntity.vehicle (4) → VehiclePosition
//   VehiclePosition.trip (1) → TripDescriptor: route_id (5)
//   VehiclePosition.stop_id (8)
//   VehiclePosition.current_status (9)

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

function readBytes(buf, pos) {
  const { value: len, pos: p } = readVarint(buf, pos);
  return { value: buf.slice(p, p + len), pos: p + len };
}

function skipField(buf, pos, wireType) {
  if (wireType === 0) { // varint
    while (pos < buf.length && (buf[pos++] & 0x80));
    return pos;
  } else if (wireType === 2) { // length-delimited
    const { value: len, pos: p } = readVarint(buf, pos);
    return p + len;
  } else if (wireType === 1) return pos + 8; // 64-bit
  else if (wireType === 5) return pos + 4; // 32-bit
  return pos + 1;
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
      const { value: bytes, pos: np } = readBytes(buf, pos);
      pos = np;
      if (!fields[fieldNum]) fields[fieldNum] = [];
      fields[fieldNum].push(bytes);
    } else if (wireType === 0) {
      const { value, pos: np } = readVarint(buf, pos);
      pos = np;
      if (!fields[fieldNum]) fields[fieldNum] = [];
      fields[fieldNum].push(value);
    } else {
      pos = skipField(buf, pos, wireType);
    }
  }
  return fields;
}

function readString(buf) {
  return Buffer.from(buf).toString('utf8');
}

function readFloat(buf) {
  return buf.readFloatBE(0); // big-endian 32-bit float
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const route = req.query.route ?? 'F';
  
  // Map route to MTA feed
  const feedMap = {
    'A': 'ace', 'C': 'ace', 'E': 'ace',
    'B': 'bdfm', 'D': 'bdfm', 'F': 'bdfm', 'M': 'bdfm',
    'N': 'nqrw', 'Q': 'nqrw', 'R': 'nqrw', 'W': 'nqrw',
    '1': '123456', '2': '123456', '3': '123456', '4': '123456', '5': '123456', '6': '123456',
    'J': 'jz', 'Z': 'jz', 'G': 'g', 'L': 'l',
    '7': '7', 'SI': 'si',
  };
  const feed = feedMap[route] ?? 'bdfm';
  
  try {
    const url = `https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-${feed}`;
    const resp = await fetch(url);
    if (!resp.ok) return res.status(502).json({ error: 'MTA feed unavailable' });
    
    const arrayBuf = await resp.arrayBuffer();
    const buf = Buffer.from(arrayBuf);
    
    // Parse FeedMessage
    const msg = parseMessage(buf);
    const entities = msg[2] ?? []; // field 2 = entity
    
    const trains = [];
    for (const entityBuf of entities) {
      const entity = parseMessage(entityBuf);
      const vehicleBufs = entity[4]; // field 4 = vehicle
      if (!vehicleBufs) continue;
      
      for (const vBuf of vehicleBufs) {
        const v = parseMessage(vBuf);
        
        // trip (field 1)
        const tripBufs = v[1];
        if (!tripBufs) continue;
        const trip = parseMessage(tripBufs[0]);
        const routeIdBufs = trip[5]; // route_id = field 5
        if (!routeIdBufs) continue;
        const routeId = readString(routeIdBufs[0]);
        if (routeId !== route) continue;
        
        // stop_id (field 8)
        const stopIdBufs = v[8];
        const stopId = stopIdBufs ? readString(stopIdBufs[0]) : null;
        
        // current_status (field 9) — 1=IN_TRANSIT_TO, 2=STOPPED_AT, 3=INCOMING_AT
        const status = v[9]?.[0] ?? 1;
        
        // trip_id (field 1 in TripDescriptor)
        const tripIdBufs = trip[1];
        const tripId = tripIdBufs ? readString(tripIdBufs[0]) : null;
        
        // direction from trip_id (contains N/S)
        const dir = tripId?.includes('..N') ? 'N' : 'S';
        
        trains.push({ routeId, stopId, status, tripId, dir });
      }
    }
    
    res.status(200).json({ trains, updated: Date.now() });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}
