// Command codes and message builders. See docs/protocol.md.
import { encodeMessage } from './frame.ts';
import { encodeModule, encodePreset, SLOT_COUNT, type ModuleState, type Preset } from './preset.ts';
import { requestRhythm } from './rhythm.ts';

export const Cmd = {
  // host -> device
  REQUEST_SYSTEM: 0x31,
  REQUEST_ALL_PRESETS: 0xa0,
  REQUEST_IR_NAMES: 0xc1,
  REQUEST_CURRENT: 0xb0,
  SELECT_PRESET: 0x96,
  STORE_PRESET: 0xc3,
  SET_MODULE_BASE: 0x82, // + slot (0..8)
  // device -> host
  SYSTEM: 0x32,
  SPILL_OVER: 0x12,
  GLOBAL_EQ: 0x11,
  PRESET_DUMP: 0x20,
  IR_NAMES: 0x41,
  IR_DATA: 0x4d,
  CURRENT_PRESET: 0x30,
  PRESET_CHANGED: 0x16,
  STORE_ACK: 0x43,
  MODULE_BASE: 0x02, // + slot (0..8)
} as const;

const one = (v: number) => Uint8Array.of(v);

/** The connect sequence, in order. */
export const handshake = (): Uint8Array[] => [
  encodeMessage(Cmd.REQUEST_SYSTEM, one(1)),
  encodeMessage(Cmd.REQUEST_ALL_PRESETS, one(1)),
  encodeMessage(Cmd.REQUEST_IR_NAMES, one(1)),
  requestRhythm(),
  requestCurrent(),
];

/** Answered with 30, 33, 18 and module reports 02-0A of the live state. */
export const requestCurrent = () => encodeMessage(Cmd.REQUEST_CURRENT, one(1));

export const selectPreset = (index: number) => encodeMessage(Cmd.SELECT_PRESET, one(index));

/** Real-time module update; not stored until storePreset. */
export const setModule = (slot: number, m: ModuleState) => encodeMessage(Cmd.SET_MODULE_BASE + slot, encodeModule(m));

export const storePreset = (p: Preset) => encodeMessage(Cmd.STORE_PRESET, encodePreset(p));

export const isModuleReport = (cmd: number) => cmd >= Cmd.MODULE_BASE && cmd < Cmd.MODULE_BASE + SLOT_COUNT;
