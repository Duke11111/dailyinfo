// Build-time only. Derive interior representative points from NLSC boundary data.
// The application never downloads boundaries or guesses coordinates from text.
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

const url = 'https://geo.maderaojen.me/datasets/tw-townships/releases/v1/2026-07-04.1/data.geojson';
const expectedHash = '4ab5da8297a75c3e3fd2cb272642693a91f04299a739897dffc8d7ae029d5196';
const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
if (!response.ok) throw new Error(`Boundary HTTP ${response.status}`);
const raw = Buffer.from(await response.arrayBuffer());
const sha256 = createHash('sha256').update(raw).digest('hex');
if (sha256 !== expectedHash) throw new Error('Boundary hash changed; review source before updating.');
const data = JSON.parse(raw.toString('utf8'));

function ringArea(ring) {
  return Math.abs(ring.reduce((sum, p, i) => {
    const next = ring[(i + 1) % ring.length];
    return sum + p[0] * next[1] - next[0] * p[1];
  }, 0) / 2);
}
function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inPolygon = (point, polygon) => inRing(point, polygon[0]) && !polygon.slice(1).some(ring => inRing(point, ring));

// The midpoint of an interior scanline interval is guaranteed to be on land
// within the polygon. Choose the widest interval among 31 horizontal samples
// on the largest component, so remote islets do not drag a centroid offshore.
function interiorPoint(polygon) {
  const ys = polygon[0].map(p => p[1]);
  const min = Math.min(...ys), max = Math.max(...ys);
  let best = null, width = -1;
  for (let sample = 1; sample <= 31; sample++) {
    const y = min + (max - min) * sample / 32;
    const xs = [];
    for (const ring of polygon) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > y) !== (yj > y)) xs.push(xi + (y - yi) * (xj - xi) / (yj - yi));
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const point = [(xs[i] + xs[i + 1]) / 2, y];
      if (xs[i + 1] - xs[i] > width && inPolygon(point, polygon)) {
        width = xs[i + 1] - xs[i]; best = point;
      }
    }
  }
  if (!best) throw new Error('No interior representative point');
  return best.map(v => Number(v.toFixed(6)));
}

const regions = data.features.map(feature => {
  const p = feature.properties;
  const polygons = feature.geometry.type === 'MultiPolygon' ? feature.geometry.coordinates : [feature.geometry.coordinates];
  const largest = [...polygons].sort((a, b) => ringArea(b[0]) - ringArea(a[0]))[0];
  const [longitude, latitude] = interiorPoint(largest);
  if (!inPolygon([longitude, latitude], largest)) throw new Error(`Rounded point outside ${p.TOWNCODE}`);
  if (!/^[0-9]{8}$/.test(p.TOWNCODE) || latitude < 21 || latitude > 27 || longitude < 118 || longitude > 123) throw new Error(`Invalid ${p.TOWNCODE}`);
  return { id: p.TOWNCODE, county: p.COUNTYNAME, district: p.TOWNNAME, latitude, longitude };
}).sort((a, b) => a.id.localeCompare(b.id));
if (regions.length !== 368 || new Set(regions.map(r => r.county)).size !== 22 || new Set(regions.map(r => r.id)).size !== 368) throw new Error('Unexpected coverage');
await mkdir('src/data', { recursive: true });
await writeFile('src/data/regions.json', JSON.stringify(regions, null, 2) + '\n');
await mkdir('data-sources', { recursive: true });
await writeFile('data-sources/regions-provenance.json', JSON.stringify({
  source: '內政部國土測繪中心 鄉鎮市區界線（1140318）',
  officialDataset: 'https://data.gov.tw/dataset/7441',
  distribution: url, distributionRelease: '2026-07-04.1', sha256,
  license: '政府資料開放授權條款－第1版', licenseUrl: 'https://data.gov.tw/license',
  coordinateSystem: 'EPSG:4326 (GeoJSON distribution)',
  method: 'Largest polygon component, widest interior horizontal interval across 31 samples; rounded to six decimal places and rechecked inside polygon. Representative forecast point, not a station, office, or official centroid.',
  counties: 22, districts: 368, verifiedInsideBoundary: 368,
  coverage: '臺灣、澎湖、金門、連江的22縣市368鄉鎮市區；不含村里、郵遞區號專用地名或獨立的東沙/南沙選項。多島行政區使用最大面積陸塊。',
}, null, 2) + '\n');
console.log(`Verified ${regions.length} representative points inside boundaries, 22 counties, SHA-256 ${sha256}`);
console.log(regions.filter(r => ['臺北市大安區', '苗栗縣竹南鎮', '高雄市左營區'].includes(r.county + r.district)));
