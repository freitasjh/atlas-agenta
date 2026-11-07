#!/usr/bin/env node
// QA seed ADR-005 (harness-only): massa financeira sintética no tenant demo.
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

function statusEnv() {
  const out = execFileSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8" });
  const map = {};
  for (const raw of out.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    map[line.slice(0, eq).trim()] = v;
  }
  return map;
}

const st = statusEnv();
const db = createClient(st.API_URL, st.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const TAG = "[QA-ADR005]";

async function one(q) {
  const { data, error } = await q;
  if (error) throw error;
  return Array.isArray(data) ? (data[0] ?? null) : (data ?? null);
}

const tenantRow = await one(db.from("tenants").select("id").eq("owner_email", "admin@demo.local").limit(1));
if (!tenantRow) throw new Error("tenant demo ausente");
const tid = tenantRow.id;
console.log("tenant", tid);

const prof = await one(db.from("professionals").select("id").eq("tenant_id", tid).limit(1));
const svc = await one(db.from("services").select("id,price_cents").eq("tenant_id", tid).eq("name", "Corte").limit(1));
const adminProfile = await one(db.from("profiles").select("id").eq("tenant_id", tid).eq("role", "admin").limit(1));

let customer = await one(db.from("customers").select("id").eq("tenant_id", tid).ilike("name", `${TAG}%`).limit(1));
if (!customer) {
  customer = await one(db.from("customers").insert({ tenant_id: tid, name: `${TAG} Cliente`, phone: "11999990000" }).select("id").single());
}
console.log("customer", customer.id);

const tagged = await db.from("appointments").select("id").eq("tenant_id", tid).eq("customer_id", customer.id);
for (const a of (tagged.data ?? [])) {
  await db.from("appointment_payments").delete().eq("appointment_id", a.id);
  await db.from("charges").delete().eq("appointment_id", a.id);
  await db.from("appointments").delete().eq("id", a.id);
}

const mk = (day, hour = 12) => new Date(Date.UTC(2026, 10, day, hour, 0, 0)).toISOString();
const mkEnd = (day, mins) => new Date(new Date(mk(day)).getTime() + mins * 60000).toISOString();

async function mkAppt(day, price, mins = 30) {
  return one(db.from("appointments").insert({
    tenant_id: tid, customer_id: customer.id, professional_id: prof.id, service_id: svc.id,
    starts_at: mk(day), ends_at: mkEnd(day, mins), price_cents: price, status: "concluido",
  }).select("id").single());
}

const a1 = await mkAppt(5, 5000);
const a2 = await mkAppt(6, 12000);
const a3 = await mkAppt(7, 5000);
const a4 = await mkAppt(10, 8000);
console.log("appts", a1.id, a2.id, a3.id, a4.id);

const rAt = (day) => new Date(Date.UTC(2026, 10, day, 15, 0, 0)).toISOString();
await db.from("appointment_payments").insert([
  { tenant_id: tid, appointment_id: a1.id, method: "dinheiro", amount_cents: 5000, tip_cents: 500, source: "manual", received_at: rAt(5), received_by: adminProfile.id },
  { tenant_id: tid, appointment_id: a2.id, method: "cartao_credito", amount_cents: 4000, tip_cents: 0, source: "manual", received_at: rAt(6), received_by: adminProfile.id },
  { tenant_id: tid, appointment_id: a3.id, method: "pix_maquininha", amount_cents: 5000, tip_cents: 0, source: "manual", received_at: rAt(7), received_by: adminProfile.id, voided_at: new Date().toISOString(), voided_by: adminProfile.id, void_reason: `${TAG} teste de estorno` },
]);
await db.from("charges").insert({
  tenant_id: tid, appointment_id: a4.id, asaas_payment_id: "pay_qa_adr005_001",
  status: "pendente", amount_cents: 8000, expires_at: new Date(Date.UTC(2027, 0, 1)).toISOString(),
});
console.log("ledger+charge ok");

async function ensureUser(email, password, role, wantProf = false) {
  let found = null;
  for (let page = 1; page <= 5; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    found = (data?.users ?? []).find((u) => (u.email ?? "").toLowerCase() === email);
    if (found) break;
    if (!data?.nextPage || data.nextPage <= page) break;
  }
  let user = found;
  if (!user) {
    const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: email } });
    if (error) throw error;
    user = data.user;
  } else {
    await db.auth.admin.updateUserById(user.id, { password, email_confirm: true });
  }
  const existing = await one(db.from("profiles").select("id,tenant_id,role").eq("id", user.id).limit(1));
  if (!existing) {
    const { error } = await db.from("profiles").insert({ id: user.id, tenant_id: tid, role, full_name: email });
    if (error) throw error;
  } else {
    await db.from("profiles").update({ tenant_id: tid, role }).eq("id", user.id);
  }
  if (wantProf) {
    let p = await one(db.from("professionals").select("id").eq("tenant_id", tid).eq("profile_id", user.id).limit(1));
    if (!p) {
      p = await one(db.from("professionals").insert({ tenant_id: tid, name: `${TAG} Prof`, profile_id: user.id, active: true }).select("id").single());
    }
    console.log("professional link", p.id);
  }
  console.log("user ok", email, role, user.id);
}
await ensureUser("recepcao@demo.local", "demo12345", "receptionist");
await ensureUser("prof@demo.local", "demo12345", "professional", true);
console.log("QA-SEED-OK", JSON.stringify({ tenant: tid }));
