// Preset and module codecs. Layout in docs/protocol.md.
import { readU16 as u16, writeU16 as putU16 } from './frame.ts';

export const SLOT_COUNT = 9;
export const PRESET_COUNT = 200;
export const NAME_LENGTH = 16;
export const MODULE_BYTES = 24;
export const PRESET_BODY_BYTES = 1 + NAME_LENGTH + SLOT_COUNT * MODULE_BYTES + 12; // 245

export interface ModuleState {
  on: boolean;
  type: number;
  /** Raw parameter values in catalog order (10 entries; unused ones are 0). */
  values: number[];
}

export interface ExpSettings {
  MODULE_CTRL: number;
  PARA_CTRL: number;
  FUN_SWITCH: number;
  VOL_SWITCH: number;
  VOL_MIN: number;
  VOL_MAX: number;
}

export const EXP_ORDER: (keyof ExpSettings)[] = ['MODULE_CTRL', 'PARA_CTRL', 'FUN_SWITCH', 'VOL_SWITCH', 'VOL_MIN', 'VOL_MAX'];

export interface Preset {
  /** 1-based device slot, 1..200. */
  index: number;
  name: string;
  modules: ModuleState[];
  exp: ExpSettings;
}

export function decodeModule(b: Uint8Array, off = 0): ModuleState {
  const values: number[] = [];
  for (let i = 0; i < 10; i++) values.push(u16(b, off + 4 + i * 2));
  return { on: u16(b, off) === 1, type: u16(b, off + 2), values };
}

export function encodeModule(m: ModuleState): Uint8Array {
  const b = new Uint8Array(MODULE_BYTES);
  putU16(b, 0, m.on ? 1 : 0);
  putU16(b, 2, m.type);
  m.values.slice(0, 10).forEach((v, i) => putU16(b, 4 + i * 2, v));
  return b;
}

export function decodePreset(body: Uint8Array): Preset {
  if (body.length < PRESET_BODY_BYTES) throw new Error(`preset body too short: ${body.length}`);
  const nameBytes = body.subarray(1, 1 + NAME_LENGTH);
  const end = nameBytes.indexOf(0);
  const name = String.fromCharCode(...(end < 0 ? nameBytes : nameBytes.subarray(0, end)));
  const modules: ModuleState[] = [];
  for (let s = 0; s < SLOT_COUNT; s++) modules.push(decodeModule(body, 17 + s * MODULE_BYTES));
  const expOff = 17 + SLOT_COUNT * MODULE_BYTES;
  const exp = Object.fromEntries(EXP_ORDER.map((k, i) => [k, u16(body, expOff + i * 2)])) as unknown as ExpSettings;
  return { index: body[0], name, modules, exp };
}

export function encodePreset(p: Preset): Uint8Array {
  const b = new Uint8Array(PRESET_BODY_BYTES);
  b[0] = p.index;
  b.set(encodeName(p.name), 1);
  p.modules.forEach((m, s) => b.set(encodeModule(m), 17 + s * MODULE_BYTES));
  const expOff = 17 + SLOT_COUNT * MODULE_BYTES;
  EXP_ORDER.forEach((k, i) => putU16(b, expOff + i * 2, p.exp[k]));
  return b;
}

/**
 * At most 16 bytes, NUL padded. decodePreset maps each name byte to the character with the same
 * code (U+0001..U+00FF), so this is its exact inverse: names round-trip byte for byte, including
 * non-ASCII bytes some presets carry. Characters above U+00FF (typed by the user) become '?'.
 */
export function encodeName(name: string): Uint8Array {
  const b = new Uint8Array(NAME_LENGTH);
  [...name].slice(0, NAME_LENGTH).forEach((ch, i) => {
    const c = ch.codePointAt(0)!;
    b[i] = c > 0 && c <= 0xff ? c : 0x3f;
  });
  return b;
}

/** Bank/letter label for a 1-based preset index, e.g. 5 -> "2A". */
export function presetLabel(index: number): string {
  const i = index - 1;
  return `${Math.floor(i / 4) + 1}${'ABCD'[i % 4]}`;
}
