# Decision log: GE150 Pro for Game Table

Decisions for the Game Table game in this repository (`games/ge150-pro`), newest last. Platform decisions live in
games-service `docs/decisions.md`; the pedal's protocol is researched in the GE150PRO repository
(`klaushofrichter/GE150PRO`, private, `docs/protocol/README.md`). "Klaus" marks product decisions; "Claude" marks
implementation choices, which Klaus can overrule.

Format: **E-nnn · date · decided by** — decision. *Why:* reason.

Records are history: an older record is not edited when a newer one changes it. Where that happened:

| Earlier | Changed by | What changed |
| --- | --- | --- |

- **E-001 · 2026-11-13 · Klaus** — A Mooer GE150 Pro connected to the table by USB becomes a game for Game Table, in
  this repository's `games/` folder (an extra game repository, like synth-game): one player at the table on South, no
  AI players, no remote player. The game controls the pedal only; no guitar audio goes through the table. The board
  controls the signal chain and programs configurations; the phone is the remote while playing (quick access to
  configurations and rhythm) with its own tabs. The official editor's layout is not copied: the design is for touch.
  No setlist. The only platform request is the console configuration that lets tables download the repository.
  *Why:* recall and shape sounds while playing, without bending down to the pedal.
- **E-002 · 2026-11-13 · Claude** — The pedal is driven over WebHID by `board.js`, and only on the table's own board
  for the player sitting at it (`info.controlSeats`), like synth-game's emulator (synth-game E-002). The board connects
  by itself to a pedal the browser already allows; otherwise **Connect pedal** opens the browser's device chooser (a
  touch is the user gesture WebHID needs). A remote board shows the state and a note. *Why:* the pedal is on the table
  PC's USB; WebHID works in the kiosk's secure page at 127.0.0.1 without platform changes.
- **E-003 · 2026-11-13 · Claude** — The rules keep what the table shares: the pedal's state as the board reports it
  (connection, current preset, the 200 names, the chain's on/off and models, rhythm, EXP), the configurations, the
  click track, and a numbered command queue. The phone's `select` and `apply` intents append commands; the board
  carries each out once and acknowledges with `done`; commands still unacknowledged when a board starts are carried
  out then. Full preset data stays in the board's memory. Reports to the rules are merged for 150 ms, since each
  counts as a move. *Why:* the rules stay pure and replayable while the board talks to the hardware; the preset
  bodies (200 × 245 bytes) are too large to copy on every step.
- **E-004 · 2026-11-13 · Klaus (what), Claude (how)** — A configuration is a named set of modules exactly as they are
  on the pedal, optionally with a preset to select first, saved from the board (**Save configuration…**). It goes on
  one of eight quick slots on the phone and/or on a footswitch: when the pedal reports that its footswitch selected the
  trigger preset (`16`), the board applies the configuration right after. Each quick slot and each trigger belongs to
  one configuration; the newest one takes it. *Why:* the pedal's footswitches cannot be reassigned (their functions
  are fixed in the firmware); reacting to what they report adds functions without changing the pedal. The pedal
  sends `16` only for its own selections, never for the host's, so the board needs no filter for its own.
- **E-005 · 2026-11-13 · Klaus** — Rhythm on the phone: the pedal's drum machine is shown (style by name, tempo,
  volume, a light at its tempo) but cannot be started, stopped or changed: the firmware has no USB rhythm command
  (dispatcher analysis of V2.1.2 and V2.1.4) and ignores USB-MIDI start/stop and clock. The phone instead controls a
  **table click**, played by the board's speakers: start/stop, tempo (±, tap, or following the pedal's drum machine),
  beats per bar with an accent. Its volume is a board setting. *Why:* a rhythm the phone can control, honestly
  labelled as the table's.
- **E-006 · 2026-11-13 · Claude** — The player's configurations are kept in the phone's browser between games (like
  synth-game's favourites, synth-game E-013): sent to the game once (`configs`), kept up to date from it. Another
  player taking the seat starts without configurations until their phone sends its own. *Why:* they belong to the
  player, not the table.
- **E-007 · 2026-11-13 · Claude** — The protocol library (`src/ge150/`) is a copy of the GE150PRO repository's,
  bundled with esbuild into `assets/ge150.js`, the one module board and phone import; `tests/assets.test.ts` fails
  while the committed bundle is out of date. Its model catalog keeps model names, parameter specs and value positions
  but not the manual's model descriptions. *Why:* games ship plain browser modules; the library stays testable as
  TypeScript; the descriptions are the manual's text.
- **E-008 · 2026-11-13 · Claude** — The browser check runs against a simulated pedal (`scripts/e2e/fake_pedal.js`,
  injected as WebHID), which answers like the hardware: framing and CRC, the connect sequence, live module state, a
  store acknowledgement and a footswitch. *Why:* CI has no pedal; the simulation exercises the real WebHID code path.
- **E-009 · 2026-11-13 · Claude** — Safety: the game sends only commands observed from Mooer's editor, never factory
  reset, firmware or the flash-erasing codes the firmware analysis found (`8B`, `BA`), and writing a preset slot
  (**Save…**) always asks first. *Why:* the pedal holds the player's own presets.
- **E-010 · 2026-11-13 · Klaus** — The protocol specification is published here as a sanitized copy,
  `docs/protocol.md`, generated by `scripts/import-protocol.mjs` from the GE150PRO repository, which stays the original
  source. The copy keeps the specification, evidence labels and open questions, and leaves out how the research was
  done (capture by injection into Mooer's editor, local paths, the webcam set-up) and where firmware images are kept.
  *Why:* the protocol is obvious to anyone who looks; the research set-up is not the game's business.
- **E-011 · 2026-11-13 · Klaus (what), Claude (how)** — The game takes games-service's look (`shared/theme.css`), not
  the pedal maker's editor: felt, brass as the only accent (a module that is on is lit in brass), the display serif for
  names, letter-spaced brass labels, pill buttons, the board games' rim (dark wood, brass ring) around the signal
  chain, jade only for the connection's OK. *Why:* it is a Game Table game and should look like one.
