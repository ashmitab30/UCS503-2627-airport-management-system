import { describe, it, expect } from 'vitest';
import {
  getBoardingGroupInfo,
  canPassengerCancelAssistance,
  canAdvanceAssistance,
  getNextAssistanceStatus,
  validateAssistanceInput,
  ASSISTANCE_TYPE_LABELS,
  ASSISTANCE_STATUS_LABELS,
} from './assistanceValidation.js';

describe('assistanceValidation utils', () => {
  describe('getBoardingGroupInfo', () => {
    it('returns Priority info for Group 1', () => {
      const info = getBoardingGroupInfo(1);
      expect(info.isPriority).toBe(true);
      expect(info.label).toBe('Priority Boarding (Group 1)');
      expect(info.shortLabel).toBe('Group 1');
      expect(info.pillClass).toBe('status-pill-cyan');
    });

    it('returns General info for Group 2', () => {
      const info = getBoardingGroupInfo(2);
      expect(info.isPriority).toBe(false);
      expect(info.label).toBe('Boarding Group 2');
      expect(info.shortLabel).toBe('Group 2');
      expect(info.pillClass).toBe('status-pill-blue');
    });

    it('handles unassigned / null group gracefully', () => {
      const info = getBoardingGroupInfo(null);
      expect(info.isPriority).toBe(false);
      expect(info.label).toBe('Standard Boarding');
    });
  });

  describe('canPassengerCancelAssistance', () => {
    it('allows passenger cancellation when status is requested', () => {
      expect(canPassengerCancelAssistance('requested')).toBe(true);
    });

    it('prevents passenger cancellation when status is assigned, in_progress, completed, or cancelled', () => {
      expect(canPassengerCancelAssistance('assigned')).toBe(false);
      expect(canPassengerCancelAssistance('in_progress')).toBe(false);
      expect(canPassengerCancelAssistance('completed')).toBe(false);
      expect(canPassengerCancelAssistance('cancelled')).toBe(false);
    });
  });

  describe('canAdvanceAssistance', () => {
    const staffUser1 = { id: 10, role: 'ground_crew' };
    const staffUser2 = { id: 20, role: 'medical' };
    const adminUser = { id: 1, role: 'admin' };
    const opsUser = { id: 2, role: 'ops_manager' };

    it('allows any assistance staff to advance requested -> assigned', () => {
      const req = { id: 1, status: 'requested', assigned_staff_id: null };
      expect(canAdvanceAssistance(req, staffUser1)).toBe(true);
      expect(canAdvanceAssistance(req, staffUser2)).toBe(true);
      expect(canAdvanceAssistance(req, adminUser)).toBe(true);
    });

    it('allows only the assigned staff member to advance assigned -> in_progress', () => {
      const req = { id: 1, status: 'assigned', assigned_staff_id: 10 };
      expect(canAdvanceAssistance(req, staffUser1)).toBe(true);
      expect(canAdvanceAssistance(req, staffUser2)).toBe(false);
    });

    it('allows admin or ops_manager to advance assigned -> in_progress even if not assigned to them', () => {
      const req = { id: 1, status: 'assigned', assigned_staff_id: 10 };
      expect(canAdvanceAssistance(req, adminUser)).toBe(true);
      expect(canAdvanceAssistance(req, opsUser)).toBe(true);
    });

    it('allows only the assigned staff member or admin/ops to advance in_progress -> completed', () => {
      const req = { id: 1, status: 'in_progress', assigned_staff_id: 10 };
      expect(canAdvanceAssistance(req, staffUser1)).toBe(true);
      expect(canAdvanceAssistance(req, staffUser2)).toBe(false);
      expect(canAdvanceAssistance(req, adminUser)).toBe(true);
    });

    it('returns false for terminal states', () => {
      expect(canAdvanceAssistance({ id: 1, status: 'completed' }, adminUser)).toBe(false);
      expect(canAdvanceAssistance({ id: 1, status: 'cancelled' }, adminUser)).toBe(false);
    });
  });

  describe('getNextAssistanceStatus', () => {
    it('returns the linear progression of states', () => {
      expect(getNextAssistanceStatus('requested')).toBe('assigned');
      expect(getNextAssistanceStatus('assigned')).toBe('in_progress');
      expect(getNextAssistanceStatus('in_progress')).toBe('completed');
      expect(getNextAssistanceStatus('completed')).toBe(null);
      expect(getNextAssistanceStatus('cancelled')).toBe(null);
    });
  });

  describe('validateAssistanceInput', () => {
    it('validates correct assistance input', () => {
      const res = validateAssistanceInput('wheelchair', 'Needs help at gate');
      expect(res.valid).toBe(true);
      expect(res.error).toBe(null);
    });

    it('rejects invalid assistance type', () => {
      const res = validateAssistanceInput('unsupported_type', '');
      expect(res.valid).toBe(false);
      expect(res.error).toContain('valid assistance service type');
    });

    it('rejects notes exceeding 500 characters', () => {
      const longNotes = 'A'.repeat(501);
      const res = validateAssistanceInput('wheelchair', longNotes);
      expect(res.valid).toBe(false);
      expect(res.error).toContain('Notes cannot exceed 500 characters');
    });
  });
});
