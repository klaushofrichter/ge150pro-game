import { describe, expect, it } from 'vitest';
import { crc16, encodeMessage, Reassembler, toReports } from '../src/ge150/frame.ts';
import { renamePreset, selectPreset, setModule } from '../src/ge150/commands.ts';
import { decodeModule, decodePreset, encodePreset, presetLabel, PRESET_BODY_BYTES } from '../src/ge150/preset.ts';
import { moToPreset, presetToMo } from '../src/ge150/mo.ts';
import { decodeRhythm, requestRhythm, styleName } from '../src/ge150/rhythm.ts';
import { handshake } from '../src/ge150/commands.ts';
import { catalog, formatValue, rawRange } from '../src/ge150/catalog.ts';
import { decodeExpReport, EXP_PARAMS, expLabel, setExpFunction, setExpVolume } from '../src/ge150/exp.ts';
import {
  decodeGlobalEq, decodeSpillOver, decodeSystem, decodeSystemChange, formatEq, GLOBAL_EQ_PARAMS, LEVEL_LABELS,
  setBrightness, setCabOut, setGlobalEq, setInputLevel as sysSetInputLevel, setLanguage, setOtgLevel, setSpillOver,
} from '../src/ge150/system.ts';

const hex = (s: string) => Uint8Array.from(s.replace(/\s+/g, '').match(/../g)!.map((b) => parseInt(b, 16)));
const toHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

// Byte streams observed from the official editor (captures/raw/session1.log, 2026-11-13).
const OBSERVED = {
  select1B: 'aa5502009602 8098',
  select2A: 'aa5502009605 f07f',
  focusAmp: 'aa550300b40800 babb',
  ampGain77: 'aa551900 84 0100 0600 4d00 4200 2800 2a00 5000 6400 0000 0000 0000 0000 a779',
  rename: 'aa551200 97 05 544553543031000000000000000000 00 2efe',
};

describe('frame', () => {
  it('reproduces the editor CRC for every observed message', () => {
    for (const s of Object.values(OBSERVED)) {
      const m = hex(s);
      const len = m[2] | (m[3] << 8);
      expect(crc16(m.subarray(2, 4 + len))).toBe((m[4 + len] << 8) | m[5 + len]);
    }
  });

  it('builds byte-identical commands', () => {
    expect(toHex(selectPreset(2))).toBe(OBSERVED.select1B.replace(/\s/g, ''));
    expect(toHex(selectPreset(5))).toBe(OBSERVED.select2A.replace(/\s/g, ''));
    expect(toHex(encodeMessage(0xb4, hex('0800')))).toBe(OBSERVED.focusAmp.replace(/\s/g, ''));
    expect(toHex(renamePreset(5, 'TEST01'))).toBe(OBSERVED.rename.replace(/\s/g, ''));
    const amp = { on: true, type: 6, values: [77, 66, 40, 42, 80, 100, 0, 0, 0, 0] };
    expect(toHex(setModule(2, amp))).toBe(OBSERVED.ampGain77.replace(/\s/g, ''));
  });

  it('chunks long messages into 63-byte report payloads and reassembles them', () => {
    const payload = new Uint8Array(PRESET_BODY_BYTES).map((_, i) => i & 0xff);
    const stream = encodeMessage(0xc3, payload);
    const reports = toReports(stream);
    // 6 framing bytes + 246 = 252 = 4 full chunks, as in the captured C3 store.
    expect(reports.map((r) => r[0])).toEqual([63, 63, 63, 63]);
    reports.forEach((r) => expect(r.length).toBe(64));
    const rx = new Reassembler();
    const msgs = reports.flatMap((r) => rx.push(r));
    expect(msgs).toHaveLength(1);
    expect(msgs[0].cmd).toBe(0xc3);
    expect(msgs[0].payload).toEqual(payload);
  });

  it('ignores stale bytes after the report length', () => {
    // Device input report observed with leftover bytes after n=8.
    const report = new Uint8Array(64);
    report.set(hex('08aa55020034085ace 0000ffffffff'));
    expect(new Reassembler().push(report)).toEqual([{ cmd: 0x34, payload: Uint8Array.of(8) }]);
  });
});

describe('system settings', () => {
  // Payloads observed in captures/raw/session2.log (2026-11-13).
  const payload = (m: Uint8Array) => toHex(m.subarray(5, m.length - 2));

  it('decodes the connect-time system, global EQ and spill-over reports', () => {
    expect(decodeSystem(hex('0900 1400 0100 0100 0900 0100'))).toEqual({
      inputLevel: 9, brightness: 20, cabLeft: true, cabRight: true, otgLevel: 9, language: 1,
    });
    const eq = decodeGlobalEq(hex('0000 dd27 2000 0000 2000 0000 2000 0000 0000'));
    expect(eq.on).toBe(false);
    expect(GLOBAL_EQ_PARAMS.map((p, i) => formatEq(p, eq.values[i]))).toEqual([
      '10235 Hz', '0.0 dB', '30 Hz', '0.0 dB', '30 Hz', '0.0 dB', 'OFF', 'OFF',
    ]);
    expect(decodeSpillOver(hex('0000'))).toBe(false);
    expect(LEVEL_LABELS[9]).toBe('0 dB');
  });

  it('decodes changes made on the pedal (24 = input-level knob, observed 2026-11-13)', () => {
    expect([hex('0a00'), hex('0900'), hex('0800')].map((p) => decodeSystemChange(0x24, p))).toEqual([
      { inputLevel: 10 }, { inputLevel: 9 }, { inputLevel: 8 },
    ]);
    expect(decodeSystemChange(0x26, hex('00000100'))).toEqual({ cabLeft: false, cabRight: true });
    expect(decodeSystemChange(0x34, hex('0800'))).toBeNull();
  });

  it('builds the observed setter payloads', () => {
    expect(payload(sysSetInputLevel(10))).toBe('0a00');
    expect(payload(setBrightness(19))).toBe('1300');
    expect(payload(setCabOut(false, true))).toBe('00000100');
    expect(payload(setOtgLevel(10))).toBe('0a00');
    expect(payload(setLanguage(0))).toBe('0000');
    expect(payload(setSpillOver(true))).toBe('0100');
    const on = { on: true, values: [0x27dd, 0x20, 0, 0x20, 0, 0x20, 0, 0] };
    expect(payload(setGlobalEq(on))).toBe('0100dd27200000002000000020000000' + '0000');
    expect([0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xd2].map((c) => c)).toEqual([
      sysSetInputLevel(0)[4], setBrightness(0)[4], setCabOut(true, true)[4], setOtgLevel(0)[4], setLanguage(0)[4], setSpillOver(false)[4],
    ]);
  });
});

describe('preset', () => {
  it('decodes module state as uint16 LE switch, type, values', () => {
    const m = decodeModule(hex('0100 0600 4d00 4200 2800 2a00 5000 6400 0000 0000 0000 0000'));
    expect(m).toEqual({ on: true, type: 6, values: [77, 66, 40, 42, 80, 100, 0, 0, 0, 0] });
  });

  it('round-trips a preset body and .mo conversion', () => {
    const body = new Uint8Array(PRESET_BODY_BYTES);
    body[0] = 5;
    body.set(new TextEncoder().encode('TEST01'), 1);
    const p0 = decodePreset(body);
    p0.modules[2] = { on: true, type: 6, values: [77, 66, 40, 42, 80, 100, 0, 0, 0, 0] };
    p0.exp = { MODULE_CTRL: 6, PARA_CTRL: 43, FUN_SWITCH: 1, VOL_SWITCH: 1, VOL_MIN: 0, VOL_MAX: 100 };
    const p = decodePreset(encodePreset(p0));
    expect(p).toEqual(p0);
    const mo = presetToMo(p);
    expect(mo.effectModule['2'].Data.GAIN).toBe(77);
    expect(moToPreset(mo, 5)).toEqual(p);
  });

  it('round-trips non-ASCII name bytes (a dumped preset name starts with EB 91)', () => {
    const body = new Uint8Array(PRESET_BODY_BYTES);
    body.set([0xeb, 0x91, 0x34, 0x74, 0x79], 1);
    expect([...encodePreset(decodePreset(body)).subarray(1, 6)]).toEqual([0xeb, 0x91, 0x34, 0x74, 0x79]);
  });

  it('labels presets by bank and letter', () => {
    expect([1, 2, 5, 200].map(presetLabel)).toEqual(['1A', '1B', '2A', '50D']);
  });
});

describe('rhythm', () => {
  // 0C payloads observed in captures/raw/session4.log while the user changed the pedal's RHYTHM menu.
  it('decodes the drum machine report', () => {
    expect(decodeRhythm(hex('010000057800'))).toEqual({ playing: true, mode: 0, style: 0, volume: 5, bpm: 120 });
    expect(decodeRhythm(hex('010003087b00'))).toEqual({ playing: true, mode: 0, style: 3, volume: 8, bpm: 123 });
    expect(decodeRhythm(hex('000100087800'))).toEqual({ playing: false, mode: 1, style: 0, volume: 8, bpm: 120 });
  });

  it('names styles as the pedal shows them (style 3 = "8 BEAT 4" on the display)', () => {
    expect(styleName({ mode: 0, style: 3 })).toBe('8 BEAT 4');
    expect(styleName({ mode: 0, style: 39 })).toBe('TANGO');
    expect(styleName({ mode: 1, style: 2 })).toBe('METRO 3/4');
  });

  it('requests rhythm data as the editor does (8C 01)', () => {
    expect(toHex(requestRhythm())).toBe(toHex(handshake()[3]));
    expect(requestRhythm()[4]).toBe(0x8c);
  });
});

describe('expression pedal', () => {
  // captures/raw/session5.log (2026-11-13): connect reports and the editor's EXP panel.
  const exp = { MODULE_CTRL: 2, PARA_CTRL: 13, FUN_SWITCH: 1, VOL_SWITCH: 0, VOL_MIN: 0, VOL_MAX: 100 };

  it('decodes the connect-time reports', () => {
    expect(decodeExpReport(0x18, hex('06002b000100'))).toEqual({ MODULE_CTRL: 6, PARA_CTRL: 43, FUN_SWITCH: 1 });
    expect(decodeExpReport(0x33, hex('010000006400'))).toEqual({ VOL_SWITCH: 1, VOL_MIN: 0, VOL_MAX: 100 });
    expect(expLabel({ MODULE_CTRL: 6, PARA_CTRL: 43 })).toBe('MOD · MIX');
  });

  it('builds the observed 98 and B3 messages', () => {
    const payload = (m: Uint8Array) => toHex(m.subarray(5, m.length - 2));
    expect(payload(setExpFunction(exp))).toBe('02000d000100');
    expect(payload(setExpVolume(exp))).toBe('000000006400');
    expect(setExpFunction(exp)[4]).toBe(0x98);
    expect(setExpVolume(exp)[4]).toBe(0xb3);
  });

  it('starts each module at the parameter id the editor sent when switching modules', () => {
    expect(EXP_PARAMS.map((list) => list[0].id)).toEqual([0, 10, 13, 19, 21, 25, 39, 51, 57]);
  });
});

describe('parameter value encoding', () => {
  const param = (slot: number, model: string, name: string) =>
    catalog.slots[slot].models.find((m) => m.name === model)!.params.find((p) => p.name === name)!;

  it('stores delay times as milliseconds (pedal display, 2026-11-13: raw 1040 -> 4 digits, raw 960 -> 3 digits)', () => {
    const time = param(7, 'DUAL DELAY', 'TIME A');
    expect(rawRange(time)).toEqual([40, 2500]);
    expect(formatValue(time, 960)).toBe('960 ms');
  });

  it('offsets ranges that go negative', () => {
    const pitch = param(6, 'PITCH SHIFT', 'PITCH');
    expect(rawRange(pitch)).toEqual([0, 240]);
    expect(formatValue(pitch, 120)).toBe('0.0');
  });
});

describe('parameter positions', () => {
  const model = (slot: number, name: string) => catalog.slots[slot].models.find((m) => m.name === name)!;

  it('places values where the pedal reads them (webcam 2026-11-13, dumps vs .mo)', () => {
    const pos = (slot: number, name: string) => Object.fromEntries(model(slot, name).params.map((p) => [p.name, p.pos]));
    expect(pos(6, 'PHASER')).toEqual({ RATE: 0, LEVEL: 1, DEPTH: 3 });
    expect(pos(6, 'PITCH SHIFT')).toEqual({ PITCH: 5, MIX: 1, TONE: 2 });
    expect(pos(7, 'DYNAMIC')).toMatchObject({ TIME: 2, THRES: 6 });
    expect(pos(5, 'CUSTOM EQ')).toEqual({ GAIN1: 0, FREQ1: 6, GAIN2: 2, FREQ2: 7, GAIN3: 4, FREQ3: 8 });
  });

  it('round-trips .mo data through the shifted positions', () => {
    const body = new Uint8Array(PRESET_BODY_BYTES);
    body[0] = 7;
    const p = decodePreset(body);
    p.modules[6] = { on: false, type: model(6, 'PITCH SHIFT').index, values: [0, 61, 72, 0, 0, 150, 0, 0, 0, 0] };
    const mo = presetToMo(p);
    expect(mo.effectModule['6'].Data).toEqual({ PITCH: 150, MIX: 61, TONE: 72 });
    expect(moToPreset(mo, 7).modules[6]).toEqual(p.modules[6]);
  });
});
