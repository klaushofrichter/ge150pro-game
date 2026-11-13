// Which firmware the game supports, checked from the pedal's own answers at connect.
//
// The firmware version number cannot be read over the HID control channel. Instead the game requires the protocol of
// the firmware it was built and tested on: every answer firmware V2.1.2 gives to the connect sequence, with its exact
// size. V2.1.4 answers the same, so it passes; a firmware that answers differently is refused, and the game then writes
// nothing to the pedal.
import type { Message } from './frame.ts';
import { PRESET_BODY_BYTES, PRESET_COUNT } from './preset.ts';

export const MIN_FIRMWARE = 'V2.1.2';

/** Payload sizes of the answers to the connect sequence (31, A0, C1, 8C, B0) on firmware V2.1.2 and V2.1.4. */
const EXPECTED: Record<number, { name: string; bytes: number; count?: number }> = {
  0x32: { name: 'system settings', bytes: 12 },
  0x12: { name: 'spill-over', bytes: 2 },
  0x11: { name: 'global EQ', bytes: 18 },
  0x20: { name: 'preset dump', bytes: PRESET_BODY_BYTES, count: PRESET_COUNT },
  0x41: { name: 'IR slot names', bytes: 640 },
  0x4d: { name: 'IR slot data', bytes: 40 },
  0x0c: { name: 'drum machine', bytes: 6 },
  0x30: { name: 'current preset', bytes: 2 + PRESET_BODY_BYTES - 17 },
  0x33: { name: 'EXP volume', bytes: 6 },
  0x18: { name: 'EXP function', bytes: 6 },
  ...Object.fromEntries(Array.from({ length: 9 }, (_, s) => [0x02 + s, { name: `module ${s}`, bytes: 24 }])),
};

export interface CompatResult {
  /** All answers arrived with the expected sizes. */
  ok: boolean;
  /** Answers still missing (name, or name and how many). */
  missing: string[];
  /** Answers that arrived with another size: the firmware speaks another protocol. */
  wrong: string[];
}

/** Collects the pedal's answers during connect and says whether they are the supported firmware's. */
export class ConnectCheck {
  private seen = new Map<number, number>();
  private bad: string[] = [];

  /** One message from the pedal. Messages the check does not know are ignored (the pedal may send pages, `34`). */
  push(m: Message) {
    const e = EXPECTED[m.cmd];
    if (!e) return;
    if (m.payload.length !== e.bytes) {
      this.bad.push(`${e.name}: ${m.payload.length} bytes, expected ${e.bytes}`);
      return;
    }
    this.seen.set(m.cmd, (this.seen.get(m.cmd) ?? 0) + 1);
  }

  result(): CompatResult {
    const missing: string[] = [];
    for (const [cmd, e] of Object.entries(EXPECTED)) {
      const n = this.seen.get(Number(cmd)) ?? 0;
      const want = e.count ?? 1;
      if (n < want) missing.push(want > 1 ? `${e.name} (${n} of ${want})` : e.name);
    }
    return { ok: !missing.length && !this.bad.length, missing, wrong: [...this.bad] };
  }
}
