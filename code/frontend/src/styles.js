// Design tokens — shared across every page (Login, Register, Dashboard, OpsCore).
// Palette: deep navy + one blue accent, on a clean white working surface.
export const colors = {
  navy: '#0B1220',
  navyPanel: '#0F1B32',
  ink: '#0F172A',
  slate: '#475569',
  muted: '#64748B',
  line: '#E2E8F0',
  lineSoft: '#EEF1F5',
  surface: '#FFFFFF',
  surfaceAlt: '#F8FAFC',
  accent: '#2F5CF5',
  accentDark: '#2247D6',
  accentSoft: '#EAEFFF',
  success: '#15803D',
  successSoft: '#EAF7EE',
  danger: '#B91C1C',
  dangerSoft: '#FDECEC',
};

const fontFamily = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

export const styles = {
  // ---- page shell ----
  main: {
    fontFamily,
    maxWidth: 760,
    margin: '3rem auto',
    padding: '0 1.5rem',
    color: colors.ink,
  },
  title: { fontSize: '1.6rem', fontWeight: 700, marginBottom: '0.2rem', letterSpacing: '-0.01em' },
  subtitle: { color: colors.muted, marginBottom: '2rem', fontSize: '0.95rem' },

  // ---- cards ----
  card: {
    border: `1px solid ${colors.line}`,
    borderRadius: 12,
    padding: '1.5rem',
    marginBottom: '1.25rem',
    background: colors.surface,
    boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
  },
  cardTitle: { fontSize: '1.05rem', fontWeight: 600, marginTop: 0, marginBottom: '1rem', color: colors.ink },

  // ---- forms ----
  form: { display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: 380 },
  label: { display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: '0.85rem', fontWeight: 600, color: colors.ink },
  input: {
    padding: '0.65rem 0.8rem',
    borderRadius: 8,
    border: `1px solid ${colors.line}`,
    fontSize: '0.95rem',
    fontFamily,
    outline: 'none',
    color: colors.ink,
    background: colors.surface,
  },
  select: {
    padding: '0.65rem 0.8rem',
    borderRadius: 8,
    border: `1px solid ${colors.line}`,
    fontSize: '0.95rem',
    fontFamily,
    background: colors.surface,
    color: colors.ink,
  },
  button: {
    padding: '0.7rem 1.1rem',
    borderRadius: 8,
    border: 'none',
    background: colors.accent,
    color: '#fff',
    fontSize: '0.95rem',
    fontWeight: 600,
    cursor: 'pointer',
    width: 'fit-content',
    fontFamily,
    boxShadow: '0 1px 2px rgba(47, 92, 245, 0.3)',
  },
  buttonSecondary: {
    padding: '0.6rem 1rem',
    borderRadius: 8,
    border: `1px solid ${colors.line}`,
    background: colors.surface,
    color: colors.ink,
    fontSize: '0.9rem',
    fontWeight: 600,
    cursor: 'pointer',
    width: 'fit-content',
    fontFamily,
  },
  error: { color: colors.danger, fontSize: '0.88rem', background: colors.dangerSoft, padding: '0.5rem 0.75rem', borderRadius: 8 },
  success: { color: colors.success, fontSize: '0.88rem', background: colors.successSoft, padding: '0.5rem 0.75rem', borderRadius: 8 },

  // ---- nav / dashboard shell ----
  nav: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: '2rem', paddingBottom: '1rem', borderBottom: `1px solid ${colors.line}`,
  },
  navLinks: { display: 'flex', gap: '1.25rem', fontSize: '0.9rem' },

  // ---- data display ----
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' },
  th: { textAlign: 'left', borderBottom: `2px solid ${colors.line}`, padding: '0.5rem 0.6rem', color: colors.slate, fontWeight: 600 },
  td: { borderBottom: `1px solid ${colors.lineSoft}`, padding: '0.5rem 0.6rem' },
  badge: {
    display: 'inline-block', padding: '0.2rem 0.6rem', borderRadius: 999,
    fontSize: '0.72rem', fontWeight: 600, background: colors.accentSoft, color: colors.accentDark,
  },
  muted: { color: colors.muted, fontSize: '0.85rem' },

  // ---- split auth screen (Login / Register) ----
  authShell: {
    fontFamily,
    minHeight: '100vh',
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
    background: colors.surface,
  },
  authLeft: {
    background: `linear-gradient(160deg, ${colors.navy} 0%, ${colors.navyPanel} 100%)`,
    color: '#fff',
    padding: '3rem',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    position: 'relative',
    overflow: 'hidden',
  },
  authLogoRow: { display: 'flex', alignItems: 'center', gap: '0.75rem' },
  authLogoBadge: {
    width: 44, height: 44, borderRadius: 12, background: colors.accent,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontWeight: 700, fontSize: '1.1rem', flexShrink: 0,
  },
  authBrand: { fontSize: '1.3rem', fontWeight: 700, letterSpacing: '-0.01em' },
  authBrandSub: { fontSize: '0.7rem', color: '#94A3C4', letterSpacing: '0.08em', marginTop: 2 },
  authHeadline: { fontSize: '2.4rem', fontWeight: 700, lineHeight: 1.15, letterSpacing: '-0.02em', maxWidth: 420 },
  authFootRow: { display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#7E8CB3' },
  authRight: {
    display: 'flex', flexDirection: 'column', justifyContent: 'center',
    padding: '3rem', maxWidth: 440, width: '100%', margin: '0 auto',
  },
  authHeading: { fontSize: '1.7rem', fontWeight: 700, marginBottom: '0.35rem', color: colors.ink, letterSpacing: '-0.01em' },
  authSubheading: { color: colors.muted, fontSize: '0.95rem', marginBottom: '2rem' },
  authFullButton: {
    padding: '0.8rem 1.1rem',
    borderRadius: 8,
    border: 'none',
    background: colors.accent,
    color: '#fff',
    fontSize: '0.97rem',
    fontWeight: 600,
    cursor: 'pointer',
    width: '100%',
    fontFamily,
    marginTop: '0.25rem',
  },
  authFootnote: { fontSize: '0.82rem', color: colors.muted, marginTop: '1.5rem' },
};
