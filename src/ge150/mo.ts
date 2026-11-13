// Conversion between device presets and the official editor's .mo (JSON) files.
import { model } from './catalog.ts';
import { EXP_ORDER, SLOT_COUNT, type ExpSettings, type ModuleState, type Preset } from './preset.ts';

export interface MoFile {
  Exp: Record<string, number>;
  effectModule: Record<string, { Data: Record<string, number>; SWITCH: number; TYPE: number }>;
  fileInfo: Record<string, string>;
}

export function presetToMo(p: Preset): MoFile {
  const effectModule: MoFile['effectModule'] = {};
  p.modules.forEach((m, slot) => {
    const params = model(slot, m.type)?.params ?? [];
    effectModule[String(slot)] = {
      Data: Object.fromEntries(params.map((spec) => [spec.name, m.values[spec.pos] ?? 0])),
      SWITCH: m.on ? 1 : 0,
      TYPE: m.type,
    };
  });
  return {
    Exp: { ...p.exp },
    effectModule,
    fileInfo: {
      app: 'GE150PRO Edit',
      app_version: 'V1.0.1',
      device: 'GE150PRO',
      device_version: 'V1.0.0', // value used by every file in the reference library
      preset_name: p.name,
      schema: 'GE150PRO Preset',
    },
  };
}

/** Parse a numbered-schema (V1.0.1) .mo file into a preset for the given slot. */
export function moToPreset(mo: MoFile, index: number): Preset {
  if (mo.fileInfo?.device !== 'GE150PRO') throw new Error('not a GE150PRO preset file');
  const modules: ModuleState[] = [];
  for (let slot = 0; slot < SLOT_COUNT; slot++) {
    const m = mo.effectModule?.[String(slot)];
    if (!m) throw new Error(`missing module slot ${slot} (only the numbered V1.0.1 schema is supported)`);
    const params = model(slot, m.TYPE)?.params;
    if (!params) throw new Error(`slot ${slot}: unknown TYPE ${m.TYPE}`);
    const values = Array<number>(10).fill(0);
    for (const spec of params) values[spec.pos] = m.Data[spec.name] ?? 0;
    modules.push({ on: m.SWITCH === 1, type: m.TYPE, values });
  }
  const exp = Object.fromEntries(EXP_ORDER.map((k) => [k, mo.Exp?.[k] ?? 0])) as unknown as ExpSettings;
  return { index, name: (mo.fileInfo.preset_name ?? '').slice(0, 16), modules, exp };
}
