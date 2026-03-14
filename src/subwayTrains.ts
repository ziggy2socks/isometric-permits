// Live F train positions via MTA GTFS-RT (decoded server-side)

export interface SubwayTrain {
  tripId: string;
  stopId: string;
  status: number;   // 1=IN_TRANSIT_TO, 2=STOPPED_AT, 3=INCOMING_AT
  dir: 'N' | 'S';
  route: string;
}

export async function fetchFTrains(): Promise<SubwayTrain[]> {
  try {
    const res = await fetch('/api/subway?route=F', { cache: 'no-store' });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.trains ?? []) as SubwayTrain[];
  } catch {
    return [];
  }
}
