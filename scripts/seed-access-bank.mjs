/**
 * Seed Access Bank Cameroon Plc as the default payment destination for Promptstack.
 * Also mirrors the RIB into organization_settings bank fields and default payment notes.
 */
import fs from "fs";
import { createClient } from "@supabase/supabase-js";

for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
  const i = line.indexOf("=");
  const k = line.slice(0, i).trim();
  let v = line.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!(k in process.env)) process.env[k] = v;
}

const orgId = process.env.DEFAULT_ORGANIZATION_ID || "00000000-0000-4000-8000-000000000001";
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const destination = {
  organization_id: orgId,
  kind: "bank",
  label: "Access Bank Cameroon Plc",
  provider: "Access Bank Cameroon Plc",
  account_name: "PROMPTSTACK TECHNOLOGIES",
  // Bank code + branch + account + key (RIB style)
  account_number: "10041 00001 00101301472 73",
  iban: "CM21 10041 00001 00101301472 73",
  swift: "ABNGCMCX",
  is_default: true,
  is_active: true,
  show_on_documents: true,
  sort_order: 0,
};

const { data: existing } = await admin
  .from("payment_destinations")
  .select("id")
  .eq("organization_id", orgId)
  .eq("iban", destination.iban)
  .maybeSingle();

if (existing) {
  const { error } = await admin.from("payment_destinations").update(destination).eq("id", existing.id);
  if (error) throw error;
  console.log("Updated payment destination", existing.id);
} else {
  // Clear other defaults first
  await admin.from("payment_destinations").update({ is_default: false }).eq("organization_id", orgId);
  const { data, error } = await admin.from("payment_destinations").insert(destination).select("id").single();
  if (error) throw error;
  console.log("Created payment destination", data.id);
}

const paymentNote =
  "Bank transfer to Access Bank Cameroon Plc (PROMPTSTACK TECHNOLOGIES).\n" +
  "IBAN: CM21 10041 00001 00101301472 73 · SWIFT: ABNGCMCX\n" +
  "Cheques payable to Promptstack Technologies.";

const { error: settingsError } = await admin
  .from("organization_settings")
  .update({
    bank_name: "Access Bank Cameroon Plc",
    bank_account_name: "PROMPTSTACK TECHNOLOGIES",
    bank_account_number: "10041 00001 00101301472 73",
    bank_iban: "CM21 10041 00001 00101301472 73",
    bank_swift: "ABNGCMCX",
    enabled_payment_methods: ["bank_transfer", "cheque", "cash", "mtn_momo", "orange_money", "card", "other"],
    default_invoice_notes: paymentNote,
    default_proforma_notes: paymentNote,
  })
  .eq("organization_id", orgId);

if (settingsError) throw settingsError;
console.log("Updated organization bank settings and default notes.");
console.log("Done.");
