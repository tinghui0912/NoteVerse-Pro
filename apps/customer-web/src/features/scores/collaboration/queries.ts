'use client';

import type { MembershipRole } from '@/generated/api';
import { collaborationApi } from './api';
import { collaborationQueryKeys } from './query-keys';
import { scoreInvitesChanged, scoreMembersChanged, pendingInvitesChanged } from './cache';
import { scoreLeft, inviteAccepted } from '../consequences';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export function useLeaveScore() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (scoreId: string) => collaborationApi.leaveScore(scoreId),
    onSuccess: (_response, scoreId) => scoreLeft(queryClient, scoreId),
  });
}

export function useScoreInvites(scoreId: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: collaborationQueryKeys.invites(scoreId),
    queryFn: ({ signal, pageParam }) =>
      collaborationApi.listInvites(scoreId, { signal, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage?.next_cursor ?? undefined,
    enabled: enabled && Boolean(scoreId),
  });
}

export function useCreateScoreInvite(scoreId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof collaborationApi.createInvite>[1]) =>
      collaborationApi.createInvite(scoreId, input),
    onSuccess: () => scoreInvitesChanged(queryClient, scoreId),
  });
}

export function useRevokeScoreInvite(scoreId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (inviteId: string) => collaborationApi.revokeInvite(scoreId, inviteId),
    onSuccess: () => scoreInvitesChanged(queryClient, scoreId),
  });
}

export function useScoreMembers(scoreId: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: collaborationQueryKeys.members(scoreId),
    queryFn: ({ signal, pageParam }) =>
      collaborationApi.listMembers(scoreId, { signal, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage?.next_cursor ?? undefined,
    enabled: enabled && Boolean(scoreId),
  });
}

export function useUpdateScoreMember(scoreId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ membershipId, role }: { membershipId: number; role: MembershipRole }) =>
      collaborationApi.updateMember(scoreId, membershipId, { role }),
    onSuccess: () => scoreMembersChanged(queryClient, scoreId),
  });
}

export function useRemoveScoreMember(scoreId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (membershipId: number) => collaborationApi.removeMember(scoreId, membershipId),
    onSuccess: () => scoreMembersChanged(queryClient, scoreId),
  });
}

export function useScoreInviteAccess(token: string) {
  return useQuery({
    queryKey: collaborationQueryKeys.inviteAccess(token),
    queryFn: ({ signal }) => collaborationApi.inspectInvite(token, signal),
    enabled: Boolean(token),
    staleTime: 0,
  });
}

export function useAcceptScoreInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => collaborationApi.acceptInvite(token),
    onSuccess: (response) => inviteAccepted(queryClient, response.score_id),
  });
}

export function useMyPendingScoreInvites(enabled = true) {
  return useInfiniteQuery({
    queryKey: collaborationQueryKeys.myInvites(),
    queryFn: ({ signal, pageParam }) =>
      // One page covers the Bell's exact 0..99 / saturated 99+ presentation.
      collaborationApi.listMyPendingInvites({ signal, cursor: pageParam, limit: 100 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage?.next_cursor ?? undefined,
    enabled,
  });
}

export function useAcceptMyPendingScoreInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (inviteId: string) => collaborationApi.acceptMyPendingInvite(inviteId),
    onSuccess: (response) => inviteAccepted(queryClient, response.score_id),
  });
}

export function useDeclineMyPendingScoreInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (inviteId: string) => collaborationApi.declineMyPendingInvite(inviteId),
    onSuccess: () => pendingInvitesChanged(queryClient),
  });
}
