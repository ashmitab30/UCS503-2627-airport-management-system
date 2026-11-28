import React from 'react';
import { colors, styles } from '../../styles.js';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught unhandled render error:', error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      const isDev = import.meta.env?.DEV;

      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.background || 'var(--color-background, #f9f9ff)',
            padding: '24px',
          }}
        >
          <div
            style={{
              ...styles.card,
              maxWidth: '540px',
              width: '100%',
              textAlign: 'center',
              padding: '36px 28px',
              boxShadow: '0 8px 32px rgba(6, 27, 58, 0.08)',
              border: '1px solid rgba(226, 232, 240, 0.9)',
            }}
          >
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                backgroundColor: colors.dangerBg || 'rgba(239, 68, 68, 0.12)',
                color: colors.danger || '#ba1a1a',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '32px' }}>
                error
              </span>
            </div>

            <h1
              style={{
                ...styles.title,
                fontSize: '1.5rem',
                margin: '0 0 8px',
                color: colors.ink || '#061b3a',
              }}
            >
              Something went wrong on this page
            </h1>

            <p
              style={{
                ...styles.subtitle,
                margin: '0 0 24px',
                color: colors.slate || '#424656',
                fontSize: '14px',
              }}
            >
              An unexpected error occurred while displaying this view. Please try reloading the page.
            </p>

            <button
              type="button"
              onClick={this.handleReload}
              className="btn-primary-aero"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 24px',
                fontSize: '13.5px',
                fontWeight: 700,
                cursor: 'pointer',
                margin: '0 auto',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
                refresh
              </span>
              <span>Reload</span>
            </button>

            {isDev && this.state.error && (
              <div
                style={{
                  marginTop: '24px',
                  textAlign: 'left',
                  background: 'rgba(239, 68, 68, 0.06)',
                  border: '1px solid rgba(239, 68, 68, 0.25)',
                  borderRadius: '10px',
                  padding: '12px 14px',
                  overflowX: 'auto',
                }}
              >
                <div
                  style={{
                    fontSize: '11px',
                    fontWeight: 800,
                    textTransform: 'uppercase',
                    color: colors.danger || '#ba1a1a',
                    marginBottom: '4px',
                  }}
                >
                  Development Error Details:
                </div>
                <pre
                  style={{
                    margin: 0,
                    fontSize: '12px',
                    fontFamily: 'monospace',
                    color: '#991b1b',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {this.state.error.toString()}
                  {this.state.error.stack ? `\n\n${this.state.error.stack}` : ''}
                </pre>
              </div>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
