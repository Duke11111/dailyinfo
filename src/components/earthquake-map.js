import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { formatEarthquakeTime as formatTime } from '../lib/earthquake-format.js';

export const markerRadius = magnitude => 5 + Math.min(10, Math.max(0, magnitude ?? 0)) * 2;
const element = (tag, text) => { const node = document.createElement(tag); node.textContent = text; return node; };
export function earthquakePopup(event) {
  const box = element('div', ''); box.className = 'eq-popup';
  box.append(element('strong', event.location), element('p', `${formatTime(event.originTime)}（臺灣時間）`), element('p', `規模 ${event.magnitude ?? '未提供'} · 深度 ${event.depth ?? '未提供'} km · 最大觀測震度 ${event.maxIntensity ?? '未提供'}`));
  return box;
}
export function createEarthquakeMap(host, { onSelect, onStatus = () => {} }) {
  const map = L.map(host, { scrollWheelZoom: false }).setView([23.7, 121], 7);
  const layer = L.layerGroup().addTo(map), markers = new Map();
  const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, noWrap: true, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors' }).addTo(map);
  let tileError = false;
  tiles.on('loading', () => { tileError = false; onStatus('底圖載入中…'); });
  tiles.on('tileerror', () => { tileError = true; onStatus('部分底圖載入失敗；震央標記、列表及詳情仍可使用。'); });
  tiles.on('load', () => { if (!tileError) onStatus('底圖：OpenStreetMap · 可拖曳平移，使用＋／−縮放。'); });
  map.zoomControl.getContainer().querySelector('.leaflet-control-zoom-in')?.setAttribute('aria-label', '放大震央地圖');
  map.zoomControl.getContainer().querySelector('.leaflet-control-zoom-out')?.setAttribute('aria-label', '縮小震央地圖');
  return {
    setEvents(events) {
      layer.clearLayers(); markers.clear();
      for (const event of events) {
        const significant = event.reports.some(report => report.dataset === 'E-A0015-001');
        const marker = L.circleMarker([event.latitude, event.longitude], { radius: markerRadius(event.magnitude), weight: 2, fillOpacity: .3, className: `eq-marker ${significant ? 'eq-significant' : 'eq-local'}` }).addTo(layer).bindPopup(earthquakePopup(event));
        marker.on('click', () => onSelect(event)); markers.set(event.id, marker);
        const path = marker.getElement();
        if (path) {
          path.setAttribute('tabindex', '0'); path.setAttribute('role', 'button'); path.setAttribute('aria-label', `震央：${formatTime(event.originTime)} ${event.location} 規模 ${event.magnitude ?? '未提供'}`);
          path.addEventListener('keydown', key => { if (key.key === 'Enter' || key.key === ' ') { key.preventDefault(); marker.openPopup(); onSelect(event); } });
        }
      }
    },
    select(id, focus = true) {
      for (const [key, marker] of markers) {
        marker.getElement()?.classList.toggle('eq-selected', key === id); marker.getElement()?.setAttribute('aria-pressed', String(key === id));
      }
      const marker = markers.get(id);
      if (focus && marker) { map.setView(marker.getLatLng(), Math.max(9, map.getZoom()), { animate: false }); marker.openPopup(); }
    },
    reset() { map.setView([23.7, 121], 7, { animate: false }); },
    destroy() { map.remove(); },
  };
}
