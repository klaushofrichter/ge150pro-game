// GE150 Pro on the board: the pedal's signal chain and its parameters by touch, the presets, and the configurations
// the phone recalls. The pedal is driven over WebHID by the table's own board only, for the player sitting at it
// (E-002); a remote board shows the state and a note. The protocol library is assets/ge150.js (src/ge150/).
import { audio as sharedAudio, esc, html, seatPlates, useStyles } from "/shared/board-kit.js";

const ID = "ge150-pro";
const REPORT_MS = 150; // reports to the rules are merged for this long (each counts as a move)
const SEND_MS = 40; // a fader sends at most once per this interval
const VOLUMES = [0, 20, 40, 60, 80, 100];
/** The oldest supported firmware (src/ge150/compat.ts MIN_FIRMWARE; the settings window needs it before the library loads). */
const MIN_FIRMWARE = "V2.1.2";
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
  unsupported: { title: "Firmware not supported",
    text: `The game needs firmware ${MIN_FIRMWARE} or newer. Update the pedal with Mooer's editor; the game changes nothing on this pedal.` },
  error: { title: "Pedal error", text: "" },
};
const prefsOf = (info) => ({ volume: VOLUMES.includes(info?.prefs?.volume) ? info.prefs.volume : 60 });

/** The mounted board, for the settings window. */
let live = null;

export function settings({ info, setPrefs }) {
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
    { type: "button", label: "Pedal", action: "Connect the pedal again", onChange: () => live?.reconnect() },
    { type: "text", label: "Requires", value: `Mooer GE150 Pro by USB, firmware ${MIN_FIRMWARE} or newer` },
  ];
}

export function mount(root, ctx) {
  useStyles(`/games/${ID}/board.css`);
  const box = html(`<div class="gp-root">
    <div class="gp-bar">
      <div class="gp-conn"><span class="gp-dot"></span><div class="gp-conn-text"></div>
        <button class="gp-btn primary gp-connect" type="button" hidden>Connect pedal</button></div>
      <div class="gp-now"><div class="gp-label"></div><div class="gp-name"></div></div>
      <div class="gp-bar-right"><button class="gp-btn gp-save" type="button">Save…</button></div>
    </div>
    <div class="gp-chain" role="list"></div>
    <div class="gp-main">
      <section class="gp-editor">
        <div class="gp-ed-head"><div><div class="gp-ed-slot"></div><button class="gp-btn gp-model" type="button"></button></div>
          <button class="gp-power gp-ed-power" type="button" aria-label="Switch the module on or off"></button></div>
        <div class="gp-faders"></div>
        <div class="gp-notice" hidden><div class="gp-notice-title"></div><div class="gp-notice-text"></div>
          <button class="gp-btn primary gp-notice-connect" type="button" hidden>Connect pedal</button>
          <div class="gp-req"><div class="gp-eyebrow">Requires</div>
            <div class="gp-req-row"><b>Device</b><span>Mooer GE150 Pro, connected to this table by USB</span></div>
            <div class="gp-req-row"><b>Firmware</b><span class="gp-req-fw"></span></div>
            <div class="gp-req-note muted">The pedal does not tell its firmware version over USB, so the board checks how it
              answers. Update an older pedal with Mooer's GE150 Pro editor.</div></div></div>
      </section>
      <section class="gp-side">
        <div class="gp-tabs" role="tablist"><button class="gp-tab on" type="button" data-tab="presets">Presets</button>
          <button class="gp-tab" type="button" data-tab="configs">Configurations</button></div>
        <div class="gp-pane gp-presets">
          <div class="gp-bank"><button class="gp-btn gp-bank-prev" type="button" aria-label="Previous bank">◀</button>
            <div class="gp-bank-name"></div><button class="gp-btn gp-bank-next" type="button" aria-label="Next bank">▶</button></div>
          <div class="gp-abcd"></div>
          <div class="gp-hint muted">Tap a preset to select it on the pedal. Unsaved changes on the pedal are lost when it switches.</div>
        </div>
        <div class="gp-pane gp-configs" hidden>
          <button class="gp-btn primary gp-capture" type="button">Save configuration…</button>
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
  const sendTimers = new Map(), sendNext = new Map();

  const playerSeat = () => (view ? view.seat : null);
  /** This board drives the pedal: the table's own board, for the player sitting at the table (controlSeats). */
  const plays = () => !!info && !!view && info.controlSeats?.includes(view.seat);

  // ---- reports to the rules -------------------------------------------------------------------------------------
  function report(patch) {
    if (!plays() || view?.done) return;
    if (!ready && !("connected" in patch)) return; // nothing about an unchecked pedal reaches the table
    Object.assign(pending, patch);
    reportTimer ??= setTimeout(() => {
      reportTimer = null;
      const p = pending;
      pending = {};
      ctx.act(playerSeat(), "pedal", p);
    }, REPORT_MS);
  }
  const chainOf = (mods) => mods.map((m) => ({ on: m.on, type: m.type }));
  const sameModule = (a, b) => a && b && a.on === b.on && a.type === b.type && a.values.every((v, i) => v === b.values[i]);
  const modifiedNow = () => !!modules && !!stored.get(current) && modules.some((m, s) => !sameModule(m, stored.get(current).modules[s]));

  // ---- the pedal ------------------------------------------------------------------------------------------------
  async function loadLib() {
    lib ??= await import(ctx.assetUrl("ge150.js"));
    return lib;
  }

  async function connect(fromTouch) {
    if (!plays() || dev || opening || dead) return;
    const L = await loadLib();
    if (!navigator.hid) return status("noHid");
    opening = true;
    try {
      const d = fromTouch ? await L.GE150Pro.request() : await L.GE150Pro.previouslyGranted();
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
      draw();
    }
  }

  function status(key, detail = "") {
    state = { key, detail };
    const connected = key === "connected";
    const { title, text } = STATES[key];
    // the bar keeps the title; the notice panel and the phone say it all
    $(".gp-conn-text").textContent = title;
    $(".gp-dot").dataset.state = connected ? "on" : "off";
    report({ connected, text: connected ? title : `${title}: ${detail || text}` });
    drawNotice();
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
    $(".gp-req-fw").textContent = `${MIN_FIRMWARE} or newer`;
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
    d.on("current", (i) => adopt(i));
    d.on("switched", (i) => onSwitched(i));
    d.on("module", (slot, m) => {
      if (!modules) return;
      modules[slot] = m;
      afterLiveChange();
    });
    d.on("exp", (patch) => {
      exp = { ...(exp ?? {}), ...patch };
      reportExp();
    });
    d.on("rhythm", (r) => {
      rhythm = r;
      report({ rhythm: r });
    });
    d.on("stored", (i) => {
      if (i === current && modules) stored.set(i, { ...stored.get(i), modules: structuredClone(modules) });
      afterLiveChange();
    });
    d.on("disconnect", () => {
      reset();
      status("unplugged");
      draw();
    });
    d.on("error", (e) => status("error", String(e?.message ?? e)));
  }

  function adopt(index) {
    if (index < 1 || index > lib.PRESET_COUNT) return;
    current = index;
    bank = Math.floor((index - 1) / 4) + 1;
    const p = stored.get(index);
    modules = p ? structuredClone(p.modules) : modules;
    if (p) exp = { ...p.exp };
    report({ current: index, ...(modules ? { chain: chainOf(modules), modified: modifiedNow() } : {}) });
    reportExp();
    draw();
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
    report({ exp: { label: on ? lib.expLabel(exp) : "Off", value: spec ? lib.formatValue(spec, m.values[spec.pos]) : "" } });
  }

  /** A footswitch selected a preset on the pedal: apply the configuration it triggers (E-004). The pedal reports `16`
   * only for its own selections, never for ours, so no selection of ours needs filtering out. */
  async function onSwitched(index) {
    if (!ready) return;
    const c = view?.configs.find((x) => x.trigger === index);
    if (c) await applyConfig(c, true);
    if (plays()) ctx.act(playerSeat(), "switched", c ? { index, config: c.id } : { index });
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
      busy = busy.then(() => (c.kind === "select" ? select(c.index) : applyConfig(c.config, false))).catch(() => {});
    }
    busy = busy.then(() => {
      if (lastDone === lastAcked) return;
      lastAcked = lastDone;
      ctx.act(playerSeat(), "done", { n: lastDone });
    });
  }

  async function select(index) {
    if (!dev) return;
    await dev.selectPreset(index);
    adopt(index);
    // the pedal answers a host selection with nothing: read the new preset's live state, and wait for it
    await dev.readCurrent();
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
  function setModule(slot, m) {
    modules[slot] = m;
    drawLive();
    sendNext.set(slot, m);
    if (sendTimers.has(slot)) return;
    const flush = () => {
      const next = sendNext.get(slot);
      sendNext.delete(slot);
      if (!next) {
        sendTimers.delete(slot);
        afterLiveChange();
        return;
      }
      dev?.setModule(slot, structuredClone(next));
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

  // ---- drawing ---------------------------------------------------------------------------------------------------
  function draw() {
    if (!view || !info) return;
    const local = plays();
    const ped = view.pedal;
    const L = lib;
    const idx = local ? current || ped.current : ped.current;
    const names = local && ready ? null : ped.names;
    const nameOf = (i) => (names ? names[i - 1] : stored.get(i)?.name.trim()) || "";
    $(".gp-label").textContent = idx ? (L ? L.presetLabel(idx) : "") : "";
    $(".gp-name").textContent = idx ? `${nameOf(idx) || "—"}${(local ? modifiedNow() : ped.modified) ? " *" : ""}` : "GE150 Pro";
    $(".gp-connect").hidden = !local || !!dev || view.done;
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

  /** What a fader or a module switch changes: the name's modified mark, the chain and the editor. */
  function drawLive() {
    const name = $(".gp-name");
    name.textContent = name.textContent.replace(/ \*$/, "") + (modifiedNow() ? " *" : "");
    drawChain();
    drawEditor();
  }

  function drawChain() {
    const L = lib;
    // the chain: from the live modules here, from the view on a remote board
    const chain = plays() && modules ? modules : view.pedal.chain;
    const tiles = Array.from({ length: 9 }, (_, s) => {
      const m = chain?.[s];
      const slotName = L?.catalog.slots[s].name ?? "";
      const modelName = m && L ? L.model(s, m.type)?.name ?? `model ${m.type + 1}` : "";
      return `<div class="gp-tile ${m?.on ? "on" : ""} ${s === selected ? "sel" : ""}" role="listitem" data-slot="${s}">
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
    const L = lib;
    const m = modules?.[selected];
    const slotName = L?.catalog.slots[selected].name ?? "";
    $(".gp-ed-slot").textContent = slotName;
    const mm = m && L ? L.model(selected, m.type) : null;
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
            <button type="button" class="gp-btn gp-f-inc" data-i="${i}" aria-label="More ${esc(p.name)}">+</button></div></div>`)
        .join("");
    }
    mm.params.forEach((p, i) => {
      const el = faders.querySelector(`.gp-fader[data-i="${i}"]`);
      const raw = m.values[p.pos];
      const f = L.rawFraction(p, raw);
      el.querySelector(".gp-f-value").textContent = L.formatValue(p, raw);
      el.querySelector(".gp-f-fill").style.height = `${f * 100}%`;
      el.querySelector(".gp-f-knob").style.bottom = `calc(${f * 100}% - 14px)`; // (the track's margin keeps it off the name)
    });
  }

  function drawPresets(nameOf, idx) {
    $(".gp-bank-name").textContent = `Bank ${bank}`;
    const btns = [0, 1, 2, 3].map((k) => {
      const i = (bank - 1) * 4 + k + 1;
      return `<button type="button" class="gp-preset ${i === idx ? "on" : ""}" data-index="${i}" ${canEdit() ? "" : "disabled"}>
        <b>${"ABCD"[k]}</b><span>${esc(nameOf(i) || "")}</span></button>`;
    }).join("");
    setHtml($(".gp-abcd"), btns);
    $(".gp-presets").hidden = tab !== "presets";
    $(".gp-configs").hidden = tab !== "configs";
    box.querySelectorAll(".gp-tab").forEach((t) => t.classList.toggle("on", t.dataset.tab === tab));
  }

  function drawConfigs() {
    const L = lib;
    $(".gp-capture").disabled = !canEdit();
    const rows = (view.configs ?? []).map((c) => {
      const what = Object.keys(c.modules).map((k) => L?.catalog.slots[Number(k)].name ?? k).join(", ");
      const tags = [c.slot !== null ? `Quick ${c.slot + 1}` : "", c.trigger ? `Footswitch ${L ? L.presetLabel(c.trigger) : c.trigger}` : "", c.preset && L ? `on ${L.presetLabel(c.preset)}` : ""].filter(Boolean);
      return `<div class="gp-config"><div class="gp-config-text"><b>${esc(c.name)}</b><span class="muted">${esc(what || "preset only")}</span>
          <span class="gp-tags">${tags.map((t) => `<i>${esc(t)}</i>`).join("")}</span></div>
        <button type="button" class="gp-btn gp-apply" data-id="${esc(c.id)}" ${canEdit() ? "" : "disabled"}>Apply</button>
        <button type="button" class="gp-btn gp-delete" data-id="${esc(c.id)}" aria-label="Delete ${esc(c.name)}" ${plays() && !view.done ? "" : "disabled"}>✕</button></div>`;
    }).join("");
    const list = rows || `<div class="gp-empty muted">No configurations yet. Shape the sound, then Save configuration… to put it on a quick slot of the phone or on a footswitch.</div>`;
    setHtml($(".gp-config-list"), list);
  }

  // ---- sheets ----------------------------------------------------------------------------------------------------
  function openSheet(inner, wire) {
    const wrap = $(".gp-sheet-wrap");
    $(".gp-sheet").innerHTML = inner;
    wrap.hidden = false;
    wire($(".gp-sheet"));
  }
  const closeSheet = () => ($(".gp-sheet-wrap").hidden = true);

  function openModels() {
    if (!canEdit()) return;
    const L = lib;
    const models = L.catalog.slots[selected].models;
    openSheet(
      `<div class="gp-sheet-head"><div class="gp-sheet-title">${esc(L.catalog.slots[selected].name)}: choose a model</div>
        <button type="button" class="gp-btn gp-close">Close</button></div>
      <div class="gp-models">${models.map((m) => `<button type="button" class="gp-model-card ${m.index === modules[selected].type ? "on" : ""}" data-type="${m.index}">
        <span>${String(m.index + 1).padStart(2, "0")}</span><b>${esc(m.name)}</b></button>`).join("")}</div>`,
      (el) => {
        el.querySelector(".gp-close").onclick = closeSheet;
        el.querySelector(".gp-models").onclick = (e) => {
          const b = e.target.closest(".gp-model-card");
          if (!b) return;
          setModel(selected, Number(b.dataset.type));
          closeSheet();
        };
      },
    );
  }

  function openSave() {
    if (!canEdit()) return;
    const L = lib;
    const label = L.presetLabel(current);
    openSheet(
      `<div class="gp-sheet-head"><div class="gp-sheet-title">Save to ${esc(label)}?</div></div>
      <p class="gp-sheet-text">This overwrites the preset stored in slot ${esc(label)} on the pedal with the sound it plays now.
        The pedal keeps it without the table.</p>
      <div class="gp-sheet-btns"><button type="button" class="gp-btn gp-no">Cancel</button><button type="button" class="gp-btn primary gp-yes">Save to ${esc(label)}</button></div>`,
      (el) => {
        el.querySelector(".gp-no").onclick = closeSheet;
        el.querySelector(".gp-yes").onclick = async () => {
          closeSheet();
          const p = stored.get(current);
          if (!p || !dev) return;
          await dev.storePreset({ ...p, modules: structuredClone(modules), exp: { ...p.exp, ...(exp ?? {}) } });
        };
      },
    );
  }

  function openCapture() {
    if (!canEdit()) return;
    const L = lib;
    const base = stored.get(current);
    const changed = modules.map((m, s) => !base || !sameModule(m, base.modules[s]));
    const pick = new Set(changed.some(Boolean) ? changed.flatMap((c, s) => (c ? [s] : [])) : modules.flatMap((m, s) => (m.on ? [s] : [])));
    const quick = Array.from({ length: view.quickSlots }, (_, q) => q);
    let slot = quick.find((q) => !view.configs.some((c) => c.slot === q)) ?? null;
    let trigger = false, withPreset = false;
    const used = (q) => view.configs.find((c) => c.slot === q)?.name;
    const render = () => `<div class="gp-sheet-head"><div class="gp-sheet-title">Save a configuration</div>
        <button type="button" class="gp-btn gp-close">Cancel</button></div>
      <div class="gp-cap-row"><div class="gp-cap-label">Modules it sets</div><div class="gp-cap-mods">
        ${modules.map((m, s) => `<button type="button" class="gp-chip ${pick.has(s) ? "on" : ""}" data-mod="${s}">${esc(L.catalog.slots[s].name)}${changed[s] ? " •" : ""}</button>`).join("")}</div></div>
      <div class="gp-cap-row"><div class="gp-cap-label">Quick slot on the phone</div><div class="gp-cap-mods">
        <button type="button" class="gp-chip ${slot === null ? "on" : ""}" data-slot="-1">None</button>
        ${quick.map((q) => `<button type="button" class="gp-chip ${slot === q ? "on" : ""}" data-slot="${q}">${q + 1}${used(q) ? " ↺" : ""}</button>`).join("")}</div></div>
      <div class="gp-cap-row"><div class="gp-cap-label">Options</div><div class="gp-cap-mods">
        <button type="button" class="gp-chip ${withPreset ? "on" : ""}" data-opt="preset">Select ${esc(L.presetLabel(current))} first</button>
        <button type="button" class="gp-chip ${trigger ? "on" : ""}" data-opt="trigger">Apply when ${esc(L.presetLabel(current))} is chosen with the footswitch</button></div></div>
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
          const names = [...pick].map((s) => L.catalog.slots[s].name.split("/")[0]);
          const name = `${names.slice(0, 2).join("+") || "Preset"}${names.length > 2 ? "+…" : ""} ${L.presetLabel(current)}`.slice(0, 24);
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
  $(".gp-notice-connect").addEventListener("click", () => connect(true));
  $(".gp-save").addEventListener("click", openSave);
  $(".gp-model").addEventListener("click", openModels);
  $(".gp-capture").addEventListener("click", openCapture);
  $(".gp-sheet-wrap").addEventListener("click", (e) => e.target === $(".gp-sheet-wrap") && closeSheet());
  box.querySelector(".gp-tabs").addEventListener("click", (e) => {
    const t = e.target.closest(".gp-tab");
    if (t) (tab = t.dataset.tab), draw();
  });
  $(".gp-bank-prev").addEventListener("click", () => ((bank = bank === 1 ? 50 : bank - 1), draw()));
  $(".gp-bank-next").addEventListener("click", () => ((bank = bank === 50 ? 1 : bank + 1), draw()));
  $(".gp-abcd").addEventListener("click", (e) => {
    const b = e.target.closest(".gp-preset");
    if (b && canEdit()) busy = busy.then(() => select(Number(b.dataset.index)));
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
    if (a && canEdit()) {
      const c = view.configs.find((x) => x.id === a.dataset.id);
      if (c) busy = busy.then(() => applyConfig(c, false));
      return;
    }
    const d = e.target.closest(".gp-delete");
    if (d && plays()) ctx.act(playerSeat(), "edit", { id: d.dataset.id, remove: true });
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
        syncClick();
        draw();
      });
    },
    destroy() {
      dead = true;
      if (live === inst) live = null;
      clearTimeout(reportTimer);
      if (hidWatched) navigator.hid?.removeEventListener("connect", onHidConnect);
      if (clickTimer) clearInterval(clickTimer);
      dev?.close().catch(() => {});
      box.remove();
    },
  };
  live = inst;
  return inst;
}
