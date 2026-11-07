import * as React from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Eye } from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import { useProfessionals } from "@/hooks/useProfessionals";
import { usePermissions } from "@/hooks/usePermissions";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useWorkingHours } from "@/hooks/useWorkingHours";
import { useScheduleValidity } from "@/hooks/useProfessionals";
import { useScheduleOverrides } from "@/hooks/useScheduleOverrides";
import { useAppointmentActivityRange } from "@/hooks/useAppointments";
import { useTenant } from "@/hooks/useTenant";
import { tenantDayOfUtc, todayInTimeZone } from "@/lib/datetime";
import { isActiveAppointmentStatus } from "@/lib/scheduling-status";

import { WeekScheduleForm } from "@/app/config/profissionais/horarios/WeekScheduleForm";
import { ScheduleValidityForm } from "@/app/config/profissionais/horarios/ScheduleValidityForm";
import { ScheduleOverridesSection } from "@/app/config/profissionais/horarios/ScheduleOverridesSection";
import { MonthlyGradeView } from "@/app/config/profissionais/horarios/MonthlyGradeView";
import { OverrideFormDialog } from "@/app/config/profissionais/horarios/OverrideFormDialog";
import { deriveMonthlyGrade } from "@/app/config/profissionais/horarios/deriveMonthlyGrade";

const PROFISSIONAIS_HREF = "/app/config/profissionais";

/** Painel de estado (vazio/erro) desta tela. */
function StatePanel({
  titulo,
  descricao,
  children,
}: {
  titulo: string;
  descricao: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-2xl rounded-lg border border-dashed border-border p-8 text-center">
      <h2 className="font-display text-lg font-semibold tracking-tight">
        {titulo}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{descricao}</p>
      {children ? (
        <div className="mt-4 flex justify-center">{children}</div>
      ) : null}
    </div>
  );
}

function BackLink() {
  return (
    <Button variant="ghost" size="sm" asChild>
      <Link to={PROFISSIONAIS_HREF}>
        <ArrowLeft aria-hidden="true" />
        Voltar aos profissionais
      </Link>
    </Button>
  );
}

/**
 * Grade de horários semanal de um profissional
 * (`/app/config/profissionais/:profissionalId/horarios`). Última tela do
 * cadastro operacional: fecha RF04.
 *
 * RBAC (defesa em profundidade; a trava real é o RLS da ADR-01):
 *   - admin edita a grade de qualquer profissional do tenant;
 *   - professional edita **só a própria** grade (profissional cujo `profile_id`
 *     é o do usuário logado); a de outro profissional abre em **leitura**;
 *   - receptionist: leitura.
 */
export function HorariosPage() {
  const { profissionalId } = useParams<{ profissionalId: string }>();
  const { canEditAnySchedule, canEditOwnSchedule, isAdmin } = usePermissions();

  const professionalsQuery = useProfessionals();
  const { userId, subscriptionStatus } = useCurrentUser();
  const workingHoursQuery = useWorkingHours(profissionalId ?? null);
  const validityQuery = useScheduleValidity(profissionalId ?? null);
  const overridesQuery = useScheduleOverrides(profissionalId ?? null);

  const { data: tenant } = useTenant();
  const timeZone = tenant?.timezone ?? "America/Sao_Paulo";

  // Mês inicial no fuso do tenant (A6), não UTC (virada de mês 23h BRT).
  const [month, setMonth] = React.useState(() => {
    const today = todayInTimeZone(timeZone);
    return today ? today.slice(0, 7) : new Date().toISOString().slice(0, 7);
  });
  const [exceptionDate, setExceptionDate] = React.useState<string | null>(null);
  const [exceptionOpen, setExceptionOpen] = React.useState(false);

  // Contagem de appointments ativos do mês (escopada por profissional+mês,
  // nunca todo o tenant) para o calendário mensal — colunas leves (A6).
  const monthStart = `${month}-01`;
  const monthEnd = (() => {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(Date.UTC(y, m, 0));
    return d.toISOString().slice(0, 10);
  })();
  const monthAppointmentsQuery = useAppointmentActivityRange({
    startDay: monthStart,
    endDay: monthEnd,
    professionalId: profissionalId ?? undefined,
    enabled: !!profissionalId,
  });

  const professional = professionalsQuery.data?.find(
    (item) => item.id === profissionalId,
  );

  const isOwnSchedule =
    !!professional?.profile_id && professional.profile_id === userId;

  // Pode editar: admin (qualquer grade) ou quem edita a própria grade E esta é a
  // sua. Caso contrário, leitura. (A escrita de fato é barrada pelo RLS.)
  const canEdit =
    canEditAnySchedule || (canEditOwnSchedule && isOwnSchedule);

  // Assinatura bloqueado/cancelado nega a escrita operacional (SPEC §3 /
  // seguranca-multitenant): toda a escrita desta tela vira leitura.
  const writeBlockedBySubscription =
    subscriptionStatus === "bloqueado" || subscriptionStatus === "cancelado";
  const effectiveCanEdit = canEdit && !writeBlockedBySubscription;

  const isLoading =
    professionalsQuery.isLoading || workingHoursQuery.isLoading;

  const isError = professionalsQuery.isError || workingHoursQuery.isError;

  return (
    <div className="space-y-6">
      <div>
        <BackLink />
        <PageHeader
          className="mt-3"
          titulo={
            professional
              ? `Horários — ${professional.name}`
              : "Horários"
          }
          descricao="Defina a grade semanal: ligue os dias de atendimento e informe a janela de cada um (com intervalo opcional)."
        />
      </div>

      {isLoading ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : isError ? (
        <StatePanel
          titulo="Não foi possível carregar a grade"
          descricao="Verifique sua conexão e tente novamente."
        >
          <Button
            variant="outline"
            onClick={() => {
              void professionalsQuery.refetch();
              void workingHoursQuery.refetch();
            }}
          >
            Tentar novamente
          </Button>
        </StatePanel>
      ) : !professional ? (
        <StatePanel
          titulo="Profissional não encontrado"
          descricao="Ele pode ter sido removido ou o endereço está incorreto."
        >
          <Button variant="outline" asChild>
            <Link to={PROFISSIONAIS_HREF}>Voltar aos profissionais</Link>
          </Button>
        </StatePanel>
      ) : (
        <>
          {!canEdit ? (
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
              <Eye className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                Você está vendo esta grade em modo leitura. Apenas o próprio
                profissional ou um administrador pode editá-la.
              </span>
            </div>
          ) : null}

          {writeBlockedBySubscription ? (
            <div
              role="alert"
              className="rounded-md border border-amber-600/40 bg-amber-50 p-3 text-sm text-amber-900"
            >
              A assinatura está {subscriptionStatus} — a escrita operacional
              está bloqueada. Regularize a assinatura para voltar a editar.
            </div>
          ) : null}

          <WeekScheduleForm
            professionalId={professional.id}
            workingHours={workingHoursQuery.data ?? []}
            overrides={overridesQuery.data ?? []}
            readOnly={!effectiveCanEdit}
            writeBlockedBySubscription={writeBlockedBySubscription}
          />

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Vigência da agenda</CardTitle>
              <CardDescription>
                Período em que o profissional atende e o passo dos horários
                oferecidos. Só o administrador edita.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScheduleValidityForm
                professionalId={professional.id}
                readOnly={!isAdmin}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Exceções por data</CardTitle>
              <CardDescription>
                Folgas, feriados e horários atípicos que sobrepõem a grade
                semanal em dias específicos.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScheduleOverridesSection
                professionalId={professional.id}
                readOnly={!effectiveCanEdit}
              />
            </CardContent>
          </Card>

          <MonthlyGradeView
            days={deriveMonthlyGrade({
              month,
              workingHours: workingHoursQuery.data ?? [],
              overrides: overridesQuery.data ?? [],
              scheduleStartDate:
                validityQuery.data?.schedule_start_date ?? null,
              scheduleEndDate: validityQuery.data?.schedule_end_date ?? null,
            })}
            month={month}
            validityLabel={
              validityQuery.data
                ? `${
                    validityQuery.data.schedule_start_date
                      ? `a partir de ${validityQuery.data.schedule_start_date}`
                      : "sem início"
                  } · ${
                    validityQuery.data.schedule_end_date
                      ? `até ${validityQuery.data.schedule_end_date}`
                      : "sem término"
                  }`
                : "sem início · sem término"
            }
            isLoading={
              workingHoursQuery.isLoading ||
              overridesQuery.isLoading ||
              validityQuery.isLoading
            }
            isError={
              workingHoursQuery.isError ||
              overridesQuery.isError ||
              validityQuery.isError
            }
            onRetry={() => {
              void workingHoursQuery.refetch();
              void overridesQuery.refetch();
              void validityQuery.refetch();
            }}
            appointmentCounts={(() => {
              const counts = new Map<string, number>();
              for (const appointment of monthAppointmentsQuery.data ?? []) {
                if (!isActiveAppointmentStatus(appointment.status)) continue;
                // Dia de parede no fuso do tenant (A6) — o slice UTC erra de
                // dia nas horas de madrugada (02:30 UTC = 23:30 BRT prévio).
                const day = tenantDayOfUtc(appointment.starts_at, timeZone);
                if (!day) continue;
                counts.set(day, (counts.get(day) ?? 0) + 1);
              }
              return counts;
            })()}
            readOnly={!effectiveCanEdit}
            onMonthChange={setMonth}
            onDayClick={(date) => {
              setExceptionDate(date);
              setExceptionOpen(true);
            }}
          />

          {effectiveCanEdit ? (
            <OverrideFormDialog
              professionalId={professional.id}
              open={exceptionOpen}
              onOpenChange={setExceptionOpen}
              override={
                overridesQuery.data?.find(
                  (item) => item.override_date === exceptionDate,
                ) ?? null
              }
              initialDate={exceptionDate ?? undefined}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
