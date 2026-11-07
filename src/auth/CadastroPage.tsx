import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useForm, type FieldPath } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

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
 * Cadastro rico da empresa em Etapas (Multi-step Wizard).
 *
 * 4 etapas organizadas progressivamente para eliminar sobrecarga cognitiva e scroll vertical:
 *  1. Empresa (Identificação comercial)
 *  2. Endereço (Localização com busca ViaCEP integrada)
 *  3. Acesso (Credenciais de login)
 *  4. Responsável (Dados do proprietário da conta e segmento)
 *
 * A submissão continua sendo ATÔMICA e ÚNICA para a Edge Function `signup-tenant` (ADR-02).
 * Os 4 `<fieldset>` permanecem no DOM para preservar integridade de formulário e a11y.
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

const STEPS = [
  { step: 1, label: "Empresa", short: "Empresa" },
  { step: 2, label: "Endereço", short: "Endereço" },
  { step: 3, label: "Acesso", short: "Acesso" },
  { step: 4, label: "Responsável", short: "Responsável" },
] as const;

const STEP_FIELDS: Record<number, FieldPath<SignupInput>[]> = {
  1: ["tradeName", "legalName", "document", "phoneEmpresa"],
  2: [
    "addressCep",
    "addressStreet",
    "addressNumber",
    "addressComplement",
    "addressCity",
    "addressState",
  ],
  3: ["email", "password", "confirmPassword"],
  4: ["fullName", "segment"],
};

function getStepForField(name: FieldPath<SignupInput>): number {
  if (STEP_FIELDS[1].includes(name)) return 1;
  if (STEP_FIELDS[2].includes(name)) return 2;
  if (STEP_FIELDS[3].includes(name)) return 3;
  return 4;
}

interface SummaryEntry {
  name: FieldPath<SignupInput>;
  label: string;
  message: string;
}

function SectionHeader({
  index,
  title,
  description,
}: {
  index: string;
  title: string;
  description: string;
}) {
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
  const plan = parsePlanSlug(params.get("plano"));
  const [currentStep, setCurrentStep] = useState(1);
  const [serverError, setServerError] = useState<string | null>(null);
  const [summary, setSummary] = useState<SummaryEntry[]>([]);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const feedbackRef = useRef<HTMLParagraphElement>(null);
  const userEditedAddressRef = useRef<Set<string>>(new Set());
  const cepLookup = useCepLookup();

  const form = useForm<SignupInput>({
    resolver: zodResolver(signupSchema),
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
    const targetStep = getStepForField(name);
    setCurrentStep(targetStep);
    setTimeout(() => {
      document.getElementById(`cadastro-${name}`)?.focus();
    }, 0);
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

  async function handleNextStep() {
    const fields = STEP_FIELDS[currentStep];
    const isValid = await form.trigger(fields, { shouldFocus: true });
    if (isValid) {
      setSummary([]);
      setCurrentStep((prev) => Math.min(prev + 1, 4));
    }
  }

  function handlePrevStep() {
    setSummary([]);
    setCurrentStep((prev) => Math.max(prev - 1, 1));
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

        {/* Stepper Navigation Indicator */}
        <nav aria-label="Etapas do cadastro" className="mb-6">
          <ol className="grid grid-cols-4 gap-2">
            {STEPS.map((s) => {
              const isCurrent = s.step === currentStep;
              const isPast = s.step < currentStep;
              return (
                <li key={s.step} className="flex flex-col items-center">
                  <button
                    type="button"
                    disabled={!isPast}
                    onClick={() => isPast && setCurrentStep(s.step)}
                    aria-current={isCurrent ? "step" : undefined}
                    className={cn(
                      "group flex w-full flex-col items-center gap-1.5 text-center transition-colors",
                      isPast && "cursor-pointer",
                      !isPast && "cursor-default",
                    )}
                  >
                    <div className="flex w-full items-center">
                      <span
                        className={cn(
                          "h-1 w-full rounded-full transition-colors",
                          s.step === 1 ? "invisible" : "",
                          isPast || isCurrent ? "bg-primary" : "bg-muted",
                        )}
                      />
                      <span
                        className={cn(
                          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-all",
                          isCurrent &&
                            "bg-primary text-primary-foreground ring-2 ring-primary ring-offset-2 ring-offset-background",
                          isPast &&
                            "bg-primary/20 text-primary group-hover:bg-primary/30",
                          !isCurrent &&
                            !isPast &&
                            "bg-muted text-muted-foreground",
                        )}
                      >
                        {isPast ? (
                          <Check className="h-3.5 w-3.5" aria-hidden="true" />
                        ) : (
                          s.step
                        )}
                      </span>
                      <span
                        className={cn(
                          "h-1 w-full rounded-full transition-colors",
                          s.step === 4 ? "invisible" : "",
                          isPast ? "bg-primary" : "bg-muted",
                        )}
                      />
                    </div>
                    <span
                      className={cn(
                        "hidden sm:inline text-xs font-medium truncate max-w-full",
                        isCurrent && "font-semibold text-foreground",
                        isPast &&
                          "text-muted-foreground group-hover:text-foreground",
                        !isCurrent && !isPast && "text-muted-foreground/60",
                      )}
                    >
                      {s.label}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="mt-2 text-center text-xs text-muted-foreground sm:hidden">
            Etapa {currentStep} de 4:{" "}
            <span className="font-medium text-foreground">
              {STEPS[currentStep - 1].label}
            </span>
          </div>
        </nav>

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
            className="space-y-6"
            noValidate
          >
            {/* Bloco 1: Empresa */}
            <fieldset
              className={
                currentStep === 1
                  ? "block space-y-4 animate-in fade-in-50 duration-150"
                  : "hidden"
              }
            >
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
                      <FormLabel htmlFor="cadastro-tradeName">
                        {msg.labels.tradeName}
                      </FormLabel>
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
                      <FormLabel htmlFor="cadastro-legalName">
                        {msg.labels.legalNameOptional}
                      </FormLabel>
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
                      <FormLabel htmlFor="cadastro-document">
                        {msg.labels.document}
                      </FormLabel>
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
                      <FormLabel htmlFor="cadastro-phoneEmpresa">
                        {msg.labels.phoneEmpresa}
                      </FormLabel>
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

            {/* Bloco 2: Endereço */}
            <fieldset
              aria-busy={addressLoading}
              className={
                currentStep === 2
                  ? "block space-y-4 animate-in fade-in-50 duration-150"
                  : "hidden"
              }
            >
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
                      <FormLabel htmlFor="cadastro-addressCep">
                        {msg.labels.addressCep}
                      </FormLabel>
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
                      <FormLabel htmlFor="cadastro-addressStreet">
                        {msg.labels.addressStreet}
                      </FormLabel>
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
                        <FormLabel htmlFor="cadastro-addressNumber">
                          {msg.labels.addressNumber}
                        </FormLabel>
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
                        <FormLabel htmlFor="cadastro-addressCity">
                          {msg.labels.addressCity}
                        </FormLabel>
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
                        <FormLabel htmlFor="cadastro-addressState">
                          {msg.labels.addressState}
                        </FormLabel>
                        <Select
                          value={field.value || undefined}
                          onValueChange={(value) => {
                            userEditedAddressRef.current.add("addressState");
                            field.onChange(value);
                          }}
                        >
                          <FormControl>
                            <SelectTrigger
                              id="cadastro-addressState"
                              className="h-11"
                            >
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

            {/* Bloco 3: Acesso */}
            <fieldset
              className={
                currentStep === 3
                  ? "block space-y-4 animate-in fade-in-50 duration-150"
                  : "hidden"
              }
            >
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
                      <FormLabel htmlFor="cadastro-email">
                        {msg.labels.email}
                      </FormLabel>
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
                        <FormLabel htmlFor="cadastro-password">
                          {msg.labels.password}
                        </FormLabel>
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
                        <FormLabel htmlFor="cadastro-confirmPassword">
                          {msg.labels.confirmPassword}
                        </FormLabel>
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

            {/* Bloco 4: Responsável */}
            <fieldset
              className={
                currentStep === 4
                  ? "block space-y-4 animate-in fade-in-50 duration-150"
                  : "hidden"
              }
            >
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
                      <FormLabel htmlFor="cadastro-fullName">
                        {msg.labels.fullName}
                      </FormLabel>
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
                      <FormLabel htmlFor="cadastro-segment">
                        {msg.labels.segment}
                      </FormLabel>
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

            {/* Ações de Navegação dos Steps */}
            <div className="flex flex-col-reverse sm:flex-row items-center justify-between gap-3 pt-4 border-t border-border">
              {currentStep > 1 ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handlePrevStep}
                  className="min-h-[44px] w-full sm:w-auto"
                >
                  <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
                  Voltar
                </Button>
              ) : (
                <div className="hidden sm:block" />
              )}

              {currentStep < 4 ? (
                <Button
                  type="button"
                  onClick={handleNextStep}
                  className="min-h-[44px] w-full sm:w-auto sm:min-w-[160px]"
                >
                  Avançar
                  <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                </Button>
              ) : null}

              <Button
                type="submit"
                className={cn(
                  "min-h-[44px] w-full sm:w-auto sm:min-w-[160px]",
                  currentStep === 4 ? "inline-flex" : "hidden",
                )}
                disabled={signUp.isPending}
              >
                {signUp.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                    {msg.submitting}
                  </>
                ) : (
                  msg.submit
                )}
              </Button>
            </div>
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
