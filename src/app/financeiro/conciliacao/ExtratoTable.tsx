import { Ban, Check, Undo2 } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CONCILIACAO_STATUS_META,
  formatarDataExtrato,
  isDebito,
  valorAssinado,
  type BankLine,
  type ReconciliationLink,
} from "@/lib/conciliacao";

interface ExtratoTableProps {
  linhas: BankLine[];
  selecionadas: ReadonlySet<string>;
  vinculoPorLinha: ReadonlyMap<string, ReconciliationLink>;
  aoAlternar: (lineId: string) => void;
  aoConciliar: (linha: BankLine) => void;
  aoIgnorar: (linha: BankLine) => void;
  aoDesfazer: (linha: BankLine, vinculo: ReconciliationLink) => void;
}

/**
 * Painel esquerdo da conciliação: linhas do extrato com seleção múltipla,
 * valor assinado (crédito/débito), estado e ações por linha. Presentational —
 * toda decisão de negócio (match/undo) vive na página/hooks.
 *
 * Data e descrição dividem a mesma célula para o split de 2 colunas caber em
 * 1280px sem esconder as ações (o `overflow-x-auto` fica só como rede de
 * segurança em telas muito estreitas).
 *
 * A11y: tabela com `<caption>` sr-only, checkbox com `aria-label` por linha,
 * ações com 44px de toque e foco visível (WCAG 2.1 AA).
 */
export function ExtratoTable({
  linhas,
  selecionadas,
  vinculoPorLinha,
  aoAlternar,
  aoConciliar,
  aoIgnorar,
  aoDesfazer,
}: ExtratoTableProps) {
  return (
    <div className="min-w-0 overflow-x-auto rounded-md border">
      <Table>
        <caption className="sr-only">
          Linhas do extrato bancário com data, descrição, valor e estado de conciliação
        </caption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col" className="w-9 px-2">
              <span className="sr-only">Selecionar</span>
            </TableHead>
            <TableHead scope="col" className="px-2">Lançamento</TableHead>
            <TableHead scope="col" className="px-2 text-right">
              Valor
            </TableHead>
            <TableHead scope="col" className="px-2">Estado</TableHead>
            <TableHead scope="col" className="px-2">
              <span className="sr-only">Ações</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {linhas.map((linha) => {
            const meta = CONCILIACAO_STATUS_META[linha.status];
            const vinculo = vinculoPorLinha.get(linha.id);
            const pendente = linha.status === "pendente";
            const podeDesfazer = linha.status === "conciliado" && vinculo?.origem === "match";
            return (
              <TableRow
                key={linha.id}
                data-state={selecionadas.has(linha.id) ? "selected" : undefined}
              >
                <TableCell className="px-2 align-top">
                  <Checkbox
                    checked={selecionadas.has(linha.id)}
                    disabled={!pendente}
                    aria-label={`Selecionar ${linha.descricao} de ${formatarDataExtrato(linha.data)}`}
                    onCheckedChange={() => aoAlternar(linha.id)}
                  />
                </TableCell>
                <TableCell className="max-w-56 px-2">
                  <span className="block text-xs text-muted-foreground">
                    {formatarDataExtrato(linha.data)}
                  </span>
                  <span className="block break-words font-medium">{linha.descricao}</span>
                  {linha.status === "ignorado" && linha.motivo_ignorado ? (
                    <span className="block break-words text-xs font-normal text-muted-foreground">
                      {linha.motivo_ignorado}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell
                  className={`whitespace-nowrap px-2 text-right align-top tabular-nums ${
                    isDebito(linha.valor_cents)
                      ? "text-red-700 dark:text-red-400"
                      : "text-emerald-700 dark:text-emerald-400"
                  }`}
                >
                  {valorAssinado(linha.valor_cents)}
                </TableCell>
                <TableCell className="px-2 align-top">
                  <Badge variant={meta.variant}>{meta.rotulo}</Badge>
                </TableCell>
                <TableCell className="px-2 align-top">
                  <div className="flex gap-1">
                    {pendente ? (
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-11 w-11"
                          aria-label={`Conciliar ${linha.descricao}`}
                          title="Conciliar"
                          onClick={() => aoConciliar(linha)}
                        >
                          <Check className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-11 w-11"
                          aria-label={`Ignorar ${linha.descricao}`}
                          title="Ignorar com motivo"
                          onClick={() => aoIgnorar(linha)}
                        >
                          <Ban className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </>
                    ) : null}
                    {podeDesfazer && vinculo ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-11 w-11"
                        aria-label={`Desfazer conciliação de ${linha.descricao}`}
                        title="Desfazer conciliação"
                        onClick={() => aoDesfazer(linha, vinculo)}
                      >
                        <Undo2 className="h-4 w-4" aria-hidden="true" />
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
  );
}
