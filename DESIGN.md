# Milestone desk design brief

## Direction

Milestone desk is an operations console for clients, workers, and reviewers handling payment for work that is not delivered yet. The interface is calm, precise, and accountable: every stage names its status, next action, and consequence. It is not a marketing site, dashboard collage, or visual showcase.

- **Typography:** Fraunces is the display face for headings, DM Sans is the readable working face, and DM Mono is reserved for case IDs, amounts, timestamps, and PayPal identifiers. The scale moves from 12px metadata to 48px page titles.
- **Colour:** An off-white paper and ink system keeps the working surface quiet. Burnt orange is the single accent for the current step and primary action. Green, red, ochre, and slate communicate pass, fail, unclear, and pending, with text labels and borders so colour is never the only signal. Light and dark tokens are defined as CSS custom properties.
- **Layout:** A persistent 248px sidebar and a 12-column content grid support desktop work. The content is capped at roughly 1100px of readable density. On mobile the sidebar becomes a top bar and tables become labelled rows.
- **Density and motion:** Tables and definition lists carry real data without excessive cards. Only stage/status changes receive motion, and reduced-motion preferences disable it.

## Product references

1. **Stripe Dashboard:** taken from its strong object hierarchy, compact financial metadata, and explicit status language.
2. **GitHub Issues:** taken from its practical workflow language, reviewable history, and keyboard-friendly controls.
3. **Linear:** taken from its restrained navigation, focused command surfaces, and clear current-state emphasis.

## What this does not do

This design does not use a hero, feature grid, decorative illustration, gradients, icon-heavy cards, fake metrics, or marketing copy. It does not expose PayPal credentials or recreate PayPal UI; it links to the server-provided sandbox approval URL.
