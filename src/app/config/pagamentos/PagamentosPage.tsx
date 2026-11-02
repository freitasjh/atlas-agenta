import * as React from "react";

import { PageHeader } from "@/components/PageHeader";
import { StatePanel } from "@/components/StatePanel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Copy } from "lucide-react";
import { toast } from "sonner";

import {
  ASAAS_ENVIRONMENTS,
  type AsaasEnvironment,
  useAsaasConfig,
  useSaveAsaasConfig,
  useTestAsaasConnection,
} from "@/hooks/useAsaasConfig";

export function PagamentosPage() {
  const configQuery = useAsaasConfig();
  const testMutation = useTestAsaasConnection();
  const saveMutation = useSaveAsaasConfig();

  const [apiKey, setApiKey] = React.useState("");
  const [environment, setEnvironment] = React.useState<AsaasEnvironment>("sandbox");
  const [tested, setTested] = React.useState<{
    ok: boolean;
    accountId?: string;
    name?: string;
  } | null>(null);
  /**
   * Token de webhook recém-gerado. Vive **só** em estado local da sessão da
   * tela (nunca no cache do React Query, nunca no `select` da config): o
   * servidor devolve o valor uma única vez, e sair da página o descarta.
   */
  const [webhookToken, setWebhookToken] = React.useState<string | null>(null);
  const [confirmRotate, setConfirmRotate] = React.useState(false);

  React.useEffect(() => {
    if (configQuery.data) {
      setEnvironment(configQuery.data.environment);
    }
  }, [configQuery.data]);

  async function handleTest() {
    if (!apiKey.trim()) {
      toast.error("Informe a chave de API.");
      return;
    }
    try {
      const res = await testMutation.mutateAsync({
        apiKey: apiKey.trim(),
        environment,
      });
      setTested({ ok: res.ok, accountId: res.account_id, name: res.name });
      if (res.ok) toast.success("Conexão válida.");
      else toast.error("Chave inválida ou ambiente incorreto.");
    } catch (e) {
      setTested({ ok: false });
      toast.error("Falha ao testar conexão.");
    }
  }

  async function saveNow() {
    if (!apiKey.trim()) {
      toast.error("Informe a chave de API.");
      return;
    }
    try {
      const res = await saveMutation.mutateAsync({
        apiKey: apiKey.trim(),
        environment,
      });
      setApiKey("");
      setTested(null);
      setWebhookToken(res.webhook_token ?? null);
      toast.success("Configuração salva.");
    } catch (e) {
      toast.error("Não foi possível salvar a configuração.");
    }
  }

  /**
   * Salvar rotaciona o token de webhook. Quando já existe config ativa isso
   * quebra a configuração vigente no Asaas, então a rotação é confirmada.
   */
  function handleSave() {
    if (!apiKey.trim()) {
      toast.error("Informe a chave de API.");
      return;
    }
    if (cfg?.active) {
      setConfirmRotate(true);
      return;
    }
    void saveNow();
  }

  async function copyToken() {
    if (!webhookToken) return;
    try {
      await navigator.clipboard.writeText(webhookToken);
      toast.success("Token copiado.");
    } catch {
      toast.error("Não foi possível copiar.");
    }
  }

  if (configQuery.isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader titulo="Pagamentos" descricao="Configuração da integração Asaas (PIX)." />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (configQuery.isError) {
    return (
      <div className="space-y-6">
        <PageHeader titulo="Pagamentos" descricao="Configuração da integração Asaas (PIX)." />
        <StatePanel
          titulo="Não foi possível carregar a configuração"
          descricao="Verifique sua conexão e tente novamente."
        />
      </div>
    );
  }

  const cfg = configQuery.data;

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Pagamentos"
        descricao="Configure sua conta Asaas para cobranças PIX pós-atendimento."
      />

      <Card>
        <CardHeader>
          <CardTitle>Status da integração</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {cfg ? (
            <>
              <p>
                Status:{" "}
                <span className={cfg.active ? "text-green-600" : "text-muted-foreground"}>
                  {cfg.active ? "Ativa" : "Inativa"}
                </span>
              </p>
              <p>Ambiente: {cfg.environment}</p>
              {cfg.asaas_account_id ? <p>Conta Asaas: {cfg.asaas_account_id}</p> : null}
            </>
          ) : (
            <p className="text-muted-foreground">
              Nenhuma configuração salva. Informe sua chave de API abaixo.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Credenciais Asaas</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="apiKey">Chave de API</Label>
            <Input
              id="apiKey"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Cole sua chave de API do Asaas"
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="environment">Ambiente</Label>
            <Select
              value={environment}
              onValueChange={(v) => setEnvironment(v as AsaasEnvironment)}
            >
              <SelectTrigger id="environment">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ASAAS_ENVIRONMENTS.map((env) => (
                  <SelectItem key={env} value={env}>
                    {env === "sandbox" ? "Sandbox (testes)" : "Produção"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleTest()}
              disabled={testMutation.isPending}
            >
              {testMutation.isPending ? "Testando…" : "Testar conexão"}
            </Button>
            <Button
              type="button"
              onClick={() => void handleSave()}
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </div>

          {webhookToken ? (
            <div className="space-y-2 rounded-md border p-4 text-sm">
              <p className="font-medium">
                Token de webhook — exibido uma única vez
              </p>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={webhookToken}
                  aria-label="Token de webhook"
                  className="font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => void copyToken()}
                  aria-label="Copiar token de webhook"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-muted-foreground">
                Cadastre este valor no painel do Asaas como header{" "}
                <code>asaas-access-token</code>. Ele não será exibido
                novamente: salvar de novo gera um novo token e a configuração
                atual no Asaas deixa de funcionar.
              </p>
            </div>
          ) : null}

          {tested ? (
            <p className={tested.ok ? "text-sm text-green-600" : "text-sm text-destructive"}>
              {tested.ok
                ? `Conexão válida${tested.accountId ? ` — conta ${tested.accountId}` : ""}${tested.name ? ` (${tested.name})` : ""}.`
                : "Conexão inválida."}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Webhook</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Configure no painel do Asaas a URL de webhook apontando para a Edge
            Function <code>asaas-webhook</code> do seu projeto Supabase. A
            autenticidade é o token compartilhado, enviado no header{" "}
            <code>asaas-access-token</code> e comparado em tempo constante no
            servidor.
          </p>
          <p>
            Eventos recomendados: <code>PAYMENT_RECEIVED</code>,{" "}
            <code>PAYMENT_CONFIRMED</code>, <code>PAYMENT_OVERDUE</code>.
          </p>
        </CardContent>
      </Card>

      <Dialog
        open={confirmRotate}
        onOpenChange={(next) => {
          if (!next) setConfirmRotate(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Gerar um novo token de webhook?</DialogTitle>
            <DialogDescription>
              Isso vai gerar um novo token de webhook; a configuração atual no
              Asaas deixará de funcionar. Continuar?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmRotate(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => {
                setConfirmRotate(false);
                void saveNow();
              }}
              disabled={saveMutation.isPending}
            >
              Continuar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}