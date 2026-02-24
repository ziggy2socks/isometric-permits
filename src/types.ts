export interface MapConfig {
  seed: { lat: number; lng: number };
  camera_azimuth_degrees: number;
  camera_elevation_degrees: number;
  width_px: number;
  height_px: number;
  view_height_meters: number;
  tile_step: number;
}

export interface Permit {
  job__: string;
  job_type: string;
  permit_type?: string;
  permit_status?: string;
  house__?: string;
  street_name?: string;
  borough?: string;
  owner_s_business_name?: string;
  permittee_s_business_name?: string;
  filing_date?: string;
  gis_latitude?: string;
  gis_longitude?: string;
  job_description?: string;
  bin__?: string;
}

export type JobType = 'NB' | 'DM' | 'A1' | 'A2' | 'A3' | 'EW' | 'PL' | 'SG' | 'OTHER';

export interface FilterState {
  jobTypes: Set<string>;
  boroughs: Set<string>;
  daysBack: number;
}
