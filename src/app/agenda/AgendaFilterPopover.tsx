import { useEffect, useState } from "react";
import { SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { getAppointmentStatusLabel } from "@/components/StatusBadge";
import {
  APPOINTMENT_STATUSES,
  type AppointmentStatus,
} from "@/types/domain";

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia !== "undefined"
      ? window.matchMedia(query).matches
      : false,
  );

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia === "undefined") {
      return;
    }
    const list = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    setMatches(list.matches);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

export interface AdvancedFilterOption {
  id: string;
  name: string;
}

export interface AgendaFilterPopoverProps {
  professionals: AdvancedFilterOption[];
  services: AdvancedFilterOption[];
  resources?: AdvancedFilterOption[];
  servicosLabel: string;
  profissionaisLabel: string;
  /** False para `professional` (só vê a própria agenda). */
  showProfessional: boolean;
  professionalId: string;
  serviceId: string;
  resourceIds?: string[];
  status: AppointmentStatus | "";
  /** "Somente pagamento pendente" só na visão Lista com o recurso ativo. */
  showPaymentPending: boolean;
  paymentPendingOnly: boolean;
  pendingCount: number;
  activeCount: number;
  onChangeProfessional: (id: string) => void;
  onChangeService: (id: string) => void;
  onChangeResources?: (ids: string[]) => void;
  onChangeStatus: (status: AppointmentStatus | "") => void;
  onTogglePaymentPending: () => void;
  onClearAll: () => void;
}

/**
 * Filtros avançados (ADR-02 §2.2): Dialog no desktop, Sheet inferior no mobile
 * (`<640px`). Mesma fonte de estado da página — sem store nova. O trigger
 * "Filtros" carrega o badge de contagem de filtros ativos.
 */
export function AgendaFilterPopover({
  professionals,
  services,
  resources = [],
  servicosLabel,
  profissionaisLabel,
  showProfessional,
  professionalId,
  serviceId,
  resourceIds = [],
  status,
  showPaymentPending,
  paymentPendingOnly,
  pendingCount,
  activeCount,
  onChangeProfessional,
  onChangeService,
  onChangeResources,
  onChangeStatus,
  onTogglePaymentPending,
  onClearAll,
}: AgendaFilterPopoverProps) {
  const [open, setOpen] = useState(false);
  const isMobile = useMediaQuery("(max-width: 640px)");
  const servicosLower = servicosLabel.toLowerCase();
  const profissionaisLower = profissionaisLabel.toLowerCase();

  function handleClearAll() {
    onClearAll();
    setOpen(false);
  }

  const fields = (
    <div className="space-y-4">
      {showProfessional ? (
        <div className="space-y-1">
          <Label htmlFor="agenda-profissional-dialogo">{profissionaisLabel}</Label>
          <Select
            value={professionalId || "todos"}
            onValueChange={(value) => onChangeProfessional(value === "todos" ? "" : value)}
          >
            <SelectTrigger
              id="agenda-profissional-dialogo"
              className="w-full"
              aria-label={`Filtrar por ${profissionaisLower}`}
            >
              <SelectValue placeholder={`Todos (${profissionaisLower})`} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">{`Todos (${profissionaisLower})`}</SelectItem>
              {professionals.map((professional) => (
                <SelectItem key={professional.id} value={professional.id}>
                  {professional.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      <div className="space-y-1">
        <Label htmlFor="agenda-servico-dialogo">{servicosLabel}</Label>
        <Select
          value={serviceId || "todos"}
          onValueChange={(value) => onChangeService(value === "todos" ? "" : value)}
        >
          <SelectTrigger
            id="agenda-servico-dialogo"
            className="w-full"
            aria-label={`Filtrar por ${servicosLower}`}
          >
            <SelectValue placeholder={`Todos (${servicosLower})`} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">{`Todos (${servicosLower})`}</SelectItem>
            {services.map((service) => (
              <SelectItem key={service.id} value={service.id}>
                {service.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {resources.length > 0 ? (
        <div className="space-y-2">
          <Label>Recurso</Label>
          <div className="space-y-1">
            {resources.map((resource) => {
              const checked = resourceIds.includes(resource.id);
              return (
                <label key={resource.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(value) => {
                      if (!onChangeResources) return;
                      if (value) {
                        onChangeResources([...resourceIds, resource.id]);
                      } else {
                        onChangeResources(resourceIds.filter((id) => id !== resource.id));
                      }
                    }}
                  />
                  {resource.name}
                </label>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="space-y-1">
        <Label htmlFor="agenda-status-dialogo">Status</Label>
        <Select
          value={status || "todos"}
          onValueChange={(value) =>
            onChangeStatus(value === "todos" ? "" : (value as AppointmentStatus))
          }
        >
          <SelectTrigger id="agenda-status-dialogo" className="w-full" aria-label="Filtrar por status">
            <SelectValue placeholder="Todos os status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os status</SelectItem>
            {APPOINTMENT_STATUSES.map((option) => (
              <SelectItem key={option} value={option}>
                {getAppointmentStatusLabel(option)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {showPaymentPending ? (
        <div className="flex min-h-[44px] items-center justify-between gap-3 rounded-lg border border-border p-3">
          <Label htmlFor="agenda-pagamento-pendente" className="text-sm font-medium">
            {`Somente pagamento pendente (${pendingCount})`}
          </Label>
          <Switch
            id="agenda-pagamento-pendente"
            aria-label={`Somente pagamento pendente (${pendingCount})`}
            checked={paymentPendingOnly}
            onCheckedChange={onTogglePaymentPending}
          />
        </div>
      ) : null}
    </div>
  );

  const triggerLabel = activeCount > 0 ? `Filtros, ${activeCount} ativos` : "Filtros";

  const trigger = (
    <Button
      type="button"
      variant="outline"
      onClick={() => setOpen(true)}
      aria-label={triggerLabel}
      className="min-h-[44px] gap-2"
    >
      <SlidersHorizontal aria-hidden="true" className="h-4 w-4" />
      Filtros
      {activeCount > 0 ? (
        <Badge variant="default" aria-hidden="true" className="tabular-nums">
          {activeCount}
        </Badge>
      ) : null}
    </Button>
  );

  if (isMobile) {
    return (
      <>
        {trigger}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Filtros avançados</SheetTitle>
              <SheetDescription>
                Refine a agenda por profissional, serviço, status e pagamento.
              </SheetDescription>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto py-4">{fields}</div>
            <SheetFooter className="gap-2 border-t pt-4 sm:gap-0">
              <Button type="button" variant="ghost" onClick={handleClearAll} className="min-h-[44px]">
                Limpar tudo
              </Button>
              <Button type="button" onClick={() => setOpen(false)} className="min-h-[44px]">
                Aplicar
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <>
      {trigger}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Filtros avançados</DialogTitle>
            <DialogDescription>
              Refine a agenda por profissional, serviço, status e pagamento.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">{fields}</div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="ghost" onClick={handleClearAll} className="min-h-[44px]">
              Limpar tudo
            </Button>
            <Button type="button" onClick={() => setOpen(false)} className="min-h-[44px]">
              Aplicar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
