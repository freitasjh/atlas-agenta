import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useForm, type FieldPath } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff, Loader2 } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { signupSchema, type SignupInput } from "@/lib/validations/auth";
import {
  CADASTRO_SEGMENT_LABELS,
  CADASTRO_UFS,
  cadastroMessages,
} from "@/auth/cadastro-messages";
import { maskCep, maskDocument, maskPhone } from "@/lib/mask";
import { mapSignUpError } from "@/lib/auth-errors";
import { useSignUp } from "@/hooks/useAuthMutations";
import { useCepLookup } from "@/hooks/useCepLookup";
import { usePostLoginRedirect } from "@/auth/usePostLoginRedirect";
import { getPlan, parsePlanSlug } from "@/lib/plans";

/**
 * Cadastro rico da empresa (ADR-003, parecer ux-designer vinculante SPEC §1).
 *
 * Página única, 4 `<fieldset>` empilhados, 1 submit — sem wizard, sem
 * accordion. Ordem fixa: 1 Empresa → 2 Endereço → 3 Acesso → 4 Responsável
 * (`segment` mora no bloco 4). A conta e a empresa nascem na Edge Function
 * `signup-tenant` (ADR-02), numa transação só do servidor.
 *
 * - Máscara é apresentação (canônico só-dígitos via zod + `buildSignUpBody`);
 *   validação no blur (`mode: "onTouched"`), nunca no keystroke.
 * - ViaCEP é sugestão: pré-preenche logradouro/cidade/UF editáveis e NUNCA
 *   sobrescreve campo que o usuário já editou; falha ⇒ manual + retry; sem
 *   JS de ViaCEP o cadastro manual conclui (RF06).
 * - Erros por campo em pt-BR (catálogo) + error-summary com âncoras quando há
 *   ≥2 erros + foco no 1º inválido.
 * - Em sucesso o próprio hook faz o login com o mesmo e-mail e senha; se o
 *   login automático falhar, a tela vai para `/login` com aviso neutro.
 */

/** Ordem dos campos p/ o summary e p/ o foco no 1º inválido. */
const FIELD_ORDER: FieldPath<SignupInput>[] = [
  "tradeName",
  "legalName",
  "document",
  "phoneEmpresa",
  "addressCep",
  "addressStreet",
  "addressNumber",
  "addressComplement",
  "addressCity",
  "addressState",
  "email",
  "password",
  "confirmPassword",
  "fullName",
  "segment",
];

interface SummaryEntry {
  name: FieldPath<SignupInput>;
  label: string;
  message: string;
}

function SectionHeader({ index, title, description }: { index: string; title: string; description: string }) {
  return (
    <div className="mb-4 border-b pb-3">
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
        >
          {index}
        </span>
        <h2 className="font-display text-lg font-semibold">{title}</h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

export function CadastroPage() {
  const signUp = useSignUp();
  const redirectAfterLogin = usePostLoginRedirect();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // Intenção de plano vinda de `/precos` (`?plano=`). Entrada não confiável:
  // `parsePlanSlug` valida contra o enum e devolve `null` no caso inválido.
  // Puramente apresentacional — não entra em `onSubmit` nem é persistida.
  const plan = parsePlanSlug(params.get("plano"));
  const [serverError, setServerError] = useState<string | null>(null);
  const [summary, setSummary] = useState<SummaryEntry[]>([]);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const feedbackRef = useRef<HTMLParagraphElement>(null);
  // Campos de endereço que o usuário já editou: o retorno do ViaCEP nunca
  // escreve por cima deles (SPEC §1). Ref (não estado): só a fusão lê.
  const userEditedAddressRef = useRef<Set<string>>(new Set());
  const cepLookup = useCepLookup();

  const form = useForm<SignupInput>({
    resolver: zodResolver(signupSchema),
    // Blur-validation, nunca keystroke: valida no blur após o toque e no submit.
    mode: "onTouched",
    defaultValues: {
      tradeName: "",
      legalName: "",
      document: "",
      phoneEmpresa: "",
      addressCep: "",
      addressStreet: "",
      addressNumber: "",
      addressComplement: "",
      addressCity: "",
      addressState: "",
      email: "",
      password: "",
      confirmPassword: "",
      fullName: "",
      segment: undefined,
    },
  });

  const watchedCep = form.watch("addressCep");

  useEffect(() => {
    cepLookup.lookup(watchedCep ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedCep]);

  // Fusão do retorno ViaCEP: só em campo que o usuário NÃO editou. Número
  // sempre manual. O efeito roda quando o lookup conclui; cada campo tocado
  // depois disso já está no ref e é preservado.
  useEffect(() => {
    if (cepLookup.status !== "success" || !cepLookup.address) return;
    const merge: Array<[FieldPath<SignupInput>, string]> = [
      ["addressStreet", cepLookup.address.street],
      ["addressCity", cepLookup.address.city],
      ["addressState", cepLookup.address.state],
    ];
    for (const [name, value] of merge) {
      if (value && !userEditedAddressRef.current.has(name)) {
        form.setValue(name, value as never, { shouldValidate: false });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cepLookup.status, cepLookup.address]);

  useEffect(() => {
    if (serverError) feedbackRef.current?.focus();
  }, [serverError]);

  function focusField(name: FieldPath<SignupInput>) {
    document.getElementById(`cadastro-${name}`)?.focus();
  }

  function handleInvalid(errors: typeof form.formState.errors) {
    const entries: SummaryEntry[] = [];
    for (const name of FIELD_ORDER) {
      const message = errors[name]?.message;
      if (typeof message === "string") {
        entries.push({
          name,
          label:
            cadastroMessages.labels[
              name as keyof typeof cadastroMessages.labels
            ] ?? name,
          message,
        });
      }
    }
    setSummary(entries);
    if (entries.length > 0) focusField(entries[0].name);
  }

  async function onSubmit(values: SignupInput) {
    setServerError(null);
    setSummary([]);
    try {
      const { session } = await signUp.mutateAsync(values);
      if (session) {
        redirectAfterLogin(session);
        return;
      }
      // Empresa criada, sessão não: nada de dado órfão — pede login na tela
      // própria, com aviso neutro (ADR-03).
      navigate("/login", {
        replace: true,
        state: { notice: cadastroMessages.skipAutoLoginNotice },
      });
    } catch (error) {
      setServerError(mapSignUpError(error));
    }
  }

  const msg = cadastroMessages;
  const addressLoading = cepLookup.status === "loading";

  return (
    <Card className="mx-auto w-full max-w-2xl">
      <CardHeader>
        <CardTitle className="font-display text-2xl">{msg.title}</CardTitle>
        <CardDescription>{msg.subtitle}</CardDescription>
      </CardHeader>
      <CardContent>
        {plan ? (
          <div
            aria-labelledby="plano-escolhido-titulo"
            className="mb-6 rounded-md border border-primary/30 bg-primary/5 p-4"
          >
            <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-foreground">
              {msg.chosenPlan}
            </span>
            <p
              id="plano-escolhido-titulo"
              className="mt-2 font-display font-semibold"
            >
              {msg.chosenPlanTitle} {getPlan(plan).nome}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {getPlan(plan).destaques.join(" · ")}
            </p>
          </div>
        ) : null}
        {serverError ? (
          <p
            ref={feedbackRef}
            role="alert"
            tabIndex={-1}
            className="mb-6 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {serverError}
          </p>
        ) : null}
        {summary.length >= 2 ? (
          <div
            role="alert"
            className="mb-6 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
          >
            <p className="font-medium text-destructive">{msg.summary.title}</p>
            <ul className="mt-1 list-disc pl-5">
              {summary.map((entry) => (
                <li key={entry.name}>
                  <button
                    type="button"
                    className="rounded-sm text-left text-destructive underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    onClick={() => focusField(entry.name)}
                  >
                    <span className="sr-only">{msg.summary.goTo}: </span>
                    {entry.label}: {entry.message}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit, handleInvalid)}
            className="space-y-8"
            noValidate
          >
            <fieldset>
              <legend className="sr-only">
                {msg.sections.empresa.legend}
              </legend>
              <SectionHeader
                index="1"
                title={msg.sections.empresa.legend}
                description={msg.sections.empresa.description}
              />
              <p className="mb-4 text-xs text-muted-foreground">
                {msg.lgpdHelper}
              </p>
              <div className="space-y-4">
                <FormField
                  control={form.control}
                  name="tradeName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel htmlFor="cadastro-tradeName">{msg.labels.tradeName}</FormLabel>
                      <FormControl>
                        <Input
                          id="cadastro-tradeName"
                          className="h-11"
                          autoComplete="organization"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="legalName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel htmlFor="cadastro-legalName">{msg.labels.legalNameOptional}</FormLabel>
                      <FormControl>
                        <Input
                          id="cadastro-legalName"
                          className="h-11"
                          autoComplete="organization"
                          {...field}
                          value={field.value ?? ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="document"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel htmlFor="cadastro-document">{msg.labels.document}</FormLabel>
                      <FormControl>
                        <Input
                          id="cadastro-document"
                          className="h-11"
                          inputMode="numeric"
                          autoComplete="off"
                          placeholder={msg.placeholders.document}
                          value={field.value}
                          onChange={(event) => {
                            field.onChange(maskDocument(event.target.value));
                          }}
                          onBlur={field.onBlur}
                          name={field.name}
                          ref={field.ref}
                        />
                      </FormControl>
                      <FormDescription>{msg.helpers.document}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="phoneEmpresa"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel htmlFor="cadastro-phoneEmpresa">{msg.labels.phoneEmpresa}</FormLabel>
                      <FormControl>
                        <Input
                          id="cadastro-phoneEmpresa"
                          className="h-11"
                          inputMode="tel"
                          autoComplete="tel"
                          placeholder={msg.placeholders.phoneEmpresa}
                          value={field.value}
                          onChange={(event) => {
                            field.onChange(maskPhone(event.target.value));
                          }}
                          onBlur={field.onBlur}
                          name={field.name}
                          ref={field.ref}
                        />
                      </FormControl>
                      <FormDescription>
                        {msg.helpers.phoneEmpresa}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </fieldset>

            <fieldset aria-busy={addressLoading}>
              <legend className="sr-only">
                {msg.sections.endereco.legend}
              </legend>
              <SectionHeader
                index="2"
                title={msg.sections.endereco.legend}
                description={msg.sections.endereco.description}
              />
              <div className="space-y-4">
                <FormField
                  control={form.control}
                  name="addressCep"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel htmlFor="cadastro-addressCep">{msg.labels.addressCep}</FormLabel>
                      <FormControl>
                        <Input
                          id="cadastro-addressCep"
                          className="h-11"
                          inputMode="numeric"
                          autoComplete="postal-code"
                          placeholder={msg.placeholders.addressCep}
                          value={field.value}
                          onChange={(event) => {
                            field.onChange(maskCep(event.target.value));
                          }}
                          onBlur={field.onBlur}
                          name={field.name}
                          ref={field.ref}
                        />
                      </FormControl>
                      <FormDescription>{msg.helpers.addressCep}</FormDescription>
                      <div aria-live="polite">
                        {cepLookup.status === "loading" ? (
                          <p className="mt-1 inline-flex items-center gap-2 text-sm text-muted-foreground">
                            <Loader2
                              className="h-4 w-4 animate-spin"
                              aria-hidden="true"
                            />
                            {msg.viaCep.searching}
                          </p>
                        ) : null}
                        {cepLookup.status === "success" ? (
                          <p className="mt-1 text-sm text-muted-foreground">
                            {msg.viaCep.found}
                          </p>
                        ) : null}
                        {cepLookup.status === "not-found" ||
                        cepLookup.status === "error" ? (
                          <div className="mt-1">
                            <p className="text-sm text-destructive">
                              {cepLookup.status === "not-found"
                                ? msg.viaCep.notFound
                                : msg.viaCep.error}
                            </p>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="mt-2 min-h-[44px]"
                              onClick={() => cepLookup.retry()}
                            >
                              {msg.viaCep.retry}
                            </Button>
                          </div>
                        ) : null}
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="addressStreet"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel htmlFor="cadastro-addressStreet">{msg.labels.addressStreet}</FormLabel>
                      <FormControl>
                        <Input
                          id="cadastro-addressStreet"
                          className="h-11"
                          autoComplete="street-address"
                          placeholder={msg.placeholders.addressStreet}
                          value={field.value}
                          onChange={(event) => {
                            userEditedAddressRef.current.add("addressStreet");
                            field.onChange(event);
                          }}
                          onBlur={field.onBlur}
                          name={field.name}
                          ref={field.ref}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="addressNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel htmlFor="cadastro-addressNumber">{msg.labels.addressNumber}</FormLabel>
                        <FormControl>
                          <Input
                            id="cadastro-addressNumber"
                            className="h-11"
                            autoComplete="off"
                            placeholder={msg.placeholders.addressNumber}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="addressComplement"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel htmlFor="cadastro-addressComplement">
                          {msg.labels.addressComplementOptional}
                        </FormLabel>
                        <FormControl>
                          <Input
                            id="cadastro-addressComplement"
                            className="h-11"
                            autoComplete="off"
                            placeholder={msg.placeholders.addressComplement}
                            {...field}
                            value={field.value ?? ""}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="addressCity"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel htmlFor="cadastro-addressCity">{msg.labels.addressCity}</FormLabel>
                        <FormControl>
                          <Input
                            id="cadastro-addressCity"
                            className="h-11"
                            autoComplete="address-level2"
                            placeholder={msg.placeholders.addressCity}
                            value={field.value}
                            onChange={(event) => {
                              userEditedAddressRef.current.add("addressCity");
                              field.onChange(event);
                            }}
                            onBlur={field.onBlur}
                            name={field.name}
                            ref={field.ref}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="addressState"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel htmlFor="cadastro-addressState">{msg.labels.addressState}</FormLabel>
                        <Select
                          value={field.value || undefined}
                          onValueChange={(value) => {
                            userEditedAddressRef.current.add("addressState");
                            field.onChange(value);
                          }}
                        >
                          <FormControl>
                            <SelectTrigger id="cadastro-addressState" className="h-11">
                              <SelectValue
                                placeholder={msg.placeholders.addressState}
                              />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {CADASTRO_UFS.map((uf) => (
                              <SelectItem key={uf} value={uf}>
                                {uf}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            </fieldset>

            <fieldset>
              <legend className="sr-only">
                {msg.sections.acesso.legend}
              </legend>
              <SectionHeader
                index="3"
                title={msg.sections.acesso.legend}
                description={msg.sections.acesso.description}
              />
              <div className="space-y-4">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel htmlFor="cadastro-email">{msg.labels.email}</FormLabel>
                      <FormControl>
                        <Input
                          id="cadastro-email"
                          type="email"
                          className="h-11"
                          autoComplete="email"
                          placeholder={msg.placeholders.email}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel htmlFor="cadastro-password">{msg.labels.password}</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Input
                              id="cadastro-password"
                              type={showPassword ? "text" : "password"}
                              className="h-11 pr-11"
                              autoComplete="new-password"
                              {...field}
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="absolute right-1 top-1/2 h-9 w-9 -translate-y-1/2"
                              aria-pressed={showPassword}
                              aria-label={
                                showPassword
                                  ? msg.hidePassword
                                  : msg.showPassword
                              }
                              onClick={() => setShowPassword((v) => !v)}
                            >
                              {showPassword ? (
                                <EyeOff
                                  className="h-4 w-4"
                                  aria-hidden="true"
                                />
                              ) : (
                                <Eye className="h-4 w-4" aria-hidden="true" />
                              )}
                            </Button>
                          </div>
                        </FormControl>
                        <FormDescription>{msg.helpers.password}</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="confirmPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel htmlFor="cadastro-confirmPassword">{msg.labels.confirmPassword}</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Input
                              id="cadastro-confirmPassword"
                              type={showConfirmPassword ? "text" : "password"}
                              className="h-11 pr-11"
                              autoComplete="new-password"
                              {...field}
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="absolute right-1 top-1/2 h-9 w-9 -translate-y-1/2"
                              aria-pressed={showConfirmPassword}
                              aria-label={
                                showConfirmPassword
                                  ? msg.hidePassword
                                  : msg.showPassword
                              }
                              onClick={() => setShowConfirmPassword((v) => !v)}
                            >
                              {showConfirmPassword ? (
                                <EyeOff
                                  className="h-4 w-4"
                                  aria-hidden="true"
                                />
                              ) : (
                                <Eye className="h-4 w-4" aria-hidden="true" />
                              )}
                            </Button>
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            </fieldset>

            <fieldset>
              <legend className="sr-only">
                {msg.sections.responsavel.legend}
              </legend>
              <SectionHeader
                index="4"
                title={msg.sections.responsavel.legend}
                description={msg.sections.responsavel.description}
              />
              <div className="space-y-4">
                <FormField
                  control={form.control}
                  name="fullName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel htmlFor="cadastro-fullName">{msg.labels.fullName}</FormLabel>
                      <FormControl>
                        <Input
                          id="cadastro-fullName"
                          className="h-11"
                          autoComplete="given-name"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="segment"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel htmlFor="cadastro-segment">{msg.labels.segment}</FormLabel>
                      <Select
                        value={field.value || undefined}
                        onValueChange={field.onChange}
                      >
                        <FormControl>
                          <SelectTrigger id="cadastro-segment" className="h-11">
                            <SelectValue
                              placeholder={msg.placeholders.segment}
                            />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="barbearia">
                            {CADASTRO_SEGMENT_LABELS.barbearia}
                          </SelectItem>
                          <SelectItem value="clinica">
                            {CADASTRO_SEGMENT_LABELS.clinica}
                          </SelectItem>
                          <SelectItem value="salao">
                            {CADASTRO_SEGMENT_LABELS.salao}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </fieldset>

            <Button
              type="submit"
              className="min-h-[44px] w-full"
              disabled={signUp.isPending}
            >
              {signUp.isPending ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden="true" />
                  {msg.submitting}
                </>
              ) : (
                msg.submit
              )}
            </Button>
          </form>
        </Form>
      </CardContent>
      <CardFooter className="text-sm text-muted-foreground">
        <span>
          {msg.hasAccount}{" "}
          <Link
            to="/login"
            className="rounded-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {msg.signIn}
          </Link>
        </span>
      </CardFooter>
    </Card>
  );
}
