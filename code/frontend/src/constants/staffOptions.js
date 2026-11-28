export const STAFF_ROLE_OPTIONS = [
  { value: 'ground_crew', label: 'Ground Crew' },
  { value: 'security', label: 'Security' },
  { value: 'medical', label: 'Medical' },
  { value: 'ops_manager', label: 'Operations Manager' },
  { value: 'admin', label: 'Administrator' },
];

export const DEPARTMENT_OPTIONS = [
  'Ground Operations',
  'Security',
  'Medical Unit',
  'Operations Control',
  'Administration',
];

export const ROLE_DEFAULT_DEPARTMENT = {
  ground_crew: 'Ground Operations',
  security: 'Security',
  medical: 'Medical Unit',
  ops_manager: 'Operations Control',
  admin: 'Administration',
};

export const ROLE_TITLE_OPTIONS = {
  ground_crew: ['Apron Marshaller', 'Ramp Agent', 'Baggage Handler', 'Gate Agent'],
  security: ['Security Officer', 'Screening Officer', 'Security Supervisor'],
  medical: ['Paramedic', 'First Responder', 'Medical Officer'],
  ops_manager: ['Operations Manager', 'Duty Manager'],
  admin: ['Administrator'],
};

export const CERTIFICATION_OPTIONS = [
  'None',
  'CPR / First Aid',
  'Basic Ramp',
  'Aviation Security',
  'Dangerous Goods',
  'Fire Safety',
];
