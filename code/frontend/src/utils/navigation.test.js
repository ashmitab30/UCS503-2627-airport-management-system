import { describe, it, expect } from 'vitest';
import { getRoleDashboardPath, STAFF_PORTAL_ROLES, ADMIN_ROLES } from './navigation.js';

describe('Task 5: Role-based Navigation and Redirect Logic', () => {
  it('redirects to /login when user is not logged in', () => {
    expect(getRoleDashboardPath(null)).toBe('/login');
    expect(getRoleDashboardPath(undefined)).toBe('/login');
    expect(getRoleDashboardPath({})).toBe('/login');
  });

  it('redirects passengers and standard users to /dashboard', () => {
    expect(getRoleDashboardPath({ id: 1, role: 'passenger' })).toBe('/dashboard');
    expect(getRoleDashboardPath({ id: 2, role: 'user' })).toBe('/dashboard');
    expect(getRoleDashboardPath({ id: 3, role: 'guest' })).toBe('/dashboard');
  });

  it('redirects staff portal roles to /staff', () => {
    STAFF_PORTAL_ROLES.forEach((role) => {
      expect(getRoleDashboardPath({ id: 10, role })).toBe('/staff');
    });
    expect(getRoleDashboardPath({ id: 11, role: 'ground_crew' })).toBe('/staff');
    expect(getRoleDashboardPath({ id: 12, role: 'security' })).toBe('/staff');
    expect(getRoleDashboardPath({ id: 13, role: 'medical' })).toBe('/staff');
  });

  it('redirects admin and ops_manager roles to /admin', () => {
    ADMIN_ROLES.forEach((role) => {
      expect(getRoleDashboardPath({ id: 20, role })).toBe('/admin');
    });
    expect(getRoleDashboardPath({ id: 21, role: 'admin' })).toBe('/admin');
    expect(getRoleDashboardPath({ id: 22, role: 'ops_manager' })).toBe('/admin');
  });
});
