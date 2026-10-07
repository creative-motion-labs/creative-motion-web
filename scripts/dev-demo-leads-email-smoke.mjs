/**
 * Verify dev demo lead confirmation email API behavior (no secrets).
 * Usage: node scripts/dev-demo-leads-email-smoke.mjs
 */
const BASE = process.env.DEMO_BASE_URL ?? "https://dev.rasqhealth.com";

async function postLead(demoSessionId, email) {
  const res = await fetch(`${BASE}/api/public/rasq-demo/leads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      demoSessionId,
      submitIntent: "share",
      email,
      consentRasqUpdates: true,
      consentPilotStudy: false,
      movementSummary: { sessionDurationSeconds: 60 },
    }),
  });
  const data = await res.json();
  return { status: res.status, data };
}

async function main() {
  const internalId = `rasq-demo-internal-test-smoke-${crypto.randomUUID()}`;
  const internal = await postLead(internalId, "delivered@resend.dev");
  if (internal.status !== 200 || !internal.data.ok || !internal.data.stored) {
    console.error("Internal test lead failed", internal);
    process.exit(1);
  }
  if (internal.data.confirmationEmail?.reason !== "skipped") {
    console.error("Expected confirmationEmail skipped for internal test session", internal.data);
    process.exit(1);
  }

  const liveId = `rasq-demo-email-smoke-${crypto.randomUUID()}`;
  const live = await postLead(liveId, "delivered@resend.dev");
  if (live.status !== 200 || !live.data.ok || !live.data.stored) {
    console.error("Live email-path lead failed", live);
    process.exit(1);
  }

  const ce = live.data.confirmationEmail;
  if (ce?.sent === true) {
    console.log(JSON.stringify({ baseUrl: BASE, result: "confirmation_email_sent", id: live.data.id }));
    return;
  }
  if (ce?.sent === false && ce.reason === "not-configured") {
    console.error(
      JSON.stringify({
        baseUrl: BASE,
        result: "resend_not_configured",
        hint: "Add RESEND_API_KEY to Vercel project creative-motion-web-nhnv (Production), then redeploy.",
      }),
    );
    process.exit(1);
  }
  if (ce?.sent === false && ce.reason === "send-failed") {
    console.error(
      JSON.stringify({
        baseUrl: BASE,
        result: "send_failed",
        hint: "RESEND_API_KEY is present but invalid or Resend rejected the send. Re-enter the key from creative-motion-web Production.",
      }),
    );
    process.exit(1);
  }

  console.error("Unexpected confirmationEmail status", live.data);
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
