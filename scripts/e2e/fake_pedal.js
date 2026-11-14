// A simulated GE150 Pro for the browser check: replaces navigator.hid in the board's page (Playwright init script),
// so the game runs its real WebHID code against a pedal that answers like the hardware does (framing, CRC-16/GSM, the
// connect sequence, live module state, a footswitch). Nothing here ships to tables.
//   window.__pedal.log      host commands received: [{ cmd, payload: number[] }]
//   window.__pedal.press(i) a footswitch selecting preset i (the pedal reports 16)
//   window.__pedal.state    the simulated pedal: current preset, live modules
(() => {
  // Options set before this script (Playwright init script): { absent, firmware: "other", busy }.
  const opts = window.__fakePedalOptions ?? {};
  const crcTable = new Uint16Array(256).map((_, i) => {
    let c = i << 8;
    for (let k = 0; k < 8; k++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff;
    return c;
  });
  const crc16 = (b) => {
    let c = 0;
    for (const x of b) c = ((c << 8) ^ crcTable[((c >> 8) ^ x) & 0xff]) & 0xffff;
    return c ^ 0xffff;
  };
  const frame = (cmd, payload = []) => {
    const len = payload.length + 1;
    const body = [len & 0xff, len >> 8, cmd, ...payload];
    const c = crc16(body);
    return [0xaa, 0x55, ...body, c >> 8, c & 0xff];
  };
  const u16 = (...v) => v.flatMap((x) => [x & 0xff, (x >> 8) & 0xff]);

  // 200 presets: "Preset n", modules on in even slots, models 0..8, values around the middle.
  const presets = Array.from({ length: 200 }, (_, i) => ({
    name: `Preset ${i + 1}`.padEnd(16, "\0").slice(0, 16),
    modules: Array.from({ length: 9 }, (_, s) => ({ on: (s + i) % 2 === 0, type: s % 3, values: [50, 50, 50, 0, 0, 0, 0, 0, 0, 0] })),
    exp: [8, 57, 1, 1, 0, 100],
  }));
  const LOAD_MS = 120;
  let loading;
  const state = { current: 5, live: structuredClone(presets[4].modules), exp: [...presets[4].exp] };
  const moduleBytes = (m) => u16(m.on ? 1 : 0, m.type, ...m.values);
  const readModule = (p, o = 0) => {
    const v = Array.from({ length: 12 }, (_, k) => p[o + 2 * k] | (p[o + 2 * k + 1] << 8));
    return { on: v[0] === 1, type: v[1], values: v.slice(2) };
  };
  const body = (i, mods = presets[i - 1].modules, exp = presets[i - 1].exp) =>
    [i, ...[...presets[i - 1].name].map((c) => c.charCodeAt(0)), ...mods.flatMap(moduleBytes), ...u16(...exp)];

  const listeners = new Set();
  const outbox = [];
  function emit(stream) {
    for (let o = 0; o < stream.length; o += 63) {
      const chunk = stream.slice(o, o + 63);
      const report = new Uint8Array(64);
      report[0] = chunk.length;
      report.set(chunk, 1);
      outbox.push(report);
    }
  }
  function flush() {
    const r = outbox.shift();
    if (!r) return;
    const ev = { data: new DataView(r.buffer), device, reportId: 0 };
    for (const fn of listeners) fn(ev);
    setTimeout(flush, 0);
  }
  const reply = (cmd, payload) => {
    emit(frame(cmd, payload));
    setTimeout(flush, 2);
  };

  let rx = [];
  const log = [];
  function onMessage(cmd, p) {
    log.push({ cmd, payload: [...p] });
    if (cmd === 0x31) {
      reply(0x32, u16(9, 12, 1, 1, 9, 1));
      reply(0x12, u16(0));
      reply(0x11, u16(0, 0x27dd, 32, 0, 32, 0, 32, 0, 0));
    } else if (cmd === 0xa0) {
      for (let i = 1; i <= 200; i++) reply(0x20, body(i));
    } else if (cmd === 0xc1) {
      reply(0x4d, Array(40).fill(0));
      reply(0x41, Array.from({ length: 20 }, () => [..."EMPTY"].map((c) => c.charCodeAt(0)).concat(Array(27).fill(0))).flat());
    } else if (cmd === 0x8c) {
      // a firmware with another protocol: here, a drum machine report one byte longer
      reply(0x0c, opts.firmware === "other" ? [1, 0, 3, 8, 123, 0, 0] : [1, 0, 3, 8, 123, 0]);
    } else if (cmd === 0xb0) {
      reply(0x30, [state.current, 0x0e, ...body(state.current).slice(17)]);
      reply(0x33, u16(...state.exp.slice(3)));
      reply(0x18, u16(...state.exp.slice(0, 3)));
      state.live.forEach((m, s) => reply(0x02 + s, moduleBytes(m)));
    } else if (cmd >= 0x82 && cmd <= 0x8a) {
      state.live[cmd - 0x82] = readModule(p);
    } else if (cmd === 0x96) {
      // like the hardware: the number switches at once, the modules load later (100-150 ms measured), and a module set
      // in between is overwritten by the load
      state.current = p[0];
      clearTimeout(loading);
      loading = setTimeout(() => {
        state.live = structuredClone(presets[p[0] - 1].modules);
        state.exp = [...presets[p[0] - 1].exp];
      }, LOAD_MS);
    } else if (cmd === 0xc3) {
      const i = p[0];
      for (let s = 0; s < 9; s++) presets[i - 1].modules[s] = readModule(p, 17 + s * 24);
      reply(0x43, [i]);
    } else if (cmd === 0xb4) {
      reply(0x34, [p[0]]);
    } else if (cmd === 0x98 || cmd === 0xb3) {
      reply(0x34, [cmd === 0x98 ? 0x0f : 0x16]);
    }
    // anything else: the real pedal ignores codes it does not know; so does this one
  }

  function receive(report) {
    const n = report[0];
    rx.push(...report.slice(1, 1 + n));
    while (rx.length >= 6) {
      if (rx[0] !== 0xaa || rx[1] !== 0x55) {
        rx.shift();
        continue;
      }
      const len = rx[2] | (rx[3] << 8);
      if (rx.length < len + 6) return;
      const msg = rx.splice(0, len + 6);
      const c = crc16(msg.slice(2, 4 + len));
      if (c !== ((msg[4 + len] << 8) | msg[5 + len])) throw new Error("fake pedal: bad CRC from the host");
      onMessage(msg[4], msg.slice(5, 4 + len));
    }
  }

  const device = {
    vendorId: 0x0483,
    productId: 0x5703,
    productName: "GE150Pro",
    opened: false,
    async open() {
      if (opts.busy) throw new DOMException("Failed to open the device.", "NotAllowedError");
      this.opened = true;
    },
    async close() {
      this.opened = false;
    },
    async sendReport(_id, data) {
      const b = data instanceof Uint8Array ? data : new Uint8Array(data.buffer ?? data);
      receive(b);
    },
    addEventListener(type, fn) {
      if (type === "inputreport") listeners.add(fn);
    },
    removeEventListener(type, fn) {
      if (type === "inputreport") listeners.delete(fn);
    },
  };

  let plugged = !opts.absent;
  const hidListeners = { connect: new Set(), disconnect: new Set() };
  const hid = {
    async getDevices() {
      return plugged ? [device] : [];
    },
    async requestDevice() {
      return plugged ? [device] : [];
    },
    addEventListener(type, fn) {
      hidListeners[type]?.add(fn);
    },
    removeEventListener(type, fn) {
      hidListeners[type]?.delete(fn);
    },
  };
  const hidEvent = (type) => {
    for (const fn of hidListeners[type]) fn({ device });
  };
  Object.defineProperty(Navigator.prototype, "hid", { configurable: true, get: () => hid });

  window.__pedal = {
    log,
    state,
    /** Pull the USB cable: the browser reports a disconnect. */
    unplug() {
      plugged = false;
      device.opened = false;
      hidEvent("disconnect");
    },
    /** Plug it back in: the browser reports a connect for a device the page may use. */
    plug() {
      plugged = true;
      log.length = 0;
      hidEvent("connect");
    },
    press(i) {
      state.current = i;
      state.live = structuredClone(presets[i - 1].modules);
      reply(0x16, [i]);
    },
  };
})();
