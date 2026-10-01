# 0002 — Design system sourced from the Threshold Consulting brand guidelines

Status: accepted

## Context

This product has no visual identity of its own yet. Rather than invent one from nothing, the
instruction was to reuse the colour palette, typography, and design principles from the
Threshold Consulting brand guidelines
(`../../The Better Projects Handbook/brand-guidelines.html`, same author, unrelated product).

That file is a brand identity for a specific consulting company (name, wordmark, logo mark,
business-card/email-signature mockups). None of that company-identity layer belongs to this
project. What's reusable and genuinely cross-project is one level down: the palette, the font
pairing, and the written design principles behind them (warm neutrals instead of clinical white,
a single disciplined accent colour, no gradients/green/pure-black, generous whitespace, sentence
case). Those are generic editorial/engineering-trust design decisions, not Threshold-specific.

## Decision

- Extract (not copy wholesale) the palette, type system, and stated principles into this
  project's own token set at [design/design-tokens.md](../../design/design-tokens.md).
- Do **not** carry over Threshold's name, wordmark, logo mark (the two-bar motif), or any
  collateral mockups (business cards, email signatures) — those are a different entity's brand
  assets.
- The two-bar motif is explicitly excluded for the same reason, even though it's visually
  reusable — reusing a specific company's logo mark on an unrelated product is a branding
  mistake even when no one else will ever see the two, so pick a different structural motif if
  one is wanted later (not decided yet; out of scope until a surface actually needs one).
- Apply the resulting tokens consistently across all three surfaces where each can reach them:
  - `surfaces/web` — Open WebUI supports custom CSS; point it at the token values.
  - `surfaces/pc` — the Tauri webview is a normal CSS target; tokens apply directly.
  - `surfaces/android` — RikkaHub's own theming surface is whatever RikkaHub itself exposes
    (likely Material You / light-dark toggle, not arbitrary token injection); match as closely as
    RikkaHub allows rather than forking it just for colour.

## Consequences

- The product currently has no name of its own (the repo is `theAIproject`, a working title).
  The design tokens therefore don't encode a wordmark or logo — only colour/type/spacing/motion
  rules. Naming and a mark, if wanted, are a separate decision to make later, not implied by this
  ADR.
- Because Open WebUI and RikkaHub are adopted (not built) per ADR 0001, full token coverage is
  only guaranteed on `surfaces/pc`. Web and Android get "as close as the adopted app allows,"
  which may mean just picking the closest built-in theme rather than exact hex matches.
