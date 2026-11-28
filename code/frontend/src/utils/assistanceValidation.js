export const ASSISTANCE_TYPES = ['wheelchair', 'medical', 'visual', 'hearing', 'elderly_support'];

export const ASSISTANCE_TYPE_LABELS = {
  wheelchair: 'Wheelchair Assistance',
  medical: 'Medical Assistance',
  visual: 'Visual Assistance',
  hearing: 'Hearing Assistance',
  elderly_support: 'Elderly Passenger Support',
};

export const ASSISTANCE_STATUS_LABELS = {
  requested: 'Submitted',
  assigned: 'Staff Assigned',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

/**
 * Returns user-facing label and styling for boarding groups.
 * Group 1: Priority Boarding
 * Group 2: General Boarding
 */
export function getBoardingGroupInfo(group) {
  if (group === 1) {
    return {
      group: 1,
      label: 'Priority Boarding (Group 1)',
      shortLabel: 'Group 1',
      isPriority: true,
      pillClass: 'status-pill-cyan',
    };
  }
  if (group === 2) {
    return {
      group: 2,
      label: 'Boarding Group 2',
      shortLabel: 'Group 2',
      isPriority: false,
      pillClass: 'status-pill-blue',
    };
  }
  return {
    group: null,
    label: 'Standard Boarding',
    shortLabel: 'Unassigned',
    isPriority: false,
    pillClass: 'status-pill-muted',
  };
}

/**
 * Passenger may cancel their own assistance request only while it is still 'requested'.
 */
export function canPassengerCancelAssistance(status) {
  return status === 'requested';
}

/**
 * Determines whether a staff member or admin can advance an assistance request.
 * - 'requested' -> 'assigned' (Take it): Any assistance staff
 * - 'assigned' -> 'in_progress' (Start): Only assigned staff member or admin/ops_manager
 * - 'in_progress' -> 'completed' (Complete): Only assigned staff member or admin/ops_manager
 */
export function canAdvanceAssistance(request, currentUser) {
  if (!request || !currentUser) return false;
  const { status, assigned_staff_id } = request;
  const role = currentUser.role;
  const isSuperUser = ['admin', 'ops_manager'].includes(role);

  if (status === 'requested') {
    return ['admin', 'ops_manager', 'ground_crew', 'medical'].includes(role);
  }

  if (status === 'assigned' || status === 'in_progress') {
    if (isSuperUser) return true;
    return assigned_staff_id === currentUser.id;
  }

  return false;
}

/**
 * Returns the next status in the staff assistance workflow.
 */
export function getNextAssistanceStatus(currentStatus) {
  switch (currentStatus) {
    case 'requested':
      return 'assigned';
    case 'assigned':
      return 'in_progress';
    case 'in_progress':
      return 'completed';
    default:
      return null;
  }
}

/**
 * Validates passenger assistance request input.
 */
export function validateAssistanceInput(type, notes) {
  const validTypes = ['wheelchair', 'medical', 'visual', 'hearing', 'elderly_support'];
  if (!type || !validTypes.includes(type)) {
    return { valid: false, error: 'Please select a valid assistance service type.' };
  }
  if (notes && notes.length > 500) {
    return { valid: false, error: 'Notes cannot exceed 500 characters.' };
  }
  return { valid: true, error: null };
}
