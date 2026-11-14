import { describe, expect, it } from 'vitest';
import { crc16, encodeMessage, packU16, readU16, Reassembler, toReports } from '../src/ge150/frame.ts';
import { handshake, selectPreset, setModule } from '../src/ge150/commands.ts';
import { decodeModule, decodePreset, encodePreset, presetLabel, PRESET_BODY_BYTES } from '../src/ge150/preset.ts';
import { decodeRhythm, requestRhythm, styleName } from '../src/ge150/rhythm.ts';
import { catalog, formatValue, rawRange } from '../src/ge150/catalog.ts';
import { decodeExpReport, EXP_PARAMS, expLabel, expTarget } from '../src/ge150/exp.ts';

const hex = (s: string) => Uint8Array.from(s.replace(/\s+/g, '').match(/../g)!.map((b) => parseInt(b, 16)));
const toHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

// Byte streams as the pedal's editor sends them (recorded 2026-11-13).
const OBSERVED = {
  select1B: 'aa5502009602 8098',
  select2A: 'aa5502009605 f07f',
  focusAmp: 'aa550300b40800 babb',
  ampGain77: 'aa551900 84 0100 0600 4d00 4200 2800 2a00 5000 6400 0000 0000 0000 0000 a779',
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

  it('drops a message with a bad CRC and keeps the next one in the same report', () => {
    const good = encodeMessage(0x16, Uint8Array.of(9));
    const bad = encodeMessage(0x16, Uint8Array.of(5));
    bad[bad.length - 1] ^= 0xff;
    const stream = new Uint8Array([...bad, ...good]);
    const rx = new Reassembler();
    const msgs = toReports(stream).flatMap((r) => rx.push(r));
    expect(msgs).toEqual([{ cmd: 0x16, payload: Uint8Array.of(9) }]);
    expect(rx.takeErrors().map((e) => e.message)).toEqual(['bad CRC for cmd 0x16']);
    expect(rx.takeErrors()).toEqual([]);
  });

  it('reads and writes uint16 little-endian', () => {
    expect(toHex(packU16(1, 0x0102, 0xffff))).toBe('01000201ffff');
    expect(readU16(hex('3412'), 0)).toBe(0x1234);
  });

  it('ignores stale bytes after the report length', () => {
    // Device input report observed with leftover bytes after n=8.
    const report = new Uint8Array(64);
    report.set(hex('08aa55020034085ace 0000ffffffff'));
    expect(new Reassembler().push(report)).toEqual([{ cmd: 0x34, payload: Uint8Array.of(8) }]);
  });
});

describe('preset', () => {
  it('decodes module state as uint16 LE switch, type, values', () => {
    const m = decodeModule(hex('0100 0600 4d00 4200 2800 2a00 5000 6400 0000 0000 0000 0000'));
    expect(m).toEqual({ on: true, type: 6, values: [77, 66, 40, 42, 80, 100, 0, 0, 0, 0] });
  });

  it('round-trips a preset body', () => {
    const body = new Uint8Array(PRESET_BODY_BYTES);
    body[0] = 5;
    body.set(new TextEncoder().encode('TEST01'), 1);
    const p0 = decodePreset(body);
    p0.modules[2] = { on: true, type: 6, values: [77, 66, 40, 42, 80, 100, 0, 0, 0, 0] };
    p0.exp = { MODULE_CTRL: 6, PARA_CTRL: 43, FUN_SWITCH: 1, VOL_SWITCH: 1, VOL_MIN: 0, VOL_MAX: 100 };
    const p = decodePreset(encodePreset(p0));
    expect(p).toEqual(p0);
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
  // 0C payloads recorded while the pedal's RHYTHM menu was changed.
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
  // Connect reports and EXP settings as recorded on 2026-11-13.
  const exp = { MODULE_CTRL: 2, PARA_CTRL: 13, FUN_SWITCH: 1, VOL_SWITCH: 0, VOL_MIN: 0, VOL_MAX: 100 };

  it('decodes the connect-time reports', () => {
    expect(decodeExpReport(0x18, hex('06002b000100'))).toEqual({ MODULE_CTRL: 6, PARA_CTRL: 43, FUN_SWITCH: 1 });
    expect(decodeExpReport(0x33, hex('010000006400'))).toEqual({ VOL_SWITCH: 1, VOL_MIN: 0, VOL_MAX: 100 });
    expect(expLabel({ MODULE_CTRL: 6, PARA_CTRL: 43 })).toBe('MOD · MIX');
  });

  it("finds the controlled parameter in the module's current model, also where the catalog spells it differently", () => {
    const mod = catalog.slots[6].models.find((m) => m.name === 'JET-FLANGER')!;
    expect(expTarget({ MODULE_CTRL: 6, PARA_CTRL: 46 }, mod.index)?.name).toBe('F.BACK');
    const amp = catalog.slots[2].models[6];
    expect(expTarget(exp, amp.index)?.name).toBe('GAIN');
    expect(expTarget({ MODULE_CTRL: 6, PARA_CTRL: 43 }, mod.index)?.name).toBe('MIX');
    expect(expTarget({ MODULE_CTRL: 6, PARA_CTRL: 40 }, mod.index)).toBeUndefined(); // the flanger has no PITCH
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

  it('places values where the pedal reads them', () => {
    const pos = (slot: number, name: string) => Object.fromEntries(model(slot, name).params.map((p) => [p.name, p.pos]));
    expect(pos(6, 'PHASER')).toEqual({ RATE: 0, LEVEL: 1, DEPTH: 3 });
    expect(pos(6, 'PITCH SHIFT')).toEqual({ PITCH: 5, MIX: 1, TONE: 2 });
    expect(pos(7, 'DYNAMIC')).toMatchObject({ TIME: 2, THRES: 6 });
    expect(pos(5, 'CUSTOM EQ')).toEqual({ GAIN1: 0, FREQ1: 6, GAIN2: 2, FREQ2: 7, GAIN3: 4, FREQ3: 8 });
  });

});
