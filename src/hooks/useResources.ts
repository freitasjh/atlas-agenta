import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/lib/supabase";
import type { Resource } from "@/types/domain";

const resourceRowSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  name: z.string(),
  type: z.enum(["sala", "equipamento", "cadeira"]),
  capacity: z.number().int(),
  color: z.string().nullable(),
  active: z.boolean(),
  created_at: z.string(),
});

const resourceListSchema = z.array(resourceRowSchema);

const RESOURCES_KEY = ["resources"] as const;
const SERVICE_RESOURCES_KEY = ["service_resources"] as const;

export function useResources(options?: { activeOnly?: boolean }) {
  const activeOnly = options?.activeOnly ?? false;
  return useQuery<Resource[]>({
    queryKey: [...RESOURCES_KEY, { activeOnly }],
    queryFn: async () => {
      let query = supabase
        .from("resources")
        .select("id, tenant_id, name, type, capacity, color, active, created_at")
        .order("name", { ascending: true });
      if (activeOnly) query = query.eq("active", true);
      const { data, error } = await query;
      if (error) throw error;
      return resourceListSchema.parse(data);
    },
  });
}

export interface ResourceInput {
  name: string;
  type: "sala" | "equipamento" | "cadeira";
  capacity: number;
  color?: string | null;
  active: boolean;
}

export function useCreateResource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ResourceInput) => {
      const { data, error } = await supabase
        .from("resources")
        .insert({
          name: input.name,
          type: input.type,
          capacity: input.capacity,
          color: input.color ?? null,
          active: input.active,
        })
        .select("id, tenant_id, name, type, capacity, color, active, created_at")
        .single();
      if (error) throw error;
      return resourceRowSchema.parse(data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: RESOURCES_KEY });
    },
  });
}

export function useUpdateResource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: ResourceInput & { id: string }) => {
      const { data, error } = await supabase
        .from("resources")
        .update({
          name: input.name,
          type: input.type,
          capacity: input.capacity,
          color: input.color ?? null,
          active: input.active,
        })
        .eq("id", id)
        .select("id, tenant_id, name, type, capacity, color, active, created_at")
        .single();
      if (error) throw error;
      return resourceRowSchema.parse(data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: RESOURCES_KEY });
    },
  });
}

export function useDeactivateResource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { data, error } = await supabase
        .from("resources")
        .update({ active })
        .eq("id", id)
        .select("id, tenant_id, name, type, capacity, color, active, created_at")
        .single();
      if (error) throw error;
      return resourceRowSchema.parse(data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: RESOURCES_KEY });
    },
  });
}

// service_resources
const serviceResourceRowSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  service_id: z.string(),
  resource_id: z.string(),
  qty: z.number().int(),
  created_at: z.string(),
});

export function useServiceResources(serviceId: string | null) {
  return useQuery<{ resource_id: string; qty: number }[]>({
    queryKey: [...SERVICE_RESOURCES_KEY, serviceId],
    enabled: !!serviceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_resources")
        .select("id, tenant_id, service_id, resource_id, qty, created_at")
        .eq("service_id", serviceId as string);
      if (error) throw error;
      return serviceResourceRowSchema
        .array()
        .parse(data)
        .map((r) => ({ resource_id: r.resource_id, qty: r.qty }));
    },
  });
}

export function useSetServiceResources(serviceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (links: { resource_id: string; qty: number }[]) => {
      // delete existing then insert
      const { error: delErr } = await supabase
        .from("service_resources")
        .delete()
        .eq("service_id", serviceId);
      if (delErr) throw delErr;
      if (links.length > 0) {
        const { error: insErr } = await supabase
          .from("service_resources")
          .insert(
            links.map((l) => ({
              service_id: serviceId,
              resource_id: l.resource_id,
              qty: l.qty,
            })),
          );
        if (insErr) throw insErr;
      }
      return links;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SERVICE_RESOURCES_KEY });
    },
  });
}

export async function insertServiceResources(
  serviceId: string,
  links: { resource_id: string; qty: number }[],
) {
  if (links.length === 0) return;
  const { error } = await supabase.from("service_resources").insert(
    links.map((l) => ({
      service_id: serviceId,
      resource_id: l.resource_id,
      qty: l.qty,
    })),
  );
  if (error) throw error;
}

export async function checkResourceConflict(params: {
  resourceId: string;
  startsAt: string;
  endsAt: string;
  processingMinutes?: number;
  excludeAppointmentId?: string | null;
  qty?: number;
}): Promise<boolean> {
  const { data, error } = await supabase.rpc("check_resource_conflict", {
    p_resource_id: params.resourceId,
    p_starts_at: params.startsAt,
    p_ends_at: params.endsAt,
    p_processing_minutes: params.processingMinutes ?? 0,
    p_exclude_appointment_id: params.excludeAppointmentId ?? null,
    p_qty: params.qty ?? 1,
  });
  if (error) throw error;
  return Boolean(data);
}

export async function listAppointmentsByResource(params: {
  resourceId: string;
  day: string;
  timezone?: string;
}): Promise<unknown[]> {
  const { data, error } = await supabase.rpc("list_appointments_by_resource", {
    p_resource_id: params.resourceId,
    p_day: params.day,
    p_timezone: params.timezone ?? "UTC",
  });
  if (error) throw error;
  return (data ?? []) as unknown[];
}