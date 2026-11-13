// GE150 Pro on the player's phone: a hands-free remote while playing. Play: the current preset, stepping presets, and
// eight quick slots that recall configurations. Rhythm: the pedal's drum machine (shown; it is started on the pedal)
// and the table's click track (started here). Pedal: the connection, the configurations, Finish. The configurations
// live in this phone's browser between games: sent to the game once, kept up to date from it (E-006).
import { esc, useStyles } from "/shared/board-kit.js";

const ID = "ge150-pro";
const STORE = "ge150-pro.configs";

function stored() {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? "null");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function store(configs) {
  try {
    localStorage.setItem(STORE, JSON.stringify(configs));
  } catch {
    // (private browsing, or storage blocked: the configurations last for this game only)
  }
}

export function mount(root, ctx) {
  useStyles(`/games/${ID}/deck.css`);
  root.innerHTML = `<div class="gd">
    <div class="gd-pages">
      <section class="gd-page gd-play" data-page="play">
        <div class="card gd-now"><div class="eyebrow gd-label"></div><div class="gd-name"></div><div class="gd-conn muted"></div></div>
        <div class="gd-step"><button type="button" class="gd-prev" aria-label="Previous preset">◀</button>
          <button type="button" class="gd-next" aria-label="Next preset">▶</button></div>
        <div class="gd-slots"></div>
        <div class="gd-exp muted"></div>
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
          <div class="gd-note muted">Played by the table's speakers, not through the pedal.</div></div>
      </section>
      <section class="gd-page gd-setup" data-page="setup" hidden>
        <div class="card gd-status"><div class="eyebrow">Pedal</div><div class="gd-status-text"></div></div>
        <div class="gd-list"></div>
        <button type="button" class="gd-finish">Finish</button>
        <div class="gd-confirm" hidden><div class="gd-confirm-text">End the session? The pedal keeps its sound; the board offers Play again.</div>
          <div class="gd-confirm-btns"><button type="button" class="primary gd-keep">Keep playing</button><button type="button" class="gd-end">Finish</button></div></div>
      </section>
    </div>
    <nav class="gd-tabs" role="tablist">
      <button type="button" class="gd-tab on" data-tab="play" role="tab">Play</button>
      <button type="button" class="gd-tab" data-tab="rhythm" role="tab">Rhythm</button>
      <button type="button" class="gd-tab" data-tab="setup" role="tab">Pedal</button>
    </nav>
  </div>`;
  const $ = (s) => root.querySelector(s);
  let view = null, lib = null, sent = false, taps = [], beatTimer = null, beatKey = "";

  import(ctx.assetUrl("ge150.js")).then((m) => {
    lib = m;
    draw();
  });

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
    $(".gd-prev").disabled = $(".gd-next").disabled = !live;
    const slots = Array.from({ length: 8 }, (_, q) => {
      const c = view.configs.find((x) => x.slot === q);
      return `<button type="button" class="gd-slot ${c ? "" : "empty"}" data-id="${c ? esc(c.id) : ""}" ${c && live ? "" : "disabled"}>
        <span>${q + 1}</span><b>${c ? esc(c.name) : "—"}</b></button>`;
    }).join("");
    if ($(".gd-slots").dataset.html !== slots) {
      $(".gd-slots").dataset.html = slots;
      $(".gd-slots").innerHTML = slots;
    }
    $(".gd-exp").textContent = p.exp ? `EXP: ${p.exp.label}${p.exp.value ? ` · ${p.exp.value}` : ""}` : "";
    // Rhythm: the pedal's
    const r = p.rhythm;
    $(".gd-pr-style").textContent = r ? (lib ? lib.styleName(r) : `style ${r.style + 1}`) : "Not known yet";
    $(".gd-pr-detail").textContent = r ? `${r.playing ? "Playing" : "Stopped"} · ${r.bpm} BPM · volume ${r.volume}` : "";
    flash(r?.playing ? r.bpm : 0);
    // Rhythm: the table's click
    const c = view.click;
    const tempo = c.follow && r?.bpm ? r.bpm : c.bpm;
    $(".gd-bpm b").textContent = String(tempo);
    $(".gd-start").textContent = c.on ? "Stop" : "Start";
    $(".gd-start").classList.toggle("on", c.on);
    $(".gd-start").classList.toggle("primary", !c.on); // Start is the primary action; a running click's Stop is not
    $(".gd-follow").setAttribute("aria-pressed", String(c.follow));
    $(".gd-beats").textContent = `${c.beats} ${c.beats === 1 ? "beat" : "beats"}`;
    for (const s of [".gd-start", ".gd-tap", ".gd-minus", ".gd-plus", ".gd-follow", ".gd-beats"]) $(s).disabled = view.done;
    // Pedal
    $(".gd-status-text").textContent = view.done ? "Done" : p.connected ? `Connected · preset ${label(p.current)}` : p.text || "Not connected: tap Connect pedal on the board";
    const rows = view.configs.map((x) => {
      const tags = [x.slot !== null ? `Quick ${x.slot + 1}` : "", x.trigger ? `Footswitch ${label(x.trigger)}` : ""].filter(Boolean).join(" · ");
      return `<div class="gd-config"><div class="gd-config-text"><b>${esc(x.name)}</b><span class="muted">${esc(tags || "not on a slot")}</span></div>
        <button type="button" class="gd-rename" data-id="${esc(x.id)}" ${view.done ? "disabled" : ""}>Rename</button>
        <button type="button" class="gd-delete" data-id="${esc(x.id)}" aria-label="Delete ${esc(x.name)}" ${view.done ? "disabled" : ""}>✕</button></div>`;
    }).join("") || `<div class="muted gd-empty">No configurations yet: save one on the board.</div>`;
    if ($(".gd-list").dataset.html !== rows) {
      $(".gd-list").dataset.html = rows;
      $(".gd-list").innerHTML = rows;
    }
    $(".gd-finish").disabled = view.done;
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
  $(".gd-prev").addEventListener("click", () => send("select", { step: -1 }));
  $(".gd-next").addEventListener("click", () => send("select", { step: 1 }));
  $(".gd-slots").addEventListener("click", (e) => {
    const b = e.target.closest(".gd-slot");
    if (b?.dataset.id) {
      ctx.vibrate(30);
      send("apply", { id: b.dataset.id });
    }
  });
  const tempoNow = () => (view.click.follow && view.pedal.rhythm?.bpm ? view.pedal.rhythm.bpm : view.click.bpm);
  $(".gd-minus").addEventListener("click", () => send("click", { bpm: Math.max(30, tempoNow() - 1), follow: false }));
  $(".gd-plus").addEventListener("click", () => send("click", { bpm: Math.min(300, tempoNow() + 1), follow: false }));
  $(".gd-start").addEventListener("click", () => send("click", { on: !view.click.on, ...(view.click.on ? {} : { bpm: tempoNow() }) }));
  $(".gd-follow").addEventListener("click", () => send("click", { follow: !view.click.follow }));
  $(".gd-beats").addEventListener("click", () => {
    const order = [4, 3, 6, 2, 1];
    send("click", { beats: order[(order.indexOf(view.click.beats) + 1) % order.length] });
  });
  $(".gd-tap").addEventListener("click", () => {
    // the average of the last taps, once at least three arrive within two seconds of each other
    const now = performance.now();
    taps = taps.filter((t) => now - t < 2000).concat(now).slice(-6);
    if (taps.length >= 3) {
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
    if (d) send("edit", { id: d.dataset.id, remove: true });
  });
  // Finish ends the game for good (the platform has no way back into it), so it asks first.
  const confirming = (on) => {
    $(".gd-finish").hidden = on;
    $(".gd-confirm").hidden = !on;
  };
  $(".gd-finish").addEventListener("click", () => confirming(true));
  $(".gd-keep").addEventListener("click", () => confirming(false));
  $(".gd-end").addEventListener("click", () => {
    confirming(false);
    ctx.send("finish", {});
  });

  return {
    update(v) {
      view = v;
      if (!v.synced) {
        // the game has none of this player's configurations yet (a new game, or another player took the seat)
        if (!sent && !v.done) {
          sent = true;
          ctx.send("configs", { list: stored() });
        }
      } else {
        sent = false; // (sent again if the seat changes hands)
        store(v.configs);
      }
      if (v.done) confirming(false);
      draw();
    },
    destroy() {
      clearInterval(beatTimer);
    },
  };
}
