import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/lib/supabase";
import { MESSAGE_TEMPLATES_KEY } from "@/lib/whatsapp";
import { MESSAGE_TEMPLATES } from "@/types/domain";
import type { MessageTemplateRow } from "@/types/domain";
import type { MessageTemplateInput } from "@/lib/validations/whatsapp";

/**
 * Hooks de dados de `message_templates` (TanStack Query), espelhando
 * `useServices`. Toda leitura valida o shape de retorno com zod (dado externo
 * não confiável); nenhuma escrita envia `tenant_id` — o RLS o deriva do JWT e a
 * coluna tem `default current_tenant_id()` (ADR-01). A escrita é do cliente sob
 * RLS (conteúdo editorial), não via Edge Function.
 */

const messageTemplateRowSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  template_key: z.enum(MESSAGE_TEMPLATES),
  body: z.string(),
  active: z.boolean(),
  updated_at: z.string(),
  created_at: z.string(),
});

const messageTemplateListSchema = z.array(messageTemplateRowSchema);

const SELECT_COLUMNS =
  "id, tenant_id, template_key, body, active, updated_at, created_at";

/** Lista dos templates do tenant, ordenados por `template_key`. */
export function useMessageTemplates() {
  return useQuery<MessageTemplateRow[]>({
    queryKey: MESSAGE_TEMPLATES_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("message_templates")
        .select(SELECT_COLUMNS)
        .order("template_key", { ascending: true });
      if (error) throw error;
      return messageTemplateListSchema.parse(data);
    },
  });
}

/**
 * Upsert por `(tenant_id, template_key)`. O `tenant_id` NÃO vai no payload — vem
 * do default da coluna / RLS; `onConflict` usa a unique `(tenant_id,
 * template_key)` da ADR-01.
 */
export function useUpsertMessageTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: MessageTemplateInput) => {
      const { data, error } = await supabase
        .from("message_templates")
        .upsert(
          {
            template_key: input.templateKey,
            body: input.body,
            active: input.active,
          },
          { onConflict: "tenant_id,template_key" },
        )
        .select(SELECT_COLUMNS)
        .single();
      if (error) throw error;
      return messageTemplateRowSchema.parse(data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: MESSAGE_TEMPLATES_KEY });
    },
  });
}
