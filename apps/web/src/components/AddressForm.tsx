import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Crosshair } from 'lucide-react';
import { addressSchema, type AddressInput } from '@tadka/shared';
import { api, fieldErrors } from '../lib/api';
import { useLocationStore } from '../lib/stores';
import type { Address } from '../lib/types';
import { errorMessage } from '../lib/format';
import { Button, Field, Input, Notice } from './ui';
import { POPULAR_AREAS } from './LocationPicker';

/**
 * Indian address form: flat/house, locality, landmark, PIN. The map pin comes from the device location,
 * the header location, or a known area — never typed coordinates.
 */
export function AddressForm({ onSaved, initial }: { onSaved: (a: Address) => void; initial?: Partial<AddressInput> }) {
  const current = useLocationStore((s) => s.location);
  const [pin, setPin] = useState<{ lat: number; lng: number; label: string } | null>(current ? { lat: current.lat, lng: current.lng, label: current.label } : null);
  const [serverError, setServerError] = useState('');
  const [locating, setLocating] = useState(false);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<AddressInput>({
    resolver: zodResolver(addressSchema),
    defaultValues: { label: 'Home', city: 'Bengaluru', state: 'Karnataka', ...initial, location: pin ?? { lat: 0, lng: 0 } },
  });

  const submit = handleSubmit(async (values) => {
    setServerError('');
    if (!pin) return setServerError('Set the map pin for this address first.');
    try {
      const r = await api<{ address: Address }>('/addresses', { method: 'POST', body: { ...values, location: { lat: pin.lat, lng: pin.lng } } });
      if (r.address.serviceable === false) setServerError('Saved, but this address is outside our delivery zone right now.');
      onSaved(r.address);
    } catch (err) {
      const fe = fieldErrors(err);
      Object.entries(fe).forEach(([k, m]) => setError(k as keyof AddressInput, { message: m }));
      if (!Object.keys(fe).length) setServerError(errorMessage(err));
    }
  });

  function gps() {
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false);
        setPin({ lat: p.coords.latitude, lng: p.coords.longitude, label: `GPS (±${Math.round(p.coords.accuracy)} m)` });
      },
      () => {
        setLocating(false);
        setServerError('Couldn’t read your location. Choose an area instead.');
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="rounded-xl border border-line bg-paper p-3 text-sm">
        <p className="font-semibold">Map pin</p>
        <p className="text-muted">{pin ? pin.label : 'Not set'}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={gps} loading={locating}>
            <Crosshair className="size-3.5" /> Use GPS
          </Button>
          {POPULAR_AREAS.slice(0, 3).map((a) => (
            <Button key={a.label} type="button" variant="ghost" size="sm" onClick={() => setPin(a)}>
              {a.label.split(',')[0]}
            </Button>
          ))}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Flat / house no., floor, building" error={errors.line1?.message}>
          {(id, d) => <Input id={id} aria-describedby={d} aria-invalid={!!errors.line1} autoComplete="address-line1" {...register('line1')} />}
        </Field>
        <Field label="Street / area (optional)" error={errors.line2?.message}>
          {(id) => <Input id={id} autoComplete="address-line2" {...register('line2')} />}
        </Field>
        <Field label="Locality" error={errors.locality?.message}>
          {(id, d) => <Input id={id} aria-describedby={d} aria-invalid={!!errors.locality} placeholder="e.g. Koramangala 6th Block" {...register('locality')} />}
        </Field>
        <Field label="Landmark (optional)" hint="Helps the partner find you" error={errors.landmark?.message}>
          {(id, d) => <Input id={id} aria-describedby={d} placeholder="Near…" {...register('landmark')} />}
        </Field>
        <Field label="City" error={errors.city?.message}>
          {(id) => <Input id={id} autoComplete="address-level2" {...register('city')} />}
        </Field>
        <Field label="PIN code" error={errors.pincode?.message}>
          {(id, d) => <Input id={id} aria-describedby={d} aria-invalid={!!errors.pincode} inputMode="numeric" maxLength={6} autoComplete="postal-code" {...register('pincode')} />}
        </Field>
        <Field label="State" error={errors.state?.message}>
          {(id) => <Input id={id} autoComplete="address-level1" {...register('state')} />}
        </Field>
        <Field label="Save as" error={errors.label?.message}>
          {(id) => <Input id={id} placeholder="Home, Work…" {...register('label')} />}
        </Field>
      </div>
      {serverError && <Notice tone="error">{serverError}</Notice>}
      <Button type="submit" block loading={isSubmitting}>
        Save address
      </Button>
    </form>
  );
}
