# GE150 Pro

Control a Mooer GE150 Pro guitar multi-effects pedal that is connected to the table by USB. The table only controls
the pedal: your guitar plays through the pedal as always.

## In short

- One player, with the GE150 Pro connected to the table by USB.
- The **board** shapes the sound: modules, models, parameters, presets.
- **Save configuration…** puts a sound on a phone **quick slot** or a footswitch.
- The **phone** steps through presets and your favorites, recalls quick slots, runs a click and shows the drum machine.
- Leave the game through the player tab at the top of your phone.

![The board with the signal chain, faders and presets; the phone with favorites and quick slots](assets/img/layout.svg)

## Connecting the pedal

Connect the GE150 Pro to the table's computer with a USB cable before starting. The board connects to it by itself
when it can; otherwise tap **Connect pedal** on the board and choose **GE150Pro**. Only one program can use the pedal at
a time: close Mooer's own editor first. The pedal's presets load in a few seconds.

Without a pedal the board says how to connect it, and connects by itself as soon as the pedal is plugged in (also when
it was unplugged during the game). The game needs the pedal's firmware **V2.1.2 or newer**; with an older firmware the
board says so and changes nothing on the pedal: update it with Mooer's editor.

## The board

- **Connected** (top left): tap it to disconnect the pedal, after asking, so Mooer's editor or the web editor can use
  it. **Connect pedal** connects again; until then the board does not connect by itself.
- **The preset's name** at the top (on the board and the phone): tap it to see what the preset plays, module by
  module: on or off, the model (which amp, which cab) and its values. Unsaved changes are marked in brass beside the saved value, and
  **Reset** goes back to the saved preset.
- **The signal chain** across the top shows the nine modules in the pedal's order. **ON/OFF** switches a module; tap
  its name to edit it below.
- **The editor** shows the module's model (tap it to choose another) and a fader for each parameter: drag anywhere on
  a fader, or use **−** and **+**.
- Tap the **bank name** on the right to see every bank and its presets: the shown bank and the playing preset are marked, a * shows unsaved changes. Tap a preset to select it, or a bank's number to only show that bank. **Reload saved** (after asking) drops the unsaved changes.
- **EXP** under a fader makes the expression pedal control that value in EXP mode (the toe switch selects EXP or
  volume mode). One value per preset: choosing another moves it there, and the chain shows an **EXP** badge on the
  module that has it. Faders without EXP are values the pedal cannot control. **Save preset…** keeps the choice.
  The chosen EXP is filled in EXP mode and only outlined in volume mode (the badge too); tapping it again switches
  the mode, like the toe switch. Calibrate the pedal once (EXP → CALIBRATE on the pedal) to use its full range.
- **Presets** selects a preset by bank and A–D, like the footswitches. Changes are live on the pedal and are lost when
  it switches presets, as on the pedal itself. **Save preset…** (top right) stores the current sound in its preset slot (it asks first).
  With **Confirm when changing presets after edits** on (the board's settings, off by default), switching with
  unsaved changes asks first, on the board or the phone where you switched: **Save and switch**, **Discard and
  switch** or **Cancel**. The other screen waits for the answer. The pedal's own footswitches never ask.
- **Configurations** lists your saved configurations: tap a name to see what it sets (preset, slot, footswitch, each
  module's model and values); **Load** sets it on the pedal now, as unsaved changes.
  **Save all to file…** saves every configuration in one file on the table's computer; **Load all from file…** brings
  such a file back and replaces the configurations the table keeps (both ask first). **✕** deletes one, after asking.

## Configurations and quick slots

A configuration is a set of modules exactly as they are now, saved from the board with **Save configuration…**. Choose
the modules it sets (the ones you changed are marked), whether it first selects the current preset, and where it goes:

- a **quick slot** (1 to 8) on your phone's **Config** tab: tap the slot while you play;
- a **footswitch**: when you select this preset with the pedal's footswitch, the configuration is applied right after.

The table keeps the configurations between games, for everyone who plays here; hold one on your phone's
**Config** tab to rename or remove it. (Ones an earlier version kept on your phone move to the table the first time you play.) The table's
people can export, import or delete them all under **Advanced › Game data** on the board.

## The phone

The card at the top shows the preset that plays (* for unsaved changes) and the expression pedal's mode: **VOL** in
volume mode, **EXP** with the value it sets in EXP mode. Tap the card to see what the preset plays, module by module.

- **Preset**: **◀ ▶** step through the presets. Below are your **favorites**, up to 12 presets in your own order, kept
  on this phone: tap **+** on the card (or drag the card down onto the list) to add the preset that plays. Tap a
  favorite to select it, **−** removes it, and drag it by **⋮⋮** to sort the list. The playing preset is marked and
  shows **modified** with unsaved changes. Favorites remember the bank and letter (23A): if other presets are loaded
  into the pedal, they show what is there now.
- **Rhythm**: below.
- **Config**: the configurations, the eight quick slots first, then any not on a slot, and the pedal's connection.
  Tap one to load it on the pedal; **hold** it to see what it sets, **Rename** it or **Remove** it (after asking).

## Rhythm

The phone's **Rhythm** tab shows the pedal's drum machine: style, tempo, volume and a light at its tempo. Start, stop
and TAP stay on the pedal, which takes no rhythm commands over USB.

The **table click** is a click track from the table's speakers: **Start** and **Stop**, **−** and **+**, **Tap** a few
times for a tempo, **Follow pedal tempo** to use the drum machine's tempo, and the beats per bar (the first is
accented). The board's **Click volume** setting sets its loudness.

## Good to know

- The game never sends a factory reset or a firmware update to the pedal.
- A remote player's board shows what happens but cannot control the pedal; it stays at the table.
