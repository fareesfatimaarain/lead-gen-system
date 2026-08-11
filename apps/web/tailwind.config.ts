import type { Config } from "tailwindcss";

/**
 * Design system.
 *
 * Reference points are Linear, Vercel, and Stripe: dense, flat, instant. Colour
 * is reserved for state meaning — there is deliberately no decorative palette
 * here, and no gradient, glow, or shadow beyond a single hairline elevation.
 *
 * Every value maps to a CSS variable in globals.css so both themes are one
 * definition, not two.
 */
const config: Config = {
  darkMode: ["class", '[data-theme="dark"]'],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    // 4px scale. Nothing lands between these values.
    spacing: {
      0: "0px",
      px: "1px",
      0.5: "2px",
      1: "4px",
      1.5: "6px",
      2: "8px",
      2.5: "10px",
      3: "12px",
      4: "16px",
      5: "20px",
      6: "24px",
      7: "28px",
      8: "32px",
      10: "40px",
      12: "48px",
      16: "64px",
      20: "80px",
      24: "96px",
    },
    borderRadius: {
      none: "0",
      sm: "3px",
      DEFAULT: "5px",
      md: "6px",
      lg: "8px",
      full: "9999px",
    },
    fontSize: {
      "2xs": ["10px", { lineHeight: "14px", letterSpacing: "0.02em" }],
      xs: ["11px", { lineHeight: "16px" }],
      sm: ["12px", { lineHeight: "18px" }],
      base: ["13px", { lineHeight: "20px" }],
      md: ["14px", { lineHeight: "21px" }],
      lg: ["16px", { lineHeight: "24px" }],
      xl: ["20px", { lineHeight: "28px", letterSpacing: "-0.01em" }],
      "2xl": ["24px", { lineHeight: "32px", letterSpacing: "-0.02em" }],
    },
    extend: {
      colors: {
        bg: "rgb(var(--bg) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        "surface-raised": "rgb(var(--surface-raised) / <alpha-value>)",
        "surface-hover": "rgb(var(--surface-hover) / <alpha-value>)",
        border: "rgb(var(--border) / <alpha-value>)",
        "border-strong": "rgb(var(--border-strong) / <alpha-value>)",
        fg: "rgb(var(--fg) / <alpha-value>)",
        "fg-muted": "rgb(var(--fg-muted) / <alpha-value>)",
        "fg-subtle": "rgb(var(--fg-subtle) / <alpha-value>)",

        // The single accent. Primary actions and focus only.
        accent: "rgb(var(--accent) / <alpha-value>)",
        "accent-fg": "rgb(var(--accent-fg) / <alpha-value>)",
        "accent-muted": "rgb(var(--accent-muted) / <alpha-value>)",

        // Semantic. These mean something; they are not decoration.
        ok: "rgb(var(--ok) / <alpha-value>)",
        "ok-muted": "rgb(var(--ok-muted) / <alpha-value>)",
        warn: "rgb(var(--warn) / <alpha-value>)",
        "warn-muted": "rgb(var(--warn-muted) / <alpha-value>)",
        danger: "rgb(var(--danger) / <alpha-value>)",
        "danger-muted": "rgb(var(--danger-muted) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
      fontVariantNumeric: {
        tabular: "tabular-nums",
      },
      boxShadow: {
        // One elevation, for overlays only. Nothing on a card, nothing on hover.
        overlay: "0 8px 24px -6px rgb(0 0 0 / 0.18), 0 0 0 1px rgb(var(--border) / 1)",
        none: "none",
      },
      transitionDuration: {
        // The whole motion budget. There is no slower value available.
        fast: "100ms",
        DEFAULT: "120ms",
        slow: "150ms",
      },
      keyframes: {
        // The one permitted animation: a thin indeterminate bar for genuinely
        // async work. No shimmer, no skeleton pulse, no staggered lists.
        indeterminate: {
          "0%": { transform: "translateX(-100%) scaleX(0.3)" },
          "50%": { transform: "translateX(0%) scaleX(0.5)" },
          "100%": { transform: "translateX(100%) scaleX(0.3)" },
        },
      },
      animation: {
        indeterminate: "indeterminate 1.1s ease-in-out infinite",
      },
      gridTemplateColumns: {
        shell: "216px minmax(0, 1fr)",
      },
    },
  },
  plugins: [],
};

export default config;
