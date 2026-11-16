import type { MembershipRole } from '@/generated/api';

export const selectableMembershipRoles = [
  'VIEWER', 'PRACTITIONER', 'EDITOR',
] as const satisfies readonly MembershipRole[];

export const membershipRoleTranslationKey = {
  VIEWER: 'viewer',
  PRACTITIONER: 'practitioner',
  EDITOR: 'editor',
} as const satisfies Record<MembershipRole, string>;
