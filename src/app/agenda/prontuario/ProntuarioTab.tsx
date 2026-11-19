import { useEffect, useRef, useState, useCallback } from "react";
import { Link } from "react-router-dom";

import { StatePanel } from "@/components/StatePanel";
import { Button } from "@/components/ui/button";
import type { Role } from "@/types/domain";
import { BannerAlergia } from "@/app/agenda/prontuario/BannerAlergia";
import { AnamneseWizard } from "@/app/agenda/prontuario/AnamneseWizard";
import { FichaAtual } from "@/app/agenda/prontuario/FichaAtual";
import { EvolucaoTimeline } from "@/app/agenda/prontuario/EvolucaoTimeline";
import { FotosAntesDepois } from "@/app/agenda/prontuario/FotosAntesDepois";
import { MapaFacial } from "@/app/agenda/prontuario/MapaFacial";
import { TermoConsentimento } from "@/app/agenda/prontuario/TermoConsentimento";
import { currentRecord } from "@/app/agenda/prontuario/types";
import { useClinicalRecords } from "@/app/agenda/prontuario/useClinicalRecords";

interface ProntuarioTabProps {
  appointmentId: string | null;
  customerId: string | null;
  role: Role | null;
  /** Entitlement `prontuario` (ADR-01): `null` = não resolvido, degrada. */
  entitled: boolean | null;
  /** Aba ativa: sem request sensível com a aba fechada ou sem entitlement. */
  active: boolean;
  timeZone: string;
}

/**
 * 4ª aba do Drawer (G4/RF-01..RF-06): banner de alergias (todos os perfis) +
 * ficha vigente + evolução append-only (só perfil clínico). Sem entitlement
 * não dispara request sensível: mostra o shell + upsell, nunca hide
 * silencioso. Recepção vê só o banner; admin/professional veem tudo (o
 * recorte por profissional é do RLS; aqui é defesa em profundidade).
 */
export function ProntuarioTab({
  appointmentId,
  customerId,
  role,
  entitled,
  active,
  timeZone,
}: ProntuarioTabProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (active) headingRef.current?.focus();
  }, [active ]);

  const queryEnabled =
    active && entitled === true && appointmentId !== null;
  const recordsQuery = useClinicalRecords({
    appointmentId,
    enabled: queryEnabled,
  });
  const records = recordsQuery.data;
  const head = records ? currentRecord(records) : null;

  const canViewFull = role === "admin" || role === "professional";
  const canWrite = canViewFull && entitled === true;
  const [consented, setConsented] = useState(false);
  const handleConsentChange = useCallback((next: boolean) => {
    setConsented(next);
  }, []);

  if (appointmentId === null || customerId === null) {
    return (
      <p className="text-sm text-muted-foreground">
        O prontuário fica disponível após salvar o agendamento.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <h3
        ref={headingRef}
        tabIndex={-1}
        className="text-base font-semibold outline-none"
      >
        Prontuário
      </h3>

      {entitled === true ? null : (
        <StatePanel
          titulo="Prontuário: recurso não incluído no plano atual"
          descricao="Seu histórico está preservado e volta a aparecer ao incluir o recurso. Para criar ou editar, fale com o responsável pelo plano."
        >
          <Button asChild>
            <Link to="/precos">Ver planos</Link>
          </Button>
        </StatePanel>
      )}

      <BannerAlergia
        allergies={head?.allergies}
        isLoading={recordsQuery.isLoading && queryEnabled}
        unavailable={entitled !== true}
      />

      {canViewFull ? (
        <>
          {head !== null || records === undefined ? (
            <FichaAtual
              record={head}
              isLoading={recordsQuery.isLoading && queryEnabled}
              canWrite={canWrite}
              appointmentId={appointmentId}
              customerId={customerId}
            />
          ) : canWrite ? (
            <AnamneseWizard
              key={appointmentId}
              appointmentId={appointmentId}
              customerId={customerId}
            />
          ) : null}
          <EvolucaoTimeline
            records={records}
            isLoading={recordsQuery.isLoading && queryEnabled}
            canWrite={canWrite}
            appointmentId={appointmentId}
            customerId={customerId}
            headId={head?.id ?? null}
            timeZone={timeZone}
          />
          {/* ADR-05 (ordem UX-SPEC T1: fotos → mapa → termo). Só perfil clínico;
              recepção não vê conteúdo clínico. */}
          <FotosAntesDepois
            customerId={customerId}
            appointmentId={appointmentId}
            timeZone={timeZone}
            consented={consented}
            canWrite={canWrite}
            enabled={queryEnabled && canViewFull}
          />
          <MapaFacial
            customerId={customerId}
            appointmentId={appointmentId}
            canWrite={canWrite}
            enabled={queryEnabled && canViewFull}
          />
          <TermoConsentimento
            customerId={customerId}
            timeZone={timeZone}
            canWrite={canWrite}
            enabled={queryEnabled && canViewFull}
            onStatusChange={handleConsentChange}
          />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Ficha e evolução são restritas ao perfil clínico.
        </p>
      )}
    </div>
  );
}
