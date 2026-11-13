// Framing for the GE150 Pro editor channel. See docs/protocol/README.md.

export const REPORT_SIZE = 64;
const CHUNK = REPORT_SIZE - 1;

const CRC_TABLE = (() => {
  const t = new Uint16Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i << 8;
    for (let b = 0; b < 8; b++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff;
    t[i] = c;
  }
  return t;
})();

/** CRC-16 poly 0x1021, init 0, not reflected, final XOR 0xFFFF (CRC-16/GSM). */
export function crc16(bytes: Uint8Array): number {
  let c = 0;
  for (const b of bytes) c = ((c << 8) & 0xffff) ^ CRC_TABLE[((c >> 8) ^ b) & 0xff];
  return ~c & 0xffff;
}

export interface Message {
  cmd: number;
  payload: Uint8Array;
}

/** Build the byte stream `AA 55 len cmd payload crc`. */
export function encodeMessage(cmd: number, payload: Uint8Array = new Uint8Array()): Uint8Array {
  const len = payload.length + 1;
  const m = new Uint8Array(len + 6);
  m[0] = 0xaa;
  m[1] = 0x55;
  m[2] = len & 0xff;
  m[3] = len >> 8;
  m[4] = cmd;
  m.set(payload, 5);
  const crc = crc16(m.subarray(2, 4 + len));
  m[4 + len] = crc >> 8;
  m[5 + len] = crc & 0xff;
  return m;
}

/** Split a message stream into 64-byte output reports: `[n][n bytes][zero padding]`. */
export function toReports(stream: Uint8Array): Uint8Array<ArrayBuffer>[] {
  const reports: Uint8Array<ArrayBuffer>[] = [];
  for (let off = 0; off < stream.length; off += CHUNK) {
    const part = stream.subarray(off, off + CHUNK);
    const r = new Uint8Array(REPORT_SIZE);
    r[0] = part.length;
    r.set(part, 1);
    reports.push(r);
  }
  return reports;
}

export class CrcError extends Error {}

/** Reassembles input reports into messages. Ignores stale bytes after each report's length byte. */
export class Reassembler {
  private buf = new Uint8Array(0);

  /** Feed one input report; returns every message completed by it. */
  push(report: Uint8Array): Message[] {
    const n = Math.min(report[0], report.length - 1);
    const chunk = report.subarray(1, 1 + n);
    if (chunk[0] === 0xaa && chunk[1] === 0x55) this.buf = new Uint8Array(0);
    const next = new Uint8Array(this.buf.length + chunk.length);
    next.set(this.buf);
    next.set(chunk, this.buf.length);
    this.buf = next;

    const out: Message[] = [];
    while (this.buf.length >= 4) {
      if (this.buf[0] !== 0xaa || this.buf[1] !== 0x55) {
        this.buf = new Uint8Array(0); // lost sync; wait for the next header
        break;
      }
      const len = this.buf[2] | (this.buf[3] << 8);
      if (this.buf.length < len + 6) break;
      const msg = this.buf.subarray(0, len + 6);
      const crc = (msg[4 + len] << 8) | msg[5 + len];
      if (crc16(msg.subarray(2, 4 + len)) !== crc) throw new CrcError(`bad CRC for cmd 0x${msg[4].toString(16)}`);
      out.push({ cmd: msg[4], payload: msg.slice(5, 4 + len) });
      this.buf = this.buf.slice(len + 6);
    }
    return out;
  }
}
