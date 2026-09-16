// Compatibility rule: a gate can host an aircraft whose size_class is
// less than or equal to the gate's own size_class (a large gate can
// take a small aircraft, but not vice versa). This is the same idea
// real airports use — narrow-body gates literally can't fit a jumbo.

export const SIZE_ORDER = { small: 1, medium: 2, large: 3, jumbo: 4 };

export function gateCanHost(aircraftSizeClass, gateSizeClass) {
  const a = SIZE_ORDER[aircraftSizeClass];
  const g = SIZE_ORDER[gateSizeClass];
  if (a == null || g == null) return false;
  return a <= g;
}

// Minimum ground-time buffer (minutes) a flight needs at its gate,
// based on aircraft size. Bigger aircraft need more time to board,
// fuel and turn around. Used both for gate-window calculation
// (gateConflict.js) and to auto-populate the turnaround checklist's
// estimated durations.
export const TURNAROUND_MINUTES = {
  small: 25,
  medium: 40,
  large: 60,
  jumbo: 90,
};
