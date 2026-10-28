import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Crosshair } from 'lucide-react';
import { restaurantProfileSchema } from '@tadka/shared';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/format';
import { Button, Field, Input, Notice, PageHeader, Spinner, Textarea, toast } from '../../components/ui';
import { POPULAR_AREAS } from '../../components/LocationPicker';

interface Profile {
  name: string;
  description: string;
  cuisines: string[];
  tags: string[];
  phone: string;
  fssaiLicense: string;
  imageUrl: string;
  priceForTwo: number;
  packagingFee: number;
  prepTimeMinutes: number;
  deliveryRadiusKm: number;
  pureVeg: boolean;
  approval?: string;
  address: { line1: string; line2?: string; locality: string; landmark?: string; city: string; state: string; pincode: string; location: { lat: number; lng: number } };
  hours: { day: number; open: string; close: string }[];
}

const empty: Profile = {
  name: '',
  description: '',
  cuisines: [],
  tags: [],
  phone: '',
  fssaiLicense: '',
  imageUrl: '',
  priceForTwo: 40000,
  packagingFee: 1500,
  prepTimeMinutes: 20,
  deliveryRadiusKm: 6,
  pureVeg: false,
  address: { line1: '', locality: '', city: 'Bengaluru', state: 'Karnataka', pincode: '', location: { lat: 0, lng: 0 } },
  hours: [],
};

/** Used both for first-time onboarding and later edits. */
export function RestaurantProfilePage({ onboarding }: { onboarding?: boolean }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const existing = useQuery({
    queryKey: ['merchant', 'restaurant', 'full'],
    queryFn: () => api<{ restaurant: Profile }>('/merchant/restaurant').then((r) => r.restaurant),
    retry: false,
  });
  const [f, setF] = useState<Profile>(empty);
  const [open, setOpen] = useState('11:00');
  const [close, setClose] = useState('23:00');
  const [allDay, setAllDay] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    if (existing.data) {
      setF(existing.data);
      if (existing.data.hours.length) {
        setAllDay(false);
        setOpen(existing.data.hours[0].open);
        setClose(existing.data.hours[0].close);
      }
    }
  }, [existing.data]);
  const isNew = existing.isError;

  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...f,
        phone: f.phone.replace(/^\+91/, ''),
        hours: allDay ? [] : [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, open, close })),
        address: { ...f.address, line2: f.address.line2 ?? '', landmark: f.address.landmark ?? '' },
      };
      delete (body as Partial<Profile>).approval;
      const v = restaurantProfileSchema.safeParse(body);
      if (!v.success) {
        const i = v.error.issues[0];
        throw new Error(`${i.path.join(' › ')}: ${i.message}`);
      }
      if (!f.address.location.lat) throw new Error('Set the restaurant’s map pin');
      return api('/merchant/restaurant', { method: isNew ? 'POST' : 'PUT', body: v.data });
    },
    onSuccess: () => {
      toast.success(isNew ? 'Submitted for verification' : 'Saved');
      qc.invalidateQueries({ queryKey: ['merchant'] });
      qc.invalidateQueries({ queryKey: ['me'] });
      if (isNew) nav('/partner/restaurant/menu');
    },
    onError: (e) => setError(errorMessage(e)),
  });

  if (existing.isLoading) return <Spinner />;
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setF((s) => ({ ...s, [k]: v }));
  const setAddr = (k: keyof Profile['address'], v: string) => setF((s) => ({ ...s, address: { ...s.address, [k]: v } }));

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader title={onboarding || isNew ? 'Tell us about your restaurant' : 'Restaurant profile'} sub={isNew ? 'We verify your FSSAI licence before you go live. Usually within a working day.' : f.approval ? `Verification status: ${f.approval.toLowerCase()}` : undefined} />
      <section className="card grid gap-4 p-5 sm:grid-cols-2">
        <Field label="Restaurant name">{(id) => <Input id={id} value={f.name} onChange={(e) => set('name', e.target.value)} />}</Field>
        <Field label="Restaurant phone">{(id) => <Input id={id} type="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} />}</Field>
        <div className="sm:col-span-2">
          <Field label="Description">{(id) => <Textarea id={id} value={f.description} maxLength={400} onChange={(e) => set('description', e.target.value)} />}</Field>
        </div>
        <Field label="Cuisines" hint="comma separated, up to 6">
          {(id, d) => <Input id={id} aria-describedby={d} value={f.cuisines.join(', ')} onChange={(e) => set('cuisines', e.target.value.split(',').map((x) => x.trim()).filter(Boolean))} />}
        </Field>
        <Field label="FSSAI licence number" hint="14 digits">
          {(id, d) => <Input id={id} aria-describedby={d} inputMode="numeric" maxLength={14} value={f.fssaiLicense} onChange={(e) => set('fssaiLicense', e.target.value.replace(/\D/g, ''))} />}
        </Field>
        <Field label="Cost for two (₹)">{(id) => <Input id={id} inputMode="numeric" value={f.priceForTwo / 100} onChange={(e) => set('priceForTwo', Math.round(Number(e.target.value) * 100))} />}</Field>
        <Field label="Packaging charge per order (₹)" hint="Shown to customers as a separate line">
          {(id, d) => <Input id={id} aria-describedby={d} inputMode="numeric" value={f.packagingFee / 100} onChange={(e) => set('packagingFee', Math.round(Number(e.target.value) * 100))} />}
        </Field>
        <Field label="Typical prep time (min)">{(id) => <Input id={id} type="number" min={5} max={90} value={f.prepTimeMinutes} onChange={(e) => set('prepTimeMinutes', Number(e.target.value))} />}</Field>
        <Field label="Delivery radius (km)">{(id) => <Input id={id} type="number" min={1} max={15} step={0.5} value={f.deliveryRadiusKm} onChange={(e) => set('deliveryRadiusKm', Number(e.target.value))} />}</Field>
        <Field label="Cover image URL (https, optional)">{(id) => <Input id={id} value={f.imageUrl} onChange={(e) => set('imageUrl', e.target.value)} />}</Field>
        <label className="flex items-center gap-2 self-end pb-3 text-sm font-medium">
          <input type="checkbox" checked={f.pureVeg} onChange={(e) => set('pureVeg', e.target.checked)} className="size-4 accent-[var(--color-brand-500)]" /> Pure vegetarian kitchen
        </label>
      </section>

      <section className="card grid gap-4 p-5 sm:grid-cols-2">
        <h2 className="text-lg font-bold sm:col-span-2">Address & map pin</h2>
        <Field label="Shop no., building">{(id) => <Input id={id} value={f.address.line1} onChange={(e) => setAddr('line1', e.target.value)} />}</Field>
        <Field label="Locality">{(id) => <Input id={id} value={f.address.locality} onChange={(e) => setAddr('locality', e.target.value)} />}</Field>
        <Field label="City">{(id) => <Input id={id} value={f.address.city} onChange={(e) => setAddr('city', e.target.value)} />}</Field>
        <Field label="PIN code">{(id) => <Input id={id} inputMode="numeric" maxLength={6} value={f.address.pincode} onChange={(e) => setAddr('pincode', e.target.value)} />}</Field>
        <div className="space-y-2 text-sm sm:col-span-2">
          <p>
            Pin:{' '}
            <strong className="num">{f.address.location.lat ? `${f.address.location.lat.toFixed(5)}, ${f.address.location.lng.toFixed(5)}` : 'not set'}</strong>
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() =>
                navigator.geolocation.getCurrentPosition(
                  (p) => setF((s) => ({ ...s, address: { ...s.address, location: { lat: p.coords.latitude, lng: p.coords.longitude } } })),
                  () => toast.error('Couldn’t read location'),
                )
              }
            >
              <Crosshair className="size-3.5" /> I’m at the restaurant
            </Button>
            {POPULAR_AREAS.map((a) => (
              <Button key={a.label} type="button" size="sm" variant="ghost" onClick={() => setF((s) => ({ ...s, address: { ...s.address, location: { lat: a.lat, lng: a.lng } } }))}>
                {a.label.split(',')[0]}
              </Button>
            ))}
          </div>
        </div>
      </section>

      <section className="card space-y-3 p-5">
        <h2 className="text-lg font-bold">Opening hours (IST)</h2>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="size-4 accent-[var(--color-brand-500)]" /> Open 24 hours (cloud kitchen)
        </label>
        {!allDay && (
          <div className="flex items-center gap-3 text-sm">
            <Input type="time" value={open} onChange={(e) => setOpen(e.target.value)} aria-label="Opens at" className="w-36" />
            to
            <Input type="time" value={close} onChange={(e) => setClose(e.target.value)} aria-label="Closes at" className="w-36" />
            <span className="text-muted">every day (closing after midnight is supported)</span>
          </div>
        )}
      </section>
      {error && <Notice tone="error">{error}</Notice>}
      <Button size="lg" onClick={() => save.mutate()} loading={save.isPending}>
        {isNew ? 'Submit for verification' : 'Save changes'}
      </Button>
    </div>
  );
}
