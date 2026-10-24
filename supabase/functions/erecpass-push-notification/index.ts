import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { importPKCS8, SignJWT } from "https://deno.land/x/jose@v4.15.5/index.ts";

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json", "cache-control": "no-store" },
});

Deno.serve(async (req) => {
  if (req.method !== "POST") return reply({ error: "POST required" }, 405);
  const secret = Deno.env.get("ERECPASS_PUSH_WEBHOOK_SECRET") || "";
  if (secret.length < 32 || req.headers.get("x-erecpass-webhook-secret") !== secret) return reply({ error: "Unauthorized" }, 401);
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const raw = Deno.env.get("FCM_SERVICE_ACCOUNT_JSON");
  if (!url || !key || !raw) return reply({ error: "Push sender is not configured" }, 503);

  try {
    const event = await req.json();
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const record = event.record || {};
    let recipients: string[] = [];
    let title = "ERecPass update";
    let body = "You have a new update. Open ERecPass to view it.";
    let kind = "update";

    if (event.table === "message_messages" && event.type === "INSERT") {
      const [conv, sender] = await Promise.all([
        db.from("message_conversations").select("patient_id").eq("id", record.conversation_id).maybeSingle(),
        db.from("profiles").select("role").eq("id", record.sender_id).maybeSingle(),
      ]);
      if (conv.error) throw conv.error;
      if (sender.data?.role === "admin") recipients = [String(conv.data?.patient_id || "")];
      else {
        const admins = await db.from("profiles").select("id").eq("role", "admin").eq("active", true);
        if (admins.error) throw admins.error;
        recipients = (admins.data || []).map((x) => String(x.id));
      }
      recipients = recipients.filter((id) => id && id !== String(record.sender_id));
      title = sender.data?.role === "staff" ? "New staff message" : sender.data?.role === "admin" ? "New reply from ERecPass" : "New patient message";
      kind = "chat";
    } else if (event.table === "appointments") {
      const patientId = String(record.patient_id || "");
      if (event.type === "INSERT") {
        const creatorId = String(record.created_by || "");
        const creator = creatorId
          ? await db.from("profiles").select("role").eq("id", creatorId).maybeSingle()
          : { data: null, error: null };
        if (creator.error) throw creator.error;
        if (creator.data?.role === "admin") {
          const patient = await db.from("patients").select("user_id").eq("id", patientId).maybeSingle();
          if (patient.error) throw patient.error;
          if (patient.data?.user_id) recipients = [String(patient.data.user_id)];
          title = "Appointment scheduled";
          body = "An appointment was added to your ERecPass account.";
        } else {
          const admins = await db.from("profiles").select("id").eq("role", "admin").eq("active", true);
          if (admins.error) throw admins.error;
          recipients = (admins.data || []).map((x) => String(x.id));
          title = "New appointment request";
          body = "An appointment request needs review in ERecPass.";
        }
      } else if (event.type === "UPDATE") {
        if (String(event.old_record?.status || "") === String(record.status || "")) return reply({ ok: true, skipped: "status unchanged" });
        const patient = await db.from("patients").select("user_id").eq("id", patientId).maybeSingle();
        if (patient.error) throw patient.error;
        if (patient.data?.user_id) recipients = [String(patient.data.user_id)];
        title = "Appointment status updated";
        body = "Your appointment status is now: " + String(record.status || "updated") + ".";
      } else {
        return reply({ ok: true, skipped: "unsupported appointment event" });
      }
      kind = "appointment";
    } else if (event.table === "patients" && event.type === "UPDATE") {
      if (!event.changed_lab_results && !event.changed_prescriptions) return reply({ ok: true, skipped: "no record changes" });
      if (record.user_id) recipients = [String(record.user_id)];
      title = event.changed_lab_results ? "Lab results updated" : "Medication record updated";
      body = "Your health record was updated. Sign in to ERecPass to view it.";
      kind = event.changed_lab_results ? "lab-results" : "medications";
    } else if (event.table === "medication_reminders") {
      if (record.patient_user_id) recipients = [String(record.patient_user_id)];
      title = "Medication reminder updated";
      body = "Your medication reminder settings were updated in ERecPass.";
      kind = "medications";
    } else return reply({ ok: true, skipped: "unsupported event" });

    recipients = [...new Set(recipients.filter(Boolean))];
    if (!recipients.length) return reply({ ok: true, sent: 0 });
    const tokenRows = await db.from("device_push_tokens").select("token").in("user_id", recipients);
    if (tokenRows.error) throw tokenRows.error;
    if (!tokenRows.data?.length) return reply({ ok: true, sent: 0, skipped: "no registered devices" });

    const sa = JSON.parse(raw);
    const now = Math.floor(Date.now() / 1000);
    const privateKey = await importPKCS8(String(sa.private_key).replace(/\\n/g, "\n"), "RS256");
    const assertion = await new SignJWT({ scope: "https://www.googleapis.com/auth/firebase.messaging" })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" }).setIssuer(sa.client_email)
      .setAudience("https://oauth2.googleapis.com/token").setIssuedAt(now).setExpirationTime(now + 3600).sign(privateKey);
    const oauth = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    });
    const auth = await oauth.json();
    if (!oauth.ok || !auth.access_token) throw new Error("Google OAuth token exchange failed");
    let sent = 0;
    for (const row of tokenRows.data) {
      const result = await fetch("https://fcm.googleapis.com/v1/projects/" + encodeURIComponent(sa.project_id) + "/messages:send", {
        method: "POST", headers: { authorization: "Bearer " + auth.access_token, "content-type": "application/json" },
        body: JSON.stringify({ message: { token: row.token, notification: { title, body }, data: { kind }, android: { priority: "HIGH", notification: { channel_id: "erecpass-updates", sound: "default" } } } }),
      });
      if (result.ok) sent++;
      else console.error("FCM send failed", result.status, (await result.text()).slice(0, 250));
    }
    return reply({ ok: true, sent });
  } catch (error) {
    console.error("ERecPass push dispatch failed", error);
    return reply({ error: "Push dispatch failed" }, 500);
  }
});
