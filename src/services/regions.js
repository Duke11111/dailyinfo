import rawRegions from '../data/regions.json' with { type: 'json' };
import { readStored, writeStored } from '../lib/storage.js';

export const REGION_KEY = 'dailyinfo.region.v1';
export const regions = Object.freeze(rawRegions.map(region => Object.freeze(region)));
export const counties = Object.freeze([...new Set(regions.map(r => r.county))]);
const index = new Map(regions.map(region => [region.id, region]));
export const DEFAULT_REGION = index.get('63000030'); // 臺北市大安區，行政區界線內代表點
export const getRegion = (id) => typeof id === 'string' ? index.get(id) ?? null : null;
export const getDistricts = (county) => typeof county === 'string' ? regions.filter(r => r.county === county) : [];
export const regionLabel = (region) => `${region.county} ${region.district}`;
export function validateCoordinates(region) {
  const canonical = getRegion(region?.id);
  return Boolean(canonical && canonical.county === region.county && canonical.district === region.district
    && typeof region.latitude === 'number' && Number.isFinite(region.latitude) && region.latitude >= 21 && region.latitude <= 27
    && typeof region.longitude === 'number' && Number.isFinite(region.longitude) && region.longitude >= 118 && region.longitude <= 123
    && canonical.latitude === region.latitude && canonical.longitude === region.longitude);
}
export function loadRegion() {
  const stored = readStored(REGION_KEY);
  return stored && typeof stored === 'object' && !Array.isArray(stored) ? getRegion(stored.id) ?? DEFAULT_REGION : DEFAULT_REGION;
}
export function saveRegion(id) { return getRegion(id) ? writeStored(REGION_KEY, { id }) : false; }
const normalize = (value) => value.normalize('NFKC').replace(/台/g, '臺').replace(/\s+/g, '').toLowerCase();
export function searchRegions(query) {
  if (typeof query !== 'string' || query.length > 80) return [];
  const needle = normalize(query);
  if (!needle) return [];
  return regions.filter(r => normalize(r.county + r.district).includes(needle));
}
