// Campanhas (ADR-05 Fase 4): criação, segmentação, opt-in, dispatch, métricas, RLS.
// Cobertura: RF-12 (templates), RF-13 (criação+preview), RF-14 (execução+métricas),
// RF-15 (consentimento), RF-16 (gating por entitlement).
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serviceClient } from "../helpers/clients.ts";
import { createTenantMember, createCommonUser, deleteTestUsers, tenantIdOf, type TestUser } from "../helpers/users.ts";

let adminA: TestUser;
let tenantA: string;
let receptionistA: TestUser;
let adminB: TestUser;
let tenantB: string;

let serviceId: string;
let professionalId: string;
let customerOptIn: string;
let customerNoOpt: string;
let customerOldInactive: string;

let templateId: string;
let campaignId: string;

function must<T>(label: string, result: { data: unknown; error: { code?: string } | null }): T {
  if (result.error || result.data === null || result.data === undefined) {
    throw new Error(`Fixture ${label} falhou (código ${result.error?.code ?? "vazio"}).`);
  }
  return result.data as T;
}

async function setPlanPremium(tenantId: string): Promise<void> {
  const { error } = await serviceClient().from("tenants").update({ plan: "premium" }).eq("id", tenantId);
  if (error) throw new Error(`Upgrade de plano falhou (código ${error.code ?? "vazio"}).`);
}

beforeAll(async () => {
  adminA = await createCommonUser("campaign-a");
  tenantA = await tenantIdOf(adminA.id);
  receptionistA = await createTenantMember(tenantA, "receptionist", "campaign-recep");
  adminB = await createCommonUser("campaign-b");
  tenantB = await tenantIdOf(adminB.id);

  // Entitlement `campanhas` só em premium/enterprise (seed da migration).
  await setPlanPremium(tenantA);

  const admin = serviceClient();
  const suffix = randomUUID().slice(0, 8);

  const svc = must<{ id: string }>(
    "service",
    await admin
      .from("services")
      .insert({ tenant_id: tenantA, name: `Corte ${suffix}`, duration_minutes: 30, price_cents: 8000 })
      .select("id")
      .single(),
  );
  serviceId = svc.id;

  const prof = must<{ id: string }>(
    "professional",
    await admin.from("professionals").insert({ tenant_id: tenantA, name: `Prof ${suffix}` }).select("id").single(),
  );
  professionalId = prof.id;

  const mkCustomer = async (over: Record<string, unknown>): Promise<string> => {
    const row = must<{ id: string }>(
      "customer",
      await admin
        .from("customers")
        .insert({ tenant_id: tenantA, name: `Cliente ${suffix}`, phone: `119${Math.floor(10000000 + Math.random() * 89999999)}`, ...over })
        .select("id")
        .single(),
    );
    return row.id;
  };

  // Elegível: opt-in + tag win-back + último atendimento há 60 dias.
  customerOptIn = await mkCustomer({ whatsapp_opt_in: true, tags: ["win-back"] });
  // Excluído: sem opt-in, mesmo perfil.
  customerNoOpt = await mkCustomer({ whatsapp_opt_in: false, tags: ["win-back"] });
  // Fora do segmento: opt-in mas visita recente (sem tag).
  customerOldInactive = await mkCustomer({ whatsapp_opt_in: true, tags: [] });

  const oldStart = new Date(Date.now() - 60 * 24 * 3600 * 1000);
  const mkAppt = async (customerId: string, status: string, startsAt: Date) => {
    const endsAt = new Date(startsAt.getTime() + 30 * 60_000);
    must(
      "appointment",
      await admin
        .from("appointments")
        .insert({
          tenant_id: tenantA,
          customer_id: customerId,
          professional_id: professionalId,
          service_id: serviceId,
          starts_at: startsAt.toISOString(),
          ends_at: endsAt.toISOString(),
          price_cents: 8000,
          status,
        })
        .select("id")
        .single(),
    );
  };
  await mkAppt(customerOptIn, "concluido", oldStart);
  await mkAppt(customerNoOpt, "concluido", oldStart);
  await mkAppt(customerOldInactive, "concluido", new Date(Date.now() - 2 * 24 * 3600 * 1000));

  const tpl = must<{ id: string }>(
    "template",
    await adminA.client
      .from("campaign_templates")
      .insert({
        name: `Retorno ${suffix}`,
        body: "Olá {nome}, sentimos sua falta na {empresa}!",
        channel: "whatsapp",
        approved_outside_24h: true,
      })
      .select("id")
      .single(),
  );
  templateId = tpl.id;

  const camp = must<{ id: string }>(
    "campaign",
    await adminA.client
      .from("campaigns")
      .insert({
        name: `Win-back ${suffix}`,
        preset: "win_back",
        template_id: templateId,
        segment: { tags: ["win-back"], last_visit_before_days: 30, service_ids: [serviceId] },
        scheduled_at: new Date().toISOString(),
        status: "agendada",
      })
      .select("id")
      .single(),
  );
  campaignId = camp.id;
});

afterAll(async () => {
  const svc = serviceClient();
  for (const tenantId of [tenantA, tenantB].filter(Boolean)) {
    await svc.from("campaign_sends").delete().eq("tenant_id", tenantId);
    await svc.from("campaigns").delete().eq("tenant_id", tenantId);
    await svc.from("campaign_templates").delete().eq("tenant_id", tenantId);
  }
  await deleteTestUsers();
});

describe("RF-12 templates: biblioteca por tenant", () => {
  it("recepção lê mas não escreve template", async () => {
    const { data, error } = await receptionistA.client.from("campaign_templates").select("id");
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);

    const { error: writeError } = await receptionistA.client
      .from("campaign_templates")
      .insert({ name: "x", body: "y" });
    expect(writeError).not.toBeNull();
  });

  it("tenant B não enxerga templates do tenant A (RLS)", async () => {
    const { data, error } = await adminB.client.from("campaign_templates").select("id");
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });
});

describe("RF-13 criação e preview de segmentação", () => {
  it("preview conta elegíveis e excluídos por opt-in", async () => {
    const { data, error } = await adminA.client.rpc("campaign_preview_segment", {
      p_campaign_id: campaignId,
    });
    expect(error).toBeNull();
    const preview = data as { total: number; eligible: number; excluded_opt_in: number };
    expect(preview.total).toBe(2);
    expect(preview.eligible).toBe(1);
    expect(preview.excluded_opt_in).toBe(1);
  });

  it("recepção pode rodar preview", async () => {
    const { error } = await receptionistA.client.rpc("campaign_preview_segment", {
      p_campaign_id: campaignId,
    });
    expect(error).toBeNull();
  });

  it("campanha de outro tenant não existe para o tenant B", async () => {
    const { error } = await adminB.client.rpc("campaign_preview_segment", {
      p_campaign_id: campaignId,
    });
    expect(error?.code).toBe("PT404");
  });
});

describe("RF-15 consentimento e idempotência do enqueue", () => {
  it("enqueue cria queued só p/ opt-in e marca excluded_opt_in", async () => {
    const { data, error } = await adminA.client.rpc("campaign_enqueue", {
      p_campaign_id: campaignId,
    });
    expect(error).toBeNull();
    const result = data as { queued: number; excluded_opt_in: number; replayed: boolean; status: string };
    expect(result.queued).toBe(1);
    expect(result.excluded_opt_in).toBe(1);
    expect(result.replayed).toBe(false);
    expect(result.status).toBe("enviando");
  });

  it("replay do enqueue não duplica (idempotente)", async () => {
    const { data, error } = await adminA.client.rpc("campaign_enqueue", {
      p_campaign_id: campaignId,
    });
    expect(error).toBeNull();
    const result = data as { queued: number; excluded_opt_in: number; replayed: boolean };
    expect(result.replayed).toBe(true);

    const { count } = await serviceClient()
      .from("campaign_sends")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantA)
      .eq("campaign_id", campaignId);
    expect(count).toBe(2);
  });

  it("recepção não pode executar enqueue (só admin)", async () => {
    const { error } = await receptionistA.client.rpc("campaign_enqueue", {
      p_campaign_id: campaignId,
    });
    expect(error?.code).toBe("PT403");
  });
});

describe("RF-14 execução e métricas", () => {
  it("claim reserva queued e release de stale volta p/ fila", async () => {
    const svc = serviceClient();
    const { data: claimed, error } = await svc.rpc("campaign_claim_sends", {
      p_campaign_id: campaignId,
      p_limit: 10,
    });
    expect(error).toBeNull();
    expect((claimed as unknown[]).length).toBe(1);

    const second = await svc.rpc("campaign_claim_sends", {
      p_campaign_id: campaignId,
      p_limit: 10,
    });
    expect((second.data as unknown[]).length).toBe(0);

    const released = await svc.rpc("campaign_release_stale_claims", {
      p_campaign_id: campaignId,
      p_older_than_minutes: 0,
    });
    // p_older_than_minutes=0 = release imediato (handler chama com 0 quando
    // a instância está desconectada): o claim recém-criado é liberado.
    expect(Number(released.data)).toBe(1);

    // Re-claim para testar a janela de 15min.
    const reclaimed = await svc.rpc("campaign_claim_sends", {
      p_campaign_id: campaignId,
      p_limit: 10,
    });
    expect((reclaimed.data as unknown[]).length).toBe(1);

    // Envelhece o claim e libera.
    await svc.from("campaign_sends").update({ claimed_at: new Date(Date.now() - 3600_000).toISOString() }).eq("campaign_id", campaignId);
    const released2 = await svc.rpc("campaign_release_stale_claims", {
      p_campaign_id: campaignId,
      p_older_than_minutes: 15,
    });
    expect(Number(released2.data)).toBe(1);
  });

  it("register_status avança o funil e replay não move relógio", async () => {
    const svc = serviceClient();
    const claimed = (await svc.rpc("campaign_claim_sends", {
      p_campaign_id: campaignId,
      p_limit: 10,
    })) as { data: Array<{ send_id: string }> };
    const sendId = claimed.data[0]!.send_id;

    await svc.from("campaign_sends").update({
      status: "sent",
      provider_message_id: "prov-test-1",
      claimed_at: null,
      sent_at: new Date().toISOString(),
    }).eq("id", sendId);

    const first = await adminA.client.rpc("campaign_register_status", {
      p_provider_message_id: "prov-test-1",
      p_status: "delivered",
    });
    expect(first.error).toBeNull();

    const replay = await adminA.client.rpc("campaign_register_status", {
      p_provider_message_id: "prov-test-1",
      p_status: "delivered",
    });
    expect((replay.data as { replayed: boolean }).replayed).toBe(true);

    const metrics = await adminA.client.rpc("campaign_metrics", { p_campaign_id: campaignId });
    expect(metrics.error).toBeNull();
    const counts = (metrics.data as { counts: Record<string, number> }).counts;
    expect(counts["delivered"]).toBe(1);
    expect(counts["excluded_opt_in"]).toBe(1);
  });

  it("conversão exige atendimento do mesmo cliente/tenant", async () => {
    const { error } = await adminA.client.rpc("campaign_register_status", {
      p_provider_message_id: "prov-test-1",
      p_status: "converted",
      p_converted_appointment_id: randomUUID(),
    });
    expect(error?.code).toBe("PT404");
  });
});

describe("RF-16 gating por entitlement", () => {
  it("tenant starter (sem campanhas) é bloqueado no enqueue", async () => {
    const tpl = must<{ id: string }>(
      "template-b",
      await adminB.client
        .from("campaign_templates")
        .insert({ name: "T", body: "Oi {nome}", approved_outside_24h: true })
        .select("id")
        .single(),
    );
    const camp = must<{ id: string }>(
      "campaign-b",
      await adminB.client
        .from("campaigns")
        .insert({
          name: "C",
          preset: "custom",
          template_id: tpl.id,
          segment: {},
          status: "agendada",
        })
        .select("id")
        .single(),
    );
    const { error } = await adminB.client.rpc("campaign_enqueue", {
      p_campaign_id: camp.id,
    });
    expect(error?.code).toBe("PT403");
  });
});
