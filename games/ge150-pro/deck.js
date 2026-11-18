// GE150 Pro on the player's phone: a hands-free remote while playing. The game's tabs sit at the top, under the
// platform's, then the current preset's card on every tab, then the tab. Preset: stepping presets and this phone's
// favorites (E-031). Rhythm: the pedal's drum machine (shown; it is started on the pedal) and the table's click track
// (started here). Config: the connection and the configurations, quick slots first (tap loads, hold for details). The game is left through the platform's
// player tab (no Finish here, E-020). The configurations
// are the table's, kept in its game data and brought to the game by the board (E-017); ones this phone kept before
// that move to the table once. On a table without game data (an older platform) they live in this phone's browser
// between games: sent to the game once, kept up to date from it (E-006).
import { esc, useStyles } from "/shared/board-kit.js";
/** The version the table loaded this file with (`?v=…`): the stylesheet and the library too, so an update is not
 * served from the browser's cache (the table versions only this file). */
const VERSIONED = new URL(import.meta.url).search;

const ID = "ge150-pro";
const STORE = "ge150-pro.configs";
const MOVED = "ge150-pro.configs.moved"; // this phone's configurations have gone to the table
const FAVS = "ge150-pro.favorites"; // this phone's favorite presets, by label ("23A"), in the player's order
const MAX_FAVS = 12;
const LONG_MS = 550;

/** "23A" for preset 89 and back (bank, then A-D), without the library. */
const labelOf = (i) => `${Math.floor((i - 1) / 4) + 1}${"ABCD"[(i - 1) % 4]}`;
const indexOf = (l) => {
  const m = /^(\d{1,2})([A-D])$/.exec(l);
  const i = m ? (Number(m[1]) - 1) * 4 + "ABCD".indexOf(m[2]) + 1 : 0;
  return i >= 1 && i <= 200 ? i : 0;
};
/** The favorites kept on this phone (E-031): which presets sit at those places is not checked. */
function loadFavs() {
  try {
    const v = JSON.parse(localStorage.getItem(FAVS) ?? "[]");
    return Array.isArray(v) ? v.map(indexOf).filter((i, k, a) => i && a.indexOf(i) === k).slice(0, MAX_FAVS) : [];
  } catch {
    return [];
  }
}
function saveFavs(list) {
  try {
    localStorage.setItem(FAVS, JSON.stringify(list.map(labelOf)));
  } catch {
    // (storage blocked: the favorites last until the page reloads)
  }
}

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
  useStyles(`/games/${ID}/deck.css${VERSIONED}`);
  root.innerHTML = `<div class="gd">
    <nav class="gd-tabs" role="tablist">
      <button type="button" class="gd-tab on" data-tab="play" role="tab">Preset</button>
      <button type="button" class="gd-tab" data-tab="rhythm" role="tab">Rhythm</button>
      <button type="button" class="gd-tab" data-tab="config" role="tab">Config</button>
    </nav>
    <div class="card gd-now" role="button" tabindex="0"><div class="gd-now-top"><div class="eyebrow gd-label"></div><span class="gd-exp-badge" hidden></span></div>
      <div class="gd-name-row"><div class="gd-name"></div><button type="button" class="gd-fav-add" aria-label="Add to the favorites">+</button></div>
      <div class="gd-conn muted"></div></div>
    <div class="gd-pages">
      <section class="gd-page gd-play" data-page="play">
        <div class="gd-step"><button type="button" class="gd-prev" aria-label="Previous preset">◀</button>
          <button type="button" class="gd-next" aria-label="Next preset">▶</button></div>
        <div class="gd-note muted gd-board-asks" hidden>The board is asking whether to save the changes first: answer there.</div>
        <div class="gd-favs-head"><span class="eyebrow">Favorites</span><span class="muted gd-favs-count"></span></div>
        <div class="gd-favs"></div>
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
      <section class="gd-page gd-config-page" data-page="config" hidden>
        <div class="gd-slots"></div>
        <div class="gd-others"></div>
        <div class="gd-note muted gd-slots-note"></div>
        <div class="card gd-status"><div class="eyebrow">Pedal</div><div class="gd-status-text"></div>
          <div class="gd-req muted">Requires a Mooer GE150 Pro with firmware V2.1.2 or newer, connected to the table by USB.</div></div>
      </section>
    </div>
    <div class="gd-ask-wrap gd-info-wrap" hidden><div class="card gd-ask gd-info" role="dialog" aria-labelledby="gd-info-title">
      <div class="gd-ask-title" id="gd-info-title"></div><div class="gd-info-mods"></div>
      <div class="gd-ask-text muted gd-info-note"></div>
      <div class="gd-ask-btns"><button type="button" class="primary gd-info-close">Close</button></div></div></div>
    <div class="gd-ask-wrap gd-cfg-wrap" hidden><div class="card gd-ask gd-info" role="dialog" aria-labelledby="gd-cfg-title">
      <div class="gd-ask-title gd-cfg-title" id="gd-cfg-title"></div><div class="gd-ask-text muted gd-cfg-where"></div><div class="gd-info-mods gd-cfg-mods"></div>
      <div class="gd-ask-btns"><button type="button" class="gd-cfg-rename">Rename</button><button type="button" class="gd-cfg-remove">Remove</button>
        <button type="button" class="primary gd-cfg-close">Close</button></div></div></div>
    <div class="gd-ask-wrap gd-del-wrap" hidden><div class="card gd-ask" role="alertdialog" aria-labelledby="gd-del-title">
      <div class="gd-ask-title gd-del-title" id="gd-del-title"></div><div class="gd-ask-text gd-del-text muted"></div>
      <div class="gd-ask-btns"><button type="button" class="gd-del-yes">Remove</button><button type="button" class="primary gd-del-no">Cancel</button></div></div></div>
    <div class="gd-ask-wrap gd-switch-wrap" hidden><div class="card gd-ask" role="alertdialog" aria-labelledby="gd-ask-title">
      <div class="gd-ask-title" id="gd-ask-title"></div><div class="gd-ask-text muted"></div>
      <div class="gd-ask-btns"><button type="button" class="primary gd-ask-save">Save and switch</button>
        <button type="button" class="gd-ask-discard">Discard and switch</button><button type="button" class="gd-ask-cancel">Cancel</button></div></div></div>
  </div>`;
  const $ = (s) => root.querySelector(s);
  let view = null, info = null, lib = null, sent = false, taps = [], beatTimer = null, beatKey = "";
  /** The open "save before switching?" question (E-021): what to send once answered, and the preset it was about. */
  let ask = null;
  let favs = loadFavs();

  import(ctx.assetUrl("ge150.js") + VERSIONED).then((m) => {
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

  let tab = "play";
  function showTab(t) {
    tab = t;
    root.querySelectorAll(".gd-tab").forEach((b) => b.classList.toggle("on", b.dataset.tab === t));
    root.querySelectorAll(".gd-page").forEach((p) => (p.hidden = p.dataset.page !== t));
    draw();
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
    // the expression pedal's mode on the preset card: VOL, or EXP with what it moves and the value now
    const badge = $(".gd-exp-badge");
    const x = live ? p.exp : null;
    badge.hidden = !x;
    if (x) {
      const vol = x.label === "Volume" || x.label === "Off";
      badge.textContent = vol ? (x.label === "Off" ? "EXP off" : "VOL") : `EXP ${x.label.split(" · ").pop()}${x.value ? ` ${x.value}` : ""}`;
      badge.title = vol ? `Expression pedal: ${x.label.toLowerCase()}` : `Expression pedal moves ${x.label}${x.value ? ` (${x.value})` : ""}`;
      badge.classList.toggle("vol", vol);
    }
    root.classList.toggle("gd-on-play", tab === "play");
    $(".gd-fav-add").disabled = !p.current || favs.includes(p.current) || favs.length >= MAX_FAVS || view.done;
    drawFavs(live && !boardAsks);
    drawSlots(live && !boardAsks);
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
  }

  /** The favorites (E-031): label, name, a badge for the playing preset's unsaved changes; − removes, ⋮⋮ sorts. */
  function drawFavs(can) {
    const p = view.pedal;
    const rows = favs.map((i) => {
      const on = i === p.current;
      return `<div class="gd-fav ${on ? "on" : ""}" data-index="${i}"><span class="gd-fav-grip" aria-label="Drag to sort">⋮⋮</span>
        <button type="button" class="gd-fav-pick" data-index="${i}" ${can ? "" : "disabled"}><b>${labelOf(i)}</b><span>${esc(p.names[i - 1]?.trim() || "—")}</span>${on && p.modified ? `<i class="gd-mod">modified</i>` : ""}</button>
        <button type="button" class="gd-fav-del" data-index="${i}" aria-label="Remove ${labelOf(i)} from the favorites">−</button></div>`;
    }).join("");
    setHtml($(".gd-favs"), rows || `<div class="muted gd-empty">Your favorite presets, in your order, kept on this phone: tap + on the preset above, or drag the preset down here.</div>`);
    $(".gd-favs-count").textContent = `${favs.length} of ${MAX_FAVS}`;
    fitFavs();
  }
  /** The favorites scroll inside the page, which itself fits the screen (E-020). */
  function fitFavs() {
    const el = $(".gd-favs");
    if (tab !== "play") return;
    el.style.maxHeight = `${Math.max(150, window.innerHeight - el.getBoundingClientRect().top - 12)}px`;
  }
  window.addEventListener("resize", fitFavs);

  /** The quick slots and the other configurations: tap loads, a long press shows details, Rename and Remove. */
  function drawSlots(can) {
    const tile = (c, n) => `<button type="button" class="gd-slot ${c ? "" : "empty"}" data-id="${c ? esc(c.id) : ""}" ${c && (can || !view.done) ? "" : "disabled"} ${c && !can ? 'data-nocall="1"' : ""}>
        <span>${n}</span><b>${c ? esc(c.name) : "—"}</b></button>`;
    const slots = Array.from({ length: view.quickSlots }, (_, q) => tile(view.configs.find((x) => x.slot === q), q + 1)).join("");
    setHtml($(".gd-slots"), slots);
    const others = view.configs.filter((x) => x.slot === null || x.slot === undefined || x.slot >= view.quickSlots);
    setHtml($(".gd-others"), others.map((c) => tile(c, "not on a slot")).join(""));
    $(".gd-slots-note").textContent = view.configs.length
      ? "Tap a configuration to load it; hold it for what it sets, Rename and Remove."
      : "No configurations yet: on the board, Save configuration… puts a sound on a quick slot.";
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
    const mods = modsHtml(p.chain.map((m, s) => [s, m]));
    setHtml($(".gd-info-mods"), mods || `<div class="muted">Not known yet: the board has not reported the pedal.</div>`);
    $(".gd-info-note").textContent = `As the pedal plays it now${p.modified ? ", with unsaved changes (*)" : ""}. Change modules on the board, or in the GE150 Pro Editor web app.`;
  }
  /** Module rows for a window: [slot, {on, type, values}] → name, switch, model and (when on) its values. */
  function modsHtml(entries) {
    return entries.map(([s, m]) => {
      const mm = lib.model(s, m.type);
      const vals = m.on && mm && m.values ? mm.params.map((q) => `<span><i>${esc(q.name)}</i> ${esc(lib.formatValue(q, m.values[q.pos]))}</span>`).join("") : "";
      return `<div class="gd-info-mod ${m.on ? "" : "off"}"><div><b>${esc(lib.catalog.slots[s].name)}</b> ${m.on ? "On" : "Off"}${mm ? ` · ${esc(mm.name)}` : ""}</div>
        ${vals ? `<div class="gd-info-vals">${vals}</div>` : ""}</div>`;
    }).join("");
  }
  let dragged = false; // a drag of the preset card ends without opening its window
  $(".gd-now").addEventListener("click", (e) => {
    if (dragged) return (dragged = false);
    if (e.target.closest(".gd-fav-add")) return;
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
  // ---- favorites (E-031) ------------------------------------------------------------------------------------------
  const setFavs = (list) => {
    favs = list.slice(0, MAX_FAVS);
    saveFavs(favs);
    draw();
  };
  const addFav = (i) => i && !favs.includes(i) && favs.length < MAX_FAVS && (ctx.vibrate(20), setFavs([...favs, i]));
  $(".gd-fav-add").addEventListener("click", () => addFav(view?.pedal.current));
  $(".gd-favs").addEventListener("click", (e) => {
    const d = e.target.closest(".gd-fav-del");
    if (d) return setFavs(favs.filter((i) => i !== Number(d.dataset.index)));
    const b = e.target.closest(".gd-fav-pick");
    if (b) switchFromPhone(Number(b.dataset.index), "select", { index: Number(b.dataset.index) });
  });
  // sorting: drag an entry by its grip; the others make room as it passes
  $(".gd-favs").addEventListener("pointerdown", (e) => {
    const grip = e.target.closest(".gd-fav-grip");
    if (!grip) return;
    e.preventDefault();
    const row = grip.closest(".gd-fav"), list = $(".gd-favs");
    row.classList.add("lifted");
    // (on the window, not captured by the grip: moving the row in the page would drop a capture)
    const move = (ev) => {
      const rows = [...list.querySelectorAll(".gd-fav")].filter((r) => r !== row);
      const after = rows.find((r) => ev.clientY < r.getBoundingClientRect().top + r.offsetHeight / 2);
      if (after) list.insertBefore(row, after);
      else list.appendChild(row);
      // near the list's edges it scrolls
      const box = list.getBoundingClientRect();
      if (ev.clientY < box.top + 30) list.scrollTop -= 12;
      else if (ev.clientY > box.bottom - 30) list.scrollTop += 12;
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      row.classList.remove("lifted");
      const order = [...list.querySelectorAll(".gd-fav")].map((r) => Number(r.dataset.index));
      list.dataset.html = ""; // (drawn again from the new order)
      setFavs(order);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  });
  // the preset card dragged down onto the list adds it
  $(".gd-now").addEventListener("pointerdown", (e) => {
    if (tab !== "play" || e.target.closest(".gd-fav-add") || !view?.pedal.current) return;
    const card = $(".gd-now"), y0 = e.clientY;
    let moving = false;
    card.setPointerCapture(e.pointerId);
    const over = (ev) => ev.clientY > $(".gd-favs-head").getBoundingClientRect().top;
    const move = (ev) => {
      const dy = ev.clientY - y0;
      if (!moving && Math.abs(dy) < 12) return;
      moving = true;
      card.style.transform = `translateY(${Math.max(0, dy)}px)`;
      card.classList.add("dragging");
      $(".gd-favs").classList.toggle("drop", over(ev));
    };
    const end = (ev) => {
      card.removeEventListener("pointermove", move);
      card.style.transform = "";
      card.classList.remove("dragging");
      $(".gd-favs").classList.remove("drop");
      if (!moving) return;
      dragged = true;
      setTimeout(() => (dragged = false), 400);
      if (ev.type === "pointerup" && over(ev)) addFav(view.pedal.current);
    };
    card.addEventListener("pointermove", move);
    card.addEventListener("pointerup", end, { once: true });
    card.addEventListener("pointercancel", end, { once: true });
  });

  // ---- configurations: tap loads, a long press opens the details -------------------------------------------------
  let held = false;
  const holdable = $(".gd-config-page");
  holdable.addEventListener("pointerdown", (e) => {
    held = false; // (the click after a long press can land on its window instead)
    const b = e.target.closest(".gd-slot");
    if (!b?.dataset.id) return;
    const x0 = e.clientX, y0 = e.clientY;
    const timer = setTimeout(() => {
      held = true;
      ctx.vibrate(40);
      openConfig(b.dataset.id);
    }, LONG_MS);
    const stop = () => {
      clearTimeout(timer);
      holdable.removeEventListener("pointermove", drift);
    };
    const drift = (ev) => Math.hypot(ev.clientX - x0, ev.clientY - y0) > 10 && stop();
    holdable.addEventListener("pointermove", drift);
    for (const t of ["pointerup", "pointercancel"]) holdable.addEventListener(t, stop, { once: true });
  });
  holdable.addEventListener("contextmenu", (e) => e.target.closest(".gd-slot") && e.preventDefault());
  function openConfig(id) {
    const c = view?.configs.find((x) => x.id === id);
    if (!c) return;
    $(".gd-cfg-wrap").dataset.id = id;
    $(".gd-cfg-title").textContent = c.name;
    $(".gd-cfg-where").textContent = [
      c.preset ? `Selects ${label(c.preset)} ${view.pedal.names[c.preset - 1]?.trim() ?? ""} first.` : "Changes the preset that plays.",
      ...(c.tags ?? []),
    ].join(" · ");
    const entries = Object.entries(c.modules ?? {}).map(([k, m]) => [Number(k), m]);
    setHtml($(".gd-cfg-mods"), lib ? modsHtml(entries) || `<div class="muted">No module settings: it only selects the preset.</div>` : "");
    $(".gd-cfg-rename").disabled = $(".gd-cfg-remove").disabled = !!view.done;
    $(".gd-cfg-wrap").hidden = false;
  }
  $(".gd-cfg-close").addEventListener("click", () => ($(".gd-cfg-wrap").hidden = true));
  $(".gd-cfg-rename").addEventListener("click", () => {
    const c = view.configs.find((x) => x.id === $(".gd-cfg-wrap").dataset.id);
    const name = c && prompt("Name of the configuration (up to 24 characters):", c.name);
    if (name && name.trim()) send("edit", { id: c.id, name: name.trim().slice(0, 24) });
    $(".gd-cfg-wrap").hidden = true;
  });
  $(".gd-cfg-remove").addEventListener("click", () => {
    const c = view.configs.find((x) => x.id === $(".gd-cfg-wrap").dataset.id);
    $(".gd-cfg-wrap").hidden = true;
    if (!c) return;
    // deleting takes it from the table for everyone, without undo: ask first (E-023)
    const tags = (c.tags ?? []).filter((t) => !t.startsWith("on "));
    $(".gd-del-title").textContent = `Remove "${c.name}"?`;
    $(".gd-del-text").textContent = `${tags.length ? `It is on ${tags.join(" and ")}. ` : ""}It is gone for everyone who plays at this table.`;
    $(".gd-del-wrap").dataset.id = c.id;
    $(".gd-del-wrap").hidden = false;
  });
  holdable.addEventListener("click", (e) => {
    const b = e.target.closest(".gd-slot");
    if (held) return (held = false);
    if (!b?.dataset.id || !view || b.dataset.nocall) return;
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
