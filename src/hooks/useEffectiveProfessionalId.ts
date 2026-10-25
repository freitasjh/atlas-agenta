import { useMemo } from "react";

import { usePermissions } from "@/hooks/usePermissions";
import { useProfessionals } from "@/hooks/useProfessionals";
import { useProfile } from "@/hooks/useProfile";

/**
 * Deriva o `professional_id` efetivo da sessão para o recorte de UI do dashboard
 * — mesmo padrão provado na `AgendaPage` (`ownProfessional` +
 * `canScheduleForAnyProfessional`):
 *
 *   - `admin`/`receptionist` (`canScheduleForAnyProfessional === true`)
 *     → `undefined`: os agregados/listas cobrem o **tenant inteiro**.
 *   - `professional` → o `professionals.id` ligado ao próprio `profile.id`:
 *     os números/listas ficam na **própria agenda**.
 *
 * É **defesa em profundidade / conveniência de UI**, NÃO a fronteira: as RPCs
 * (`SECURITY INVOKER`) e as leituras rodam sob o RLS de `appointments`, que já
 * confina o `professional` ao próprio `profile_id`. Forjar o id de um colega não
 * retorna linhas dele. Nenhum `tenant_id` trafega do cliente.
 */
export function useEffectiveProfessionalId(): string | undefined {
  const { canScheduleForAnyProfessional } = usePermissions();
  const { data: profile } = useProfile();
  const professionalsQuery = useProfessionals({ activeOnly: true });

  return useMemo(() => {
    if (canScheduleForAnyProfessional) return undefined;
    if (!profile) return undefined;
    return (
      professionalsQuery.data?.find((p) => p.profile_id === profile.id)?.id ??
      undefined
    );
  }, [canScheduleForAnyProfessional, profile, professionalsQuery.data]);
}
