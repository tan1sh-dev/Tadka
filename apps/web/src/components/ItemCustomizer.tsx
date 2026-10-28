import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { Minus, Plus, ShieldAlert } from 'lucide-react';
import { ALLERGEN_LABELS, checkDietary, mergeDietaryFacts, type Allergen, type DietaryProfile } from '@tadka/shared';
import type { MenuItem } from '../lib/types';
import { inr } from '../lib/format';
import { Button, DietMark, Modal, Notice } from './ui';

export interface Customised {
  quantity: number;
  selections: { groupId: string; optionIds: string[] }[];
  optionsLabel: string;
  unitPrice: number;
}

export function ItemCustomizer({ item, profile, onClose, onAdd }: { item: MenuItem; profile: DietaryProfile | null; onClose: () => void; onAdd: (c: Customised) => void }) {
  const [picked, setPicked] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(item.optionGroups.map((g) => [g.id, g.min === 1 && g.max === 1 ? [g.options.find((o) => o.available)?.id ?? ''].filter(Boolean) : []])),
  );
  const [qty, setQty] = useState(1);

  const chosen = item.optionGroups.flatMap((g) => g.options.filter((o) => picked[g.id]?.includes(o.id)));
  const unitPrice = item.price + chosen.reduce((s, o) => s + o.price, 0);
  const problems = item.optionGroups.filter((g) => (picked[g.id]?.length ?? 0) < g.min).map((g) => `Choose ${g.min === g.max ? g.min : `at least ${g.min}`} in “${g.name}”`);

  // Live Dietary Guard: add-ons can change an item's diet/allergens.
  const guard = useMemo(() => {
    const facts = mergeDietaryFacts(
      { diet: item.diet, vegan: item.vegan, jainFriendly: item.jainFriendly, allergens: item.allergens as Allergen[] },
      chosen.map((o) => ({ diet: o.diet, allergens: (o.allergens ?? []) as Allergen[] })),
    );
    return checkDietary(profile, facts);
  }, [item, chosen, profile]);

  function toggle(groupId: string, optionId: string, max: number) {
    setPicked((p) => {
      const cur = p[groupId] ?? [];
      if (max === 1) return { ...p, [groupId]: [optionId] };
      if (cur.includes(optionId)) return { ...p, [groupId]: cur.filter((x) => x !== optionId) };
      if (cur.length >= max) return p;
      return { ...p, [groupId]: [...cur, optionId] };
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={item.name}
      footer={
        <div className="flex items-center gap-3">
          <div className="flex items-center rounded-xl border border-line-strong">
            <button className="grid size-10 place-items-center" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Decrease quantity">
              <Minus className="size-4" />
            </button>
            <span className="num w-8 text-center font-semibold" aria-live="polite">
              {qty}
            </span>
            <button className="grid size-10 place-items-center" onClick={() => setQty((q) => Math.min(20, q + 1))} aria-label="Increase quantity">
              <Plus className="size-4" />
            </button>
          </div>
          <Button
            block
            size="lg"
            disabled={problems.length > 0 || !guard.ok}
            onClick={() =>
              onAdd({
                quantity: qty,
                unitPrice,
                selections: Object.entries(picked).filter(([, v]) => v.length).map(([groupId, optionIds]) => ({ groupId, optionIds })),
                optionsLabel: chosen.map((o) => o.name).join(', '),
              })
            }
          >
            Add · {inr(unitPrice * qty)}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="flex items-start gap-2">
          <DietMark diet={item.diet} className="mt-1" />
          <p className="text-sm text-muted">{item.description}</p>
        </div>
        {item.allergens.length > 0 && (
          <p className="text-xs text-muted">
            Contains (declared by restaurant): {item.allergens.map((a) => ALLERGEN_LABELS[a as Allergen]).join(', ')}
          </p>
        )}
        {item.optionGroups.map((g) => (
          <fieldset key={g.id}>
            <legend className="mb-2 flex w-full items-baseline justify-between">
              <span className="font-semibold">{g.name}</span>
              <span className="text-xs text-muted">{g.min > 0 ? `Required · ${g.min === g.max ? `pick ${g.min}` : `pick ${g.min}–${g.max}`}` : `Optional · up to ${g.max}`}</span>
            </legend>
            <div className="space-y-1.5">
              {g.options.map((o) => {
                const on = picked[g.id]?.includes(o.id) ?? false;
                return (
                  <label key={o.id} className={clsx('flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5', on ? 'border-brand-500 bg-brand-50' : 'border-line', !o.available && 'cursor-not-allowed opacity-50')}>
                    <input
                      type={g.max === 1 ? 'radio' : 'checkbox'}
                      name={g.id}
                      checked={on}
                      disabled={!o.available}
                      onChange={() => toggle(g.id, o.id, g.max)}
                      className="size-4 accent-[var(--color-brand-500)]"
                    />
                    {o.diet && <DietMark diet={o.diet} />}
                    <span className="flex-1 text-sm">
                      {o.name}
                      {!o.available && ' (sold out)'}
                    </span>
                    <span className="num text-sm text-muted">{o.price ? `+ ${inr(o.price)}` : ''}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}
        {!guard.ok && (
          <Notice tone="error" title="Blocked by your Dietary Guard">
            <span className="inline-flex items-start gap-1.5">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> {guard.reasons.join(' · ')}. Change your selection or update your profile.
            </span>
          </Notice>
        )}
        {problems.length > 0 && <p className="text-xs font-medium text-brand-700">{problems[0]}</p>}
      </div>
    </Modal>
  );
}
