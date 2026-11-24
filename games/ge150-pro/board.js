// GE150 Pro on the board: the pedal's signal chain and its parameters by touch, the presets, and the configurations
// the phone recalls. The pedal is driven over WebHID by the table's own board only, for the player sitting at it
// (E-002); a remote board shows the state and a note. The protocol library is assets/ge150.js (src/ge150/).
import * as kit from "/shared/board-kit.js";
const { audio: sharedAudio, esc, html, seatPlates, useStyles } = kit;
/** The version the table loaded this file with (`?v=…`): the stylesheet and the library too, so an update is not
 * served from the browser's cache (the table versions only this file). */
const VERSIONED = new URL(import.meta.url).search;
/** The platform's wide scrollbar for a finger (D-306), where the table has it; else the browser's own. */
const touchScroll = (el) => kit.touchScroll?.(el);

const ID = "ge150-pro";
const REPORT_MS = 150; // reports to the rules are merged for this long (each counts as a move)
const SEND_MS = 40; // a fader sends at most once per this interval
const EDIT_GUARD_MS = 500; // the pedal's reports for a slot edited here this recently are older than the edit
const NOTICE_MS = 4000; // how long a passing problem shows in the bar
const VOLUMES = [0, 20, 40, 60, 80, 100];
/** The oldest supported firmware (src/ge150/compat.ts MIN_FIRMWARE; the settings window needs it before the library loads). */
const MIN_FIRMWARE = "V2.1.2";
/** What Save all to file… writes, so Load all from file… recognizes it (E-023). */
const FILE_FORMAT = "ge150-pro-configurations";
/**
 * What the board says about the pedal, by state: the short title (the bar and the notice panel), the explanation
 * under it, and the full sentence the phone shows. `retry` offers Connect pedal.
 */
const STATES = {
  noHid: { title: "No USB access", text: "This browser cannot reach USB devices (WebHID): the table needs Google Chrome." },
  noPedal: { title: "No pedal", text: "Connect the GE150 Pro by USB, then tap Connect pedal.", retry: true },
  notChosen: { title: "No pedal chosen", text: "Tap Connect pedal and choose GE150Pro.", retry: true },
  busy: { title: "Pedal in use", text: "Another program uses the pedal: close Mooer's editor, then tap Connect pedal.", retry: true },
  loading: { title: "Connecting…", text: "Loading the presets…" },
  connected: { title: "Connected", text: "" },
  unplugged: { title: "Pedal disconnected", text: "Plug it in again.", retry: true },
  released: { title: "Disconnected", text: "The table let go of the pedal: Mooer's editor or the web editor (klaushofrichter.github.io/ge150pro-editor) can use it now. Tap Connect pedal to connect again.", retry: true },
  unsupported: { title: "Firmware not supported",
    text: `The game needs firmware ${MIN_FIRMWARE} or newer. Update the pedal with Mooer's editor; the game changes nothing on this pedal.` },
  error: { title: "Pedal error", text: "" },
};
const prefsOf = (info) => ({ volume: VOLUMES.includes(info?.prefs?.volume) ? info.prefs.volume : 60, confirm: info?.prefs?.confirm === true });

/**
 * The settings window's items. The running board adds *Connect the pedal again* (the platform asks it, games-service
 * D-326); before the game is on the table, the module's export gives the rest.
 */
export function settings({ info, setPrefs }, reconnect = null) {
  const p = prefsOf(info);
  return [
    {
      type: "choice",
      label: "Click volume",
      hint: "The table's click track, started from the phone's Rhythm tab.",
      value: String(p.volume),
      options: VOLUMES.map((v) => ({ value: String(v), label: v ? `${v}%` : "Off" })),
      onChange: (v) => setPrefs({ volume: Number(v) }),
    },
    {
      type: "toggle",
      label: "Confirm when changing presets after edits",
      hint: "Before the board or the phone selects another preset, offer to save unsaved changes. The pedal's own footswitches switch without asking.",
      value: p.confirm,
      onChange: (v) => setPrefs({ confirm: v === true }),
    },
    ...(reconnect ? [{ type: "button", label: "Pedal", action: "Connect the pedal again", onChange: reconnect }] : []),
    { type: "text", label: "Requires", value: `Mooer GE150 Pro by USB, firmware ${MIN_FIRMWARE} or newer` },
  ];
}

export function mount(root, ctx) {
  useStyles(`/games/${ID}/board.css${VERSIONED}`);
  const box = html(`<div class="gp-root">
    <div class="gp-bar">
      <div class="gp-conn"><span class="gp-dot"></span><div class="gp-conn-text"></div>
        <button class="gp-btn primary gp-connect" type="button" hidden>Connect pedal</button></div>
      <div class="gp-now" role="button" tabindex="0" title="What this preset plays"><div class="gp-label"></div><div class="gp-name"></div></div>
      <div class="gp-bar-right"><button class="gp-btn gp-save" type="button">Save preset…</button></div>
    </div>
    <div class="gp-chain" role="list"></div>
    <div class="gp-main">
      <section class="gp-editor">
        <div class="gp-ed-head"><div><div class="gp-ed-slot"></div><button class="gp-btn gp-model" type="button"></button></div>
          <button class="gp-power gp-ed-power" type="button" aria-label="Switch the module on or off"></button></div>
        <div class="gp-exp-note muted" hidden>The pedal is in volume mode: it sets the volume. Tap the outlined EXP (or the toe switch) for EXP mode.</div>
        <div class="gp-faders"></div>
        <div class="gp-notice" hidden><div class="gp-notice-title"></div><div class="gp-notice-text"></div>
          <button class="gp-btn primary gp-notice-connect" type="button" hidden>Connect pedal</button>
          <div class="gp-req"><div class="gp-eyebrow">Requires</div>
            <div class="gp-req-row"><b>Device</b><span>Mooer GE150 Pro, connected to this table by USB</span></div>
            <div class="gp-req-row"><b>Firmware</b><span class="gp-req-fw">${MIN_FIRMWARE} or newer</span></div>
            <div class="gp-req-note muted">The pedal does not tell its firmware version over USB, so the board checks how it
              answers. Update an older pedal with Mooer's GE150 Pro editor.</div>
            <div class="gp-req-row"><b>EXP pedal</b><span>Calibrate it first to use its full range: on the pedal, EXP → CALIBRATE</span></div></div></div>
      </section>
      <section class="gp-side">
        <div class="gp-tabs" role="tablist"><button class="gp-tab on" type="button" data-tab="presets">Presets</button>
          <button class="gp-tab" type="button" data-tab="configs">Configurations</button></div>
        <div class="gp-pane gp-presets">
          <div class="gp-bank"><button class="gp-btn gp-bank-prev" type="button" aria-label="Previous bank">◀</button>
            <button class="gp-bank-name" type="button" aria-label="All banks"></button><button class="gp-btn gp-bank-next" type="button" aria-label="Next bank">▶</button></div>
          <div class="gp-abcd"></div>
          <div class="gp-hint muted gp-presets-hint"></div>
        </div>
        <div class="gp-pane gp-configs" hidden>
          <div class="gp-config-btns"><button class="gp-btn primary gp-capture" type="button">Save configuration…</button>
            <button class="gp-btn gp-file-save" type="button">Save all to file…</button>
            <button class="gp-btn gp-file-load" type="button">Load all from file…</button>
            <input class="gp-file-input" type="file" accept=".json,application/json" hidden></div>
          <div class="gp-config-list"></div>
        </div>
      </section>
    </div>
    <div class="gp-away" hidden></div>
    <div class="gp-sheet-wrap" hidden><div class="gp-sheet"></div></div>
  </div>`);
  root.appendChild(box);
  const $ = (s) => box.querySelector(s);

  let info = null, view = null, lib = null, dev = null, dead = false;
  let opening = false;
  /** The pedal passed the connect check (E-013, run by the library, which refuses writes until then). */
  let ready = false;
  /** What the board says about the pedal: a key of STATES, and the detail of an error. */
  let state = { key: "loading", detail: "" };
  /** Stored presets from the dump, index 1..200 → Preset. */
  const stored = new Map();
  /** Live state of the current preset on the pedal. */
  let current = 0, modules = null, exp = null, rhythm = null;
  let selected = 2; // module slot open in the editor
  let bank = 1, tab = "presets";
  let lastDone = 0, lastAcked = 0; // the last command carried out by this board, and the last one reported done
  let busy = Promise.resolve();
  let pending = {}, reportTimer = null;
  /** This board's "save before switching?" sheet is open (E-021); a store waiting for the pedal's acknowledgement. */
  let asking = false, storedWait = null;
  /** The player disconnected the pedal (E-025): the board does not connect again by itself. */
  let released = false;
  const sendTimers = new Map(), sendNext = new Map(), editedAt = new Map();

  const playerSeat = () => (view ? view.seat : null);
  /** This board drives the pedal: the table's own board, for the player sitting at the table (controlSeats). */
  const plays = () => !!info && !!view && info.controlSeats?.includes(view.seat);

  // ---- the table's configurations (E-017) -----------------------------------------------------------------------
  // The configurations are the table's: kept in its game data between games (games-service D-302), shared by everyone
  // who plays here. The board that drives the pedal brings them to the game once, then keeps the table's copy in step
  // with the game's. On a table without game data (an older platform) the phone keeps its own, as before (E-006).
  /** A configuration as it is kept: without what the view adds for showing it. */
  const forTable = (configs) => (configs ?? []).map(({ id, name, slot, trigger, preset, modules }) => ({ id, name, slot, trigger, preset, modules }));
  let tableAsked = false;
  let tableHas = null; // the table's copy, as JSON
  let tableWriting = false;
  let tableRetry = null;
  async function syncTable() {
    if (dead || !ctx.store || !plays() || view.done) return;
    if (!view.shared) {
      if (tableAsked) return;
      tableAsked = true;
      try {
        // A table that can't be asked just now throws (games-service D-304): asked again with the next update, never
        // taken for a table without configurations, which would later be written over the ones it keeps.
        const stored = await ctx.store.get("configs");
        const list = Array.isArray(stored) ? stored : [];
        tableHas = JSON.stringify(list); // what the table has, as read
        const r = await ctx.act(playerSeat(), "configs", { list, shared: true });
        if (!r?.ok) tableAsked = false;
      } catch {
        tableAsked = false;
      }
      // not brought (the table could not be asked, the move was refused): again with the next update, or by itself
      clearTimeout(tableRetry);
      if (!tableAsked) tableRetry = setTimeout(syncTable, 3000);
      return;
    }
    const now = JSON.stringify(forTable(view.configs));
    if (now === tableHas || tableWriting) return;
    tableWriting = true;
    const r = await ctx.store.set("configs", JSON.parse(now)).catch((e) => ({ ok: false, reason: e?.message }));
    tableWriting = false;
    clearTimeout(tableRetry);
    if (r?.ok) {
      tableHas = now; // the table has it; only now
      return void syncTable(); // (what changed while it was being written)
    }
    // Not saved (too many changes at once, the connection): said, and tried again, also when nothing else changes.
    notice(`The configurations could not be saved on the table${r?.reason ? `: ${r.reason}` : ""}; trying again`);
    tableRetry = setTimeout(syncTable, 3000);
  }

  // ---- reports to the rules -------------------------------------------------------------------------------------
  function report(patch) {
    if (!plays() || view?.done) return;
    if (!ready && !("connected" in patch)) return; // nothing about an unchecked pedal reaches the table
    Object.assign(pending, patch);
    reportTimer ??= setTimeout(() => {
      reportTimer = null;
      // only what the table does not show yet (the rules' current view, so a rejected or reset state is sent again)
      const shown = view?.pedal ?? {};
      const p = Object.fromEntries(Object.entries(pending).filter(([k, v]) => !(k in shown) || JSON.stringify(v) !== JSON.stringify(shown[k])));
      pending = {};
      if (Object.keys(p).length) ctx.act(playerSeat(), "pedal", p);
    }, REPORT_MS);
  }
  const chainOf = (mods) => mods.map((m) => ({ on: m.on, type: m.type, values: [...m.values] }));
  const sameModule = (a, b) => a && b && a.on === b.on && a.type === b.type && a.values.every((v, i) => v === b.values[i]);
  /** The live modules as Save keeps them: without the expression pedal's position (playing, not an edit). */
  const kept = () => {
    const base = stored.get(current);
    // (the pedal moves what it controls now: the live EXP target, which may not be stored yet)
    return base && modules ? lib.withoutPedalMove(exp?.MODULE_CTRL !== undefined ? exp : base.exp, modules, base.modules) : modules;
  };
  /** The EXP target differs from the stored preset's (E-027): an unsaved change like a module's. */
  const expChanged = () => !!exp && !!stored.get(current) && (exp.MODULE_CTRL !== stored.get(current).exp.MODULE_CTRL || exp.PARA_CTRL !== stored.get(current).exp.PARA_CTRL);
  const modifiedNow = () => !!modules && !!stored.get(current) && (expChanged() || kept().some((m, s) => !sameModule(m, stored.get(current).modules[s])));

  // ---- the pedal ------------------------------------------------------------------------------------------------
  async function loadLib() {
    lib ??= await import(ctx.assetUrl("ge150.js") + VERSIONED);
    return lib;
  }

  async function connect(fromTouch) {
    if (!plays() || dev || opening || dead) return;
    // after Disconnect only a touch connects again, not an update or a hotplug (E-025)
    if (released && !fromTouch) return;
    released = false;
    opening = true; // before any await: a second call (an update, a hotplug) waits for this one
    // Chrome's device chooser ends fullscreen: back to it once the choice is made (E-026)
    const fs = fullscreenDoc();
    const wasFull = fromTouch && !!fs.fullscreenElement;
    try {
      await loadLib();
      if (!navigator.hid) return status("noHid");
      const d = fromTouch ? await lib.GE150Pro.request() : await lib.GE150Pro.previouslyGranted();
      if (!d) {
        status(fromTouch ? "notChosen" : "noPedal");
        return;
      }
      wire(d);
      dev = d;
      ready = false;
      status("loading");
      try {
        await d.open();
      } catch {
        d.close().catch(() => {});
        dev = null;
        status("busy");
      }
    } catch (e) {
      dev = null;
      status(fromTouch && e?.name === "NotFoundError" ? "notChosen" : "noPedal");
    } finally {
      opening = false;
      if (wasFull && !fs.fullscreenElement) refullscreen(fs);
      draw();
    }
  }

  /** The document the table's Fullscreen applies to: the whole page when the board is framed in it (same origin). */
  function fullscreenDoc() {
    try {
      return window.parent !== window && window.parent.document ? window.parent.document : document;
    } catch {
      return document;
    }
  }

  /**
   * Back to fullscreen: at once if the browser still allows it, else with the next touch anywhere on the page. The
   * chooser uses up the touch that opened it, so usually it is the next touch. A finger only counts as a user gesture
   * when it lifts (pointerup), not when it lands (pointerdown), so the attempt runs then. If it fails, the next touch tries again.
   */
  const GESTURES = ["pointerup", "keydown"];
  function refullscreen(fs) {
    fs.documentElement.requestFullscreen().catch(() => {
      const wins = [...new Set([fs.defaultView ?? window, window])];
      const listen = (on) => wins.forEach((w) => GESTURES.forEach((t) => (on ? w.addEventListener : w.removeEventListener).call(w, t, again, true)));
      const again = () => {
        if (fs.fullscreenElement) return listen(false);
        fs.documentElement.requestFullscreen().then(() => listen(false), () => {});
      };
      listen(true);
    });
  }

  function status(key, detail = "") {
    state = { key, detail };
    const connected = key === "connected";
    const { title, text } = STATES[key];
    // the bar keeps the title; the notice panel and the phone say it all
    $(".gp-conn-text").textContent = title;
    $(".gp-dot").dataset.state = connected ? "on" : "off";
    report({ connected, text: [title, detail || text].filter(Boolean).join(" — ") });
    drawNotice();
  }

  /** A passing problem with a connected pedal (a bad report, a failed write): in the bar for a few seconds only. */
  let noticeTimer = null;
  function notice(text) {
    $(".gp-conn-text").textContent = `${STATES[state.key].title} — ${text}`;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => ($(".gp-conn-text").textContent = STATES[state.key].title), NOTICE_MS);
  }

  /** The notice panel in the editor's place while the pedal is not ready; the chain and presets dim. */
  function drawNotice() {
    const show = plays() && !ready && !view?.done;
    $(".gp-notice").hidden = !show;
    $(".gp-faders").hidden = show;
    box.classList.toggle("gp-locked", show);
    if (!show) return;
    const st = STATES[state.key];
    $(".gp-notice-title").textContent = st.title;
    $(".gp-notice-text").textContent = state.detail || st.text;
    $(".gp-notice-connect").hidden = !st.retry;
  }

  /** All answers of the connect sequence arrived as the supported firmware gives them. */
  function supported(d) {
    ready = true;
    const names = Array.from({ length: lib.PRESET_COUNT }, (_, i) => stored.get(i + 1)?.name.trim() ?? "");
    status("connected");
    // everything held back while the check ran, in one report
    report({ names, ...(current ? { current } : {}), ...(modules ? { chain: chainOf(modules), modified: modifiedNow() } : {}), ...(rhythm ? { rhythm } : {}) });
    reportExp();
    d.requestCurrent(); // the live state again, now that the stored copies exist to compare with
    runCommands();
    draw();
  }

  /** Forget the pedal (unplugged, or connecting again). */
  function reset() {
    dev = null;
    ready = false;
    dropEdits();
  }

  function wire(d) {
    // another firmware (or no answer): the pedal stays connected, and the library refuses every write to it
    d.on("checked", (r) => {
      if (r.ok) supported(d);
      else status("unsupported"), draw();
    });
    d.on("preset", (p) => {
      stored.set(p.index, p);
      if (p.index === current && !modules) adopt(current);
    });
    d.on("current", (i) => (peeking && i === current ? undefined : adopt(i)));
    d.on("switched", (i) => onSwitched(i));
    d.on("module", (slot, m) => {
      if (!modules) return;
      // a slot edited here moments ago: this report can be the answer to an earlier read, older than the edit
      if (Date.now() - (editedAt.get(slot) ?? 0) < EDIT_GUARD_MS) return;
      modules[slot] = m;
      afterLiveChange();
    });
    d.on("exp", (patch) => {
      exp = { ...(exp ?? {}), ...patch };
      reportExp();
      draw(); // the EXP badge, toggles and modified mark follow the pedal's report
    });
    d.on("rhythm", (r) => {
      rhythm = r;
      report({ rhythm: r });
    });
    d.on("stored", (i) => storedWait?.(i));
    d.on("stored", (i) => {
      if (i === current && modules) {
        const keep = kept();
        const was = stored.get(i);
        // as storeCurrent sent it: the live EXP target and volume range, the preset's own toe-switch mode (E-027)
        stored.set(i, { ...was, modules: structuredClone(keep), exp: { ...was.exp, ...(exp ?? {}), FUN_SWITCH: was.exp.FUN_SWITCH } });
        // storing also loads the stored values into the sound: put back the value the expression pedal had set
        const moved = keep.findIndex((m, s) => !sameModule(m, modules[s]));
        if (moved >= 0) {
          const m = structuredClone(modules[moved]);
          later(() => d.setModule(moved, m));
        }
      }
      afterLiveChange();
    });
    d.on("disconnect", () => {
      reset();
      status("unplugged");
      draw();
    });
    // a bad report or a failed write: shown, but the pedal stays connected (an unplugged pedal says so itself)
    d.on("error", (e) => (ready ? notice(String(e?.message ?? e)) : status("error", String(e?.message ?? e))));
  }

  function adopt(index) {
    if (index < 1 || index > lib.PRESET_COUNT) return;
    if (index !== current) dropEdits(); // fader values still waiting belong to the preset left behind
    current = index;
    bank = Math.floor((index - 1) / 4) + 1;
    const p = stored.get(index);
    modules = p ? structuredClone(p.modules) : modules;
    if (p) exp = { ...p.exp };
    report({ current: index, ...(modules ? { chain: chainOf(modules), modified: modifiedNow() } : {}) });
    reportExp();
    draw();
  }

  /** The EXP target of this board's pedal (null on a remote board, which has only the phone's label). */
  const expOf = () => (plays() && exp?.MODULE_CTRL !== undefined ? exp : null);

  /** The pedal is in EXP mode now (its toe switch's mode): it moves its target, not the volume. */
  const expMode = () => exp?.FUN_SWITCH === 1;

  /**
   * The EXP toggle under a slider (E-027, E-028). On another slider: the expression pedal controls this one from now
   * on, in the mode it is in (one target per preset, moved without asking; an unsaved change until Save preset…). On
   * the slider it already controls: the toe switch's mode, EXP ⇄ volume, as the pedal's own toe switch does.
   */
  function assignExp(i) {
    if (!canEdit() || !exp) return;
    const p = lib.model(selected, modules[selected].type)?.params[i];
    const id = p && lib.expParamId(selected, p.name);
    if (id === undefined) return;
    const toggle = exp.MODULE_CTRL === selected && exp.PARA_CTRL === id;
    exp = { ...exp, MODULE_CTRL: selected, PARA_CTRL: id, FUN_SWITCH: toggle ? (expMode() ? 0 : 1) : exp.FUN_SWITCH ?? 1 };
    const e = { MODULE_CTRL: exp.MODULE_CTRL, PARA_CTRL: exp.PARA_CTRL, FUN_SWITCH: exp.FUN_SWITCH };
    afterLiveChange();
    later(async () => {
      try {
        await dev?.setExpFunction(e);
      } catch {
        return notice("the EXP setting did not reach the pedal");
      }
      // a read of the live state still running when the toggle was tapped (after a switch) put back the stored
      // target: the pedal has this one now, so show it again
      exp = { ...exp, ...e };
      afterLiveChange();
      // into EXP mode: the pedal sets the value from where it stands; read it so the slider shows it
      if (e.FUN_SWITCH === 1) await peekLive();
    });
  }

  /** Read the pedal's live values without taking the preset again from the stored copy (adopt): unsaved edits stay. */
  let peeking = false;
  async function peekLive() {
    peeking = true;
    try {
      await dev?.readCurrent();
    } finally {
      peeking = false;
    }
  }

  function afterLiveChange() {
    report({ chain: chainOf(modules), modified: modifiedNow() });
    reportExp();
    draw();
  }

  /** The expression pedal's target and the value it sets now, for the phone. */
  function reportExp() {
    if (!lib || !exp || exp.MODULE_CTRL === undefined) return;
    const on = exp.FUN_SWITCH === 1;
    const m = modules?.[exp.MODULE_CTRL];
    const spec = on && m ? lib.expTarget(exp, m.type) : undefined;
    // FUN_SWITCH is the toe switch's mode: 1 the pedal moves the assigned parameter, 0 the volume (if EXP VOL is on)
    report({ exp: { label: on ? lib.expLabel(exp) : exp.VOL_SWITCH === 1 ? "Volume" : "Off", value: spec ? lib.formatValue(spec, m.values[spec.pos]) : "" } });
  }

  /** A footswitch selected a preset on the pedal: apply the configuration it triggers (E-004). The pedal reports `16`
   * only for its own selections, never for ours, so no selection of ours needs filtering out. */
  function onSwitched(index) {
    if (!ready) return;
    if (asking) closeSheet(); // the pedal switched by itself: the question is moot
    // one queue for all pedal work, so a configuration never interleaves with a phone command
    later(async () => {
      const c = view?.configs.find((x) => x.trigger === index);
      // on the preset the footswitch chose, even if a phone command queued earlier selected another one meanwhile
      if (c) await applyConfig({ ...c, preset: index }, current !== index ? false : true);
      if (plays()) ctx.act(playerSeat(), "switched", c ? { index, config: c.id } : { index });
    });
  }

  /** The pedal plugged in (again): connect by itself, as at the start. */
  const onHidConnect = (e) => {
    const d = e.device;
    if (lib && d?.vendorId === lib.FILTER.vendorId && d?.productId === lib.FILTER.productId && !dev && plays()) connect(false);
  };
  let hidWatched = false;

  // ---- commands from the phone ----------------------------------------------------------------------------------
  function runCommands() {
    if (!dev || !ready || !view) return;
    for (const c of view.commands) {
      if (c.n <= lastDone) continue;
      lastDone = c.n;
      later(() => (c.kind === "select" ? select(c.index) : c.kind === "save" ? storeCurrent() : applyConfig(c.config, false)));
    }
    later(() => {
      if (lastDone === lastAcked) return;
      lastAcked = lastDone;
      ctx.act(playerSeat(), "done", { n: lastDone });
    });
  }

  /** Pedal work runs one job at a time; a failed job (the pedal unplugged mid-way) does not stop the ones after it. */
  function later(job) {
    busy = busy.then(job).catch(() => {});
  }

  async function select(index) {
    if (!dev) return;
    // the board switches first, so edits made while the pedal loads the preset belong to the new preset, which is
    // where the device queue delivers them
    const before = current;
    dropEdits(); // also when this preset is selected again: that reloads it, its edits are gone
    adopt(index);
    try {
      await dev.selectAndRead(index);
    } catch (e) {
      adopt(before); // the pedal did not switch: show what it plays
      throw e;
    }
    await restoreExp(index);
  }

  /**
   * A selection from the host loads the modules but keeps the expression pedal's target and mode from before (seen in
   * the USB captures: a footswitch loads the preset's own, `96` does not), so the new preset showed * at once. Set
   * the preset's own, as its footswitch would (E-030).
   */
  async function restoreExp(index) {
    const want = stored.get(index)?.exp;
    if (!want || !exp || index !== current) return;
    const keys = ["MODULE_CTRL", "PARA_CTRL", "FUN_SWITCH"];
    if (keys.every((k) => exp[k] === want[k])) return;
    const e = Object.fromEntries(keys.map((k) => [k, want[k]]));
    await dev?.setExpFunction(e);
    exp = { ...exp, ...e };
    afterLiveChange();
    if (e.FUN_SWITCH === 1) await peekLive(); // in EXP mode the pedal may set the target from where it stands
  }

  async function applyConfig(c, fromSwitch) {
    if (!dev) return;
    if (c.preset && c.preset !== current && !fromSwitch) await select(c.preset);
    for (const [k, m] of Object.entries(c.modules)) {
      const slot = Number(k);
      await dev.setModule(slot, m);
      if (modules) modules[slot] = structuredClone(m);
    }
    if (modules) afterLiveChange();
  }

  // ---- editing on the board --------------------------------------------------------------------------------------
  /** Forget fader values still waiting to be sent (the preset changed). */
  function dropEdits() {
    for (const t of sendTimers.values()) clearTimeout(t);
    sendTimers.clear();
    sendNext.clear();
    editedAt.clear();
  }

  function setModule(slot, m) {
    modules[slot] = m;
    drawLive();
    sendNext.set(slot, m);
    editedAt.set(slot, Date.now());
    if (sendTimers.has(slot)) return;
    const flush = () => {
      const next = sendNext.get(slot);
      sendNext.delete(slot);
      if (!next) {
        sendTimers.delete(slot);
        afterLiveChange();
        return;
      }
      dev?.setModule(slot, structuredClone(next)).catch(() => {}); // (unplugged: the disconnect says so)
      sendTimers.set(slot, setTimeout(flush, SEND_MS));
    };
    flush();
  }

  function toggle(slot) {
    if (!modules || !canEdit()) return;
    setModule(slot, { ...modules[slot], on: !modules[slot].on });
  }

  function setModel(slot, type) {
    const mm = lib.model(slot, type);
    if (!mm) return;
    const values = [...modules[slot].values];
    for (const p of mm.params) {
      const [lo, hi] = lib.rawRange(p);
      values[p.pos] = Math.min(hi, Math.max(lo, values[p.pos]));
    }
    setModule(slot, { ...modules[slot], type, values });
  }

  const canEdit = () => plays() && !!dev && ready && !!modules && !view?.done;
  /** The phone has a "save before switching?" question open (E-021): the board does not switch meanwhile. */
  const phoneAsks = () => view?.confirming === "deck";
  const canSwitch = () => canEdit() && !phoneAsks();

  // ---- drawing ---------------------------------------------------------------------------------------------------
  function draw() {
    if (!view || !info) return;
    const local = plays();
    const ped = view.pedal;
    const idx = local ? current || ped.current : ped.current;
    const names = local && ready ? null : ped.names;
    const nameOf = (i) => (names ? names[i - 1] : stored.get(i)?.name.trim()) || "";
    $(".gp-label").textContent = idx ? (lib ? lib.presetLabel(idx) : "") : "";
    drawName(idx ? nameOf(idx) || "—" : null, local ? modifiedNow() : ped.modified);
    $(".gp-connect").hidden = !local || !!dev || view.done;
    $(".gp-conn").classList.toggle("can-release", local && !!dev && state.key === "connected" && !view.done);
    $(".gp-save").hidden = !local || !dev || !ready || view.done;
    if (!local) $(".gp-conn-text").textContent = ped.connected ? "Pedal connected at the table" : ped.text || "Waiting for the pedal at the table";
    if (!local) $(".gp-dot").dataset.state = ped.connected ? "on" : "off";
    drawChain();
    drawEditor();
    drawPresets(nameOf, idx);
    drawConfigs();
    box.classList.toggle("gp-readonly", !canEdit());
    drawNotice();
  }

  /** The preset's name with its modified mark ("GE150 Pro" before a preset is known). */
  let shownName = null;
  function drawName(name, modified) {
    shownName = name;
    $(".gp-name").textContent = name === null ? "GE150 Pro" : `${name}${modified ? " *" : ""}`;
  }

  /** What a fader or a module switch changes: the name's modified mark, the chain and the editor. */
  function drawLive() {
    drawName(shownName, modifiedNow());
    drawChain();
    drawEditor();
  }

  function drawChain() {
    // the chain: from the live modules here, from the view on a remote board
    const chain = plays() && modules ? modules : view.pedal.chain;
    if (!lib) return; // the chain's names come from the library
    const tiles = Array.from({ length: lib.SLOT_COUNT }, (_, s) => {
      const m = chain?.[s];
      const slotName = lib?.catalog.slots[s].name ?? "";
      const modelName = m && lib ? lib.model(s, m.type)?.name ?? `model ${m.type + 1}` : "";
      const expHere = expOf()?.MODULE_CTRL === s;
      return `<div class="gp-tile ${m?.on ? "on" : ""} ${s === selected ? "sel" : ""}" role="listitem" data-slot="${s}">
        ${expHere ? `<span class="gp-exp-badge ${expMode() ? "" : "vol"}" title="The expression pedal controls ${esc(lib.expLabel(expOf()))} in EXP mode${expMode() ? "" : "; it is in volume mode now"}">EXP</span>` : ""}
        <button class="gp-tile-body" type="button" data-slot="${s}"><span class="gp-tile-slot">${esc(slotName)}</span>
          <span class="gp-tile-model">${esc(modelName)}</span></button>
        <button class="gp-power" type="button" data-power="${s}" aria-label="${esc(slotName)} on or off" aria-pressed="${!!m?.on}" ${canEdit() ? "" : "disabled"}></button></div>`;
    }).join("");
    setHtml($(".gp-chain"), tiles);
  }

  /** Replace an element's content only when it changed (keeps focus and pressed states). */
  function setHtml(el, markup) {
    if (el.dataset.html === markup) return;
    el.dataset.html = markup;
    el.innerHTML = markup;
  }

  function drawEditor() {
    const m = modules?.[selected];
    const slotName = lib?.catalog.slots[selected].name ?? "";
    $(".gp-ed-slot").textContent = slotName;
    const mm = m && lib ? lib.model(selected, m.type) : null;
    $(".gp-model").textContent = mm ? `${String(m.type + 1).padStart(2, "0")}  ${mm.name}` : "—";
    $(".gp-model").disabled = !canEdit();
    const pw = $(".gp-ed-power");
    pw.setAttribute("aria-pressed", String(!!m?.on));
    pw.disabled = !canEdit();
    pw.dataset.power = String(selected);
    const faders = $(".gp-faders");
    if (!mm || !plays()) {
      faders.innerHTML = plays() ? `<div class="gp-empty muted">${dev ? "Loading…" : "Connect the pedal to edit its sound."}</div>` : "";
      return;
    }
    const key = `${selected}|${m.type}`;
    if (faders.dataset.key !== key) {
      faders.dataset.key = key;
      faders.innerHTML = mm.params
        .map((p, i) => `<div class="gp-fader" data-i="${i}"><div class="gp-f-value"></div>
          <div class="gp-f-track" data-i="${i}"><div class="gp-f-fill"></div><div class="gp-f-knob"></div></div>
          <div class="gp-f-name">${esc(p.name)}</div>
          <div class="gp-f-step"><button type="button" class="gp-btn gp-f-dec" data-i="${i}" aria-label="Less ${esc(p.name)}">−</button>
            <button type="button" class="gp-btn gp-f-inc" data-i="${i}" aria-label="More ${esc(p.name)}">+</button></div>
          ${lib.expParamId(selected, p.name) !== undefined ? `<button type="button" class="gp-btn gp-f-exp" data-i="${i}" aria-pressed="false" aria-label="Expression pedal controls ${esc(p.name)}">EXP</button>` : `<div class="gp-f-exp-none"></div>`}</div>`)
        .join("");
    }
    mm.params.forEach((p, i) => {
      const el = faders.querySelector(`.gp-fader[data-i="${i}"]`);
      const raw = m.values[p.pos];
      const f = lib.rawFraction(p, raw);
      el.querySelector(".gp-f-value").textContent = lib.formatValue(p, raw);
      el.querySelector(".gp-f-fill").style.height = `${f * 100}%`;
      el.querySelector(".gp-f-knob").style.bottom = `calc(${f * 100}% - 14px)`; // (the track's margin keeps it off the name)
      const xb = el.querySelector(".gp-f-exp");
      if (xb) {
        const on = !!exp && exp.MODULE_CTRL === selected && exp.PARA_CTRL === lib.expParamId(selected, p.name);
        xb.setAttribute("aria-pressed", String(on));
        // the target: filled in EXP mode, only outlined in volume mode; tapping it again switches the mode
        xb.classList.toggle("vol", on && !expMode());
        xb.setAttribute("aria-label", on ? `EXP controls ${p.name}: ${expMode() ? "EXP mode, tap for volume mode" : "volume mode, tap for EXP mode"}` : `Expression pedal controls ${p.name}`);
        xb.disabled = !canEdit() || !exp;
      }
    });
    $(".gp-exp-note").hidden = !exp || exp.FUN_SWITCH === 1;
  }

  function drawPresets(nameOf, idx) {
    $(".gp-bank-name").textContent = `Bank ${bank}`;
    const btns = [0, 1, 2, 3].map((k) => {
      const i = (bank - 1) * 4 + k + 1;
      return `<button type="button" class="gp-preset ${i === idx ? "on" : ""}" data-index="${i}" ${canSwitch() ? "" : "disabled"}>
        <b>${"ABCD"[k]}</b><span>${esc(nameOf(i) || "")}</span></button>`;
    }).join("");
    setHtml($(".gp-abcd"), btns);
    $(".gp-presets-hint").textContent = phoneAsks()
      ? "The phone is asking whether to save the changes first: answer there."
      : prefsOf(info).confirm
        ? "Tap a preset to select it on the pedal. With unsaved changes, the board offers to save them first."
        : "Tap a preset to select it on the pedal. Unsaved changes on the pedal are lost when it switches.";
    $(".gp-presets").hidden = tab !== "presets";
    $(".gp-configs").hidden = tab !== "configs";
    box.querySelectorAll(".gp-tab").forEach((t) => t.classList.toggle("on", t.dataset.tab === tab));
  }

  function drawConfigs() {
    $(".gp-capture").disabled = !canEdit();
    $(".gp-file-save").disabled = !plays() || !(view.configs ?? []).length;
    $(".gp-file-load").disabled = !plays() || !!view.done;
    const rows = (view.configs ?? []).map((c) => {
      const what = Object.keys(c.modules).map((k) => lib?.catalog.slots[Number(k)].name ?? k).join(", ");
      const tags = c.tags ?? [];
      return `<div class="gp-config"><div class="gp-config-text" role="button" tabindex="0" data-id="${esc(c.id)}" title="What ${esc(c.name)} sets"><b>${esc(c.name)}</b><span class="muted">${esc(what || "preset only")}</span>
          <span class="gp-tags">${tags.map((t) => `<i>${esc(t)}</i>`).join("")}</span></div>
        <button type="button" class="gp-btn gp-apply" data-id="${esc(c.id)}" ${canSwitch() ? "" : "disabled"}>Load</button>
        <button type="button" class="gp-btn gp-delete" data-id="${esc(c.id)}" aria-label="Delete ${esc(c.name)}" ${plays() && !view.done ? "" : "disabled"}>✕</button></div>`;
    }).join("");
    const list = rows || `<div class="gp-empty muted">No configurations yet. Shape the sound, then Save configuration… to put it on a quick slot of the phone or on a footswitch.</div>`;
    setHtml($(".gp-config-list"), list);
    touchScroll($(".gp-config-list")); // (measures again: the list or the tab changed)
  }

  // ---- sheets ----------------------------------------------------------------------------------------------------
  function openSheet(inner, wire) {
    const wrap = $(".gp-sheet-wrap");
    // a sheet's own handler on the container (Save configuration…) must not answer the next sheet's buttons
    $(".gp-sheet").onclick = null;
    $(".gp-sheet").innerHTML = inner;
    wrap.hidden = false;
    $(".gp-sheet").querySelectorAll(".gp-scroll").forEach(touchScroll); // lists in a window: the wide bar (D-306)
    wire($(".gp-sheet"));
  }
  function closeSheet() {
    $(".gp-sheet-wrap").hidden = true;
    if (!asking) return;
    asking = false;
    if (plays()) ctx.act(playerSeat(), "confirm", { from: "board", on: false });
  }

  /**
   * A switch to another preset asked for on the board (`go` carries it out). With the setting on and unsaved changes,
   * the board asks first whether to save them; the phone cannot switch while it asks (E-021).
   */
  function switchFromBoard(target, go) {
    if (!canSwitch()) return;
    if (!prefsOf(info).confirm || !modifiedNow()) return later(go);
    const from = lib.presetLabel(current), to = target ? lib.presetLabel(target) : from;
    const name = stored.get(current)?.name?.trim() || from;
    asking = true;
    ctx.act(playerSeat(), "confirm", { from: "board", on: true });
    openSheet(
      `<div class="gp-sheet-head"><div class="gp-sheet-title">Save the changes to ${esc(from)}?</div></div>
      <p class="gp-sheet-text">"${esc(name)}" has unsaved changes. ${to === from ? `Selecting ${esc(to)} again reloads it and` : `Switching to ${esc(to)}`} discards them, unless you save them to ${esc(from)} first.</p>
      <div class="gp-sheet-btns"><button type="button" class="gp-btn gp-no">Cancel</button><button type="button" class="gp-btn gp-discard">Discard and switch</button>
        <button type="button" class="gp-btn primary gp-yes">Save and switch</button></div>`,
      (el) => {
        el.querySelector(".gp-no").onclick = closeSheet;
        el.querySelector(".gp-discard").onclick = () => (closeSheet(), later(go));
        el.querySelector(".gp-yes").onclick = () => {
          closeSheet();
          later(async () => {
            await storeCurrent();
            await go();
          });
        };
      },
    );
  }

  function openModels() {
    if (!canEdit()) return;
    const models = lib.catalog.slots[selected].models;
    openSheet(
      `<div class="gp-sheet-head"><div class="gp-sheet-title">${esc(lib.catalog.slots[selected].name)}: choose a model</div>
        <button type="button" class="gp-btn gp-close">Close</button></div>
      <div class="gp-models gp-scroll">${models.map((m) => `<button type="button" class="gp-model-card ${m.index === modules[selected].type ? "on" : ""}" data-type="${m.index}">
        <span>${String(m.index + 1).padStart(2, "0")}</span><b>${esc(m.name)}</b></button>`).join("")}</div>`,
      (el) => {
        el.querySelector(".gp-close").onclick = closeSheet;
        scrollTo(el.querySelector(".gp-models"), el.querySelector(".gp-model-card.on"));
        el.querySelector(".gp-models").onclick = (e) => {
          const b = e.target.closest(".gp-model-card");
          if (!b) return;
          setModel(selected, Number(b.dataset.type));
          closeSheet();
        };
      },
    );
  }

  /** A sheet's list that scrolls: the wide bar for a finger, with the chosen entry in view. */
  function scrollTo(list, chosen) {
    touchScroll(list);
    if (chosen) list.scrollTop = chosen.offsetTop - list.offsetTop - (list.clientHeight - chosen.offsetHeight) / 2;
    touchScroll(list); // (measures again after the scroll)
  }

  /**
   * Every bank with its four presets (E-029, E-030): the bank shown on the right and the preset that plays are marked,
   * the playing one with * for unsaved changes. A preset selects it on the pedal (asking about unsaved changes, as the
   * A-D buttons do); a bank's number only shows that bank. Reload saved discards the unsaved changes.
   */
  function openBanks() {
    if (!lib) return;
    const local = plays();
    const names = local && ready ? null : view.pedal.names;
    const nameOf = (i) => (names ? names[i - 1] : stored.get(i)?.name.trim()) || "";
    const playing = local ? current || view.pedal.current : view.pedal.current;
    const unsaved = local ? modifiedNow() : !!view.pedal.modified;
    const rows = Array.from({ length: banks() }, (_, b) => {
      const cells = [0, 1, 2, 3].map((k) => {
        const i = b * 4 + k + 1;
        const on = i === playing;
        return `<button type="button" class="gp-bk-preset ${on ? "on" : ""}" data-bank="${b + 1}" data-index="${i}"${on ? ' aria-current="true"' : ""}><b>${"ABCD"[k]}</b><span>${esc(nameOf(i) || "—")}${on && unsaved ? " *" : ""}</span></button>`;
      }).join("");
      const shown = b + 1 === bank;
      return `<div class="gp-bk-row ${shown ? "sel" : ""}"><button type="button" class="gp-bk-num" data-bank="${b + 1}" aria-label="Show bank ${b + 1}${shown ? " (shown)" : ""}">${b + 1}</button>${cells}</div>`;
    }).join("");
    openSheet(
      `<div class="gp-sheet-head"><div class="gp-sheet-title">Banks</div>
        <div class="gp-sheet-head-btns"><button type="button" class="gp-btn gp-reload" ${canSwitch() ? "" : "disabled"}>Reload saved</button>
        <button type="button" class="gp-btn gp-close">Close</button></div></div>
      <div class="gp-banks gp-scroll">${rows}</div>`,
      (el) => {
        el.querySelector(".gp-close").onclick = closeSheet;
        el.querySelector(".gp-reload").onclick = askReload;
        scrollTo(el.querySelector(".gp-banks"), el.querySelector(".gp-bk-row.sel"));
        el.querySelector(".gp-banks").onclick = (e) => {
          const b = e.target.closest("[data-bank]");
          if (!b) return;
          bank = Number(b.dataset.bank);
          closeSheet();
          draw();
          const i = Number(b.dataset.index);
          if (i && canSwitch()) switchFromBoard(i, () => select(i));
        };
      },
    );
  }

  /** Back to the saved presets (E-030): the pedal selects the playing preset again, which drops its unsaved changes. */
  function askReload() {
    if (!canSwitch()) return;
    const label = lib.presetLabel(current);
    ask(
      "Reload the saved presets?",
      modifiedNow()
        ? `${label} plays with unsaved changes. Reloading selects it again from the pedal's memory, so these changes are lost. The other presets have none: the pedal keeps unsaved changes only for the preset that plays.`
        : `No preset has unsaved changes. Reloading selects ${label} again from the pedal's memory, its expression pedal setting included.`,
      "Reload",
      () => later(() => select(current)),
    );
  }

  function openSave() {
    if (!canEdit()) return;
    const label = lib.presetLabel(current);
    openSheet(
      `<div class="gp-sheet-head"><div class="gp-sheet-title">Save preset ${esc(label)}?</div></div>
      <p class="gp-sheet-text">This overwrites the preset stored in slot ${esc(label)} on the pedal with the sound it plays now.
        The pedal keeps it without the table.</p>
      <div class="gp-sheet-btns"><button type="button" class="gp-btn gp-no">Cancel</button><button type="button" class="gp-btn primary gp-yes">Save to ${esc(label)}</button></div>`,
      (el) => {
        el.querySelector(".gp-no").onclick = closeSheet;
        el.querySelector(".gp-yes").onclick = () => {
          closeSheet();
          later(storeCurrent);
        };
      },
    );
  }

  /** Tap "Connected": let go of the pedal, after asking, so another program can use it (E-025). */
  function askDisconnect() {
    if (!plays() || !dev || state.key !== "connected") return;
    const unsaved = modifiedNow() ? " The unsaved changes stay on the pedal until it switches presets; Save preset… keeps them." : "";
    ask("Disconnect the pedal?", `The table lets go of the GE150 Pro, so Mooer's editor or the GE150 Pro Editor web app (klaushofrichter.github.io/ge150pro-editor) can use it. The pedal keeps playing.${unsaved} Connect pedal connects again.`, "Disconnect", () => {
      released = true;
      const d = dev;
      reset();
      d?.close().catch(() => {});
      status("released");
      draw();
    });
  }

  /** A small question in the board's sheet: Cancel and one action. */
  function ask(title, text, action, run) {
    openSheet(
      `<div class="gp-sheet-head"><div class="gp-sheet-title">${esc(title)}</div></div><p class="gp-sheet-text">${esc(text)}</p>
      <div class="gp-sheet-btns"><button type="button" class="gp-btn gp-no">Cancel</button><button type="button" class="gp-btn primary gp-yes">${esc(action)}</button></div>`,
      (el) => {
        el.querySelector(".gp-no").onclick = closeSheet;
        el.querySelector(".gp-yes").onclick = () => (closeSheet(), run());
      },
    );
  }

  /** Deleting a configuration takes it from the table for everyone, without undo: ask first (E-023). */
  function confirmDelete(c) {
    const tags = (c.tags ?? []).filter((t) => !t.startsWith("on "));
    ask(`Delete "${c.name}"?`, `${tags.length ? `It is on ${tags.join(" and ")}. ` : ""}It is gone for everyone who plays at this table; a file saved before keeps it.`, "Delete", () => {
      if (plays()) ctx.act(playerSeat(), "edit", { id: c.id, remove: true });
    });
  }

  /** All configurations into one file on this computer (E-023). */
  function saveFile() {
    const list = forTable(view.configs);
    if (!list.length) return;
    ask(`Save all ${list.length} configurations to a file?`, "The browser saves one file with every configuration. Load all from file… brings them back, here or on another table.", "Save to file", () => {
      const blob = new Blob([JSON.stringify({ format: FILE_FORMAT, version: 1, configs: list }, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `ge150-pro-configurations-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
  }

  /** A file chosen with Load all from file…: after asking, its configurations replace the table's (E-023). */
  async function loadFile(file) {
    let list;
    try {
      const data = JSON.parse(await file.text());
      list = Array.isArray(data) ? data : data?.format === FILE_FORMAT && Array.isArray(data.configs) ? data.configs : null;
    } catch {
      list = null;
    }
    if (!list) return ask("Not a configurations file", `${file.name} is not a file saved with Save all to file….`, "OK", () => {});
    const have = (view.configs ?? []).length;
    ask(
      `Load ${list.length} configurations from ${file.name}?`,
      `They replace ${have ? `the ${have} configurations` : "the configurations"} this table keeps, for everyone who plays here, quick slots and footswitches included.${have ? " Save all to file… first keeps the current ones." : ""}`,
      "Load all",
      async () => {
        const r = await ctx.act(playerSeat(), "configs", { list, replace: true });
        if (r && !r.ok) ask("Not loaded", r.reason || "The game did not take the file.", "OK", () => {});
      },
    );
  }

  /** The current preset as the pedal plays it: every module with its switch, model and values; nothing to change (E-024). */
  function openPresetInfo() {
    if (!lib || !modules || !current) return;
    const base = stored.get(current);
    const name = base?.name?.trim() || lib.presetLabel(current);
    const unsaved = modifiedNow();
    // unsaved changes marked against the stored preset (E-030): what Save keeps, without the pedal's position
    const live = unsaved ? kept() : modules;
    const expNote = unsaved && expChanged() ? `<p class="gp-sheet-text gp-chg-note">The expression pedal controls ${esc(lib.expLabel(exp))}; saved: ${esc(lib.expLabel(base.exp))}.</p>` : "";
    openSheet(
      `<div class="gp-sheet-head"><div class="gp-sheet-title">${esc(lib.presetLabel(current))} · ${esc(name)}${unsaved ? " *" : ""}</div></div>
      <div class="gp-cfg-mods gp-scroll">${modulesHtml(live.map((m, s) => [s, m]), unsaved ? base.modules : null)}</div>${expNote}
      <p class="gp-sheet-text muted">As the pedal plays it now${unsaved ? ", with the unsaved changes (*) in brass next to the saved value. Reset goes back to the saved preset" : ""}. Change modules in the signal chain above, or in the GE150 Pro Editor web app.</p>
      <div class="gp-sheet-btns">${unsaved ? `<button type="button" class="gp-btn gp-reset" ${canSwitch() ? "" : "disabled"}>Reset</button>` : ""}<button type="button" class="gp-btn primary gp-no">Close</button></div>`,
      (el) => {
        el.querySelector(".gp-no").onclick = closeSheet;
        const r = el.querySelector(".gp-reset");
        if (r) r.onclick = () => (closeSheet(), canSwitch() && later(() => select(current)));
      },
    );
  }

  /**
   * Module cards for a sheet: [slot, {on, type, values}] → name, switch, model and (when on) its values. With `saved`
   * (the stored modules), what differs from it is marked, with the saved value.
   */
  function modulesHtml(entries, saved = null) {
    return entries
      .map(([s, m]) => {
        const mm = lib.model(s, m.type);
        const was = saved?.[s];
        const sameModel = !was || was.type === m.type;
        const vals = m.on && mm
          ? mm.params.map((p) => {
              const chg = was && sameModel && was.values[p.pos] !== m.values[p.pos];
              return `<span class="${chg ? "chg" : ""}"><i>${esc(p.name)}</i> ${esc(lib.formatValue(p, m.values[p.pos]))}${chg ? ` <small>saved ${esc(lib.formatValue(p, was.values[p.pos]))}</small>` : ""}</span>`;
            }).join("")
          : "";
        const onOff = m.on ? "On" : "Off";
        const head = [
          was && was.on !== m.on ? `<em class="chg">${onOff}</em> <small>saved ${was.on ? "on" : "off"}</small>` : onOff,
          ...(mm ? [sameModel ? esc(mm.name) : `<em class="chg">${esc(mm.name)}</em> <small>saved ${esc(lib.model(s, was.type)?.name ?? "")}</small>`] : []),
        ].join(" · ");
        const changed = was && !sameModule(m, was);
        return `<div class="gp-cfg-mod ${m.on ? "" : "off"} ${changed ? "changed" : ""}"><div class="gp-cfg-mod-head"><b>${esc(lib.catalog.slots[s].name)}</b>
          <span>${head}</span></div>${vals ? `<div class="gp-cfg-vals">${vals}</div>` : ""}</div>`;
      })
      .join("");
  }

  /** Load a configuration on the pedal: one on another preset switches to it first (asking about unsaved changes). */
  function loadConfig(c) {
    if (c.preset && c.preset !== current) switchFromBoard(c.preset, () => applyConfig(c, false));
    else if (canSwitch()) later(() => applyConfig(c, false));
  }

  /** What a configuration sets: its preset, slot and footswitch, and each stored module with its values. */
  function openConfig(c) {
    if (!lib) return;
    const where = [
      c.preset ? `Selects ${esc(lib.presetLabel(c.preset))} ${esc(stored.get(c.preset)?.name?.trim() ?? "")} first.` : "Changes the preset that plays.",
      ...(c.tags ?? []).filter((t) => !t.startsWith("on ")).map((t) => esc(t)),
    ].join(" · ");
    const mods = modulesHtml(Object.entries(c.modules).map(([k, m]) => [Number(k), m]));
    openSheet(
      `<div class="gp-sheet-head"><div class="gp-sheet-title">${esc(c.name)}</div></div>
      <p class="gp-sheet-text">${where}</p>
      <div class="gp-cfg-mods gp-scroll">${mods || `<div class="muted">No module settings: it only selects the preset.</div>`}</div>
      <p class="gp-sheet-text muted">${Object.keys(c.modules).length < 9 ? "The other modules stay as they are. " : ""}Load sets these values on the pedal now, as unsaved changes; Save preset… keeps them.</p>
      <div class="gp-sheet-btns"><button type="button" class="gp-btn gp-no">Close</button>
        <button type="button" class="gp-btn primary gp-yes" ${canSwitch() ? "" : "disabled"}>Load</button></div>`,
      (el) => {
        el.querySelector(".gp-no").onclick = closeSheet;
        el.querySelector(".gp-yes").onclick = () => {
          closeSheet();
          loadConfig(c);
        };
      },
    );
  }

  /** Store the sound the pedal plays now into the current preset's slot, and wait for the pedal to acknowledge it. */
  async function storeCurrent() {
    const p = stored.get(current);
    if (!p || !dev) return;
    const acked = new Promise((resolve) => {
      const timer = setTimeout(resolve, 3000);
      storedWait = (i) => i === p.index && (clearTimeout(timer), resolve());
    });
    // the toe switch's mode is playing too: the preset keeps its own FUN_SWITCH
    await dev.storePreset({ ...p, modules: structuredClone(kept()), exp: { ...p.exp, ...(exp ?? {}), FUN_SWITCH: p.exp.FUN_SWITCH } }).catch(() => {});
    await acked;
    storedWait = null;
  }

  function openCapture() {
    if (!canEdit()) return;
    const base = stored.get(current);
    const changed = kept().map((m, s) => !base || !sameModule(m, base.modules[s]));
    const pick = new Set(changed.some(Boolean) ? changed.flatMap((c, s) => (c ? [s] : [])) : modules.flatMap((m, s) => (m.on ? [s] : [])));
    const quick = Array.from({ length: view.quickSlots }, (_, q) => q);
    let slot = quick.find((q) => !view.configs.some((c) => c.slot === q)) ?? null;
    let trigger = false, withPreset = false;
    const used = (q) => view.configs.find((c) => c.slot === q)?.name;
    const render = () => `<div class="gp-sheet-head"><div class="gp-sheet-title">Save a configuration</div>
        <button type="button" class="gp-btn gp-close">Cancel</button></div>
      <div class="gp-cap-row"><div class="gp-cap-label">Modules it sets</div><div class="gp-cap-mods">
        ${modules.map((m, s) => `<button type="button" class="gp-chip ${pick.has(s) ? "on" : ""}" data-mod="${s}">${esc(lib.catalog.slots[s].name)}${changed[s] ? " •" : ""}</button>`).join("")}</div></div>
      <div class="gp-cap-row"><div class="gp-cap-label">Quick slot on the phone</div><div class="gp-cap-mods">
        <button type="button" class="gp-chip ${slot === null ? "on" : ""}" data-slot="-1">None</button>
        ${quick.map((q) => `<button type="button" class="gp-chip ${slot === q ? "on" : ""}" data-slot="${q}">${q + 1}${used(q) ? " ↺" : ""}</button>`).join("")}</div></div>
      <div class="gp-cap-row"><div class="gp-cap-label">Options</div><div class="gp-cap-mods">
        <button type="button" class="gp-chip ${withPreset ? "on" : ""}" data-opt="preset">Select ${esc(lib.presetLabel(current))} first</button>
        <button type="button" class="gp-chip ${trigger ? "on" : ""}" data-opt="trigger">Apply when ${esc(lib.presetLabel(current))} is chosen with the footswitch</button></div></div>
      <p class="gp-sheet-text muted">• changed from the stored preset. ↺ the slot is taken; this configuration replaces it there.
        The name can be changed on the phone.</p>
      <div class="gp-sheet-btns"><button type="button" class="gp-btn primary gp-yes" ${pick.size || withPreset ? "" : "disabled"}>Save configuration</button></div>`;
    const wireIt = (el) => {
      el.querySelector(".gp-close").onclick = closeSheet;
      el.onclick = (e) => {
        const b = e.target.closest("button");
        if (!b) return;
        if (b.dataset.mod) pick.has(Number(b.dataset.mod)) ? pick.delete(Number(b.dataset.mod)) : pick.add(Number(b.dataset.mod));
        else if (b.dataset.slot) slot = b.dataset.slot === "-1" ? null : Number(b.dataset.slot);
        else if (b.dataset.opt === "preset") withPreset = !withPreset;
        else if (b.dataset.opt === "trigger") trigger = !trigger;
        else if (b.classList.contains("gp-yes")) {
          const n = (view.configs?.length ?? 0) + 1;
          const names = [...pick].map((s) => lib.catalog.slots[s].name.split("/")[0]);
          const name = `${names.slice(0, 2).join("+") || "Preset"}${names.length > 2 ? "+…" : ""} ${lib.presetLabel(current)}`.slice(0, 24);
          const config = {
            id: `c${Date.now().toString(36)}${n}`,
            name,
            slot,
            trigger: trigger ? current : null,
            preset: withPreset ? current : null,
            modules: Object.fromEntries([...pick].sort().map((s) => [String(s), structuredClone(modules[s])])),
          };
          closeSheet();
          ctx.act(playerSeat(), "capture", { config });
          tab = "configs";
          return;
        } else return;
        el.innerHTML = render();
        wireIt(el);
      };
    };
    openSheet(render(), wireIt);
  }

  // ---- touch -----------------------------------------------------------------------------------------------------
  $(".gp-connect").addEventListener("click", () => connect(true));
  $(".gp-conn-text").addEventListener("click", askDisconnect);
  $(".gp-dot").addEventListener("click", askDisconnect);
  $(".gp-notice-connect").addEventListener("click", () => connect(true));
  $(".gp-save").addEventListener("click", openSave);
  $(".gp-now").addEventListener("click", openPresetInfo);
  $(".gp-model").addEventListener("click", openModels);
  $(".gp-capture").addEventListener("click", openCapture);
  $(".gp-file-save").addEventListener("click", saveFile);
  $(".gp-file-load").addEventListener("click", () => $(".gp-file-input").click());
  $(".gp-file-input").addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) loadFile(f);
  });
  $(".gp-sheet-wrap").addEventListener("click", (e) => e.target === $(".gp-sheet-wrap") && closeSheet());
  box.querySelector(".gp-tabs").addEventListener("click", (e) => {
    const t = e.target.closest(".gp-tab");
    if (t) (tab = t.dataset.tab), draw();
  });
  const banks = () => lib.PRESET_COUNT / 4;
  $(".gp-bank-prev").addEventListener("click", () => ((bank = bank === 1 ? banks() : bank - 1), draw()));
  $(".gp-bank-next").addEventListener("click", () => ((bank = bank === banks() ? 1 : bank + 1), draw()));
  $(".gp-bank-name").addEventListener("click", openBanks);
  $(".gp-abcd").addEventListener("click", (e) => {
    const b = e.target.closest(".gp-preset");
    if (b) switchFromBoard(Number(b.dataset.index), () => select(Number(b.dataset.index)));
  });
  box.addEventListener("click", (e) => {
    const pw = e.target.closest("[data-power]");
    if (pw) return toggle(Number(pw.dataset.power));
    const tile = e.target.closest(".gp-tile-body");
    if (tile) {
      selected = Number(tile.dataset.slot);
      draw();
    }
  });
  $(".gp-config-list").addEventListener("click", (e) => {
    const a = e.target.closest(".gp-apply");
    if (a) {
      const c = view.configs.find((x) => x.id === a.dataset.id);
      if (c) loadConfig(c);
      return;
    }
    const t = e.target.closest(".gp-config-text");
    if (t) {
      const c = view.configs.find((x) => x.id === t.dataset.id);
      if (c) openConfig(c);
      return;
    }
    const d = e.target.closest(".gp-delete");
    if (d && plays()) {
      const c = view.configs.find((x) => x.id === d.dataset.id);
      if (c) confirmDelete(c);
    }
  });
  // faders: drag anywhere on the track; − and + step by one
  const faders = $(".gp-faders");
  /** One drag per finger (pointerId → fader), so two faders move at once on a multitouch screen. */
  const drags = new Map();
  const valueAt = (r, y, p) => {
    const f = Math.min(1, Math.max(0, (r.bottom - y) / r.height));
    const [lo, hi] = lib.rawRange(p);
    return Math.round(lo + f * (hi - lo));
  };
  const setParam = (i, raw) => {
    const mm = lib.model(selected, modules[selected].type);
    const p = mm.params[i];
    const [lo, hi] = lib.rawRange(p);
    const values = [...modules[selected].values];
    values[p.pos] = Math.min(hi, Math.max(lo, raw));
    if (values[p.pos] !== modules[selected].values[p.pos]) setModule(selected, { ...modules[selected], values });
  };
  const follow = (d, y) => setParam(d.i, valueAt(d.rect, y, lib.model(selected, modules[selected].type).params[d.i]));
  faders.addEventListener("pointerdown", (e) => {
    const track = e.target.closest(".gp-f-track");
    if (!track || !canEdit()) return;
    const d = { i: Number(track.dataset.i), rect: track.getBoundingClientRect() };
    drags.set(e.pointerId, d);
    track.setPointerCapture(e.pointerId);
    follow(d, e.clientY);
  });
  faders.addEventListener("pointermove", (e) => {
    const d = drags.get(e.pointerId);
    if (d && canEdit()) follow(d, e.clientY);
  });
  const endDrag = (e) => drags.delete(e.pointerId);
  faders.addEventListener("pointerup", endDrag);
  faders.addEventListener("pointercancel", endDrag);
  faders.addEventListener("click", (e) => {
    const x = e.target.closest(".gp-f-exp");
    if (x) return assignExp(Number(x.dataset.i));
    const b = e.target.closest(".gp-f-dec, .gp-f-inc");
    if (!b || !canEdit()) return;
    const i = Number(b.dataset.i);
    const p = lib.model(selected, modules[selected].type).params[i];
    setParam(i, modules[selected].values[p.pos] + (b.classList.contains("gp-f-inc") ? 1 : -1));
  });

  // ---- the table's click track (E-005) ---------------------------------------------------------------------------
  let audio = null, clickTimer = null, nextAt = 0, beat = 0, clickRun = -1;
  function tickClick() {
    const c = view?.click;
    if (!audio || !c?.on) return;
    const vol = prefsOf(info).volume / 100;
    while (nextAt < audio.currentTime + 0.12) {
      if (vol > 0 && info?.sound !== false) {
        const o = audio.createOscillator(), g = audio.createGain();
        o.frequency.value = beat % c.beats === 0 ? 1760 : 1175;
        g.gain.setValueAtTime(0.0001, nextAt);
        g.gain.exponentialRampToValueAtTime(0.6 * vol, nextAt + 0.002);
        g.gain.exponentialRampToValueAtTime(0.0001, nextAt + 0.05);
        o.connect(g).connect(audio.destination);
        o.start(nextAt);
        o.stop(nextAt + 0.06);
      }
      beat++;
      nextAt += 60 / view.tempo;
    }
  }
  function syncClick() {
    const c = view?.click;
    const want = plays() && !!c?.on && !view.done;
    if (!want) {
      if (clickTimer) clearInterval(clickTimer), (clickTimer = null);
      return;
    }
    audio = sharedAudio();
    if (!audio) return;
    if (c.run !== clickRun || !clickTimer) {
      clickRun = c.run;
      beat = 0;
      nextAt = audio.currentTime + 0.1;
    }
    clickTimer ??= setInterval(tickClick, 25);
  }

  const inst = {
    reconnect() {
      dev?.close().catch(() => {});
      reset();
      connect(true);
    },
    update(v, _events, i) {
      view = v;
      info = i;
      seatPlates(root, info).classList.toggle("gp-north", info.rotation === 180);
      box.classList.toggle("gp-north", info.rotation === 180);
      const local = plays();
      syncTable();
      box.classList.toggle("gp-remote", !local);
      const away = $(".gp-away");
      away.hidden = local;
      if (!local) {
        const me = info.players.find((p) => p.seat === v.seat);
        away.innerHTML = `<div class="gp-away-box">The pedal is connected to the table's own screen; ${esc(me?.name ?? "the player")} controls it there.</div>`;
      }
      loadLib().then(() => {
        if (dead) return;
        if (local && !hidWatched && navigator.hid) {
          hidWatched = true;
          navigator.hid.addEventListener("connect", onHidConnect);
        }
        if (local && !dev && !opening && !ready) connect(false);
        // commands still in the view were not acknowledged yet: carry them out (each once)
        if (lastDone === 0 && v.commands.length) lastDone = v.commands[0].n - 1;
        runCommands();
        // a question this board had open before it was reloaded is gone
        if (local && v.confirming === "board" && !asking) ctx.act(playerSeat(), "confirm", { from: "board", on: false });
        syncClick();
        draw();
      });
    },
    destroy() {
      dead = true;
      clearTimeout(tableRetry);
      clearTimeout(reportTimer);
      clearTimeout(noticeTimer);
      dropEdits();
      if (hidWatched) navigator.hid?.removeEventListener("connect", onHidConnect);
      if (clickTimer) clearInterval(clickTimer);
      dev?.close().catch(() => {});
      box.remove();
    },
  };
  inst.settings = (args) => settings(args, () => inst.reconnect());
  return inst;
}
