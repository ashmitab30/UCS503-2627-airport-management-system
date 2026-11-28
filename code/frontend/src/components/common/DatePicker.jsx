import { useState, useRef, useEffect } from 'react';
import { DayPicker } from 'react-day-picker';
import { formatDate } from '../../utils/format.js';
import './DatePicker.css';

/**
 * Pure helper to test if a given date is before minDate (ignoring time components).
 */
export function isDateDisabled(date, minDate) {
  if (!date || !minDate) return false;
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);

  let min;
  if (minDate === 'today') {
    min = new Date();
  } else if (typeof minDate === 'string') {
    const [y, m, d] = minDate.split('-').map(Number);
    min = new Date(y, m - 1, d);
  } else {
    min = new Date(minDate);
  }
  min.setHours(0, 0, 0, 0);

  return target.getTime() < min.getTime();
}

/**
 * Converts a Date object to "YYYY-MM-DD" local calendar string.
 */
export function toISODateString(date) {
  if (!date) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Parses "YYYY-MM-DD" string into local Date object.
 */
export function parseISODateString(str) {
  if (!str) return undefined;
  if (str instanceof Date) return str;
  const parts = String(str).split('T')[0].split('-');
  if (parts.length !== 3) return undefined;
  const [y, m, d] = parts.map(Number);
  if (isNaN(y) || isNaN(m) || isNaN(d)) return undefined;
  return new Date(y, m - 1, d);
}

export default function DatePicker({
  value,
  onChange,
  minDate,
  label,
  error,
  placeholder = 'Select departure date',
  clearable = true,
  id,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  const selectedDate = parseISODateString(value);

  // Close on outside click
  useEffect(() => {
    function handlePointerDown(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
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

  // Keyboard navigation: Escape closes popover
  function handleKeyDown(e) {
    if (e.key === 'Escape' && isOpen) {
      e.stopPropagation();
      setIsOpen(false);
    }
  }

  function handleSelect(date) {
    if (!date) {
      if (clearable) onChange('');
      return;
    }
    const isoStr = toISODateString(date);
    onChange(isoStr);
    setIsOpen(false);
  }

  function handleClear(e) {
    e.stopPropagation();
    onChange('');
    setIsOpen(false);
  }

  // Disabled matcher for react-day-picker
  const disabledMatcher = (date) => isDateDisabled(date, minDate);

  const displayLabel = selectedDate ? formatDate(selectedDate) : '';

  return (
    <div
      className="meridian-datepicker-wrapper"
      ref={containerRef}
      onKeyDown={handleKeyDown}
      id={id}
    >
      {label && (
        <label
          style={{
            display: 'block',
            fontSize: '12px',
            fontWeight: 700,
            fontFamily: 'var(--font-display)',
            color: 'var(--color-outline)',
            marginBottom: '4px',
          }}
        >
          {label}
        </label>
      )}

      <div
        role="button"
        tabIndex={0}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={label || placeholder}
        className="meridian-datepicker-trigger"
        onClick={() => setIsOpen((prev) => !prev)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsOpen((prev) => !prev);
          }
        }}
      >
        <span
          style={{
            color: selectedDate ? 'var(--color-on-surface)' : 'var(--color-outline)',
            fontWeight: selectedDate ? 600 : 400,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {displayLabel || placeholder}
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginLeft: '6px' }}>
          {clearable && selectedDate && (
            <button
              type="button"
              onClick={handleClear}
              aria-label="Clear selected date"
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
              title="Clear date"
            >
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>
                close
              </span>
            </button>
          )}
          <span
            className="material-symbols-outlined"
            style={{
              fontSize: '18px',
              color: isOpen ? 'var(--color-primary)' : 'var(--color-outline)',
              transition: 'color 0.15s ease',
            }}
          >
            calendar_month
          </span>
        </div>
      </div>

      {isOpen && (
        <div
          className="meridian-datepicker-popover"
          role="dialog"
          aria-modal="true"
          aria-label="Calendar date picker"
        >
          <DayPicker
            mode="single"
            selected={selectedDate}
            onSelect={handleSelect}
            disabled={disabledMatcher}
            defaultMonth={selectedDate || new Date()}
          />
        </div>
      )}

      {error && (
        <div style={{ color: 'var(--color-error)', fontSize: '11px', marginTop: '3px' }}>
          {error}
        </div>
      )}
    </div>
  );
}
