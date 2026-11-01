import { useMemo } from "react";

import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePermissions } from "@/hooks/usePermissions";
import { useProfessionals } from "@/hooks/useProfessionals";

/**
 * Deriva o `professional_id` efetivo da sessão para o recorte de UI do dashboard
 * — mesmo padrão provado na `AgendaPage` (`ownProfessional` +
 * `canScheduleForAnyProfessional`):
 *
 *   - `admin`/`receptionist` (`canScheduleForAnyProfessional === true`)
 *     → `undefined`: os agregados/listas cobrem o **tenant inteiro**.
 *   - `professional` → o `professionals.id` ligado ao próprio `userId`
 *     (identidade da claim da sessão; `professionals.profile_id` aponta para o
 *     `auth.users.id`): os números/listas ficam na **própria agenda**.
 *
 * É **defesa em profundidade / conveniência de UI**, NÃO a fronteira: as RPCs
 * (`SECURITY INVOKER`) e as leituras rodam sob o RLS de `appointments`, que já
 * confina o `professional` ao próprio `profile_id`. Forjar o id de um colega não
 * retorna linhas dele. Nenhum `tenant_id` trafega do cliente.
 */
export function useEffectiveProfessionalId(): string | undefined {
  const { canScheduleForAnyProfessional } = usePermissions();
  const { userId } = useCurrentUser();
  const professionalsQuery = useProfessionals({ activeOnly: true });

  return useMemo(() => {
    if (canScheduleForAnyProfessional) return undefined;
    if (!userId) return undefined;
    return (
      professionalsQuery.data?.find((p) => p.profile_id === userId)?.id ??
      undefined
    );
  }, [canScheduleForAnyProfessional, userId, professionalsQuery.data]);
}
