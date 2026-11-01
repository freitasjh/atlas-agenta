import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/lib/supabase";
import { AUDIT_LOG_KEY } from "@/hooks/useAuditLog";

export const INVITATION_ROLES = [
  "super_admin",
  "admin",
  "professional",
  "receptionist",
] as const;

export const INVITATION_STATUSES = [
  "pending",
  "accepted",
  "revoked",
  "expired",
] as const;

export const invitationRowSchema = z.object({
  id: z.string(),
  tenant_id: z.string().nullable(),
  email: z.string(),
  role: z.enum(INVITATION_ROLES),
  status: z.enum(INVITATION_STATUSES),
  expires_at: z.string(),
  accepted_at: z.string().nullable(),
  accepted_user_id: z.string().nullable(),
  created_by: z.string().nullable(),
  created_at: z.string(),
});

export const invitationSchema = invitationRowSchema;

export const invitationListSchema = z.array(invitationRowSchema);

export type Invitation = z.infer<typeof invitationRowSchema>;
export type InvitationRow = Invitation;

export const INVITATIONS_KEY = ["invitations"] as const;

const INVITATIONS_SELECT =
  "id, tenant_id, email, role, status, expires_at, accepted_at, accepted_user_id, created_by, created_at";

const inviteMemberResponseSchema = z.object({
  ok: z.boolean(),
  invitation_id: z.string(),
  expires_at: z.string(),
});

const revokeInvitationResponseSchema = z.object({
  ok: z.boolean(),
});

const resendInvitationResponseSchema = z.object({
  ok: z.boolean(),
  expires_at: z.string(),
});

export interface InviteMemberInput {
  email: string;
  role: (typeof INVITATION_ROLES)[number];
}

export function useInvitations() {
  return useQuery<Invitation[]>({
    queryKey: INVITATIONS_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invitations")
        .select(INVITATIONS_SELECT)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return invitationListSchema.parse(data ?? []);
    },
  });
}

export function useInviteMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: InviteMemberInput) => {
      const { data, error } = await supabase.functions.invoke("invite-member", {
        body: { email: input.email, role: input.role },
      });
      if (error) throw error;
      return inviteMemberResponseSchema.parse(data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: INVITATIONS_KEY });
      void queryClient.invalidateQueries({ queryKey: AUDIT_LOG_KEY });
    },
  });
}

export interface RevokeInvitationInput {
  invitationId?: string;
  invitation_id?: string;
}

function resolveInvitationId(input: RevokeInvitationInput | string): string {
  if (typeof input === "string") return input;
  return input.invitationId ?? input.invitation_id ?? "";
}

export function useRevokeInvitation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: RevokeInvitationInput | string) => {
      const invitation_id = resolveInvitationId(input);
      const { data, error } = await supabase.functions.invoke(
        "revoke-invitation",
        { body: { invitation_id } },
      );
      if (error) throw error;
      return revokeInvitationResponseSchema.parse(data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: INVITATIONS_KEY });
      void queryClient.invalidateQueries({ queryKey: AUDIT_LOG_KEY });
    },
  });
}

export function useResendInvitation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: RevokeInvitationInput | string) => {
      const invitation_id = resolveInvitationId(input);
      const { data, error } = await supabase.functions.invoke(
        "resend-invitation",
        { body: { invitation_id } },
      );
      if (error) throw error;
      return resendInvitationResponseSchema.parse(data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: INVITATIONS_KEY });
      void queryClient.invalidateQueries({ queryKey: AUDIT_LOG_KEY });
    },
  });
}

export const useResend = useResendInvitation;
export const useRevoke = useRevokeInvitation;
