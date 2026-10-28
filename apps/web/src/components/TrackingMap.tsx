import { useEffect, useRef, useState } from 'react';
import { Bike, Home, Store } from 'lucide-react';
import type { LatLng, LiveLocation } from '../lib/types';
import { loadGoogleMaps, MAP_ID, MAPS_KEY, type GoogleNs } from '../lib/maps';

interface Props {
  restaurant: LatLng;
  destination: LatLng;
  partner: LiveLocation | null;
  stale?: boolean;
}

/**
 * Live tracking map. Uses Google Maps when a browser key is configured; otherwise a clearly-labelled
 * schematic that still plots the real coordinates (never a fake moving pin).
 */
export function TrackingMap(props: Props) {
  const [mapsFailed, setMapsFailed] = useState(false);
  if (MAPS_KEY && !mapsFailed) return <GoogleTrackingMap {...props} onFail={() => setMapsFailed(true)} />;
  return <SchematicMap {...props} reason={MAPS_KEY ? 'Google Maps failed to load' : 'Google Maps not configured'} />;
}

const pin = (color: string, glyph: string) =>
  `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="44" viewBox="0 0 36 44"><path d="M18 43s15-13.6 15-25A15 15 0 0 0 3 18c0 11.4 15 25 15 25z" fill="${color}" stroke="white" stroke-width="2.5"/><text x="18" y="23" font-size="14" text-anchor="middle" fill="white" font-family="Arial" font-weight="bold">${glyph}</text></svg>`,
  )}`;

function GoogleTrackingMap({ restaurant, destination, partner, stale, onFail }: Props & { onFail: () => void }) {
  const el = useRef<HTMLDivElement>(null);
  const state = useRef<{ g: GoogleNs; map: GoogleNs; partner: GoogleNs; line: GoogleNs } | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then((g) => {
        if (cancelled || !el.current) return;
        const map = new g.maps.Map(el.current, { center: destination, zoom: 14, disableDefaultUI: true, zoomControl: true, mapId: MAP_ID, clickableIcons: false });
        new g.maps.Marker({ map, position: restaurant, title: 'Restaurant', icon: { url: pin('#e2531d', 'R'), scaledSize: new g.maps.Size(32, 40) } });
        new g.maps.Marker({ map, position: destination, title: 'Delivery address', icon: { url: pin('#1d1a16', 'H'), scaledSize: new g.maps.Size(32, 40) } });
        const p = new g.maps.Marker({ map, title: 'Delivery partner', visible: false, icon: { path: g.maps.SymbolPath.CIRCLE, scale: 9, fillColor: '#2f7d4f', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 3 } });
        const line = new g.maps.Polyline({ map, path: [restaurant, destination], strokeOpacity: 0, icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.8, strokeColor: '#e2531d', scale: 3 }, offset: '0', repeat: '14px' }] });
        const b = new g.maps.LatLngBounds();
        b.extend(restaurant);
        b.extend(destination);
        map.fitBounds(b, 48);
        state.current = { g, map, partner: p, line };
      })
      .catch(onFail);
    return () => {
      cancelled = true;
    };
  }, [restaurant, destination, onFail]);

  useEffect(() => {
    const s = state.current;
    if (!s) return;
    if (partner) {
      s.partner.setPosition({ lat: partner.lat, lng: partner.lng });
      s.partner.setVisible(true);
      s.partner.setOpacity(stale ? 0.45 : 1);
      s.line.setPath([{ lat: partner.lat, lng: partner.lng }, destination]);
    } else {
      s.partner.setVisible(false);
      s.line.setPath([restaurant, destination]);
    }
  }, [partner, stale, restaurant, destination]);

  return <div ref={el} className="h-72 w-full rounded-2xl bg-line/50 sm:h-80" role="img" aria-label="Map showing the restaurant, your address and the delivery partner" />;
}

function SchematicMap({ restaurant, destination, partner, stale, reason }: Props & { reason: string }) {
  const pts = [restaurant, destination, ...(partner ? [partner] : [])];
  const lats = pts.map((p) => p.lat);
  const lngs = pts.map((p) => p.lng);
  const pad = 0.15;
  const [minLat, maxLat, minLng, maxLng] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
  const spanLat = Math.max(maxLat - minLat, 0.004);
  const spanLng = Math.max(maxLng - minLng, 0.004);
  const W = 320;
  const H = 200;
  const proj = (p: LatLng) => ({
    x: (pad + ((p.lng - minLng) / spanLng) * (1 - 2 * pad)) * W,
    y: (1 - pad - ((p.lat - minLat) / spanLat) * (1 - 2 * pad)) * H,
  });
  const r = proj(restaurant);
  const d = proj(destination);
  const p = partner ? proj(partner) : null;
  return (
    <figure className="relative overflow-hidden rounded-2xl border border-line bg-[#f3ede2]">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-64 w-full sm:h-72" role="img" aria-label="Schematic map with restaurant, delivery address and partner positions">
        <defs>
          <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
            <path d="M24 0H0V24" fill="none" stroke="#e3d9c6" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width={W} height={H} fill="url(#grid)" />
        <line x1={(p ?? r).x} y1={(p ?? r).y} x2={d.x} y2={d.y} stroke="#e2531d" strokeWidth="2.5" strokeDasharray="6 6" strokeLinecap="round" />
        <circle cx={r.x} cy={r.y} r="11" fill="#e2531d" stroke="#fff" strokeWidth="3" />
        <circle cx={d.x} cy={d.y} r="11" fill="#1d1a16" stroke="#fff" strokeWidth="3" />
        {p && (
          <g opacity={stale ? 0.45 : 1}>
            {!stale && (
              <circle cx={p.x} cy={p.y} r="10" fill="#2f7d4f" opacity="0.35">
                <animate attributeName="r" from="8" to="22" dur="1.6s" repeatCount="indefinite" />
                <animate attributeName="opacity" from="0.4" to="0" dur="1.6s" repeatCount="indefinite" />
              </circle>
            )}
            <circle cx={p.x} cy={p.y} r="9" fill="#2f7d4f" stroke="#fff" strokeWidth="3" />
          </g>
        )}
      </svg>
      <div className="pointer-events-none absolute inset-0">
        <Legend x={r.x / W} y={r.y / H} icon={<Store className="size-3.5" />} text="Restaurant" />
        <Legend x={d.x / W} y={d.y / H} icon={<Home className="size-3.5" />} text="You" />
        {p && <Legend x={p.x / W} y={p.y / H} icon={<Bike className="size-3.5" />} text="Partner" />}
      </div>
      <figcaption className="absolute bottom-2 left-2 rounded-md bg-white/90 px-2 py-1 text-[11px] font-medium text-muted">
        Schematic view (real coordinates) · {reason}
      </figcaption>
    </figure>
  );
}

function Legend({ x, y, icon, text }: { x: number; y: number; icon: React.ReactNode; text: string }) {
  return (
    <span className="absolute inline-flex -translate-x-1/2 translate-y-3 items-center gap-1 rounded-md bg-white/95 px-1.5 py-0.5 text-[11px] font-semibold shadow" style={{ left: `${x * 100}%`, top: `${y * 100}%` }}>
      {icon}
      {text}
    </span>
  );
}
