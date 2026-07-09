/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: '#1b1a17', // Dark charcoal/brown for high contrast readability
          2: '#3d3b36',
          3: '#736f64',
          4: '#b1ada1', // User provided border/muted gray
          5: '#d7d4cd',
        },
        surface: {
          DEFAULT: '#ffffff', // User provided white
          2: '#f4f3ee', // User provided warm background
          3: '#eae8e0', // Slightly darker warm gray for hover/inactive states
        },
        accent: {
          DEFAULT: '#c15f3c', // User provided premium burnt orange/terracotta accent
          hover: '#a84e2e',
          muted: '#fcf6f3',
          border: '#f2dfd7',
        },
        ok: {
          DEFAULT: '#2a7e5c',
          muted: '#f1f8f5',
          border: '#cce5da',
        },
        warn: {
          DEFAULT: '#b26e12',
          muted: '#fdf9f0',
          border: '#f7e3c8',
        },
        bad: {
          DEFAULT: '#b91c1c',
          muted: '#fef2f2',
          border: '#fee2e2',
        },
        border: '#b1ada1', // User provided warm gray for general borders
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Menlo', 'monospace'],
      },
      fontSize: {
        '2xs': ['11px', { lineHeight: '16px' }],
      },
      boxShadow: {
        card: '0 1px 2px 0 rgba(27, 26, 23, 0.05)',
        focus: '0 0 0 3px rgba(193, 95, 60, 0.15)',
      },
      borderRadius: {
        card: '8px', // Slightly sharper for premium design magazine look
        pill: '9999px',
        btn: '6px',
      },
    },
  },
  plugins: [],
}
