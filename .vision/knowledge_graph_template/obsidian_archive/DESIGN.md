# Design System Specification: The Celestial Archive (Obsidian Edition)

## 1. Overview & Creative North Star: "The Digital Curator"
This design system moves away from the cluttered "dashboard" tropes of SaaS and toward the quiet, authoritative atmosphere of a high-end editorial archive. Our Creative North Star is **The Digital Curator**: an interface that feels like a rare, illuminated manuscript existing in a deep space void.

To achieve this, we reject the "Standard Grid." We embrace **intentional asymmetry**, where content is anchored by heavy typographic weight and surrounded by vast, purposeful negative space. Elements should never feel "pasted" onto the background; they should emerge from it through tonal layering and light.

## 2. Colors & Surface Philosophy
The "Obsidian" palette is built on a foundation of Deep Navy (`#0b1326`), punctuated by ethereal light and "atomic" accents.

### The Color Tokens
*   **Primary (Light Indigo):** `#c0c1ff` – Used for primary actions and "active" neural states.
*   **Secondary (Mint Green):** `#4edea3` – Reserved for growth, success, and secondary navigational nodes.
*   **Tertiary (Amber):** `#ffb95f` – Used sparingly for warnings, highlights, or "archival" annotations.
*   **Neutral/Ink:** `#eef2ff` – High-contrast text for maximum legibility against the void.

### The "No-Line" Rule
**Explicit Instruction:** Designers are prohibited from using 1px solid borders to section off content. Boundaries must be defined solely through background color shifts.
*   A `surface-container-low` section sitting on a `surface` background is the only permissible way to define a region. 
*   Physicality is achieved through color transitions, not outlines.

### Surface Hierarchy & Nesting
Treat the UI as a series of nested physical layers, like stacked sheets of obsidian glass:
1.  **Canvas (Base):** `surface` (`#0b1326`) – The infinite void.
2.  **Panels:** `surface-container` (`#171f33`) – The primary staging area for content.
3.  **In-Panel Cards:** `surface-container-high` (`#222a3e`) – For focused information units.
4.  **Floating Elements:** Use `surface-bright` (`#31394e`) with a 60% opacity and a `20px` backdrop-blur to create a "frosted obsidian" effect.

### Signature Textures
Use subtle linear gradients for CTAs. A transition from `primary` (`#e1dfff`) to `primary-container` (`#c0c1ff`) at a 135-degree angle provides a "shimmer" that flat hex codes cannot replicate.

## 3. Typography: The Editorial Voice
We pair the geometric precision of **Space Grotesk** with the utilitarian clarity of **Inter**.

*   **Display (Space Grotesk):** Large-scale headers (`display-lg`: 3.5rem) should be set with tight letter-spacing (-0.02em) to feel like a premium masthead.
*   **Headlines (Space Grotesk):** Use `headline-md` (1.75rem) for section titles. These should be left-aligned with significant top-padding to establish a "New Chapter" feel.
*   **Body (Inter):** All long-form reading uses `body-md` (0.875rem). Increase line-height to `1.6` to ensure the "Archive" feels breathable and scholarly.
*   **Labels (Space Grotesk):** Use `label-md` (0.75rem) in All Caps with `0.1em` letter-spacing for technical data points or metadata nodes.

## 4. Elevation & Depth
Depth is a psychological cue, not just a visual flourish.

*   **The Layering Principle:** To lift a card, do not reach for a shadow. Move from `surface-container-low` to `surface-container-highest`. The tonal "step-up" creates a natural, sophisticated lift.
*   **Ambient Shadows:** If a floating state (like a context menu) is required, use an extra-diffused shadow: `box-shadow: 0 20px 40px rgba(6, 13, 32, 0.4);`. The shadow must be a tinted navy, never pure black.
*   **The "Ghost Border" Fallback:** If accessibility requires a container edge, use `outline-variant` at 15% opacity. It should be felt, not seen.

## 5. Components

### Buttons
*   **Primary:** Solid `primary-container` (`#c0c1ff`) with `on-primary` text. Radius: `0.25rem`. 
*   **Secondary:** Ghost style. No background, `primary` text, and a `Ghost Border` (15% opacity primary).
*   **Tertiary:** `label-md` styling with an underline that appears only on hover.

### Neural Nodes (App Specific)
Nodes in the Celestial Archive should use the `secondary` (`#4edea3`) color for active states. They should possess a soft "outer glow" using a CSS drop-shadow filter of the same color at 30% opacity.

### Input Fields
*   **Styling:** No bottom line, no full box. Use `surface-container-lowest` as the fill. 
*   **Focus State:** The background shifts to `surface-container-high` and the cursor (caret) takes the `tertiary` (`#ffb95f`) color.

### Lists & Cards
*   **Forbid Dividers:** Horizontal rules are relics of the past. Separate list items using `1.5rem` of vertical whitespace or a 2% shift in background brightness on hover.

## 6. Do’s and Don’ts

### Do:
*   **Embrace the Void:** The spacing in this system is now set to a 'compact' feel. While still embracing the void, ensure visual balance is maintained with judicious use of negative space.
*   **Use Mono-spacing for Data:** Use Space Grotesk's tabular figures for any numerical data to maintain the "Archive" aesthetic.
*   **Layer with Light:** Use `secondary` or `tertiary` as tiny 4px "indicator pips" rather than large color blocks.

### Don't:
*   **Don't use pure black (#000):** It kills the depth of the Indigo canvas.
*   **Don't use 100% Opaque Borders:** This shatters the "Celestial" atmosphere and makes the UI feel like a template.
*   **Don't Center-Align Everything:** High-end editorial design is almost always anchored to a strong left or right axis to create dynamic tension.