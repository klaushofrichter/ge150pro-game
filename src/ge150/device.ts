// WebHID connection to the GE150 Pro's control channel.
//
// The device runs the connect check itself (compat.ts): until the pedal's answers to the connect sequence are those of
// the supported firmware, every write is refused, so no caller can change a pedal the game does not support.
import { Reassembler, toReports, type Message } from './frame.ts';
import { Cmd, handshake, isModuleReport, requestCurrent, selectPreset, setModule, storePreset } from './commands.ts';
import { ConnectCheck, type CompatResult } from './compat.ts';
import { decodeModule, decodePreset, PRESET_COUNT, SLOT_COUNT, type ExpSettings, type ModuleState, type Preset } from './preset.ts';
import { decodeRhythm, RhythmCmd, type Rhythm } from './rhythm.ts';
import { decodeExpReport, ExpCmd } from './exp.ts';

export const FILTER: HIDDeviceFilter = { vendorId: 0x0483, productId: 0x5703 };
/** The connect sequence's answers must all arrive within this time. */
export const CHECK_MS = 8000;
/**
 * After a host selection (`96`) the pedal switches its preset number at once but loads the preset's modules later:
 * 100-150 ms, measured on V2.1.2. A `B0` in that time answers with the old modules, and a module set is overwritten
 * by the load. So nothing is sent for this long after a selection.
 */
export const SELECT_SETTLE_MS = 300;

export interface DeviceEvents {
  /** The connect check decided: `ok` means the pedal is supported and may be written to. */
  checked: (r: CompatResult) => void;
  /** Presets received so far from the dump (1-based index). */
  preset: (p: Preset) => void;
  /** The device's current preset index (selection on the pedal, or the answer to a request). */
  current: (index: number) => void;
  /** The preset was changed on the pedal itself (footswitch or knob): `16`. The pedal sends nothing when the host
   * selects a preset, so this never fires for our own selections. */
  switched: (index: number) => void;
  /** Live state of one module slot of the current preset. */
  module: (slot: number, m: ModuleState) => void;
  stored: (index: number) => void;
  rhythm: (r: Rhythm) => void;
  /** EXP assignment of the current preset (at connect, or changed on the pedal). */
  exp: (patch: Partial<ExpSettings>) => void;
  disconnect: () => void;
  error: (e: Error) => void;
}

type Listener<K extends keyof DeviceEvents> = DeviceEvents[K];

export class GE150Pro {
  private rx = new Reassembler();
  private queue: Promise<void> = Promise.resolve();
  private listeners: { [K in keyof DeviceEvents]?: Listener<K>[] } = {};
  private dev: HIDDevice;
  private check = new ConnectCheck();
  private checkTimer: ReturnType<typeof setTimeout> | undefined;
  private verdict: boolean | null = null;
  /** Who waits for an answer to `B0` (the last module report), in request order. */
  private answers: (() => void)[] = [];

  private constructor(dev: HIDDevice) {
    this.dev = dev;
  }

  /** Ask the user to pick the device (must be called from a user gesture). */
  static async request(): Promise<GE150Pro | null> {
    const [dev] = await navigator.hid.requestDevice({ filters: [FILTER] });
    return dev ? new GE150Pro(dev) : null;
  }

  /** Re-open a device the user already granted. */
  static async previouslyGranted(): Promise<GE150Pro | null> {
    const devs = await navigator.hid.getDevices();
    const dev = devs.find((d) => d.vendorId === FILTER.vendorId && d.productId === FILTER.productId);
    return dev ? new GE150Pro(dev) : null;
  }

  /** null while the connect check runs; then whether the pedal is supported (and may be written to). */
  get supported(): boolean | null {
    return this.verdict;
  }

  on<K extends keyof DeviceEvents>(event: K, fn: Listener<K>) {
    ((this.listeners[event] ??= []) as Listener<K>[]).push(fn);
  }

  private emit<K extends keyof DeviceEvents>(event: K, ...args: Parameters<DeviceEvents[K]>) {
    for (const fn of (this.listeners[event] ?? []) as ((...a: unknown[]) => void)[]) fn(...args);
  }

  /** Opens the device, sends the connect sequence and starts the connect check (`checked` reports the outcome). */
  async open() {
    if (!this.dev.opened) await this.dev.open();
    this.dev.addEventListener('inputreport', this.onReport);
    navigator.hid.addEventListener('disconnect', this.onDisconnect);
    this.checkTimer = setTimeout(() => this.decide(this.check.result()), CHECK_MS);
    for (const m of handshake()) await this.send(m);
  }

  async close() {
    this.detach();
    if (this.dev.opened) await this.dev.close();
  }

  private detach() {
    clearTimeout(this.checkTimer);
    this.dev.removeEventListener('inputreport', this.onReport);
    navigator.hid.removeEventListener('disconnect', this.onDisconnect);
  }

  private decide(r: CompatResult) {
    if (this.verdict !== null) return;
    clearTimeout(this.checkTimer);
    this.verdict = r.ok;
    this.emit('checked', r);
  }

  private onDisconnect = (e: HIDConnectionEvent) => {
    if (e.device !== this.dev) return;
    this.detach();
    this.emit('disconnect');
  };

  private onReport = (e: HIDInputReportEvent) => {
    const report = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength);
    let messages: Message[];
    try {
      messages = this.rx.push(report);
    } catch (err) {
      this.emit('error', err as Error);
      return;
    }
    for (const m of messages) this.dispatch(m);
  };

  private dispatch(m: Message) {
    const p = m.payload;
    if (m.cmd === Cmd.PRESET_DUMP) this.emit('preset', decodePreset(p));
    else if (m.cmd === Cmd.STORE_ACK) this.emit('stored', p[0]);
    else if (m.cmd === Cmd.PRESET_CHANGED) {
      this.emit('current', p[0]);
      this.emit('switched', p[0]);
    } else if (m.cmd === Cmd.CURRENT_PRESET) this.emit('current', p[0]);
    else if (isModuleReport(m.cmd)) this.emit('module', m.cmd - Cmd.MODULE_BASE, decodeModule(p));
    else if (m.cmd === ExpCmd.FUNCTION || m.cmd === ExpCmd.VOLUME) {
      const patch = decodeExpReport(m.cmd, p);
      if (patch) this.emit('exp', patch);
    } else if (m.cmd === RhythmCmd.REPORT) this.emit('rhythm', decodeRhythm(p));
    if (m.cmd === Cmd.MODULE_BASE + SLOT_COUNT - 1) this.answers.shift()?.();
    // after the message's own event, so the outcome comes with everything the pedal has said
    if (this.verdict === null) {
      this.check.push(m);
      const r = this.check.result();
      if (r.ok || r.wrong.length) this.decide(r);
    }
  }

  /**
   * Serialize writes so multi-report messages never interleave. A `B0` request queues `answered` for its answer; a
   * selection holds the queue until the pedal has loaded the preset.
   */
  private send(stream: Uint8Array, answered: () => void = () => {}): Promise<void> {
    const job = this.queue.then(async () => {
      for (const r of toReports(stream)) await this.dev.sendReport(0, r);
      if (stream[4] === Cmd.REQUEST_CURRENT) this.answers.push(answered);
      if (stream[4] === Cmd.SELECT_PRESET) await new Promise((r) => setTimeout(r, SELECT_SETTLE_MS));
    });
    this.queue = job.catch((e) => this.emit('error', e as Error));
    return job;
  }

  /** A write: only to a pedal that passed the connect check. */
  private write(stream: Uint8Array): Promise<void> {
    if (this.verdict !== true) return Promise.reject(new Error('the pedal is not supported (or not checked yet)'));
    return this.send(stream);
  }

  /** Ask for the live state of the current preset (30, 33, 18, 02-0A). */
  requestCurrent() {
    return this.send(requestCurrent());
  }

  /**
   * Ask for the live state and wait until it has arrived (the last module report), so a caller can act on it instead
   * of guessing a delay. Gives up quietly after `timeoutMs`.
   */
  async readCurrent(timeoutMs = 1500): Promise<void> {
    let done!: () => void;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const answered = new Promise<void>((r) => (done = r));
    try {
      // answers come in request order, so this waits past the answers to earlier requests
      await this.send(requestCurrent(), done);
      await Promise.race([answered, new Promise((r) => (timer = setTimeout(r, timeoutMs)))]);
    } finally {
      clearTimeout(timer);
      const i = this.answers.indexOf(done);
      if (i >= 0) this.answers.splice(i, 1);
    }
  }

  /** Resolves once the pedal has loaded the preset (see SELECT_SETTLE_MS). */
  selectPreset(index: number) {
    if (index < 1 || index > PRESET_COUNT) return Promise.reject(new RangeError(`preset ${index}`));
    return this.write(selectPreset(index));
  }

  setModule(slot: number, m: ModuleState) {
    return this.write(setModule(slot, m));
  }

  /** Persist a full preset to its slot on the device. */
  storePreset(p: Preset) {
    return this.write(storePreset(p));
  }
}
