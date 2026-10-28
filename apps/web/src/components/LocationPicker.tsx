import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Crosshair, Home, MapPin, Search } from 'lucide-react';
import { api } from '../lib/api';
import { loadGoogleMaps, MAPS_KEY } from '../lib/maps';
import { useLocationStore, type DeliveryLocation } from '../lib/stores';
import type { Address } from '../lib/types';
import { useMe } from '../hooks/useAuth';
import { Button, Modal, Notice } from './ui';

/** Demo areas inside the seeded Bengaluru zone, for development without Maps keys. */
export const POPULAR_AREAS: DeliveryLocation[] = [
  { label: 'Koramangala 6th Block, Bengaluru', lat: 12.9389, lng: 77.6268 },
  { label: 'Indiranagar, Bengaluru', lat: 12.9719, lng: 77.6412 },
  { label: 'HSR Layout, Bengaluru', lat: 12.9116, lng: 77.6474 },
  { label: 'BTM Layout, Bengaluru', lat: 12.9166, lng: 77.6101 },
  { label: 'Jayanagar, Bengaluru', lat: 12.9299, lng: 77.5838 },
];

export function LocationPicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const setLocation = useLocationStore((s) => s.setLocation);
  const { data: me } = useMe();
  const [geoError, setGeoError] = useState('');
  const [locating, setLocating] = useState(false);
  const [checking, setChecking] = useState(false);
  const [unserviceable, setUnserviceable] = useState('');
  const addresses = useQuery({
    queryKey: ['addresses'],
    queryFn: () => api<{ addresses: Address[] }>('/addresses').then((r) => r.addresses),
    enabled: open && me?.role === 'customer',
  });

  async function choose(l: DeliveryLocation) {
    setChecking(true);
    setUnserviceable('');
    try {
      const r = await api<{ serviceable: boolean }>(`/serviceability?lat=${l.lat}&lng=${l.lng}`);
      if (!r.serviceable) {
        setUnserviceable(`We don’t deliver to ${l.label.split(',')[0]} yet. Tadka currently serves parts of south-east Bengaluru.`);
        return;
      }
      setLocation(l);
      onClose();
    } finally {
      setChecking(false);
    }
  }

  function useGps() {
    setGeoError('');
    if (!('geolocation' in navigator)) return setGeoError('Your browser can’t share location. Pick an area below instead.');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false);
        void choose({ label: 'Current location', lat: p.coords.latitude, lng: p.coords.longitude });
      },
      (e) => {
        setLocating(false);
        setGeoError(e.code === e.PERMISSION_DENIED ? 'Location permission was denied. You can still search or pick an area.' : 'We couldn’t get your location. Try again or pick an area.');
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  return (
    <Modal open={open} onClose={onClose} title="Where should we deliver?">
      <div className="space-y-5">
        <Button variant="secondary" block onClick={useGps} loading={locating}>
          <Crosshair className="size-4 text-brand-600" aria-hidden /> Use my current location
        </Button>
        {geoError && <Notice tone="warn">{geoError}</Notice>}
        {unserviceable && <Notice tone="error">{unserviceable}</Notice>}
        {MAPS_KEY ? <PlacesSearch onPick={choose} /> : null}

        {me?.role === 'customer' && (addresses.data?.length ?? 0) > 0 && (
          <section>
            <h3 className="label mb-2">Saved addresses</h3>
            <ul className="divide-y divide-line rounded-xl border border-line">
              {addresses.data!.map((a) => (
                <li key={a.id}>
                  <button
                    disabled={checking}
                    onClick={() => choose({ label: `${a.label} · ${a.locality}`, lat: a.location.lat, lng: a.location.lng, addressId: a.id })}
                    className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-paper"
                  >
                    <Home className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
                    <span>
                      <span className="block text-sm font-semibold">{a.label}</span>
                      <span className="block text-xs text-muted">
                        {a.line1}, {a.locality} {a.pincode}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h3 className="label mb-2">Popular areas {MAPS_KEY ? '' : '(demo — address search needs a Maps key)'}</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {POPULAR_AREAS.map((a) => (
              <button key={a.label} disabled={checking} onClick={() => choose(a)} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2.5 text-left text-sm hover:border-brand-200 hover:bg-brand-50">
                <MapPin className="size-4 shrink-0 text-brand-600" aria-hidden />
                {a.label.split(',')[0]}
              </button>
            ))}
          </div>
        </section>
      </div>
    </Modal>
  );
}

/** Google Places Autocomplete (only when a browser Maps key is configured). */
function PlacesSearch({ onPick }: { onPick: (l: DeliveryLocation) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let ac: { addListener: (e: string, f: () => void) => void; getPlace: () => { formatted_address?: string; name?: string; geometry?: { location: { lat: () => number; lng: () => number } } } } | null = null;
    loadGoogleMaps()
      .then((g) => {
        if (!ref.current) return;
        ac = new g.maps.places.Autocomplete(ref.current, { componentRestrictions: { country: 'in' }, fields: ['formatted_address', 'geometry', 'name'] });
        ac!.addListener('place_changed', () => {
          const p = ac!.getPlace();
          if (p.geometry) onPick({ label: p.formatted_address ?? p.name ?? 'Selected place', lat: p.geometry.location.lat(), lng: p.geometry.location.lng() });
        });
      })
      .catch(() => setFailed(true));
  }, [onPick]);
  if (failed) return <Notice tone="warn">Address search is unavailable right now. Use your location or pick an area.</Notice>;
  return (
    <label className="relative block">
      <span className="sr-only">Search for an area, street or landmark</span>
      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
      <input ref={ref} placeholder="Search area, street or landmark" className="h-11 w-full rounded-xl border border-line-strong bg-surface pl-10 pr-3 text-[15px] focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100" />
    </label>
  );
}
