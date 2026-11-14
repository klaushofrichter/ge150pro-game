import data from './catalog.json' with { type: 'json' };

/** `pos` is the index of the value in the module record (ModuleState.values). */
export type ParamSpec =
  | { name: string; pos: number; kind: 'range'; min: number; max: number; step: number; decimals: number; unit: string }
  | { name: string; pos: number; kind: 'enum'; options: string[] };

export interface Model {
  index: number;
  name: string;
  params: ParamSpec[];
}

export interface SlotCatalog {
  name: string;
  models: Model[];
}

export const catalog = data as { source: string; slots: SlotCatalog[] };

/**
 * Wire encoding of range parameters: raw = (value - offset) / step, where offset = min only when the
 * range goes negative (raw is unsigned). Ranges starting above zero are stored as the value itself:
 * DELAY TIME 40..2500 ms has raw 40..2500 (verified on the pedal's display, docs/protocol).
 */
const offset = (p: ParamSpec & { kind: 'range' }) => (p.min < 0 ? p.min : 0);

/** Valid raw values of a parameter, inclusive. */
export function rawRange(p: ParamSpec): [number, number] {
  if (p.kind === 'enum') return [0, p.options.length - 1];
  const o = offset(p);
  return [Math.round((p.min - o) / p.step), Math.round((p.max - o) / p.step)];
}

/** Position of a raw value within its range, 0..1 (for slider fills and meters). */
export function rawFraction(p: ParamSpec, raw: number): number {
  const [lo, hi] = rawRange(p);
  return hi > lo ? Math.max(0, Math.min(1, (raw - lo) / (hi - lo))) : 0;
}

/** Display a raw value. */
export function formatValue(p: ParamSpec, raw: number): string {
  if (p.kind === 'enum') return p.options[raw] ?? String(raw);
  const v = offset(p) + raw * p.step;
  return `${v.toFixed(p.decimals)}${p.unit ? ' ' + p.unit : ''}`;
}

export function model(slot: number, type: number): Model | undefined {
  return catalog.slots[slot]?.models[type];
}
