import tailwindcssAnimate from 'tailwindcss-animate';

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  corePlugins: {
    // MATIKAN preflight: CSS lama (styles.css 1595 baris) tidak boleh di-reset.
    // Utilities Tailwind tetap jalan; base reset dinonaktifkan biar tema lama utuh.
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        // Bridge ke CSS variables tema (steel blue navy) — dipakai via bg-panel, text-muted, dll.
        bg: 'var(--bg)',
        'bg-2': 'var(--bg-2)',
        panel: 'var(--panel)',
        'panel-2': 'var(--panel-2)',
        border: 'var(--border)',
        text: 'var(--text)',
        muted: 'var(--muted)',
        brand: 'var(--brand)',
        'brand-2': 'var(--brand-2)',
        green: 'var(--green)',
        amber: 'var(--amber)',
        red: 'var(--red)',
        // chart tokens
        'chart-line': '#4F8CC9',
        'chart-area': '#3B82B8',
        'chart-grid': '#1E3448',
        'chart-text': '#8295A8',
        'chart-tooltip': '#101D2A',
      },
      borderRadius: {
        // skala disiplin 4/6/8/12
        sm: '4px',
        DEFAULT: '6px',
        md: '8px',
        lg: '12px',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [tailwindcssAnimate],
};
