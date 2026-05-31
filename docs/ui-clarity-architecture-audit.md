# Forge UI Clarity And Architecture Audit

## Scope

This audit covers the Forge web app clarity contract that a routed view must explain what the user is seeing, what the data means, and how to interpret uncertainty before the user acts on it. The current implementation pass focuses on the reusable shell and the Training Load surface because those are the highest-leverage places for the reported confusion: every `PageHero` routed through the shared shell now receives a default explanation affordance when its description is plain text, and Training Load receives additional metric-level and section-level explanations.

The audit did not delete or rewrite user data. It changes React/TypeScript source, tests, and the generated plugin runtime bundle.

## Findings

The previous shell pattern placed most page orientation in short hero subtitles. That was visually tidy, but it made complex views hard to interpret because the user had no nearby explanation for page purpose, data provenance, confidence, or actionability. Training Load had the same problem at a denser level: metrics such as acute load, chronic base, ACWR, HRR zones, high-intensity share, and smart training modes were shown with strong labels but insufficient interpretation at the point of use.

The previous tooltip primitive was also too narrow. It accepted only plain string content, had no title channel for scanability, and left its panel semantically visible while only opacity-hidden. That made it harder to reuse for information-rich explanations and weaker for accessibility review.

## Architectural Contract

`src/components/shell/page-hero.tsx` is the shared page-level clarity boundary. A routed page that uses a string description now gets a help affordance beside the page title automatically. Pages can override the visible sentence with `helpContent` when they need a longer interpretation guide. This keeps page-level help consistent without forcing every page to hand-roll its own tooltip.

`src/components/ui/info-tooltip.tsx` is the shared compact explanation primitive. It supports rich React content, an optional title, a custom accessible label, and an explicit hidden/open semantic state. It is appropriate for metric labels, section headings, and controls where the user needs interpretation but the main layout must stay dense.

`src/pages/training-load-page.tsx` now centralizes explanatory copy in `TRAINING_LOAD_HELP` and renders repeated section headings through `SectionHeading`. That gives Training Load one place to audit the meaning of each metric and keeps the layout code from diverging into many one-off header patterns.

`src/components/training-load/zone-intelligence-panel.tsx` now defines `ZONE_INTELLIGENCE_HELP` for mode logic, drivers, limiters, interpretation, and next targets. The copy states what the mode does and does not do: it changes the coaching lens, not the underlying data.

## Regression Coverage

The new tests assert three durable contracts:

- `InfoTooltip` keeps hidden explanatory text out of the accessibility tree until opened and closes through Escape.
- `PageHero` gives plain-text descriptions a default explanation affordance and allows custom help content when the visible hero sentence is too short.
- Routed page files continue to rely on the shared `PageHero` clarity boundary rather than losing the explanation affordance during future page edits.

## Residual Risk

Forge has many older surfaces with domain-specific text that should eventually receive deeper page-by-page editorial review. This pass establishes the architecture and covers the highest-risk Training Load view, but it does not claim that every historical phrase in every route has been manually rewritten. Future work should continue converting dense domain areas to centralized help dictionaries and shared section-heading primitives instead of adding isolated tooltip copy.
