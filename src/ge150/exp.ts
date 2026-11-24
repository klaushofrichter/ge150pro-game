// Expression pedal assignment, per preset. See docs/protocol.md.
import { model, type ParamSpec } from './catalog.ts';
import { encodeMessage, packU16, readU16 } from './frame.ts';
import type { ExpSettings, ModuleState } from './preset.ts';

export const ExpCmd = {
  /** MODULE_CTRL, PARA_CTRL, FUN_SWITCH (u16 LE each). */
  FUNCTION: 0x18,
  /** The same three, from the host: what the official editor sends when its EXP target changes (E-027). */
  SET_FUNCTION: 0x98,
  /** VOL_SWITCH, VOL_MIN, VOL_MAX (u16 LE each). */
  VOLUME: 0x33,
} as const;

/** Modules in chain order, with the short names the pedal's EXP menu uses. */
const EXP_MODULES = ['FX', 'DS', 'AMP', 'CAB', 'NS', 'EQ', 'MOD', 'DLY', 'REV'] as const;

/**
 * Controllable parameters per module with their PARA_CTRL ids, in panel order.
 * Each id selects the same parameter name in every model of its module.
 */
export const EXP_PARAMS: { name: string; id: number }[][] = [
  [['POSITION', 0], ['Q', 1], ['RATE', 2], ['ATTACK', 3], ['RANGE', 4], ['SENS', 5], ['THRES', 6], ['PEAK', 7], ['RATIO', 8], ['LEVEL', 9], ['DEPTH', 100]],
  [['VOLUME', 10], ['TONE', 11], ['GAIN', 12]],
  [['GAIN', 13], ['BASS', 14], ['MID', 15], ['TREBLE', 16], ['PRES', 17], ['MST', 18]],
  [['CENTER', 19], ['DISTANCE', 20]],
  [['THRES', 21], ['SENS', 22], ['ATTACK', 23], ['RELEASE', 24]],
  [['80HZ', 25], ['100HZ', 26], ['200HZ', 27], ['240HZ', 28], ['250HZ', 29], ['400HZ', 30], ['630HZ', 31], ['750HZ', 32], ['800HZ', 33], ['1.6KHZ', 34], ['2.2KHZ', 35], ['3.2KHZ', 36], ['4KHZ', 37], ['6.6KHZ', 38]],
  [['RATE', 39], ['PITCH', 40], ['RISE', 41], ['SAMPLE', 42], ['MIX', 43], ['DEPTH', 44], ['LEVEL', 45], ['F.BACK', 46], ['TONE', 47], ['Q', 48], ['RANGE', 49], ['BIT', 50],
    ['DELAY', 101], ['SPEED', 102], ['INTENSITY', 103], ['SUB', 104], ['SUB TONE', 105], ['UPPER', 106], ['UPPER TONE', 107], ['DRY', 108]],
  [['LEVEL', 51], ['F.BACK', 52], ['TIME', 53], ['TIME A', 54], ['THRES', 55], ['TIME B', 56]],
  [['P.DELAY', 57], ['LEVEL', 58], ['DECAY', 59], ['TONE', 60], ['SHIMMER', 109]],
].map((list) => (list as [string, number][]).map(([name, id]) => ({ name, id })));

/** "MOD · MIX" for the current assignment, or the raw ids if unknown. */
export function expLabel(e: Pick<ExpSettings, 'MODULE_CTRL' | 'PARA_CTRL'>): string {
  const mod = EXP_MODULES[e.MODULE_CTRL];
  const para = EXP_PARAMS[e.MODULE_CTRL]?.find((p) => p.id === e.PARA_CTRL);
  return mod && para ? `${mod} · ${para.name}` : `${e.MODULE_CTRL} / ${e.PARA_CTRL}`;
}

/** The EXP menu's name for a catalog parameter, where the two spell it differently. */
const EXP_NAME: Record<string, string> = { FEEDBACK: 'F.BACK' };

/** The PARA_CTRL id of a module's catalog parameter, if the expression pedal can control it (E-027). */
export function expParamId(slot: number, paramName: string): number | undefined {
  const name = EXP_NAME[paramName.toUpperCase()] ?? paramName.toUpperCase();
  return EXP_PARAMS[slot]?.find((p) => p.name === name)?.id;
}

/** The host's EXP assignment message (98): MODULE_CTRL, PARA_CTRL, FUN_SWITCH. */
export function setExpFunction(e: Pick<ExpSettings, 'MODULE_CTRL' | 'PARA_CTRL' | 'FUN_SWITCH'>): Uint8Array {
  return encodeMessage(ExpCmd.SET_FUNCTION, packU16(e.MODULE_CTRL, e.PARA_CTRL, e.FUN_SWITCH));
}

/** The catalog parameter the expression pedal controls in a module of model `type`, if that model has it. */
export function expTarget(e: Pick<ExpSettings, 'MODULE_CTRL' | 'PARA_CTRL'>, type: number): ParamSpec | undefined {
  const name = EXP_PARAMS[e.MODULE_CTRL]?.find((p) => p.id === e.PARA_CTRL)?.name;
  const params = model(e.MODULE_CTRL, type)?.params ?? [];
  return name ? params.find((p) => (EXP_NAME[p.name.toUpperCase()] ?? p.name.toUpperCase()) === name) : undefined;
}

/**
 * `modules` with the value the expression pedal moved put back to the stored one. The pedal's position, like its toe
 * switch (EXP or volume mode), is playing, not an edit: it neither marks the preset as changed nor gets stored.
 * Modules whose model differs from the stored one are left as they are.
 */
export function withoutPedalMove(e: Pick<ExpSettings, 'MODULE_CTRL' | 'PARA_CTRL'>, modules: ModuleState[], stored: ModuleState[]): ModuleState[] {
  const slot = e.MODULE_CTRL;
  const live = modules[slot], base = stored[slot];
  const spec = live && base && live.type === base.type ? expTarget(e, live.type) : undefined;
  if (!spec || live.values[spec.pos] === base.values[spec.pos]) return modules;
  return modules.with(slot, { ...live, values: live.values.with(spec.pos, base.values[spec.pos]) });
}

/** Decode a device report (18 or 33) into the part of ExpSettings it carries. */
export function decodeExpReport(cmd: number, p: Uint8Array): Partial<ExpSettings> | null {
  const [a, b, c] = [0, 2, 4].map((o) => readU16(p, o));
  if (cmd === ExpCmd.FUNCTION) return { MODULE_CTRL: a, PARA_CTRL: b, FUN_SWITCH: c };
  if (cmd === ExpCmd.VOLUME) return { VOL_SWITCH: a, VOL_MIN: b, VOL_MAX: c };
  return null;
}
