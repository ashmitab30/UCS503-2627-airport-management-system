import { useState, useEffect, useRef, useId } from 'react';
import { apiFetch } from '../../api/client.js';

let cachedAirports = null;
let airportFetchPromise = null;

export async function fetchAirportsOnce() {
  if (cachedAirports) return cachedAirports;
  if (!airportFetchPromise) {
    airportFetchPromise = apiFetch('/airports')
      .then((data) => {
        cachedAirports = data.airports || [];
        return cachedAirports;
      })
      .catch((err) => {
        airportFetchPromise = null;
        throw err;
      });
  }
  return airportFetchPromise;
}

/**
 * Filter helper that searches case-insensitively across airport code, city, and name.
 */
export function filterAirports(airports, query) {
  if (!Array.isArray(airports)) return [];
  if (!query || !query.trim()) return airports;
  const q = query.trim().toLowerCase();
  return airports.filter((a) => {
    const codeMatch = a.code ? a.code.toLowerCase().includes(q) : false;
    const cityMatch = a.city ? a.city.toLowerCase().includes(q) : false;
    const nameMatch = a.name ? a.name.toLowerCase().includes(q) : false;
    return codeMatch || cityMatch || nameMatch;
  });
}

/**
 * Formats an airport for option display:
 * "DEL · Delhi — Indira Gandhi International Airport"
 */
export function formatAirportOption(a) {
  if (!a) return '';
  const city = a.city || 'India';
  return `${a.code} · ${city} — ${a.name}`;
}

export default function AirportSelect({
  value,
  onChange,
  valueKey = 'code', // 'code' (default for search) or 'id' (for OpsCore)
  label,
  placeholder = 'Search by code, city or name...',
  error,
  airports: initialAirports,
  required = false,
  clearable = true,
  id,
}) {
  const generatedId = useId();
  const inputId = id || generatedId;

  const [airports, setAirports] = useState(initialAirports || cachedAirports || []);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Load airports once if not provided
  useEffect(() => {
    if (initialAirports && initialAirports.length > 0) {
      setAirports(initialAirports);
      return;
    }
    let isMounted = true;
    fetchAirportsOnce()
      .then((data) => {
        if (isMounted) setAirports(data);
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, [initialAirports]);

  // Find currently selected airport object
  const selectedAirport = airports.find((a) => {
    if (valueKey === 'id') {
      return String(a.id) === String(value);
    }
    return String(a.code).toUpperCase() === String(value).toUpperCase();
  });

  const filtered = filterAirports(airports, query);

  // Close when clicking outside
  useEffect(() => {
    function handlePointerDown(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
        setQuery('');
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handlePointerDown);
      document.addEventListener('touchstart', handlePointerDown);
    }
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
  }, [isOpen]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (isOpen && listRef.current) {
      const items = listRef.current.querySelectorAll('[role="option"]');
      if (items[highlightedIndex]) {
        items[highlightedIndex].scrollIntoView({ block: 'nearest' });
      }
    }
  }, [highlightedIndex, isOpen]);

  function handleSelectAirport(airport) {
    if (!airport) {
      onChange(valueKey === 'id' ? '' : '');
    } else {
      const returnVal = valueKey === 'id' ? airport.id : airport.code;
      onChange(returnVal, airport);
    }
    setIsOpen(false);
    setQuery('');
  }

  function handleKeyDown(e) {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') {
        e.preventDefault();
        setIsOpen(true);
        setHighlightedIndex(0);
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => (filtered.length ? (prev + 1) % filtered.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => (filtered.length ? (prev - 1 + filtered.length) % filtered.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[highlightedIndex]) {
        handleSelectAirport(filtered[highlightedIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setIsOpen(false);
      setQuery('');
    } else if (e.key === 'Tab') {
      setIsOpen(false);
      setQuery('');
    }
  }

  function handleClear(e) {
    e.stopPropagation();
    onChange(valueKey === 'id' ? '' : '');
    setQuery('');
    setIsOpen(false);
    if (inputRef.current) inputRef.current.focus();
  }

  // Display text when closed vs open
  const displayValue = isOpen
    ? query
    : selectedAirport
    ? selectedAirport.code
    : value || '';

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', width: '100%' }}
      onKeyDown={handleKeyDown}
    >
      {label && (
        <label
          htmlFor={inputId}
          style={{
            display: 'block',
            fontSize: '12px',
            fontWeight: 700,
            fontFamily: 'var(--font-display)',
            color: 'var(--color-outline)',
            marginBottom: '4px',
          }}
        >
          {label} {required && <span style={{ color: 'var(--color-error)' }}>*</span>}
        </label>
      )}

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          position: 'relative',
          width: '100%',
        }}
      >
        <input
          id={inputId}
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-autocomplete="list"
          aria-controls={`${inputId}-listbox`}
          autoComplete="off"
          value={displayValue}
          placeholder={selectedAirport ? selectedAirport.code : placeholder}
          onFocus={() => {
            setIsOpen(true);
            setHighlightedIndex(0);
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!isOpen) setIsOpen(true);
            setHighlightedIndex(0);
          }}
          style={{
            width: '100%',
            background: 'transparent',
            border: 'none',
            outline: 'none',
            fontSize: '15px',
            fontWeight: 700,
            fontFamily: 'var(--font-display)',
            color: 'var(--color-on-surface)',
            padding: '2px 0',
          }}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: '2px', marginLeft: '4px' }}>
          {clearable && (value || query) && (
            <button
              type="button"
              onClick={handleClear}
              aria-label="Clear selected airport"
              style={{
                background: 'none',
                border: 'none',
                padding: '2px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                color: 'var(--color-outline)',
                borderRadius: '50%',
              }}
              title="Clear airport"
            >
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>
                close
              </span>
            </button>
          )}

          <button
            type="button"
            tabIndex={-1}
            onClick={() => {
              setIsOpen((prev) => !prev);
              if (!isOpen && inputRef.current) inputRef.current.focus();
            }}
            aria-label="Toggle airport dropdown"
            style={{
              background: 'none',
              border: 'none',
              padding: '2px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              color: 'var(--color-outline)',
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{
                fontSize: '18px',
                transform: isOpen ? 'rotate(180deg)' : 'none',
                transition: 'transform 0.15s ease',
              }}
            >
              expand_more
            </span>
          </button>
        </div>
      </div>

      {/* Dropdown Popover */}
      {isOpen && (
        <ul
          id={`${inputId}-listbox`}
          ref={listRef}
          role="listbox"
          aria-label={label || 'Airports'}
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            zIndex: 110,
            maxHeight: '260px',
            overflowY: 'auto',
            background: '#ffffff',
            border: '1px solid var(--color-outline-variant)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-elevated)',
            padding: '6px',
            margin: 0,
            listStyle: 'none',
          }}
        >
          {filtered.length === 0 ? (
            <li
              style={{
                padding: '10px 12px',
                fontSize: '13px',
                color: 'var(--color-outline)',
                fontFamily: 'var(--font-body)',
                textAlign: 'center',
              }}
            >
              No matching airports
            </li>
          ) : (
            filtered.map((a, idx) => {
              const isSelected =
                valueKey === 'id'
                  ? String(a.id) === String(value)
                  : String(a.code).toUpperCase() === String(value).toUpperCase();
              const isHighlighted = idx === highlightedIndex;

              return (
                <li
                  key={a.id || a.code}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => handleSelectAirport(a)}
                  onMouseEnter={() => setHighlightedIndex(idx)}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    background: isHighlighted
                      ? 'var(--color-surface-container)'
                      : isSelected
                      ? 'var(--color-surface-low)'
                      : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px',
                    transition: 'background 0.1s ease',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span
                        style={{
                          fontWeight: 800,
                          fontSize: '14px',
                          color: 'var(--color-primary)',
                          fontFamily: 'var(--font-display)',
                          letterSpacing: '0.02em',
                        }}
                      >
                        {a.code}
                      </span>
                      <span
                        style={{
                          fontSize: '13.5px',
                          fontWeight: 600,
                          color: 'var(--color-on-surface)',
                          fontFamily: 'var(--font-body)',
                        }}
                      >
                        · {a.city || 'India'}
                      </span>
                    </div>
                    <span
                      style={{
                        fontSize: '11.5px',
                        color: 'var(--color-outline)',
                        fontFamily: 'var(--font-body)',
                      }}
                    >
                      {a.name}
                    </span>
                  </div>

                  {isSelected && (
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: '18px', color: 'var(--color-primary)' }}
                    >
                      check
                    </span>
                  )}
                </li>
              );
            })
          )}
        </ul>
      )}

      {error && (
        <div style={{ color: 'var(--color-error)', fontSize: '11px', marginTop: '3px' }}>
          {error}
        </div>
      )}
    </div>
  );
}
