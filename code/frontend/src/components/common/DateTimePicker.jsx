import { useId } from 'react';
import DatePicker from './DatePicker.jsx';

// Generate hours 00..23 and minutes 00, 05, 10, ..., 55
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));

export default function DateTimePicker({
  value,
  onChange,
  minDate,
  label,
  error,
  required = false,
  id,
}) {
  const generatedId = useId();
  const componentId = id || generatedId;

  // Value format expected: "YYYY-MM-DDTHH:mm"
  let datePart = '';
  let hours = '12';
  let minutes = '00';

  if (value && typeof value === 'string' && value.includes('T')) {
    const [d, t] = value.split('T');
    datePart = d || '';
    if (t) {
      const timeParts = t.split(':');
      hours = String(timeParts[0] || '12').padStart(2, '0');
      // Round to nearest 5-minute step if needed
      const rawMin = Number(timeParts[1] || '00');
      const roundedMin = Math.round(rawMin / 5) * 5;
      minutes = String(roundedMin % 60).padStart(2, '0');
    }
  } else if (value && typeof value === 'string') {
    datePart = value;
  }

  function handleDateChange(newDateStr) {
    if (!newDateStr) {
      onChange('');
      return;
    }
    onChange(`${newDateStr}T${hours}:${minutes}`);
  }

  function handleHourChange(newHour) {
    if (!datePart) return;
    onChange(`${datePart}T${newHour}:${minutes}`);
  }

  function handleMinuteChange(newMinute) {
    if (!datePart) return;
    onChange(`${datePart}T${hours}:${newMinute}`);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '100%' }} id={componentId}>
      {label && (
        <label
          htmlFor={`${componentId}-date`}
          style={{
            fontSize: '12px',
            fontWeight: 700,
            fontFamily: 'var(--font-display)',
            color: 'var(--color-outline)',
          }}
        >
          {label} {required && <span style={{ color: 'var(--color-error)' }}>*</span>}
        </label>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        {/* Date Selector */}
        <div
          style={{
            flex: '1 1 180px',
            minWidth: '160px',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-outline-variant)',
            borderRadius: 'var(--radius-sm)',
            padding: '7px 10px',
          }}
        >
          <DatePicker
            id={`${componentId}-date`}
            value={datePart}
            onChange={handleDateChange}
            minDate={minDate}
            placeholder="Select date"
            clearable={!required}
          />
        </div>

        {/* 24-Hour Time Selector in 5-minute steps */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <select
            value={hours}
            onChange={(e) => handleHourChange(e.target.value)}
            disabled={!datePart}
            aria-label="Hour (24-hour format)"
            style={{
              padding: '8px 6px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--color-outline-variant)',
              background: datePart ? 'var(--color-surface)' : 'var(--color-surface-low)',
              color: 'var(--color-on-surface)',
              fontFamily: 'var(--font-body)',
              fontSize: '13px',
              fontWeight: 600,
              cursor: datePart ? 'pointer' : 'not-allowed',
            }}
          >
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {h}:00
              </option>
            ))}
          </select>

          <span style={{ fontWeight: 700, color: 'var(--color-outline)' }}>:</span>

          <select
            value={minutes}
            onChange={(e) => handleMinuteChange(e.target.value)}
            disabled={!datePart}
            aria-label="Minute (5-minute step)"
            style={{
              padding: '8px 6px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--color-outline-variant)',
              background: datePart ? 'var(--color-surface)' : 'var(--color-surface-low)',
              color: 'var(--color-on-surface)',
              fontFamily: 'var(--font-body)',
              fontSize: '13px',
              fontWeight: 600,
              cursor: datePart ? 'pointer' : 'not-allowed',
            }}
          >
            {MINUTES.map((m) => (
              <option key={m} value={m}>
                {m}m
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <span style={{ color: 'var(--color-error)', fontSize: '11px', marginTop: '2px' }}>
          {error}
        </span>
      )}
    </div>
  );
}
