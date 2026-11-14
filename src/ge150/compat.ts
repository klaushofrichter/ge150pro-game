// Which firmware the game supports, checked from the pedal's own answers at connect (GE150Pro runs the check).
//
// The firmware version number cannot be read over the HID control channel. Instead the game requires the protocol of
// the firmware it was built and tested on: every answer firmware V2.1.2 gives to the connect sequence, with its exact
// size. V2.1.4 answers the same, so it passes; a firmware that answers differently is refused, and the game then writes
// nothing to the pedal.
import { Cmd } from './commands.ts';
import { ExpCmd } from './exp.ts';
import type { Message } from './frame.ts';
import { MODULE_BYTES, NAME_LENGTH, PRESET_BODY_BYTES, PRESET_COUNT, SLOT_COUNT } from './preset.ts';
import { RhythmCmd, RHYTHM_BYTES } from './rhythm.ts';

export const MIN_FIRMWARE = 'V2.1.2';

/** `30`: index, the page shown, then the preset body without its index and name. */
const CURRENT_PRESET_BYTES = 2 + PRESET_BODY_BYTES - 1 - NAME_LENGTH;

/** Payload sizes of the answers to the connect sequence on firmware V2.1.2 and V2.1.4. */
const EXPECTED: Record<number, { name: string; bytes: number; count?: number }> = {
  [Cmd.SYSTEM]: { name: 'system settings', bytes: 6 * 2 },
  [Cmd.SPILL_OVER]: { name: 'spill-over', bytes: 2 },
  [Cmd.GLOBAL_EQ]: { name: 'global EQ', bytes: 9 * 2 },
  [Cmd.PRESET_DUMP]: { name: 'preset dump', bytes: PRESET_BODY_BYTES, count: PRESET_COUNT },
  [Cmd.IR_NAMES]: { name: 'IR slot names', bytes: 20 * 32 },
  [Cmd.IR_DATA]: { name: 'IR slot data', bytes: 40 },
  [RhythmCmd.REPORT]: { name: 'drum machine', bytes: RHYTHM_BYTES },
  [Cmd.CURRENT_PRESET]: { name: 'current preset', bytes: CURRENT_PRESET_BYTES },
  [ExpCmd.VOLUME]: { name: 'EXP volume', bytes: 3 * 2 },
  [ExpCmd.FUNCTION]: { name: 'EXP function', bytes: 3 * 2 },
  ...Object.fromEntries(Array.from({ length: SLOT_COUNT }, (_, s) => [Cmd.MODULE_BASE + s, { name: `module ${s}`, bytes: MODULE_BYTES }])),
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
