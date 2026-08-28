#### 1. Visual Identity

| Role             | Hex Code  | Usage                                                                            |
| :--------------- | :-------- | :------------------------------------------------------------------------------- |
| **Background**   | `#0A0F0A` | **Deep Obsidian Green** - The primary app background.                            |
| **Surface**      | `#161D16` | **Elevated Green-Gray** - For cards, search bars, and sections.                  |
| **Primary**      | `#4ADE80` | **Vibrant Mint** - High-visibility green for buttons and active states.          |
| **Secondary**    | `#86EFAC` | **Soft Sage** - Secondary actions and borders.                                   |
| **Accent**        | `#FFB86C` | **Soft Amber** - Highlighted states and high-emphasis actions.                   |
| **Error**         | `#F87171` | **Muted Red** - Validation and request errors.                                   |
| **Text-Primary**  | `#F3F4F6` | **Off-White** - Primary headings and body text.                                  |
| **Text-Muted**   | `#9CA3AF` | **Cool Gray** - For descriptions, labels, and metadata.                          |
| **Text-On-Bright** | `#0A0F0A` | **Deep Obsidian Green** - Text on Primary and Accent controls.                   |

#### 2. Typography

| Element         | Font Family        | Size / Weight |
| :-------------- | :----------------- | :------------ |
| **Headings**    | Inter / Sans-Serif | Bold (700)    |
| **Body**        | Inter / Sans-Serif | Regular (400) |
| **Data/Labels** | Roboto Mono        | Medium (500)  |

#### 3. Tech Stack Integration

This project uses **Svelte 5** with **Tailwind CSS**. Use Tailwind utility classes and extend the theme with the color palette above.

**Tailwind Theme Extension (tailwind.config.js):**

```javascript
theme: {
  extend: {
    colors: {
      // Dark mode
      'dark-background': '#0A0F0A',
      'dark-surface': '#161D16',
      'dark-primary': '#4ADE80',
      'dark-secondary': '#86EFAC',
      'dark-accent': '#FFB86C',
      'dark-error': '#F87171',
      'dark-text-primary': '#F3F4F6',
      'dark-text-muted': '#9CA3AF',
      'dark-text-on-bright': '#0A0F0A',
    },
    fontFamily: {
      sans: ['Inter', 'sans-serif'],
      mono: ['Roboto Mono', 'monospace'],
    },
  },
}
```

#### 4. Global Layout Patterns

The page uses one centered primary content column with a maximum width of `1280px`.

- **Mobile:** `320–639px`, one card column.
- **Tablet:** `640–1023px`, one card column.
- **Desktop:** `≥1024px`, three equal card columns.
- **Empty state:** the search control uses the prominent center position.
- **Result state:** the search control is near the top, with result cards below it.

#### 5. Component Standards (Svelte)

- **File Structure:** Components live in `src/lib/components/` with `.svelte` extension.
- **Script Setup:** Use Svelte 5 runes (`$state`, `$derived`, `$effect`).
- **State Management:** Global state via Svelte stores + TanStack Query for server state.
- **Styling:** Tailwind classes in `class` attributes; avoid `<style>` blocks unless necessary.
- **Buttons:** Use a 4px border radius and property-specific `200ms` transitions. Reduced-motion mode uses immediate state changes.
- **Pill controls:** Fully rounded controls are accepted for chip-like filters, badges, segmented choices, compact icon actions, and selected-state tokens where the pill shape communicates grouping or status. Pill controls must still use visible focus states, accessible names, and stable hit targets.
- **Inputs:** Use the Surface background, a 1px Secondary border, and Text-Primary text. Focus uses a Primary border without an outer highlight.
- **Loading States:** Do not show a spinner below Search or in selected-food or result cards. A new Search keeps the selected-food content visible without a replacement spinner. A valid local quantity commit reprojects visible selected-food and result-card values synchronously without hiding content or showing a spinner. While a MORE! request is pending, keep its localized label and show the focused non-operable control with a gray background and gray text. ISSUE-022 deprecated REQ-081's card-spinner behavior.

#### 6. Compliance & Accessibility

- **Contrast:** Normal text has at least `4.5:1` contrast. Large text and interface graphics have at least `3:1` contrast. Use Text-On-Bright on Primary and Accent.
- **Responsive:** Page content fits inside each viewport width of `320px` or more.
- **Testing:** Use Bun and `@testing-library/svelte` for component integration tests. Use Playwright for browser integration, motion, responsive layout, and visual states.
