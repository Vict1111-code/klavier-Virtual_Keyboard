# Klavier — Typing Piano

A full-featured piano you play with your computer keyboard, built with plain
HTML, CSS, and JavaScript (no build step, no dependencies to install).

## Project structure

```
klavier-project/
├── index.html          Page markup and layout
├── css/
│   └── styles.css      All visual styling (wood/brass console, keys, panels)
└── js/
    └── app.js          All behavior: audio engine, key mapping, MIDI,
                         effects, looper, practice mode, visualizer
```

## Running it

No server or build tools are required.

- **Quickest:** double-click `index.html` to open it directly in a browser.
  Note: some browsers restrict the Web MIDI API (real MIDI keyboard support)
  on pages opened directly from disk (`file://`). Everything else — audio,
  the on-screen keyboard, recording, the looper, effects — works fine this
  way.
- **Full functionality (recommended):** serve the folder over a local
  web server so MIDI and fonts load exactly as intended:
  ```bash
  cd klavier-project
  python3 -m http.server 8000
  ```
  Then open `http://localhost:8000` in your browser.

## Keyboard mapping

Two full octaves, twelve keys each:

- **Left hand:** `A S D F G H J` (white keys), `W E T Y U` (black keys)
- **Right hand:** `K L ; ' \ M ,` (white keys), `I O P [ ]` (black keys)

Hold **Space** (or click the on-screen SUSTAIN pedal) to sustain notes.
**Arrow Up / Arrow Down** or the Octave buttons shift both hands together.

## Features

- 10 synthesized voices: Grand Piano, Electric Piano, Organ, Jazz Organ,
  Strings, Brass, Bass, Choir/Pad, Music Box, Synth Lead
- Dual (layer two voices) and Split (separate left-hand voice below a
  chosen note) keyboard modes
- Transpose and Octave shift
- Effects rack: distortion, chorus, delay
- Custom ADSR envelope editor
- Scale highlighting and a practice/trainer mode with live accuracy and
  notes-per-minute stats
- A small rhythm/drum machine (Pop, Rock, Jazz Swing, Latin, Ballad, or a
  plain click) with adjustable tempo
- A single-take recorder plus a 4-track looper
- Real MIDI keyboard input via the Web MIDI API
- A falling-notes visualizer for anything you record and play back
- Fully responsive: the keyboard resizes to fit any screen width

## Editing

Everything is plain, unminified code, organized in three files, so you can
open `css/styles.css` or `js/app.js` in any text editor and change colors,
voices, key mappings, or add new features directly.
