import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
import { ALLERGEN_LABELS, ALLERGENS, menuItemSchema, type Allergen, type ItemDiet } from '@tadka/shared';
import { api } from '../../lib/api';
import { errorMessage, inr } from '../../lib/format';
import type { OptionGroup } from '../../lib/types';
import { Badge, Button, DietMark, EmptyState, ErrorState, Field, Input, Modal, Notice, PageHeader, Select, Spinner, Textarea, Toggle, toast } from '../../components/ui';

interface MItem {
  id: string;
  categoryId: string;
  name: string;
  description: string;
  price: number;
  diet: ItemDiet;
  vegan: boolean;
  jainFriendly: boolean;
  allergens: Allergen[];
  spiceLevel: number;
  tags: string[];
  imageUrl: string;
  available: boolean;
  isBestseller: boolean;
  optionGroups: OptionGroup[];
}

export function RestaurantMenuPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['merchant', 'menu'], queryFn: () => api<{ categories: { id: string; name: string; sortOrder: number }[]; items: MItem[] }>('/merchant/menu') });
  const [editing, setEditing] = useState<MItem | 'new' | null>(null);
  const [catName, setCatName] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['merchant', 'menu'] });
  const avail = useMutation({
    mutationFn: ({ id, available }: { id: string; available: boolean }) => api(`/merchant/items/${id}/availability`, { method: 'PATCH', body: { available } }),
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const addCat = useMutation({
    mutationFn: () => api('/merchant/categories', { method: 'POST', body: { name: catName, sortOrder: q.data?.categories.length ?? 0 } }),
    onSuccess: () => {
      setCatName('');
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const delCat = useMutation({ mutationFn: (id: string) => api(`/merchant/categories/${id}`, { method: 'DELETE' }), onSuccess: refresh, onError: (e) => toast.error(errorMessage(e)) });

  if (q.isError) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  if (!q.data) return <Spinner />;
  const { categories, items } = q.data;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Menu"
        sub="Mark dishes sold out the moment they run out. Customers see availability instantly."
        actions={
          <Button onClick={() => setEditing('new')} disabled={!categories.length}>
            <Plus className="size-4" /> Add dish
          </Button>
        }
      />
      <form
        className="flex max-w-md gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (catName.trim()) addCat.mutate();
        }}
      >
        <Input value={catName} onChange={(e) => setCatName(e.target.value)} placeholder="New category, e.g. Starters" aria-label="New category name" />
        <Button type="submit" variant="secondary" loading={addCat.isPending}>
          Add category
        </Button>
      </form>
      {categories.length === 0 && <EmptyState title="Start with a category" body="Create categories like “Starters” or “Biryani”, then add dishes to them." />}
      {categories.map((c) => {
        const list = items.filter((i) => i.categoryId === c.id);
        return (
          <section key={c.id} className="card overflow-hidden">
            <header className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 className="font-bold">
                {c.name} <span className="text-sm font-normal text-muted">({list.length})</span>
              </h2>
              {list.length === 0 && (
                <button onClick={() => delCat.mutate(c.id)} className="text-xs font-semibold text-chili-600 hover:underline">
                  Delete category
                </button>
              )}
            </header>
            <ul className="divide-y divide-line">
              {list.map((it) => (
                <li key={it.id} className={clsx('flex items-center gap-3 px-4 py-3', !it.available && 'bg-paper')}>
                  <DietMark diet={it.diet} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {it.name} {it.isBestseller && <Badge tone="brand">Bestseller</Badge>}
                    </p>
                    <p className="num text-xs text-muted">
                      {inr(it.price)}
                      {it.optionGroups.length > 0 && ` · ${it.optionGroups.length} customisation group${it.optionGroups.length > 1 ? 's' : ''}`}
                      {it.allergens.length > 0 && ` · ${it.allergens.map((a) => ALLERGEN_LABELS[a]).join(', ')}`}
                    </p>
                  </div>
                  <span className={clsx('hidden text-xs font-semibold sm:block', it.available ? 'text-leaf-700' : 'text-muted')}>{it.available ? 'In stock' : 'Sold out'}</span>
                  <Toggle checked={it.available} onChange={(v) => avail.mutate({ id: it.id, available: v })} label={`${it.name} available`} />
                  <button onClick={() => setEditing(it)} className="grid size-9 place-items-center rounded-lg hover:bg-ink/5" aria-label={`Edit ${it.name}`}>
                    <Pencil className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {editing && <ItemEditor item={editing === 'new' ? null : editing} categories={categories} onClose={() => setEditing(null)} onSaved={refresh} />}
    </div>
  );
}

const blankGroup = (): OptionGroup => ({ id: `g${Date.now().toString(36)}`, name: '', min: 0, max: 1, options: [{ id: 'o1', name: '', price: 0, available: true }] });

function ItemEditor({ item, categories, onClose, onSaved }: { item: MItem | null; categories: { id: string; name: string }[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState(() => ({
    categoryId: item?.categoryId ?? categories[0]?.id ?? '',
    name: item?.name ?? '',
    description: item?.description ?? '',
    price: item ? String(item.price / 100) : '',
    diet: item?.diet ?? ('veg' as ItemDiet),
    vegan: item?.vegan ?? false,
    jainFriendly: item?.jainFriendly ?? false,
    allergens: item?.allergens ?? ([] as Allergen[]),
    spiceLevel: item?.spiceLevel ?? 0,
    tags: item?.tags.join(', ') ?? '',
    imageUrl: item?.imageUrl ?? '',
    available: item?.available ?? true,
    isBestseller: item?.isBestseller ?? false,
    optionGroups: item?.optionGroups ?? ([] as OptionGroup[]),
  }));
  const [error, setError] = useState('');
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));

  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...f,
        price: Math.round(Number(f.price) * 100),
        tags: f.tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean),
        optionGroups: f.optionGroups.map((g) => ({ ...g, options: g.options.map((o) => ({ ...o, price: Math.round(Number(o.price)) })) })),
      };
      const v = menuItemSchema.safeParse(body);
      if (!v.success) {
        const i = v.error.issues[0];
        throw new Error(`${i.path.join(' › ') || 'Form'}: ${i.message}`);
      }
      return item ? api(`/merchant/items/${item.id}`, { method: 'PUT', body }) : api('/merchant/items', { method: 'POST', body });
    },
    onSuccess: () => {
      toast.success('Dish saved');
      onSaved();
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const del = useMutation({
    mutationFn: () => api(`/merchant/items/${item!.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });

  const updGroup = (gi: number, patch: Partial<OptionGroup>) => set('optionGroups', f.optionGroups.map((g, i) => (i === gi ? { ...g, ...patch } : g)));

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={item ? `Edit ${item.name}` : 'Add a dish'}
      footer={
        <div className="flex items-center gap-2">
          {item && (
            <Button variant="ghost" className="text-chili-600" onClick={() => del.mutate()} loading={del.isPending}>
              <Trash2 className="size-4" /> Delete
            </Button>
          )}
          <Button className="ml-auto" onClick={() => save.mutate()} loading={save.isPending}>
            Save dish
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">{(id) => <Input id={id} value={f.name} onChange={(e) => set('name', e.target.value)} />}</Field>
          <Field label="Category">
            {(id) => (
              <Select id={id} value={f.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Price (₹)">{(id) => <Input id={id} inputMode="decimal" value={f.price} onChange={(e) => set('price', e.target.value)} />}</Field>
          <Field label="Diet">
            {(id) => (
              <Select id={id} value={f.diet} onChange={(e) => set('diet', e.target.value as ItemDiet)}>
                <option value="veg">Vegetarian</option>
                <option value="egg">Contains egg</option>
                <option value="nonveg">Non-vegetarian</option>
              </Select>
            )}
          </Field>
        </div>
        <Field label="Description">{(id) => <Textarea id={id} value={f.description} maxLength={300} onChange={(e) => set('description', e.target.value)} />}</Field>
        <div className="flex flex-wrap gap-5 text-sm">
          {(
            [
              ['vegan', 'Vegan'],
              ['jainFriendly', 'Jain-friendly (no onion, garlic, root veg)'],
              ['isBestseller', 'Bestseller'],
              ['available', 'In stock'],
            ] as const
          ).map(([k, l]) => (
            <label key={k} className="flex items-center gap-2">
              <input type="checkbox" checked={f[k]} onChange={(e) => set(k, e.target.checked)} className="size-4 accent-[var(--color-brand-500)]" /> {l}
            </label>
          ))}
        </div>
        <div>
          <p className="mb-2 text-sm font-semibold">Allergens present</p>
          <div className="flex flex-wrap gap-2">
            {ALLERGENS.map((a) => {
              const on = f.allergens.includes(a);
              return (
                <button key={a} type="button" aria-pressed={on} onClick={() => set('allergens', on ? f.allergens.filter((x) => x !== a) : [...f.allergens, a])} className={clsx('rounded-full border px-3 py-1 text-xs font-semibold', on ? 'border-chili-600 bg-chili-50 text-chili-600' : 'border-line-strong')}>
                  {ALLERGEN_LABELS[a]}
                </button>
              );
            })}
          </div>
          <p className="mt-1 text-xs text-muted">Customers with allergies rely on this. When unsure, mark it.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Spice level (0–3)">{(id) => <Input id={id} type="number" min={0} max={3} value={f.spiceLevel} onChange={(e) => set('spiceLevel', Number(e.target.value))} />}</Field>
          <Field label="Tags" hint="comma separated: spicy, healthy…">{(id, d) => <Input id={id} aria-describedby={d} value={f.tags} onChange={(e) => set('tags', e.target.value)} />}</Field>
          <Field label="Image URL (https)">{(id) => <Input id={id} value={f.imageUrl} onChange={(e) => set('imageUrl', e.target.value)} />}</Field>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Customisations</p>
            <Button type="button" size="sm" variant="secondary" onClick={() => set('optionGroups', [...f.optionGroups, blankGroup()])}>
              <Plus className="size-3.5" /> Add group
            </Button>
          </div>
          {f.optionGroups.map((g, gi) => (
            <div key={g.id} className="space-y-2 rounded-xl border border-line p-3">
              <div className="flex gap-2">
                <Input value={g.name} onChange={(e) => updGroup(gi, { name: e.target.value })} placeholder="Group name, e.g. Portion" aria-label="Group name" />
                <Input type="number" min={0} className="w-20" value={g.min} onChange={(e) => updGroup(gi, { min: Number(e.target.value) })} aria-label="Minimum choices" title="Min" />
                <Input type="number" min={1} className="w-20" value={g.max} onChange={(e) => updGroup(gi, { max: Number(e.target.value) })} aria-label="Maximum choices" title="Max" />
                <button type="button" onClick={() => set('optionGroups', f.optionGroups.filter((_, i) => i !== gi))} aria-label="Remove group" className="grid size-11 shrink-0 place-items-center rounded-lg hover:bg-chili-50">
                  <X className="size-4" />
                </button>
              </div>
              {g.options.map((o, oi) => (
                <div key={oi} className="flex gap-2 pl-3">
                  <Input value={o.name} onChange={(e) => updGroup(gi, { options: g.options.map((x, i) => (i === oi ? { ...x, name: e.target.value } : x)) })} placeholder="Option name" aria-label="Option name" />
                  <Input
                    className="w-28"
                    inputMode="decimal"
                    value={o.price / 100}
                    onChange={(e) => updGroup(gi, { options: g.options.map((x, i) => (i === oi ? { ...x, price: Math.round(Number(e.target.value) * 100) } : x)) })}
                    aria-label="Extra price in rupees"
                    title="+ ₹"
                  />
                  <Select className="w-32" value={o.diet ?? ''} onChange={(e) => updGroup(gi, { options: g.options.map((x, i) => (i === oi ? { ...x, diet: (e.target.value || undefined) as ItemDiet | undefined } : x)) })} aria-label="Option diet">
                    <option value="">same diet</option>
                    <option value="egg">egg</option>
                    <option value="nonveg">non-veg</option>
                  </Select>
                </div>
              ))}
              <button type="button" className="pl-3 text-xs font-semibold text-brand-700" onClick={() => updGroup(gi, { options: [...g.options, { id: `o${g.options.length + 1}${Date.now().toString(36).slice(-3)}`, name: '', price: 0, available: true }] })}>
                + Add option
              </button>
            </div>
          ))}
        </div>
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Modal>
  );
}
