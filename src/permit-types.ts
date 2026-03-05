// DOB NOW: Build – Approved Permits (rbx6-tga4)
// + DOB NOW: Build – Job Filings (w9ak-ipjd) for NB/DM
export interface Permit {
  // Identity
  job_filing_number?: string;
  work_permit?: string;
  tracking_number?: string;
  bin?: string;
  sequence_number?: string;

  // Address
  house_no?: string;
  street_name?: string;
  borough?: string;
  zip_code?: string;
  block?: string;
  lot?: string;
  bbl?: string;
  community_board?: string;
  nta?: string;
  council_district?: string;

  // Work
  work_type?: string;         // verbose: "General Construction", "Full Demolition", etc.
  job_type?: string;          // normalized code: NB/DM/GC/PL/etc.
  permit_status?: string;
  job_description?: string;
  filing_reason?: string;
  work_on_floor?: string;
  estimated_job_costs?: string;

  // Dates (ISO format: 2026-02-24T00:00:00.000)
  issued_date?: string;
  approved_date?: string;
  expired_date?: string;

  // Owner
  owner_name?: string;
  owner_business_name?: string;

  // Applicant / contractor
  applicant_first_name?: string;
  applicant_last_name?: string;
  applicant_business_name?: string;

  // Filing rep
  filing_representative_first_name?: string;
  filing_representative_last_name?: string;
  filing_representative_business_name?: string;

  // Coordinates
  latitude?: string;
  longitude?: string;
}
