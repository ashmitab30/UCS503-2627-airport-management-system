import { describe, it, expect } from 'vitest';
import {
  FACILITY_TYPES,
  FACILITY_STATUSES,
  validateFacilityForm,
  filterFacilities,
  groupFacilitiesByTerminal,
  getFacilityTypeMeta,
  getFacilityStatusBadgeStyle,
} from './facilitiesHelpers.js';

describe('Task 16a: Facilities Form Validation', () => {
  const validBase = {
    airport_id: '1',
    name: 'Encalm Lounge',
    type: 'lounge',
    location_terminal: 'Terminal 3',
    location_gate_proximity: 'Near Gate 27',
    status: 'open',
  };

  it('validates a complete, correct facility form payload', () => {
    const res = validateFacilityForm(validBase);
    expect(res.isValid).toBe(true);
    expect(Object.keys(res.errors)).toHaveLength(0);
  });

  it('rejects missing or empty facility name', () => {
    const resEmpty = validateFacilityForm({ ...validBase, name: '' });
    expect(resEmpty.isValid).toBe(false);
    expect(resEmpty.errors.name).toContain('required');

    const resWhitespace = validateFacilityForm({ ...validBase, name: '   ' });
    expect(resWhitespace.isValid).toBe(false);
  });

  it('rejects facility name with fewer than 2 characters', () => {
    const res = validateFacilityForm({ ...validBase, name: 'A' });
    expect(res.isValid).toBe(false);
    expect(res.errors.name).toContain('at least 2');
  });

  it('rejects facility name exceeding 80 characters', () => {
    const res = validateFacilityForm({ ...validBase, name: 'L'.repeat(81) });
    expect(res.isValid).toBe(false);
    expect(res.errors.name).toContain('cannot exceed 80');
  });

  it('rejects missing or invalid airport_id', () => {
    expect(validateFacilityForm({ ...validBase, airport_id: '' }).isValid).toBe(false);
    expect(validateFacilityForm({ ...validBase, airport_id: '0' }).isValid).toBe(false);
    expect(validateFacilityForm({ ...validBase, airport_id: '-5' }).isValid).toBe(false);
    expect(validateFacilityForm({ ...validBase, airport_id: 'abc' }).isValid).toBe(false);
  });

  it('rejects invalid or missing facility type', () => {
    const resMissing = validateFacilityForm({ ...validBase, type: '' });
    expect(resMissing.isValid).toBe(false);

    const resInvalid = validateFacilityForm({ ...validBase, type: 'casino_arcade' });
    expect(resInvalid.isValid).toBe(false);
    expect(resInvalid.errors.type).toContain('Type must be one of');
  });

  it('accepts every allowed facility type', () => {
    for (const t of FACILITY_TYPES) {
      const res = validateFacilityForm({ ...validBase, type: t });
      expect(res.isValid).toBe(true);
    }
  });

  it('rejects terminal or gate proximity exceeding 80 characters', () => {
    const resTerm = validateFacilityForm({ ...validBase, location_terminal: 'T'.repeat(81) });
    expect(resTerm.isValid).toBe(false);
    expect(resTerm.errors.location_terminal).toContain('cannot exceed 80');

    const resGate = validateFacilityForm({ ...validBase, location_gate_proximity: 'G'.repeat(81) });
    expect(resGate.isValid).toBe(false);
    expect(resGate.errors.location_gate_proximity).toContain('cannot exceed 80');
  });

  it('rejects invalid status', () => {
    const res = validateFacilityForm({ ...validBase, status: 'maintenance' });
    expect(res.isValid).toBe(false);
    expect(res.errors.status).toContain("must be 'open' or 'closed'");
  });
});

describe('Task 16a: Facilities Filter & Grouping Helpers', () => {
  const sampleList = [
    {
      id: 1,
      airport_id: 10,
      name: 'Delhi Duty Free',
      type: 'shop',
      location_terminal: 'Terminal 3',
      location_gate_proximity: 'Central Concourse',
      status: 'open',
    },
    {
      id: 2,
      airport_id: 10,
      name: 'Costa Coffee T1',
      type: 'restaurant',
      location_terminal: 'Terminal 1',
      location_gate_proximity: 'Gate 6',
      status: 'open',
    },
    {
      id: 3,
      airport_id: 10,
      name: 'Executive Lounge T3',
      type: 'lounge',
      location_terminal: 'Terminal 3',
      location_gate_proximity: 'Gate 22',
      status: 'closed',
    },
    {
      id: 4,
      airport_id: 20,
      name: 'Mumbai Oasis Lounge',
      type: 'lounge',
      location_terminal: 'Terminal 2',
      location_gate_proximity: 'Gate 44',
      status: 'open',
    },
    {
      id: 5,
      airport_id: 10,
      name: 'Power Hub Station',
      type: 'charging_station',
      location_terminal: null,
      location_gate_proximity: 'Central Concourse',
      status: 'open',
    },
  ];

  it('filters facilities by airportId', () => {
    const filtered = filterFacilities(sampleList, { airportId: 10 });
    expect(filtered).toHaveLength(4);
    filtered.forEach((f) => expect(f.airport_id).toBe(10));
  });

  it('filters facilities by category type', () => {
    const filtered = filterFacilities(sampleList, { type: 'lounge' });
    expect(filtered).toHaveLength(2);
    filtered.forEach((f) => expect(f.type).toBe('lounge'));
  });

  it('filters facilities by status', () => {
    const filteredOpen = filterFacilities(sampleList, { status: 'open' });
    expect(filteredOpen).toHaveLength(4);

    const filteredClosed = filterFacilities(sampleList, { status: 'closed' });
    expect(filteredClosed).toHaveLength(1);
    expect(filteredClosed[0].name).toBe('Executive Lounge T3');
  });

  it('filters facilities by search query against name, terminal, and proximity', () => {
    const queryName = filterFacilities(sampleList, { query: 'costa' });
    expect(queryName).toHaveLength(1);
    expect(queryName[0].name).toContain('Costa');

    const queryProx = filterFacilities(sampleList, { query: 'gate 22' });
    expect(queryProx).toHaveLength(1);
    expect(queryProx[0].id).toBe(3);
  });

  it('groups facilities by terminal with fallback and alphabetical sorting', () => {
    const groups = groupFacilitiesByTerminal(sampleList);
    expect(Object.keys(groups)).toContain('Terminal 3');
    expect(Object.keys(groups)).toContain('Terminal 1');
    expect(Object.keys(groups)).toContain('Terminal 2');
    expect(Object.keys(groups)).toContain('General / Concourse');

    // Terminal 3 has 'Delhi Duty Free' and 'Executive Lounge T3' sorted
    expect(groups['Terminal 3']).toHaveLength(2);
    expect(groups['Terminal 3'][0].name).toBe('Delhi Duty Free');
    expect(groups['Terminal 3'][1].name).toBe('Executive Lounge T3');

    // General / Concourse has null terminal
    expect(groups['General / Concourse']).toHaveLength(1);
    expect(groups['General / Concourse'][0].name).toBe('Power Hub Station');
  });

  it('returns appropriate metadata and icons for facility types', () => {
    const loungeMeta = getFacilityTypeMeta('lounge');
    expect(loungeMeta.label).toBe('Lounge');
    expect(loungeMeta.icon).toBeDefined();

    const restaurantMeta = getFacilityTypeMeta('restaurant');
    expect(restaurantMeta.label).toContain('Restaurant');

    const fallbackMeta = getFacilityTypeMeta('unknown_type');
    expect(fallbackMeta.label).toBe('unknown_type');
  });

  it('returns valid status badge styling for open and closed', () => {
    const openStyle = getFacilityStatusBadgeStyle('open');
    expect(openStyle.backgroundColor).toBeDefined();
    expect(openStyle.color).toContain('#059669');

    const closedStyle = getFacilityStatusBadgeStyle('closed');
    expect(closedStyle.color).toContain('#dc2626');
  });
});
