import { useMemo, useState } from "react";

import { EntitlementGate } from "@/components/EntitlementGate";
import { PageHeader } from "@/components/PageHeader";
import { StatePanel } from "@/components/StatePanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePlanEntitlements } from "@/hooks/usePlanEntitlements";
import { useFiscalDocuments, type NfceFiltros } from "@/hooks/useFiscalDocuments";
import {
  FISCAL_STATUSES,
  FISCAL_STATUS_META,
  fiscalMotivoLegivel,
  fiscalStatusVariant,
  type FiscalDocument,
  type FiscalStatus,
} from "@/lib/fiscal";
import { formatCentsToBRL } from "@/lib/money";
import { CancelarNfceDialog } from "@/app/financeiro/nfce/CancelarNfceDialog";
import { DanfeModal } from "@/app/financeiro/nfce/DanfeModal";
import { EmitirNfceSheet } from "@/app/financeiro/nfce/EmitirNfceSheet";

/**
 * Notas fiscais (`/app/financeiro/nfce`, Fase 5 ADR-03). Admin-only pela rota
 * (`RequireRole admin`) + RLS no banco. Gating `nfce`: `false`/`null` → upsell
 * legível e **zero request** a `fiscal_*` (query desabilitada).
 */
export function NfcePage() {
  const entitlements = usePlanEntitlements();
  const entitled = entitlements?.nfce ?? null;
  const liberado = entitled === true;

  const [filtros, setFiltros] = useState<NfceFiltros>({});
  const [buscaTexto, setBuscaTexto] = useState("");
  const documentos = useFiscalDocuments(
    { status: filtros.status, busca: filtros.busca },
    liberado,
  );

  const [sheetAberto, setSheetAberto] = useState(false);
  const [baseReemissao, setBaseReemissao] = useState<FiscalDocument | null>(null);
  const [danfeDoc, setDanfeDoc] = useState<FiscalDocument | null>(null);
  const [cancelDoc, setCancelDoc] = useState<FiscalDocument | null>(null);

  const linhas = useMemo(() => documentos.data ?? [], [documentos.data]);

  function aplicarBusca() {
    setFiltros((atual) => ({ ...atual, busca: buscaTexto.trim() || undefined }));
  }

  function abrirEmissao() {
    setBaseReemissao(null);
    setSheetAberto(true);
  }

  function abrirReemissao(doc: FiscalDocument) {
    setBaseReemissao(doc);
    setSheetAberto(true);
  }

  const conteudo = (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="space-y-2">
          <Label htmlFor="nfce-filtro-status">Estado</Label>
          <select
            id="nfce-filtro-status"
            className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm sm:w-48 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={filtros.status ?? ""}
            onChange={(e) =>
              setFiltros((atual) => ({
                ...atual,
                status: e.target.value === "" ? undefined : (e.target.value as FiscalStatus),
              }))
            }
          >
            <option value="">Todos</option>
            {FISCAL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {FISCAL_STATUS_META[s].rotulo}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2 sm:max-w-xs sm:flex-1">
          <Label htmlFor="nfce-busca">Buscar</Label>
          <div className="flex gap-2">
            <Input
              id="nfce-busca"
              placeholder="Número ou chave"
              autoComplete="off"
              value={buscaTexto}
              onChange={(e) => setBuscaTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  aplicarBusca();
                }
              }}
            />
            <Button type="button" variant="outline" className="min-h-11" onClick={aplicarBusca}>
              Buscar
            </Button>
          </div>
        </div>
      </div>
      {documentos.isPending ? (
        <div className="space-y-2" aria-label="Carregando notas fiscais">
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      ) : documentos.isError ? (
        <StatePanel
          titulo="Não foi possível carregar as notas fiscais"
          descricao="Tente novamente. Se o erro continuar, fale com o responsável pelo plano."
        >
          <Button type="button" variant="outline" className="min-h-11" onClick={() => void documentos.refetch()}>
            Tentar novamente
          </Button>
        </StatePanel>
      ) : linhas.length === 0 ? (
        <StatePanel
          titulo="Nenhuma nota fiscal ainda"
          descricao="Emita a primeira NFC-e de um atendimento ou venda para vê-la aqui."
        >
          {liberado ? (
            <Button type="button" className="min-h-11" onClick={abrirEmissao}>
              Emitir nota
            </Button>
          ) : null}
        </StatePanel>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Número/Série</TableHead>
                <TableHead scope="col">Origem</TableHead>
                <TableHead scope="col" className="text-right">Valor</TableHead>
                <TableHead scope="col">Estado</TableHead>
                <TableHead scope="col">
                  <span className="sr-only">Ações</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map((doc) => {
                const meta = FISCAL_STATUS_META[doc.status];
                const reemitivel = doc.status === "contingencia" || doc.status === "rejeitada";
                return (
                  <TableRow key={doc.id}>
                    <TableCell className="font-medium">
                      {doc.numero ? `nº ${doc.numero}` : "—"}
                      <span className="block text-xs font-normal text-muted-foreground">
                        série {doc.serie ?? "—"}
                      </span>
                    </TableCell>
                    <TableCell>
                      {doc.origem_tipo === "appointment" ? "Atendimento" : "Venda"}
                    </TableCell>
                    <TableCell className="text-right">{formatCentsToBRL(doc.valor_cents)}</TableCell>
                    <TableCell>
                      <Badge variant={fiscalStatusVariant(doc.status)}>{meta.rotulo}</Badge>
                      {!meta.temValorFiscal && doc.status === "contingencia" ? (
                        <span className="block text-xs text-muted-foreground">sem valor fiscal</span>
                      ) : null}
                      {reemitivel ? (
                        <span className="block text-xs text-muted-foreground">
                          {fiscalMotivoLegivel(doc.status, doc.xml ?? null)}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <div className="flex min-h-11 flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="min-h-11"
                          onClick={() => setDanfeDoc(doc)}
                        >
                          DANFE
                        </Button>
                        {reemitivel ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="min-h-11"
                            onClick={() => abrirReemissao(doc)}
                          >
                            Reemitir
                          </Button>
                        ) : null}
                        {meta.permiteCancelar ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="min-h-11"
                            onClick={() => setCancelDoc(doc)}
                          >
                            Cancelar
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );

  if (!liberado) {
    return (
      <div className="space-y-6">
        <PageHeader
          titulo="Notas fiscais"
          descricao="Emita NFC-e dos atendimentos e vendas, com DANFE e XML."
        />
        <EntitlementGate
          entitled={entitled}
          recurso="Notas fiscais"
          acaoLabel="Emitir nota"
        >
          <StatePanel
            titulo="Notas fiscais disponíveis no plano"
            descricao="O conteúdo gravado continua visível aqui. A emissão é liberada nos planos com o recurso fiscal."
          />
        </EntitlementGate>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Notas fiscais"
        descricao="Emita NFC-e dos atendimentos e vendas, com DANFE e XML."
        acoes={
          <Button type="button" className="min-h-11" onClick={abrirEmissao}>
            Emitir nota
          </Button>
        }
      />
      {conteudo}
      <EmitirNfceSheet
        key={baseReemissao?.id ?? "nova"}
        aberto={sheetAberto}
        aoAlterarAberto={setSheetAberto}
        documentoBase={baseReemissao}
      />
      <DanfeModal documento={danfeDoc} aoFechar={() => setDanfeDoc(null)} />
      <CancelarNfceDialog documento={cancelDoc} aoFechar={() => setCancelDoc(null)} />
    </div>
  );
}
