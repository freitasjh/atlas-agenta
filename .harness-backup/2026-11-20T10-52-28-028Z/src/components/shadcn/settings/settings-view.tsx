import { useCallback, useEffect, useMemo, useState } from "react"
import { Settings } from "lucide-react"
import { toast } from "sonner"
import { SettingsNav } from "./settings-nav"
import { SettingsSaveBar } from "./settings-save-bar"
import { AdvancedSection } from "./settings-advanced"
import {
  AppearanceSection,
  BillingSection,
  FinancialSection,
  GeneralSection,
  IntegrationsSection,
  NotificationsSection,
  PaymentsSection,
  PdvSection,
  SecuritySection,
  TeamSection,
  type SectionProps,
} from "./settings-sections"
import {
  DEFAULT_SETTINGS,
  type SettingsSectionId,
  type SettingsValues,
} from "./settings-types"

export interface SettingsViewProps {
  initialValues?: SettingsValues
  initialSection?: SettingsSectionId
  onSave?: (values: SettingsValues) => void | Promise<void>
}

export function SettingsView({
  initialValues = DEFAULT_SETTINGS,
  initialSection = "general",
  onSave,
}: SettingsViewProps) {
  const [saved, setSaved] = useState<SettingsValues>(initialValues)
  const [draft, setDraft] = useState<SettingsValues>(initialValues)
  const [section, setSection] = useState<SettingsSectionId>(initialSection)
  const [saving, setSaving] = useState(false)

  const changedKeys = useMemo(
    () =>
      (Object.keys(draft) as (keyof SettingsValues)[]).filter(
        (k) => JSON.stringify(draft[k]) !== JSON.stringify(saved[k])
      ),
    [draft, saved]
  )
  const dirty = changedKeys.length > 0

  // Protege contra fechar/recarregar a aba com alterações pendentes
  useEffect(() => {
    if (!dirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [dirty])

  const handleChange = useCallback<SectionProps["onChange"]>((key, value) => {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave?.(draft)
      await new Promise((r) => setTimeout(r, 450))
      setSaved(draft)
      toast.success("Configurações salvas com sucesso.")
    } catch {
      toast.error("Não foi possível salvar. Tente novamente.")
    } finally {
      setSaving(false)
    }
  }

  const handleDiscard = () => {
    setDraft(saved)
    toast.info("Alterações descartadas.")
  }

  const handleReset = () => {
    setDraft(DEFAULT_SETTINGS)
    setSaved(DEFAULT_SETTINGS)
  }

  const sectionProps: SectionProps = { values: draft, onChange: handleChange }

  return (
    <div className="flex w-full flex-col gap-5 px-4 pb-24 lg:px-6">
      <div className="flex flex-col gap-1 border-b border-border/70 pb-4">
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-foreground sm:text-2xl">
          <Settings className="size-6 text-primary" />
          Configurações
        </h1>
        <p className="text-xs text-muted-foreground">
          Painel de controle do workspace: empresa, operação, acesso e integrações em um só lugar.
        </p>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <SettingsNav active={section} onSelect={setSection} />

        <div className="min-w-0 max-w-3xl">
          {section === "general" && <GeneralSection {...sectionProps} />}
          {section === "appearance" && <AppearanceSection {...sectionProps} />}
          {section === "financial" && <FinancialSection {...sectionProps} />}
          {section === "pdv" && <PdvSection {...sectionProps} />}
          {section === "payments" && <PaymentsSection {...sectionProps} />}
          {section === "team" && <TeamSection {...sectionProps} />}
          {section === "security" && <SecuritySection {...sectionProps} />}
          {section === "notifications" && <NotificationsSection {...sectionProps} />}
          {section === "integrations" && <IntegrationsSection {...sectionProps} />}
          {section === "billing" && <BillingSection />}
          {section === "advanced" && <AdvancedSection onReset={handleReset} />}
        </div>
      </div>

      <SettingsSaveBar
        visible={dirty}
        changedCount={changedKeys.length}
        saving={saving}
        onSave={handleSave}
        onDiscard={handleDiscard}
      />
    </div>
  )
}

