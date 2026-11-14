// Drum machine state. The pedal reports it; it is controlled on the pedal only (see docs/protocol.md).
import { encodeMessage, readU16 } from './frame.ts';

export interface Rhythm {
  playing: boolean;
  /** 0 = RHYTHM (drum patterns), 1 = METRONOME. */
  mode: number;
  /** 0-based style; 40 rhythm styles, 10 metronome patterns (manual). */
  style: number;
  volume: number;
  /** 40-260 (manual). */
  bpm: number;
}

export const RhythmCmd = {
  REPORT: 0x0c,
  REQUEST: 0x8c,
} as const;

/**
 * Style names as the pedal shows them, indexed by STYLE (style 3 = "8 BEAT 4").
 */
export const RHYTHM_STYLES = [
  '8 BEAT 1', '8 BEAT 2', '8 BEAT 3', '8 BEAT 4', '8 BEAT 5', '16 BEAT 1', '16 BEAT 2', '16 BEAT 3', '16 BEAT 4', '16 BEAT 5',
  'ROCK N ROLL', 'CLASSIC ROCK', 'POP ROCK', 'SLOW ROCK', 'ROCK SHUFFLE', 'ROCK BALLAD', 'PUNK', 'NEW WAVE', 'HARD ROCK', 'METAL',
  'CLASSIC FUNK', 'FUNK ROCK', 'ELECTRIC FUNK', 'SOUL', 'R&B', 'JAZZ', 'BIG BAND', 'FUSION', 'SWING', 'DIXIELAND',
  'BLUES', 'COUNTRY', 'COUNTRY FOLK', 'ROCKABILLY', 'BLUEGRASS', 'BOSSANOVA', 'RUMBA', 'SAMBA', 'CHA CHA', 'TANGO',
] as const;

/** Metronome patterns, indexed by STYLE in METRONOME mode. */
export const METRONOME_STYLES = ['METRO', 'METRO 2/4', 'METRO 3/4', 'METRO 4/4', 'METRO 5/4', 'METRO 6/4', 'METRO 7/4', 'METRO 6/8', 'METRO 7/8', 'METRO 9/8'] as const;

/** Display name of the current style, e.g. "8 BEAT 4" or "METRO 3/4". */
export function styleName(r: Pick<Rhythm, 'mode' | 'style'>): string {
  const list: readonly string[] = r.mode === 1 ? METRONOME_STYLES : RHYTHM_STYLES;
  return list[r.style] ?? `style ${r.style + 1}`;
}

/** Payload of 0C: on, mode, style, volume (u8 each), BPM (u16 LE). */
export const RHYTHM_BYTES = 6;
export function decodeRhythm(p: Uint8Array): Rhythm {
  return { playing: p[0] === 1, mode: p[1], style: p[2], volume: p[3], bpm: readU16(p, 4) };
}

/** 8C 01, answered with 0C. */
export const requestRhythm = () => encodeMessage(RhythmCmd.REQUEST, Uint8Array.of(1));
