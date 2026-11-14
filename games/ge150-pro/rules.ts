// GE150 Pro: remote control for a Mooer GE150 Pro connected to the table, for one player (decisions E-001..).
// The pedal is driven by the table's own board over WebHID (board.js); these rules only keep what the table shares:
// the pedal's state as the board reports it, the player's configurations (kept on their phone between games), the
// commands the phone asks the board to carry out, and the table's click track. No chance and no secrets: every view
// is the same.
import { count, defineGame, list, type GameContext, type SeatInfo, type StepDescription, type StepInfo } from "@game-table/sdk";

/** One effect module as the pedal stores it: switch, model (0-based) and ten raw values. */
export interface ModuleSnap {
  on: boolean;
  type: number;
  values: number[];
}

/**
 * A configuration: named changes on top of a preset, recalled from a quick slot on the phone or applied when the
 * pedal's footswitch selects the trigger preset (E-004).
 */
export interface Config {
  id: string;
  name: string;
  /** Quick slot on the phone, 0..7, or null. */
  slot: number | null;
  /** Preset (1..200) whose selection on the pedal applies this configuration, or null. */
  trigger: number | null;
  /** Preset (1..200) to select first, or null to change the current one. */
  preset: number | null;
  /** Module slot ("0".."8") → its state. */
  modules: Record<string, ModuleSnap>;
}

/** Something the board does on the pedal for the phone, numbered so the board does each once (E-003). */
export type NewCommand = { kind: "select"; index: number } | { kind: "apply"; config: Config };
export type Command = NewCommand & { n: number };

export interface PedalRhythm {
  playing: boolean;
  mode: number;
  style: number;
  volume: number;
  bpm: number;
}

/** The pedal as the board reports it. */
export interface Pedal {
  connected: boolean;
  /** What the board says about the connection, for the phone ("Connected", "Tap Connect pedal on the board", …). */
  text: string;
  /** Current preset, 1..200 (0 until known). */
  current: number;
  /** Names of the 200 presets ("" until known). */
  names: string[];
  /** On/off and model of the nine modules of the current preset. */
  chain: { on: boolean; type: number }[];
  /** Unsaved changes on the current preset. */
  modified: boolean;
  rhythm: PedalRhythm | null;
  /** Expression pedal target and its current value, for the phone ("REV · PRE DELAY", "144"). */
  exp: { label: string; value: string } | null;
}

/** The table's own click track, played by the board's speakers (E-005). */
export interface Click {
  on: boolean;
  bpm: number;
  /** Follow the pedal drum machine's tempo. */
  follow: boolean;
  /** Beats per bar (the first is accented). */
  beats: number;
  /** Counts starts, so the board restarts the bar on a new start. */
  run: number;
}

export interface State {
  player: string;
  seat: number;
  done: boolean;
  endedAt: number | null;
  pedal: Pedal;
  configs: Config[];
  /** The phone has sent its stored configurations (for this player). */
  synced: boolean;
  commands: Command[];
  nextCommand: number;
  click: Click;
  /** For the summary. */
  stats: { recalls: number; applied: number; switched: number; captured: number };
}

const PRESETS = 200;
const SLOTS = 9;
const QUICK_SLOTS = 8;
const MAX_CONFIGS = 32;
const MAX_COMMANDS = 16;
const ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "");
const int = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : null;
/** An optional field: null when absent, the number when valid, false when present but invalid. */
const nullable = (v: unknown, lo: number, hi: number): number | null | false => (v === null || v === undefined ? null : int(v, lo, hi) ?? false);

/**
 * "2A" for preset 5. The library has the same function (src/ge150/preset.ts); the rules keep their own copy because a
 * table installs only the game's folder. tests/ge150-pro.test.ts keeps the two equal.
 */
export function presetLabel(index: number): string {
  const i = index - 1;
  return `${Math.floor(i / 4) + 1}${"ABCD"[i % 4]}`;
}

function module(v: unknown): ModuleSnap | null {
  const m = v as Partial<ModuleSnap> | null;
  if (!m || typeof m.on !== "boolean" || int(m.type, 0, 255) === null || !Array.isArray(m.values) || m.values.length !== 10) return null;
  if (!m.values.every((x) => int(x, 0, 65535) !== null)) return null;
  return { on: m.on, type: m.type!, values: [...m.values] };
}

/** A configuration from a phone or the board, checked field by field; null if it is not one. */
function parseConfig(v: unknown): Config | null {
  const c = v as Record<string, unknown> | null;
  if (!c || typeof c !== "object" || typeof c.id !== "string" || !ID.test(c.id)) return null;
  const modules: Record<string, ModuleSnap> = {};
  const src = (c.modules ?? {}) as Record<string, unknown>;
  for (const [k, m] of Object.entries(src)) {
    const slot = int(Number(k), 0, SLOTS - 1);
    const snap = module(m);
    if (slot === null || !snap || String(slot) !== k) return null;
    modules[k] = snap;
  }
  const slot = nullable(c.slot, 0, QUICK_SLOTS - 1), trigger = nullable(c.trigger, 1, PRESETS), preset = nullable(c.preset, 1, PRESETS);
  if (slot === false || trigger === false || preset === false) return null;
  if (!Object.keys(modules).length && preset === null) return null;
  return { id: c.id, name: text(c.name, 24) || "Configuration", slot, trigger, preset, modules };
}

/** Quick slots and triggers belong to one configuration each: the newest one takes them. */
function settle(configs: Config[], newest: Config): Config[] {
  return configs.map((c) =>
    c.id === newest.id
      ? newest
      : { ...c, slot: newest.slot !== null && c.slot === newest.slot ? null : c.slot, trigger: newest.trigger !== null && c.trigger === newest.trigger ? null : c.trigger },
  );
}

function queue(state: State, cmd: NewCommand): State {
  const n = state.nextCommand;
  return { ...state, nextCommand: n + 1, commands: [...state.commands, { ...cmd, n }].slice(-MAX_COMMANDS) };
}

function emptyPedal(): Pedal {
  return { connected: false, text: "", current: 0, names: Array(PRESETS).fill(""), chain: [], modified: false, rhythm: null, exp: null };
}

function rhythm(v: unknown): PedalRhythm | null {
  const r = v as Partial<PedalRhythm> | null;
  if (!r || typeof r.playing !== "boolean") return null;
  const mode = int(r.mode, 0, 1), style = int(r.style, 0, 63), volume = int(r.volume, 0, 255), bpm = int(r.bpm, 20, 400);
  return mode === null || style === null || volume === null || bpm === null ? null : { playing: r.playing, mode, style, volume, bpm };
}

/** A report from the board about the pedal: only the fields it sends, each checked. */
function pedalPatch(state: State, p: Record<string, unknown>): Pedal | { reject: string } {
  const next: Pedal = { ...state.pedal };
  if ("connected" in p) {
    if (typeof p.connected !== "boolean") return { reject: "Unknown connection state" };
    next.connected = p.connected;
  }
  if ("text" in p) next.text = text(p.text, 120);
  if ("current" in p) {
    const c = int(p.current, 1, PRESETS);
    if (c === null) return { reject: "That is not a preset of the GE150 Pro" };
    next.current = c;
  }
  if ("names" in p) {
    if (!Array.isArray(p.names) || p.names.length !== PRESETS) return { reject: "The preset list is incomplete" };
    next.names = p.names.map((n) => text(n, 16));
  }
  if ("name" in p && next.current) {
    next.names = next.names.map((n, i) => (i === next.current - 1 ? text(p.name, 16) : n));
  }
  if ("chain" in p) {
    const chain = Array.isArray(p.chain) ? p.chain : [];
    if (chain.length !== SLOTS || !chain.every((m) => typeof m?.on === "boolean" && int(m?.type, 0, 255) !== null)) return { reject: "The signal chain is incomplete" };
    next.chain = chain.map((m) => ({ on: m.on as boolean, type: m.type as number }));
  }
  if ("modified" in p) next.modified = p.modified === true;
  if ("rhythm" in p) next.rhythm = p.rhythm === null ? null : rhythm(p.rhythm);
  if ("exp" in p) {
    const e = p.exp as { label?: unknown; value?: unknown } | null;
    next.exp = e ? { label: text(e.label, 40), value: text(e.value, 16) } : null;
  }
  return next;
}

/** How a configuration is labelled on the board and the phone: "Quick 3", "Footswitch 2A", "on 5B". */
function configTags(c: Config): string[] {
  return [
    c.slot !== null ? `Quick ${c.slot + 1}` : "",
    c.trigger !== null ? `Footswitch ${presetLabel(c.trigger)}` : "",
    c.preset !== null ? `on ${presetLabel(c.preset)}` : "",
  ].filter(Boolean);
}

function view(s: State) {
  return {
    seat: s.seat,
    player: s.player,
    done: s.done,
    pedal: s.pedal,
    configs: s.configs.map((c) => ({ ...c, tags: configTags(c) })),
    synced: s.synced,
    commands: s.commands,
    click: s.click,
    /** The click's tempo now: the pedal drum machine's when following it, else its own. */
    tempo: s.click.follow && s.pedal.rhythm?.bpm ? s.pedal.rhythm.bpm : s.click.bpm,
    quickSlots: QUICK_SLOTS,
  };
}

function minutes(s: State) {
  return Math.max(0, Math.round((s.endedAt ?? 0) / 60000));
}

function describeStep(step: StepInfo<State>): StepDescription | null {
  if (step.kind !== "intent" || !step.intent || !step.accepted) return null;
  const p = (step.intent.payload ?? {}) as Record<string, unknown>;
  const after = step.after;
  switch (step.intent.name) {
    case "select":
      return { text: `selects ${presetLabel(after.pedal.current)}` };
    case "apply":
      return { text: `recalls ${after.configs.find((c) => c.id === p.id)?.name ?? "a configuration"}` };
    case "capture":
      return { text: `saves the configuration ${after.configs.at(-1)?.name ?? ""}` };
    case "switched":
      return { text: `selects ${presetLabel(after.pedal.current)} on the pedal` };
    case "click":
      return { text: after.click.on ? `click at ${after.click.bpm} BPM` : "click off" };
    case "finish":
      return { text: "is done playing" };
    default:
      return null;
  }
}

export default defineGame<State>({
  setup(ctx: GameContext) {
    const me: SeatInfo | undefined = ctx.seats[0];
    return {
      player: me?.name ?? "",
      seat: me?.seat ?? 0,
      done: false,
      endedAt: null,
      pedal: emptyPedal(),
      configs: [],
      synced: false,
      commands: [],
      nextCommand: 1,
      click: { on: false, bpm: 100, follow: true, beats: 4, run: 0 },
      stats: { recalls: 0, applied: 0, switched: 0, captured: 0 },
    };
  },

  onIntent(state, seat, intent, ctx) {
    if (state.done) return { reject: "The session is over" };
    const p = (intent.payload ?? {}) as Record<string, unknown>;
    switch (intent.name) {
      // ---- from the board -------------------------------------------------------------------------------------
      case "pedal": {
        const next = pedalPatch(state, p);
        if ("reject" in next) return next;
        if (JSON.stringify(next) === JSON.stringify(state.pedal)) return { state };
        return { state: { ...state, pedal: next } };
      }
      case "done": {
        // the board carried out every command up to n
        const n = int(p.n, 1, Number.MAX_SAFE_INTEGER);
        if (n === null) return { reject: "Unknown command" };
        const commands = state.commands.filter((c) => c.n > n);
        return commands.length === state.commands.length ? { state } : { state: { ...state, commands } };
      }
      case "switched": {
        // a footswitch on the pedal selected a preset; the board applied the configuration triggered by it, if any
        const index = int(p.index, 1, PRESETS);
        if (index === null) return { reject: "That is not a preset of the GE150 Pro" };
        const applied = typeof p.config === "string" && state.configs.some((c) => c.id === p.config);
        return {
          state: { ...state, pedal: { ...state.pedal, current: index }, stats: { ...state.stats, switched: state.stats.switched + 1, applied: state.stats.applied + (applied ? 1 : 0) } },
          events: applied ? [{ name: "applied", data: { id: p.config, index } }] : [],
        };
      }
      case "capture": {
        // a new configuration from the board's live chain (E-004)
        if (state.configs.length >= MAX_CONFIGS) return { reject: `At most ${MAX_CONFIGS} configurations; delete one first` };
        const c = parseConfig(p.config);
        if (!c) return { reject: "That is not a configuration" };
        if (state.configs.some((x) => x.id === c.id)) return { reject: "That configuration exists already" };
        return { state: { ...state, configs: settle([...state.configs, c], c), stats: { ...state.stats, captured: state.stats.captured + 1 } } };
      }
      // ---- from the board or the phone ------------------------------------------------------------------------
      case "edit": {
        // rename, move to another quick slot or trigger, or delete
        const id = typeof p.id === "string" ? p.id : "";
        const c = state.configs.find((x) => x.id === id);
        if (!c) return { reject: "That configuration is gone" };
        if (p.remove === true) return { state: { ...state, configs: state.configs.filter((x) => x.id !== id) } };
        // a field left out keeps its value; null clears it
        const slot = "slot" in p ? nullable(p.slot, 0, QUICK_SLOTS - 1) : c.slot;
        const trigger = "trigger" in p ? nullable(p.trigger, 1, PRESETS) : c.trigger;
        if (slot === false || trigger === false) return { reject: "That slot does not exist" };
        const next: Config = { ...c, name: "name" in p ? text(p.name, 24) || c.name : c.name, slot, trigger };
        return { state: { ...state, configs: settle(state.configs, next) } };
      }
      case "apply": {
        const c = state.configs.find((x) => x.id === p.id);
        if (!c) return { reject: "That configuration is gone" };
        if (!state.pedal.connected) return { reject: "The pedal is not connected" };
        const next = queue(state, { kind: "apply", config: c });
        return { state: { ...next, stats: { ...state.stats, recalls: state.stats.recalls + 1 } }, events: [{ name: "apply", data: { id: c.id } }] };
      }
      case "select": {
        if (!state.pedal.connected) return { reject: "The pedal is not connected" };
        const index = "index" in p ? int(p.index, 1, PRESETS) : null;
        const step = int(p.step, -PRESETS, PRESETS);
        const target = index ?? (step !== null && state.pedal.current ? ((state.pedal.current - 1 + step + PRESETS * 2) % PRESETS) + 1 : null);
        if (target === null) return { reject: "That is not a preset of the GE150 Pro" };
        return { state: queue({ ...state, pedal: { ...state.pedal, current: target } }, { kind: "select", index: target }) };
      }
      case "click": {
        const bpm = "bpm" in p ? int(p.bpm, 30, 300) : state.click.bpm;
        const beats = "beats" in p ? int(p.beats, 1, 12) : state.click.beats;
        if (bpm === null || beats === null) return { reject: "That tempo is out of range (30 to 300 BPM)" };
        const on = typeof p.on === "boolean" ? p.on : state.click.on;
        const follow = typeof p.follow === "boolean" ? p.follow : state.click.follow;
        const click: Click = { on, bpm, beats, follow, run: on && !state.click.on ? state.click.run + 1 : state.click.run };
        return JSON.stringify(click) === JSON.stringify(state.click) ? { state } : { state: { ...state, click } };
      }
      // ---- from the phone -------------------------------------------------------------------------------------
      case "configs": {
        // the phone's stored configurations, once per player; ones made before it came stay (newer)
        if (state.synced) return { state };
        const sent = Array.isArray(p.list) ? p.list : [];
        let configs = [...state.configs];
        for (const raw of sent.slice(0, MAX_CONFIGS)) {
          const c = parseConfig(raw);
          if (c && !configs.some((x) => x.id === c.id) && configs.length < MAX_CONFIGS) {
            configs.push({ ...c, slot: configs.some((x) => x.slot === c.slot) ? null : c.slot, trigger: configs.some((x) => x.trigger === c.trigger) ? null : c.trigger });
          }
        }
        return { state: { ...state, configs, synced: true } };
      }
      case "finish":
        return { state: { ...state, done: true, endedAt: ctx.now(), click: { ...state.click, on: false } }, events: [{ name: "finished" }] };
      default:
        return { reject: "Not something this game knows" };
    }
  },

  view: (state) => view(state),
  boardView: (state) => view(state),

  isOver(state) {
    if (!state.done) return null;
    const m = minutes(state);
    const { recalls, applied, switched, captured } = state.stats;
    const parts = [
      recalls ? `recalled ${count(recalls, "configuration")} from the phone` : "",
      applied ? `had ${count(applied, "configuration")} applied by the footswitches` : "",
      captured ? `saved ${count(captured, "new configuration")}` : "",
    ].filter(Boolean);
    return {
      text: `${state.player || "The player"} played${m ? ` for ${count(m, "minute")}` : ""}${parts.length ? ` and ${list(parts)}` : ""}.`,
      highlights: { minutes: m, recalls, applied, switched, captured },
      table: { columns: ["Player", "Recalls", "Footswitch", "Minutes"], rows: [[state.player, recalls, switched, m]] },
    };
  },

  onSeatChanged(state, seat) {
    // another person: their phone brings their own configurations; the last player's queued commands and counts end
    return { state: { ...state, player: seat.name, configs: [], synced: false, commands: [], stats: { recalls: 0, applied: 0, switched: 0, captured: 0 } } };
  },

  describe: describeStep,
});
