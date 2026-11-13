// System settings. Evidence: captures/raw/session2.log (2026-11-13) and Setting::dataInit /
// Setting::inputLevelInit / Setting::screenInit in the official editor. See docs/protocol/README.md.
import { encodeMessage } from './frame.ts';

/** Level labels for INPUT LEVEL and OTG LEVEL, indexed by raw value (Setting::inputLevelInit). */
export const LEVEL_LABELS = [
  '-∞ dB', '-60 dB', '-45 dB', '-35 dB', '-30 dB', '-25 dB', '-20 dB', '-10 dB', '-5 dB', '0 dB',
  '0.5 dB', '1.0 dB', '1.5 dB', '2.0 dB', '2.5 dB', '3.0 dB', '3.5 dB', '4.0 dB', '4.5 dB', '5.0 dB', '5.5 dB', '6.0 dB',
];
export const BRIGHTNESS_MAX = 20;

export interface SystemSettings {
  inputLevel: number;
  brightness: number;
  cabLeft: boolean;
  cabRight: boolean;
  otgLevel: number;
  /** Pedal display language: 0 = Chinese, 1 = English. */
  language: number;
}

/** Global EQ in wire order (9 × uint16 after the 0x11 / 0xD1 command byte). */
export interface GlobalEq {
  on: boolean;
  /** Raw values in GLOBAL_EQ_PARAMS order. */
  values: number[];
}

export interface EqParam {
  name: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  /** Raw 0 means OFF (cut filters). Inferred from the editor showing OFF at raw 0. */
  zeroIsOff?: boolean;
}

/** From the range table built in Setting::dataInit: raw = (value - min) / step. */
export const GLOBAL_EQ_PARAMS: EqParam[] = [
  { name: 'LOW FREQ', min: 30, max: 18000, step: 1, unit: 'Hz' },
  { name: 'LOW GAIN', min: -16, max: 16, step: 0.5, unit: 'dB' },
  { name: 'MID FREQ', min: 30, max: 18000, step: 1, unit: 'Hz' },
  { name: 'MID GAIN', min: -16, max: 16, step: 0.5, unit: 'dB' },
  { name: 'HIGH FREQ', min: 30, max: 18000, step: 1, unit: 'Hz' },
  { name: 'HIGH GAIN', min: -16, max: 16, step: 0.5, unit: 'dB' },
  { name: 'LOW CUT', min: 0, max: 800, step: 1, unit: 'Hz', zeroIsOff: true },
  { name: 'HIGH CUT', min: 0, max: 19001, step: 1, unit: 'Hz', zeroIsOff: true },
];

export const eqRawMax = (p: EqParam) => Math.round((p.max - p.min) / p.step);

export function formatEq(p: EqParam, raw: number): string {
  if (p.zeroIsOff && raw === 0) return 'OFF';
  const v = p.min + raw * p.step;
  return `${p.step < 1 ? v.toFixed(1) : v} ${p.unit}`;
}

const u16s = (b: Uint8Array, n: number) => Array.from({ length: n }, (_, i) => b[2 * i] | (b[2 * i + 1] << 8));
const pack = (...vals: number[]) => {
  const b = new Uint8Array(vals.length * 2);
  vals.forEach((v, i) => {
    b[2 * i] = v & 0xff;
    b[2 * i + 1] = (v >> 8) & 0xff;
  });
  return b;
};

export const SysCmd = {
  // device -> host (connect sequence)
  SYSTEM: 0x32,
  GLOBAL_EQ: 0x11,
  SPILL_OVER: 0x12,
  // host -> device
  SET_INPUT_LEVEL: 0xa4,
  SET_BRIGHTNESS: 0xa5,
  SET_CAB_OUT: 0xa6,
  SET_OTG_LEVEL: 0xa7,
  SET_LANGUAGE: 0xa8,
  SET_GLOBAL_EQ: 0xd1,
  SET_SPILL_OVER: 0xd2,
} as const;

export function decodeSystem(p: Uint8Array): SystemSettings {
  const [inputLevel, brightness, l, r, otgLevel, language] = u16s(p, 6);
  return { inputLevel, brightness, cabLeft: l === 1, cabRight: r === 1, otgLevel, language };
}

export function decodeGlobalEq(p: Uint8Array): GlobalEq {
  const [on, ...values] = u16s(p, 9);
  return { on: on === 1, values };
}

export const decodeSpillOver = (p: Uint8Array) => u16s(p, 1)[0] === 1;

/**
 * Device -> host change reports: the pedal echoes a setting changed on its own controls
 * with the setter code minus 0x80 and the same payload. 0x24 is observed (input-level knob);
 * the others are inferred from that pattern and the module reports (0x82 -> 0x02).
 */
export const SYSTEM_CHANGE_CMDS = [0x24, 0x25, 0x26, 0x27, 0x28] as const;

export function decodeSystemChange(cmd: number, p: Uint8Array): Partial<SystemSettings> | null {
  switch (cmd) {
    case 0x24: return { inputLevel: u16s(p, 1)[0] };
    case 0x25: return { brightness: u16s(p, 1)[0] };
    case 0x26: {
      const [l, r] = u16s(p, 2);
      return { cabLeft: l === 1, cabRight: r === 1 };
    }
    case 0x27: return { otgLevel: u16s(p, 1)[0] };
    case 0x28: return { language: u16s(p, 1)[0] };
    default: return null;
  }
}

export const setInputLevel = (raw: number) => encodeMessage(SysCmd.SET_INPUT_LEVEL, pack(raw));
export const setBrightness = (v: number) => encodeMessage(SysCmd.SET_BRIGHTNESS, pack(v));
export const setCabOut = (left: boolean, right: boolean) => encodeMessage(SysCmd.SET_CAB_OUT, pack(+left, +right));
export const setOtgLevel = (raw: number) => encodeMessage(SysCmd.SET_OTG_LEVEL, pack(raw));
export const setLanguage = (lang: number) => encodeMessage(SysCmd.SET_LANGUAGE, pack(lang));
export const setGlobalEq = (eq: GlobalEq) => encodeMessage(SysCmd.SET_GLOBAL_EQ, pack(+eq.on, ...eq.values.slice(0, 8)));
export const setSpillOver = (on: boolean) => encodeMessage(SysCmd.SET_SPILL_OVER, pack(+on));
