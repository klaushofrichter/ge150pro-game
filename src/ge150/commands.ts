// Command codes and message builders. See docs/protocol.md.
import { encodeMessage } from './frame.ts';
import { encodeModule, encodeName, encodePreset, type ModuleState, type Preset } from './preset.ts';

export const Cmd = {
  // host -> device
  REQUEST_SYSTEM: 0x31, // RequestDeviceSystemData -> 32, 11, 12
  REQUEST_ALL_PRESETS: 0xa0,
  REQUEST_IR_AMP_NAMES: 0xc1, // RequestIrAmpName
  REQUEST_RHYTHM: 0x8c, // RequestRhythmData -> 0C
  REQUEST_CURRENT: 0xb0,
  SELECT_PRESET: 0x96,
  RENAME_PRESET: 0x97,
  STORE_PRESET: 0xc3,
  FOCUS: 0xb4,
  SET_MODULE_BASE: 0x82, // + slot (0..8)
  // device -> host
  PRESET_DUMP: 0x20,
  CURRENT_PRESET: 0x30,
  PRESET_CHANGED: 0x16,
  STORE_ACK: 0x43,
  FOCUS_CHANGED: 0x34,
  MODULE_BASE: 0x02, // + slot (0..8)
} as const;

const one = (v: number) => Uint8Array.of(v);

/** The connect sequence, in order. */
export const handshake = (): Uint8Array[] => [
  requestSystem(),
  encodeMessage(Cmd.REQUEST_ALL_PRESETS, one(1)),
  encodeMessage(Cmd.REQUEST_IR_AMP_NAMES, one(1)),
  encodeMessage(Cmd.REQUEST_RHYTHM, one(1)),
  requestCurrent(),
];

/** RequestDeviceSystemData: answered with 32 (system), 12 (spill-over), 11 (global EQ), but only
 * during the connect sequence; later requests get no reply. */
export const requestSystem = () => encodeMessage(Cmd.REQUEST_SYSTEM, one(1));

/** RequestCurrentPresetData: answered with 30, 33, 18 and module reports 02-0A of the live state. */
export const requestCurrent = () => encodeMessage(Cmd.REQUEST_CURRENT, one(1));

export const selectPreset = (index: number) => encodeMessage(Cmd.SELECT_PRESET, one(index));

/** Real-time module update; not stored until storePreset. */
export const setModule = (slot: number, m: ModuleState) => encodeMessage(Cmd.SET_MODULE_BASE + slot, encodeModule(m));

export const renamePreset = (index: number, name: string) => {
  const p = new Uint8Array(17);
  p[0] = index;
  p.set(encodeName(name), 1);
  return encodeMessage(Cmd.RENAME_PRESET, p);
};

export const storePreset = (p: Preset) => encodeMessage(Cmd.STORE_PRESET, encodePreset(p));

export const isModuleReport = (cmd: number) => cmd >= Cmd.MODULE_BASE && cmd < Cmd.MODULE_BASE + 9;
