import { describe, expect, it } from 'vitest';
import type { MembershipRole } from '@/generated/api';
import { membershipRoleTranslationKey, selectableMembershipRoles } from '@/features/scores/collaboration/roles';
import en from '../../messages/en/scoreCollaboration.json';
import zh from '../../messages/zh/scoreCollaboration.json';

describe('membership role presentation', () => {
  it('provides selectable generated roles and localized keys for both clients', () => {
    const roles: readonly MembershipRole[] = selectableMembershipRoles;
    expect(roles).toEqual(['VIEWER', 'PRACTITIONER', 'EDITOR']);
    for (const role of roles) {
      const key = membershipRoleTranslationKey[role];
      expect(en[key]).toBeTruthy();
      expect(zh[key]).toBeTruthy();
    }
  });
});
