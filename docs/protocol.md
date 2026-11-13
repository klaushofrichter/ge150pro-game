# GE150 Pro: USB protocol used by the game

What the game sends to a Mooer GE150 Pro and what it reads back, as implemented in `src/ge150/`. The research behind it,
with the evidence for every statement and the open questions, is in the GE150PRO repository
(`klaushofrichter/GE150PRO`). Unofficial: not affiliated with or endorsed by Mooer.

## Transport

- USB vendor `0x0483`, product `0x5703` ("GE150Pro"). The pedal is also a USB audio interface; the control channel is
  HID interface 5 with 64-byte input and output reports and no report IDs.
- WebHID: `device.sendReport(0, <64 bytes>)`; `inputreport` events deliver 64 bytes.
- Only one program can use the control channel at a time (Mooer's editor or one browser page).

### Reports and messages

A report is `[n][n bytes of the message stream][padding]`, `n` ≤ 63. Long messages continue in the next report. The
padding is not zeroed: ignore everything after `n`. A message is

```
AA 55 len_lo len_hi cmd payload… crc_hi crc_lo        len = 1 + payload length
```

CRC-16/GSM (polynomial `0x1021`, initial `0x0000`, not reflected, final XOR `0xFFFF`) over `len_lo len_hi cmd payload`,
big-endian. Both directions use the same framing. Example, select preset 2 (1B): `AA 55 02 00 96 02 80 98`, sent as
the report `08 AA 55 02 00 96 02 80 98 00 … 00`. All multi-byte values below are uint16 little-endian.

## Connect sequence

| Step | Host sends | Pedal answers |
|---|---|---|
| 1 | `31 01` | `32` system settings, `12` spill-over, `11` global EQ (only during connect; later requests get no answer) |
| 2 | `A0 01` | 200 × `20`, one preset body each, in order |
| 3 | `C1 01` | `4D` (40 bytes) and `41` (640 bytes: 20 IR slot names of 32 bytes) |
| 4 | `8C 01` | `0C` drum machine state |
| 5 | `B0 01` | `30` current preset (stored copy), `33`, `18`, then `02`–`0A` with the live modules |

`B0 01` can be sent at any time to read the current preset's live state. The answers interleave; the host does not wait
between requests.

## Presets

200 presets, banks 1–50 × A–D, index `(bank − 1) × 4 + letter + 1` (1A = 1, 2A = 5, 50D = 200).

| Cmd | Dir | Payload | Meaning |
|---|---|---|---|
| `96` | → pedal | index | select a preset. The pedal answers nothing; read the new live state with `B0 01`. |
| `16` | ← pedal | index | the preset was changed on the pedal (footswitch or knob), never sent for the host's own selection |
| `20` | ← pedal | preset body | one preset of the dump |
| `30` | ← pedal | index, page id, body bytes 17–244 | the current preset's stored copy (not unsaved changes) |
| `97` | → pedal | index, name (16 bytes) | rename |
| `C3` | → pedal | preset body | store a preset in its slot (permanent) |
| `43` | ← pedal | index | store acknowledged |

Preset body (245 bytes): index (1), name (16, NUL-padded), 9 modules × 24 bytes, then `MODULE_CTRL, PARA_CTRL,
FUN_SWITCH, VOL_SWITCH, VOL_MIN, VOL_MAX` (6 × uint16). Name bytes are kept as they are, including non-ASCII bytes.

## Effect modules

Nine fixed slots: FX/COMP, DS/OD, AMP, CAB, NS GATE, EQ, MOD, DELAY, REVERB (slot 0–8). A module is 12 × uint16:
`SWITCH (0/1), TYPE (model, 0-based), v0 … v9`.

| Cmd | Dir | Meaning |
|---|---|---|
| `82`–`8A` | → pedal | set slot 0–8 now (not stored until `C3`) |
| `02`–`0A` | ← pedal | slot 0–8 changed on the pedal, or the answer to `B0 01` |

Values: a parameter with range min…max and step is sent as `raw = (value − offset) / step`, where `offset = min` if
the range goes below zero and 0 otherwise (delay times 40–2500 ms are sent as milliseconds). Choices are their index.
Each parameter has a fixed position among `v0 … v9`; it is its place in the model's parameter list, except for PHASER
and STEP PHASER (DEPTH at 3), PITCH SHIFT (PITCH at 5), DETUNE (PITCH at 4), CUSTOM EQ (FREQ1/2/3 at 6/7/8) and
DYNAMIC delay (THRES at 6). The model catalog with ranges and positions is `src/ge150/catalog.json`.

## System settings

| Set (→ pedal) | Report (← pedal) | Payload |
|---|---|---|
| `A4` | `24` | input level index (0 = −∞ … 9 = 0 dB … 21 = +6 dB) |
| `A5` | `25` | display brightness 0–20 |
| `A6` | `26` | cab simulation on the left and right outputs (2 values) |
| `A7` | `27` | USB (OTG) level index |
| `A8` | `28` | display language (0 Chinese, 1 English) |
| `D1` | `51` | global EQ: on, then 8 values, each offset by its range's minimum |
| `D2` | `52` | spill-over on/off |

Settings take effect immediately. The reports arrive when the setting is changed on the pedal.

## Expression pedal

| Set (→ pedal) | Report (← pedal) | Payload |
|---|---|---|
| `98` | `18` | `MODULE_CTRL` (slot 0–8), `PARA_CTRL` (parameter id), `FUN_SWITCH` |
| `B3` | `33` | `VOL_SWITCH`, `VOL_MIN`, `VOL_MAX` (0–100; MIN above MAX is accepted) |

Parameter ids per slot: FX 0–9 and 100, DS 10–12, AMP 13–18, CAB 19–20, NS 21–24, EQ 25–38, MOD 39–50 and
101–108, DLY 51–56, REV 57–60 and 109 (names in `src/ge150/exp.ts`). Moving a connected expression pedal produces the
controlled module's report (`02`–`0A`).

## Drum machine

`8C 01` asks for the state; `0C` reports it, also whenever it changes on the pedal: `ON, MODE, STYLE, VOLUME` (one
byte each, MODE 0 = rhythm, 1 = metronome, STYLE 0-based) and `BPM` (uint16, 40–260). Style names are in
`src/ge150/rhythm.ts`. The pedal accepts no command that starts, stops or changes the drum machine, over USB or
USB-MIDI: it is controlled on the pedal only.

## Pages

`B4 <id> 00` makes the pedal show a page, and `34 <id>` reports the page it shows; neither changes a setting. The game
does not use them.

## Supported firmware

The firmware version cannot be read over this channel. The game supports firmware V2.1.2 and newer by checking the
answers to the connect sequence: every answer above must arrive with its exact size within 8 seconds
(`src/ge150/compat.ts`). A pedal that answers differently is not controlled.

## Commands the game never sends

Only the commands above. In particular never `8B` or `BA` (they erase the pedal's memory), `BB`, `B5`, `D3`, `D4`,
`D5`, `C5`, factory reset or firmware updates, and no command or argument that is not listed here (`B4 15` opens the
pedal's reset prompt). Writing a preset slot (`C3`) always asks the player first.
