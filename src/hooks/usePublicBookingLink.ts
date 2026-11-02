import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";

const publicBookingLinkSchema = z.object({
  token: z.string().uuid(),
  created_at: z.string(),
});

const publicBookingLinkListSchema = z.array(publicBookingLinkSchema);

export const PUBLIC_BOOKING_LINK_KEY = ["public-booking-link"] as const;

export function usePublicBookingLink() {
  return useQuery({
    queryKey: PUBLIC_BOOKING_LINK_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("public_booking_links")
        .select("token, created_at")
        .eq("active", true)
        .order("created_at", { ascending: false })
        .limit(1);

      if (error) throw error;
      if (!data || data.length === 0) return null;
      return publicBookingLinkListSchema.parse(data)[0];
    },
  });
}

export function useCreatePublicBookingLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (tenantId?: string | null) => {
      const { data, error } = await supabase.rpc("create_public_booking_link", 
        tenantId ? { p_tenant_id: tenantId } : {}
      );
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("Erro ao criar link");
      return publicBookingLinkListSchema.parse(data)[0];
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PUBLIC_BOOKING_LINK_KEY });
    },
  });
}
