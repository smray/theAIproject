# Design tokens

Source and rationale: [docs/adr/0002-design-system-source.md](../docs/adr/0002-design-system-source.md).
Palette and type system extracted from the Threshold Consulting brand guidelines; company-identity
elements (name, wordmark, logo mark) deliberately excluded — see that ADR before changing this file.

## Colour

| Token | Hex | Role |
|---|---|---|
| `--ink` | `#1A2332` | Primary — dominant background, headlines. Replaces black everywhere; pure `#000000` is never used. |
| `--slate` | `#2D3F52` | Secondary dark — body text on dark fields. |
| `--accent` | `#7A6A52` | The one accent colour. Used with discipline: key dividers, active/selected states, eyebrow labels. Never a background fill, never decorative. |
| `--accent-light` | `#9A8A72` | Accent at reduced emphasis (e.g. the "receding" half of a two-tone accent pairing, secondary icons). |
| `--accent-pale` | `#EDE8E1` | Accent-tinted neutral, for subtle highlight backgrounds. |
| `--stone` | `#F5F0E8` | Background — section fills, card grounds. |
| `--ash` | `#E2DDD6` | Border — dividers, rules, subtle separators. |
| `--mist` | `#8E8880` | Secondary text — metadata, captions, labels. |
| `--warm-white` | `#FEFCF9` | Page ground. Never pure white (`#FFFFFF`). |

Rules carried over from the source guidelines, still binding here:

- **No green**, even though this is an AI/software product where green is the default "status
  good" colour elsewhere — use the accent or a neutral instead; if a genuine status-good colour
  is needed later, that's a deliberate new decision, not an accidental default.
- **No pure black or pure white** — `--ink` and `--warm-white` replace them throughout.
- **The accent is scarce by design.** It earns attention by appearing almost nowhere. Every
  additional use dilutes every previous one.
- **No gradients, drop shadows, or decorative effects.**

## Typography

| Token | Font | Use |
|---|---|---|
| `--font-display` | `'Cormorant', Georgia, serif` | Headlines, titles, pull quotes. |
| `--font-body` | `'Jost', sans-serif` | Body copy, labels, navigation, metadata, UI chrome. |

Loaded from Google Fonts: `family=Cormorant:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400&family=Jost:wght@300;400;500;600`.

- Sentence case throughout, including labels and navigation. Uppercase is reserved for small
  eyebrow/label text only (e.g. `font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase;`).
- Never Inter, Roboto, or Arial for display text — the pairing above is a deliberate choice, not
  a placeholder.

## Spacing & layout principles

- Generous whitespace by default — density reads as anxiety, not capability.
- Hierarchy through line weight and colour restraint, not boxes/shadows/borders-everywhere.
- A single thin rule (`1px solid var(--ash)`) is the default divider; the accent colour on a rule
  is reserved for the one divider that should draw the eye.

## CSS variable block

Drop this directly into any surface that accepts custom CSS (Open WebUI custom CSS, the Tauri
webview's global stylesheet):

```css
:root {
  --ink: #1A2332;
  --slate: #2D3F52;
  --accent: #7A6A52;
  --accent-light: #9A8A72;
  --accent-pale: #EDE8E1;
  --stone: #F5F0E8;
  --ash: #E2DDD6;
  --mist: #8E8880;
  --warm-white: #FEFCF9;
  --font-display: 'Cormorant', Georgia, serif;
  --font-body: 'Jost', sans-serif;
}
```

## Applying this per surface

- **`surfaces/pc` (Tauri):** import the block above as the webview's base stylesheet; full
  control, full fidelity.
- **`surfaces/web` (Open WebUI):** paste the block into Open WebUI's custom CSS setting once
  Phase 1 integration starts; Open WebUI's own component classes will need mapping, which is
  Phase 1 work, not decided here.
- **`surfaces/android` (RikkaHub):** RikkaHub's theming surface (likely Material You / a
  light-dark toggle) may not accept arbitrary tokens — match the closest built-in theme rather
  than forking the app for colour. Confirm what RikkaHub actually exposes when Phase 2 starts.
