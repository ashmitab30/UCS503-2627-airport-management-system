/**
 * navigation.js
 * Routing & redirect decision logic based on user authentication and roles.
 */

export const STAFF_PORTAL_ROLES = ['ground_crew', 'security', 'medical'];
export const ADMIN_ROLES = ['admin', 'ops_manager'];

/**
 * Returns the target redirect path for a given user or unauthenticated state.
 *
 * @param {Object|null|undefined} user
 * @returns {string} '/login' | '/dashboard' | '/staff' | '/admin'
 */
export function getRoleDashboardPath(user) {
  if (!user || !user.role) return '/login';
  if (ADMIN_ROLES.includes(user.role)) return '/admin';
  if (STAFF_PORTAL_ROLES.includes(user.role)) return '/staff';
  return '/dashboard';
}
