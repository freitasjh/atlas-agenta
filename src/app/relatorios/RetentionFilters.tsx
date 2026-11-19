import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useProfessionals } from "@/hooks/useProfessionals";
import { useServices } from "@/hooks/useServices";
import {
  PeriodFilter,
  type PeriodPreset,
} from "@/app/relatorios/PeriodFilter";

/**
 * Filtros dos relatórios de retenção (ADR-17): período (presets/data) +
 * profissional + serviço. Padrão visual de `ComissoesPage` (filtros
 * empilhados, selects com `sm:max-w-xs`). Profissional/serviço carregam sob
 * RLS; falha de catálogo degrada para só-período (nunca trava a página).
 */
export function RetentionFilters({
  preset,
  start,
  end,
  onPresetChange,
  onStartChange,
  onEndChange,
  professionalId,
  onProfessionalChange,
  serviceId,
  onServiceChange,
  idPrefix,
  showService = true,
}: {
  preset: PeriodPreset;
  start: string;
  end: string;
  onPresetChange: (preset: PeriodPreset) => void;
  onStartChange: (value: string) => void;
  onEndChange: (value: string) => void;
  professionalId: string;
  onProfessionalChange: (value: string) => void;
  serviceId: string;
  onServiceChange: (value: string) => void;
  idPrefix: string;
  showService?: boolean;
}) {
  const professionalsQuery = useProfessionals({ activeOnly: false });
  const servicesQuery = useServices({ activeOnly: false });
  const catalogLoading =
    professionalsQuery.isLoading || servicesQuery.isLoading;

  return (
    <div className="flex flex-col gap-4">
      <PeriodFilter
        idPrefix={`${idPrefix}-periodo`}
        preset={preset}
        start={start}
        end={end}
        onPresetChange={onPresetChange}
        onStartChange={onStartChange}
        onEndChange={onEndChange}
      />

      {catalogLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 sm:max-w-xl" aria-busy="true">
          <Skeleton className="h-10 w-full" />
          {showService ? <Skeleton className="h-10 w-full" /> : null}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 sm:max-w-xl">
          <div className="space-y-1">
            <Label htmlFor={`${idPrefix}-profissional`}>Profissional</Label>
            <Select value={professionalId} onValueChange={onProfessionalChange}>
              <SelectTrigger
                id={`${idPrefix}-profissional`}
                aria-label="Filtrar por profissional"
              >
                <SelectValue placeholder="Todos os profissionais" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os profissionais</SelectItem>
                {(professionalsQuery.data ?? []).map((professional) => (
                  <SelectItem key={professional.id} value={professional.id}>
                    {professional.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {showService ? (
            <div className="space-y-1">
              <Label htmlFor={`${idPrefix}-servico`}>Serviço</Label>
              <Select value={serviceId} onValueChange={onServiceChange}>
                <SelectTrigger
                  id={`${idPrefix}-servico`}
                  aria-label="Filtrar por serviço"
                >
                  <SelectValue placeholder="Todos os serviços" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os serviços</SelectItem>
                  {(servicesQuery.data ?? []).map((service) => (
                    <SelectItem key={service.id} value={service.id}>
                      {service.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
