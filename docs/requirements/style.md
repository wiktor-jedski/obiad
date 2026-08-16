#### 1. Visual Identity

| Role             | Hex Code  | Usage                                                                            |
| :--------------- | :-------- | :------------------------------------------------------------------------------- |
| **Background**   | `#0A0F0A` | **Deep Obsidian Green** - The primary app background.                            |
| **Surface**      | `#161D16` | **Elevated Green-Gray** - For cards, search bars, and sections.                  |
| **Primary**      | `#4ADE80` | **Vibrant Mint** - High-visibility green for buttons and active states.          |
| **Secondary**    | `#86EFAC` | **Soft Sage** - Secondary actions and borders.                                   |
| **Accent**       | `#FFB86C` | **Soft Amber** - For Daily Diet Search "Best Match" badges and high-energy CTAs. |
| **Error**        | `#F87171` | **Muted Red** - For alerts and Stripe payment issues.                            |
| **Text-Primary** | `#F3F4F6` | **Off-White** - Primary headers and body text (90% opacity).                     |
| **Text-Muted**   | `#9CA3AF` | **Cool Gray** - For descriptions, labels, and metadata.                          |

#### 2. Typography

| Element         | Font Family        | Size / Weight |
| :-------------- | :----------------- | :------------ |
| **Headings**    | Inter / Sans-Serif | Bold (700)    |
| **Body**        | Inter / Sans-Serif | Regular (400) |
| **Data/Labels** | Roboto Mono        | Medium (500)  |

#### 3. Tech Stack Integration

This project uses **Svelte** with **Tailwind CSS**. All styling should leverage Tailwind utility classes where possible, extending the theme with the color palette above.

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
    },
    fontFamily: {
      sans: ['Inter', 'sans-serif'],
      mono: ['Roboto Mono', 'monospace'],
    },
  },
}
```

#### 4. Global Layout Patterns

_This defines the "Skeleton" for the Architect (SWE.2)._

- **Grid System:** 12-column CSS Grid with a max-width of `1280px`.
- **Breakpoints:**
  - Mobile: `< 640px` (Single column, sidebar as a toggle).
  - Desktop: `> 1024px` (Sidebar as a toggle, visible by default, main content area).
- **Navigation:** search in the middle, left-sidebar for additional info as per requirements.

#### 5. Component Standards (Svelte)

- **File Structure:** Components live in `src/lib/components/` with `.svelte` extension.
- **Script Setup:** Use Svelte 5 runes (`$state`, `$derived`, `$effect`) or Svelte 4 stores as per project version.
- **State Management:** Global state via Svelte stores + TanStack Query for server state.
- **Styling:** Tailwind classes in `class` attributes; avoid `<style>` blocks unless necessary.
- **Buttons:** 4px border-radius, `transition: all 0.2s ease` via Tailwind `transition-all duration-200`.
- **Pill controls:** Fully rounded controls are accepted for chip-like filters, badges, segmented choices, compact icon actions, and selected-state tokens where the pill shape communicates grouping or status. Pill controls must still use visible focus states, accessible names, and stable hit targets.
- **Inputs:** White background with 1px border (`#E0E0E0`) in light mode; use the theme Surface and Border colors in dark mode. Focus state must use Primary color.
- **Loading States:** Use spinning icons.

#### 6. Compliance & Accessibility

- **Contrast:** All Text/Background combinations must pass **WCAG 2.1 AA** (minimum 4.5:1 ratio).
- **Responsive:** No horizontal scrolling allowed at any viewport size above 320px.
- **Testing:** Components tested with @testing-library/svelte and Playwright for visual regression.
