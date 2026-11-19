import { useState } from "react";
import { Link } from "react-router-dom";
import { Clock } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useEnqueueWaitlist } from "@/hooks/useWaitlist";
import { useCustomers } from "@/hooks/useCustomers";
import { useServices } from "@/hooks/useServices";
import { useProfessionals } from "@/hooks/useProfessionals";
import {
  WaitlistEnrollDialog,
  type WaitlistEnrollValues,
} from "@/app/lista-espera/WaitlistEnrollDialog";
import {
  waitlistMessages,
} from "@/app/lista-espera/waitlist-messages";

const messages = waitlistMessages;

interface WaitlistCtaProps {
  /** Entitlement `waitlist`: sem ele o CTA some (RF-11, zero request sensível). */
  entitled: boolean | null;
  /** Pré-preenchimento vindo do slot ocupado (serviço/profissional/período). */
  initial?: Partial<WaitlistEnrollValues>;
}

/**
 * Monta os dados do formulário SOMENTE com o dialog aberto — nenhum request
 * antes do clique no CTA. Componente isolado para o shell nunca tocar em
 * hooks de dados (testes legados da agenda mockam só o necessário).
 */
function WaitlistEnrollLoader({
  open,
  onOpenChange,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: Partial<WaitlistEnrollValues>;
}) {
  const enqueue = useEnqueueWaitlist();
  const customersQuery = useCustomers({ activeOnly: false });
  const servicesQuery = useServices();
  const professionalsQuery = useProfessionals({ activeOnly: true });

  async function handleSubmit(values: WaitlistEnrollValues) {
    try {
      const { created } = await enqueue.mutateAsync({
        customer_id: values.customer_id,
        service_id: values.service_id,
        professional_id: values.professional_id || null,
        desired_start_from: values.desired_start_from,
        desired_start_to: values.desired_start_to,
        priority: values.priority,
        expires_at: values.expires_at || null,
      });
      toast.success(created ? messages.enroll.success : messages.enroll.duplicate);
      onOpenChange(false);
    } catch {
      toast.error(messages.enroll.error);
    }
  }

  return (
    <WaitlistEnrollDialog
      open={open}
      onOpenChange={onOpenChange}
      messages={messages}
      customers={(customersQuery.data ?? []).map((c) => ({ id: c.id, name: c.name }))}
      services={(servicesQuery.data ?? []).map((s) => ({ id: s.id, name: s.name }))}
      professionals={(professionalsQuery.data ?? []).map((p) => ({ id: p.id, name: p.name }))}
      submitting={enqueue.isPending}
      initial={initial}
      onSubmit={(values) => void handleSubmit(values)}
    />
  );
}

/**
 * CTA da agenda (RF-08, UX-SPEC B): ao tentar agendar um slot ocupado,
 * oferece "Entrar na lista de espera" (abre o formulário) + link para a
 * página. Sem entitlement, não renderiza nada e não toca em nenhum hook de
 * dados (nenhum request).
 */
export function WaitlistCta({ entitled, initial }: WaitlistCtaProps) {
  const [open, setOpen] = useState(false);

  if (entitled !== true) return null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Clock className="h-4 w-4" aria-hidden="true" />
          {messages.cta.enrollLabel}
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link to="/app/lista-espera">{messages.cta.viewLabel}</Link>
        </Button>
      </div>
      {open ? (
        <WaitlistEnrollLoader open={open} onOpenChange={setOpen} initial={initial} />
      ) : null}
    </>
  );
}
