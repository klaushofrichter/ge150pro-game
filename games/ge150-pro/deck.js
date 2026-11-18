// GE150 Pro on the player's phone: a hands-free remote while playing. The game's tabs sit at the top, under the
// platform's, then the current preset's card on every tab, then the tab. Preset: stepping presets, and eight quick
// slots that recall configurations. Rhythm: the pedal's drum machine (shown; it is started on the pedal) and the table's
// click track (started here). Pedal: the connection and the configurations. The game is left through the platform's
// player tab (no Finish here, E-020). The configurations
// are the table's, kept in its game data and brought to the game by the board (E-017); ones this phone kept before
// that move to the table once. On a table without game data (an older platform) they live in this phone's browser
// between games: sent to the game once, kept up to date from it (E-006).
import { esc, useStyles } from "/shared/board-kit.js";

const ID = "ge150-pro";
const STORE = "ge150-pro.configs";
const MOVED = "ge150-pro.configs.moved"; // this phone's configurations have gone to the table

function moved(set) {
  try {
    if (set) localStorage.setItem(MOVED, "1");
    return localStorage.getItem(MOVED) === "1";
  } catch {
    return true; // (no storage: nothing to move)
  }
}

function stored() {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? "null");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** Keep the configurations on the phone; only when they changed (every update carries them). */
let lastStored = "";
function store(configs) {
  const json = JSON.stringify(configs);
  if (json === lastStored) return;
  lastStored = json;
  try {
    localStorage.setItem(STORE, json);
  } catch {
    // (private browsing, or storage blocked: the configurations last for this game only)
  }
}

export function mount(root, ctx) {
  useStyles(`/games/${ID}/deck.css`);
  root.innerHTML = `<div class="gd">
    <nav class="gd-tabs" role="tablist">
      <button type="button" class="gd-tab on" data-tab="play" role="tab">Preset</button>
      <button type="button" class="gd-tab" data-tab="rhythm" role="tab">Rhythm</button>
      <button type="button" class="gd-tab" data-tab="setup" role="tab">Pedal</button>
    </nav>
    <div class="card gd-now" role="button" tabindex="0"><div class="eyebrow gd-label"></div><div class="gd-name"></div><div class="gd-conn muted"></div></div>
    <div class="gd-pages">
      <section class="gd-page gd-play" data-page="play">
        <div class="gd-step"><button type="button" class="gd-prev" aria-label="Previous preset">◀</button>
          <button type="button" class="gd-next" aria-label="Next preset">▶</button></div>
        <div class="gd-slots"></div>
        <div class="gd-note muted gd-slots-note" hidden>Quick slots: on the board, Save configuration… puts a sound on a slot. Tap a slot while you play to recall it.</div>
        <div class="gd-exp muted"></div>
        <div class="gd-note muted gd-board-asks" hidden>The board is asking whether to save the changes first: answer there.</div>
      </section>
      <section class="gd-page gd-rhythm" data-page="rhythm" hidden>
        <div class="card gd-pedal-rhythm"><div class="eyebrow">Pedal drum machine</div>
          <div class="gd-pr-row"><div class="gd-beat"></div><div><div class="gd-pr-style"></div><div class="gd-pr-detail muted"></div></div></div>
          <div class="gd-note muted">Start, stop and TAP on the pedal: it takes no rhythm commands over USB.</div></div>
        <div class="card gd-click"><div class="eyebrow">Table click</div>
          <div class="gd-bpm-row"><button type="button" class="gd-minus" aria-label="Slower">−</button>
            <div class="gd-bpm"><b></b><span>BPM</span></div><button type="button" class="gd-plus" aria-label="Faster">+</button></div>
          <div class="gd-click-btns"><button type="button" class="gd-tap">Tap</button><button type="button" class="gd-start primary">Start</button></div>
          <div class="gd-click-opts"><button type="button" class="gd-follow" aria-pressed="false">Follow pedal tempo</button>
            <button type="button" class="gd-beats">4 beats</button></div>
          <div class="gd-note muted gd-tap-note"></div>
          <div class="gd-note muted">Played by the table's speakers, not through the pedal.</div></div>
      </section>
      <section class="gd-page gd-setup" data-page="setup" hidden>
        <div class="card gd-status"><div class="eyebrow">Pedal</div><div class="gd-status-text"></div>
          <div class="gd-req muted">Requires a Mooer GE150 Pro with firmware V2.1.2 or newer, connected to the table by USB.</div></div>
        <div class="gd-list"></div>
      </section>
    </div>
    <div class="gd-ask-wrap gd-info-wrap" hidden><div class="card gd-ask gd-info" role="dialog" aria-labelledby="gd-info-title">
      <div class="gd-ask-title" id="gd-info-title"></div><div class="gd-info-mods"></div>
      <div class="gd-ask-text muted gd-info-note"></div>
      <div class="gd-ask-btns"><button type="button" class="primary gd-info-close">Close</button></div></div></div>
    <div class="gd-ask-wrap gd-del-wrap" hidden><div class="card gd-ask" role="alertdialog" aria-labelledby="gd-del-title">
      <div class="gd-ask-title gd-del-title" id="gd-del-title"></div><div class="gd-ask-text gd-del-text muted"></div>
      <div class="gd-ask-btns"><button type="button" class="gd-del-yes">Delete</button><button type="button" class="primary gd-del-no">Cancel</button></div></div></div>
    <div class="gd-ask-wrap gd-switch-wrap" hidden><div class="card gd-ask" role="alertdialog" aria-labelledby="gd-ask-title">
      <div class="gd-ask-title" id="gd-ask-title"></div><div class="gd-ask-text muted"></div>
      <div class="gd-ask-btns"><button type="button" class="primary gd-ask-save">Save and switch</button>
        <button type="button" class="gd-ask-discard">Discard and switch</button><button type="button" class="gd-ask-cancel">Cancel</button></div></div></div>
  </div>`;
  const $ = (s) => root.querySelector(s);
  let view = null, info = null, lib = null, sent = false, taps = [], beatTimer = null, beatKey = "";
  /** The open "save before switching?" question (E-021): what to send once answered, and the preset it was about. */
  let ask = null;

  import(ctx.assetUrl("ge150.js")).then((m) => {
    lib = m;
    draw();
  });

  /** Replace an element's content only when it changed (keeps a pressed button pressed). */
  const setHtml = (el, markup) => {
    if (el.dataset.html === markup) return;
    el.dataset.html = markup;
    el.innerHTML = markup;
  };
  const label = (i) => (lib && i ? lib.presetLabel(i) : i ? String(i) : "");
  const send = (name, payload) => (view && !view.done ? ctx.send(name, payload) : null);

  function showTab(t) {
    root.querySelectorAll(".gd-tab").forEach((b) => b.classList.toggle("on", b.dataset.tab === t));
    root.querySelectorAll(".gd-page").forEach((p) => (p.hidden = p.dataset.page !== t));
  }

  function draw() {
    if (!view) return;
    const p = view.pedal;
    const live = p.connected && !view.done;
    // Play
    $(".gd-label").textContent = p.current ? `Preset ${label(p.current)}` : "GE150 Pro";
    $(".gd-name").textContent = p.current ? `${p.names[p.current - 1] || "—"}${p.modified ? " *" : ""}` : "Waiting for the pedal";
    $(".gd-conn").textContent = view.done ? "Done" : p.connected ? "" : p.text || "Connect the pedal on the board";
    const boardAsks = view.confirming === "board";
    $(".gd-prev").disabled = $(".gd-next").disabled = !live || boardAsks;
    $(".gd-board-asks").hidden = !boardAsks;
    const slots = Array.from({ length: view.quickSlots }, (_, q) => {
      const c = view.configs.find((x) => x.slot === q);
      return `<button type="button" class="gd-slot ${c ? "" : "empty"}" data-id="${c ? esc(c.id) : ""}" ${c && live && !boardAsks ? "" : "disabled"}>
        <span>${q + 1}</span><b>${c ? esc(c.name) : "—"}</b></button>`;
    }).join("");
    setHtml($(".gd-slots"), slots);
    $(".gd-slots-note").hidden = view.configs.some((x) => x.slot !== undefined && x.slot !== null && x.slot < view.quickSlots);
    $(".gd-exp").textContent = p.exp ? `EXP: ${p.exp.label}${p.exp.value ? ` · ${p.exp.value}` : ""}` : "";
    // Rhythm: the pedal's
    const r = p.rhythm;
    $(".gd-pr-style").textContent = r ? (lib ? lib.styleName(r) : `style ${r.style + 1}`) : "Not known yet";
    $(".gd-pr-detail").textContent = r ? `${r.playing ? "Playing" : "Stopped"} · ${r.bpm} BPM · volume ${r.volume}` : "";
    flash(r?.playing ? r.bpm : 0);
    // Rhythm: the table's click
    const c = view.click;
    $(".gd-bpm b").textContent = String(view.tempo);
    $(".gd-start").textContent = c.on ? "Stop" : "Start";
    $(".gd-start").classList.toggle("on", c.on);
    $(".gd-start").classList.toggle("primary", !c.on); // Start is the primary action; a running click's Stop is not
    $(".gd-follow").setAttribute("aria-pressed", String(c.follow));
    $(".gd-tap-note").textContent = c.follow
      ? "Following the pedal's tempo. Tap here twice to set the table click only: it stops following. The pedal's tempo is set with TAP on the pedal."
      : "Tap twice to set the tempo, like TAP on the pedal; more taps are averaged.";
    $(".gd-beats").textContent = `${c.beats} ${c.beats === 1 ? "beat" : "beats"}`;
    for (const s of [".gd-start", ".gd-tap", ".gd-minus", ".gd-plus", ".gd-follow", ".gd-beats"]) $(s).disabled = view.done;
    // Pedal
    $(".gd-status-text").textContent = view.done ? "Done" : p.connected ? `Connected · preset ${label(p.current)}` : p.text || "Not connected: tap Connect pedal on the board";
    const rows = view.configs.map((x) => {
      const tags = (x.tags ?? []).join(" · ");
      return `<div class="gd-config"><div class="gd-config-text"><b>${esc(x.name)}</b><span class="muted">${esc(tags || "not on a slot")}</span></div>
        <button type="button" class="gd-rename" data-id="${esc(x.id)}" ${view.done ? "disabled" : ""}>Rename</button>
        <button type="button" class="gd-delete" data-id="${esc(x.id)}" aria-label="Delete ${esc(x.name)}" ${view.done ? "disabled" : ""}>✕</button></div>`;
    }).join("") || `<div class="muted gd-empty">No configurations yet: save one on the board.</div>`;
    setHtml($(".gd-list"), rows);
  }

  /** The beat light at the pedal's tempo while its drum machine plays (its beat, not its bar: the pedal sends no beat). */
  function flash(bpm) {
    const key = String(bpm);
    if (key === beatKey) return;
    beatKey = key;
    clearInterval(beatTimer);
    beatTimer = null;
    const el = $(".gd-beat");
    el.classList.remove("hit");
    if (!bpm) return;
    beatTimer = setInterval(() => {
      el.classList.add("hit");
      setTimeout(() => el.classList.remove("hit"), 90);
    }, 60000 / bpm);
  }

  // ---- touch -----------------------------------------------------------------------------------------------------
  root.querySelector(".gd-tabs").addEventListener("click", (e) => {
    const t = e.target.closest(".gd-tab");
    if (t) showTab(t.dataset.tab);
  });
  /**
   * A switch to another preset asked for here (`intent` with its payload). With the table's setting on and unsaved
   * changes, the phone asks first whether to save them; the board cannot switch while it asks (E-021).
   */
  function switchFromPhone(target, intent, payload) {
    if (!view || view.confirming === "board") return;
    const p = view.pedal;
    if (!info?.prefs?.confirm || !p.modified || !target) return send(intent, payload);
    const from = label(p.current), to = label(target);
    const name = p.names[p.current - 1]?.trim() || from;
    ask = { intent, payload, current: p.current };
    $(".gd-ask-title").textContent = `Save the changes to ${from}?`;
    $(".gd-ask-text").textContent = `"${name}" has unsaved changes. ${to === from ? `Selecting ${to} again reloads it and` : `Switching to ${to}`} discards them, unless you save them to ${from} first.`;
    $(".gd-switch-wrap").hidden = false;
    send("confirm", { from: "deck", on: true });
  }
  /** Answer the question: `save` (true/false) switches, null cancels. */
  function answer(save) {
    const a = ask;
    ask = null;
    $(".gd-switch-wrap").hidden = true;
    if (!a) return;
    if (save === null) send("confirm", { from: "deck", on: false });
    else send(a.intent, { ...a.payload, ...(save ? { save: true } : {}) }); // (closes the question too)
  }
  $(".gd-ask-save").addEventListener("click", () => answer(true));
  // Tap the preset: what it plays now, module by module; nothing to change here (E-024)
  function drawInfo() {
    const p = view?.pedal;
    if (!p || !lib) return;
    $(".gd-info-wrap .gd-ask-title").textContent = p.current ? `${label(p.current)} · ${p.names[p.current - 1]?.trim() || "—"}${p.modified ? " *" : ""}` : "GE150 Pro";
    const mods = p.chain.map((m, s) => {
      const mm = lib.model(s, m.type);
      const vals = m.on && mm && m.values ? mm.params.map((q) => `<span><i>${esc(q.name)}</i> ${esc(lib.formatValue(q, m.values[q.pos]))}</span>`).join("") : "";
      return `<div class="gd-info-mod ${m.on ? "" : "off"}"><div><b>${esc(lib.catalog.slots[s].name)}</b> ${m.on ? "On" : "Off"}${mm ? ` · ${esc(mm.name)}` : ""}</div>
        ${vals ? `<div class="gd-info-vals">${vals}</div>` : ""}</div>`;
    }).join("");
    setHtml($(".gd-info-mods"), mods || `<div class="muted">Not known yet: the board has not reported the pedal.</div>`);
    $(".gd-info-note").textContent = `As the pedal plays it now${p.modified ? ", with unsaved changes (*)" : ""}. Change modules on the board, or in the GE150 Pro Editor web app.`;
  }
  $(".gd-now").addEventListener("click", () => {
    drawInfo();
    $(".gd-info-wrap").hidden = false;
  });
  $(".gd-info-close").addEventListener("click", () => ($(".gd-info-wrap").hidden = true));
  $(".gd-del-no").addEventListener("click", () => ($(".gd-del-wrap").hidden = true));
  $(".gd-del-yes").addEventListener("click", () => {
    $(".gd-del-wrap").hidden = true;
    send("edit", { id: $(".gd-del-wrap").dataset.id, remove: true });
  });
  $(".gd-ask-discard").addEventListener("click", () => answer(false));
  $(".gd-ask-cancel").addEventListener("click", () => answer(null));
  const stepTarget = (step) => (view?.pedal.current ? ((view.pedal.current - 1 + step + 400) % 200) + 1 : 0);
  $(".gd-prev").addEventListener("click", () => switchFromPhone(stepTarget(-1), "select", { step: -1 }));
  $(".gd-next").addEventListener("click", () => switchFromPhone(stepTarget(1), "select", { step: 1 }));
  $(".gd-slots").addEventListener("click", (e) => {
    const b = e.target.closest(".gd-slot");
    if (!b?.dataset.id || !view) return;
    ctx.vibrate(30);
    // a configuration on another preset switches to it first
    const c = view.configs.find((x) => x.id === b.dataset.id);
    if (c?.preset && c.preset !== view.pedal.current) switchFromPhone(c.preset, "apply", { id: c.id });
    else send("apply", { id: b.dataset.id });
  });
  $(".gd-minus").addEventListener("click", () => send("click", { bpm: Math.max(30, view.tempo - 1), follow: false }));
  $(".gd-plus").addEventListener("click", () => send("click", { bpm: Math.min(300, view.tempo + 1), follow: false }));
  // following the drum machine, the click takes its tempo (which may lie outside the click's own range)
  $(".gd-start").addEventListener("click", () => send("click", { on: !view.click.on, ...(view.click.on || view.click.follow ? {} : { bpm: view.tempo }) }));
  $(".gd-follow").addEventListener("click", () => send("click", { follow: !view.click.follow }));
  $(".gd-beats").addEventListener("click", () => {
    const order = [4, 3, 6, 2, 1];
    send("click", { beats: order[(order.indexOf(view.click.beats) + 1) % order.length] });
  });
  $(".gd-tap").addEventListener("click", () => {
    // like the pedal's TAP: the gap between two taps; more taps within two seconds of each other are averaged
    const now = performance.now();
    taps = taps.filter((t) => now - t < 2000).concat(now).slice(-6);
    if (taps.length >= 2) {
      const gaps = taps.slice(1).map((t, i) => t - taps[i]);
      const bpm = Math.round(60000 / (gaps.reduce((a, b) => a + b, 0) / gaps.length));
      if (bpm >= 30 && bpm <= 300) send("click", { bpm, follow: false });
    }
  });
  $(".gd-list").addEventListener("click", (e) => {
    const r = e.target.closest(".gd-rename");
    if (r) {
      const c = view.configs.find((x) => x.id === r.dataset.id);
      const name = c && prompt("Name of the configuration (up to 24 characters):", c.name);
      if (name && name.trim()) send("edit", { id: c.id, name: name.trim().slice(0, 24) });
      return;
    }
    const d = e.target.closest(".gd-delete");
    const c = d && view.configs.find((x) => x.id === d.dataset.id);
    if (!c) return;
    // deleting takes it from the table for everyone, without undo: ask first (E-023)
    const tags = (c.tags ?? []).filter((t) => !t.startsWith("on "));
    $(".gd-del-title").textContent = `Delete "${c.name}"?`;
    $(".gd-del-text").textContent = `${tags.length ? `It is on ${tags.join(" and ")}. ` : ""}It is gone for everyone who plays at this table.`;
    $(".gd-del-wrap").dataset.id = c.id;
    $(".gd-del-wrap").hidden = false;
  });
  return {
    update(v, _events, i) {
      view = v;
      info = i ?? info;
      if (ask && (v.pedal.current !== ask.current || v.done)) answer(null); // the pedal switched by itself: moot
      else if (!ask && v.confirming === "deck" && !v.done) send("confirm", { from: "deck", on: false }); // left over from before a reload
      if (ctx.store) {
        // The table keeps the configurations and the board has brought them (E-017): what this phone kept before
        // joins them, once, and from then on the phone keeps nothing.
        if (v.shared && !sent && !v.done && !moved()) {
          sent = true;
          const list = stored();
          if (!list.length) moved(true);
          else Promise.resolve(ctx.send("configs", { list, merge: true })).then((r) => (r?.ok ? moved(true) : (sent = false)));
        }
      } else if (!v.synced) {
        // the game has none of this player's configurations yet (a new game, or another player took the seat)
        if (!sent && !v.done) {
          sent = true;
          ctx.send("configs", { list: stored() });
        }
      } else {
        sent = false; // (sent again if the seat changes hands)
        store(v.configs);
      }
      draw();
      if (!$(".gd-info-wrap").hidden) drawInfo(); // follows the pedal while open
    },
    destroy() {
      clearInterval(beatTimer);
    },
  };
}
