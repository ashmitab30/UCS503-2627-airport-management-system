/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx}',
  ],
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      fontFamily: {
        display: ['var(--font-display)', "'Plus Jakarta Sans'", 'system-ui', 'sans-serif'],
        body: ['var(--font-body)', "'Inter'", 'system-ui', 'sans-serif'],
      },
      colors: {
        primary: {
          DEFAULT: 'var(--color-primary)',
          container: 'var(--color-primary-container)',
          fixed: 'var(--color-primary-fixed)',
          'fixed-dim': 'var(--color-primary-fixed-dim)',
        },
        'on-primary': {
          DEFAULT: 'var(--color-on-primary)',
          fixed: 'var(--color-on-primary-fixed)',
        },
        secondary: {
          DEFAULT: 'var(--color-secondary)',
          cyan: 'var(--color-secondary-cyan)',
          container: 'var(--color-secondary-container)',
          fixed: 'var(--color-secondary-fixed)',
        },
        'on-secondary': {
          DEFAULT: 'var(--color-on-secondary)',
          fixed: 'var(--color-on-secondary-fixed)',
        },
        tertiary: {
          DEFAULT: 'var(--color-tertiary)',
          fixed: 'var(--color-tertiary-fixed)',
        },
        'on-tertiary': 'var(--color-on-tertiary)',
        background: 'var(--color-background)',
        surface: {
          DEFAULT: 'var(--color-surface)',
          lowest: 'var(--color-surface-lowest)',
          low: 'var(--color-surface-low)',
          container: 'var(--color-surface-container)',
          high: 'var(--color-surface-high)',
          highest: 'var(--color-surface-highest)',
          dim: 'var(--color-surface-dim)',
          bright: 'var(--color-surface-bright)',
        },
        'on-surface': {
          DEFAULT: 'var(--color-on-surface)',
          variant: 'var(--color-on-surface-variant)',
        },
        outline: {
          DEFAULT: 'var(--color-outline)',
          variant: 'var(--color-outline-variant)',
        },
        success: {
          DEFAULT: 'var(--color-success)',
          bg: 'var(--color-success-bg)',
          text: 'var(--color-success-text)',
        },
        warn: {
          DEFAULT: 'var(--color-warn)',
          bg: 'var(--color-warn-bg)',
          text: 'var(--color-warn-text)',
        },
        error: {
          DEFAULT: 'var(--color-error)',
          container: 'var(--color-error-container)',
          on: 'var(--color-on-error)',
        },
        'on-error': {
          DEFAULT: 'var(--color-on-error)',
          container: 'var(--color-on-error-container)',
        },
      },
      borderWidth: {
        3: '3px',
      },
      spacing: {
        '0.2': '0.05rem',
      },
      boxShadow: {
        xs: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
        card: 'var(--shadow-card)',
        elevated: 'var(--shadow-elevated)',
        glow: 'var(--shadow-glow)',
      },
      animation: {
        fadeIn: 'fadeIn 0.2s ease-out forwards',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};
