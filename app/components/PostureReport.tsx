"use client";

import type {
  PostureCheckResult,
  PostureDataSufficiency,
  PostureLabel,
} from "../lib/posture-analyzer";
import {
  labelFromPostureScore,
  resolvePostureReportPresentation,
} from "../lib/posture-report-presentation";

/* ─────────────────────────────────────────────
   Types
───────────────────────────────────────────── */
export interface PostureReportProps {
  score: number | null;
  assessmentId: string;
  patientId: string;
  patientName: string;
  lastFrame: PostureCheckResult | null;
  reportSummary: string;
  /**
   * When `"insufficient"`, do not present legacy score/label as clinical findings.
   * Defaults via presentation helper when omitted.
   */
  dataSufficiency?: PostureDataSufficiency;
}

/* ─────────────────────────────────────────────
   Clinical-text generators
   All pure: no state, no side-effects.
───────────────────────────────────────────── */
interface Finding {
  area: string;
  status: "normal" | "mild" | "marked" | "insufficient";
  /** Measured numeric note and cautious review wording. */
  text: string;
}

function buildFindings(
  frame: PostureCheckResult | null,
  isInsufficient: boolean
): Finding[] {
  if (isInsufficient || !frame) {
    return [
      {
        area: "Shoulder Alignment",
        status: "insufficient",
        text: "Insufficient data — no usable shoulder measurement captured.",
      },
      {
        area: "Head Position",
        status: "insufficient",
        text: "Insufficient data — no usable head-position measurement captured.",
      },
      {
        area: "Trunk Alignment",
        status: "insufficient",
        text: "Insufficient data — no usable trunk measurement captured.",
      },
      {
        area: "Hip Symmetry",
        status: "insufficient",
        text: "Insufficient data — no usable hip measurement captured.",
      },
    ];
  }

  const { shoulderTilt, headOffset, trunkOffset, hipTilt } = frame;

  const shoulder: Finding =
    shoulderTilt > 8
      ? { area: "Shoulder Alignment", status: "marked", text: `Measured shoulder tilt ${shoulderTilt.toFixed(1)}°. May indicate asymmetric shoulder elevation — for therapist review.` }
      : shoulderTilt > 4
        ? { area: "Shoulder Alignment", status: "mild", text: `Measured shoulder tilt ${shoulderTilt.toFixed(1)}°. May warrant monitoring of upper-quarter symmetry — for therapist review.` }
        : { area: "Shoulder Alignment", status: "normal", text: `Measured shoulder tilt ${shoulderTilt.toFixed(1)}° (within typical screening range).` };

  const head: Finding =
    headOffset > 0.06
      ? { area: "Head Position", status: "marked", text: `Measured lateral head offset ${headOffset.toFixed(3)} (normalised). May indicate a compensatory pattern — for therapist review.` }
      : headOffset > 0.03
        ? { area: "Head Position", status: "mild", text: `Measured lateral head offset ${headOffset.toFixed(3)} (normalised). May reflect habitual posture — for therapist review.` }
        : { area: "Head Position", status: "normal", text: `Measured lateral head offset ${headOffset.toFixed(3)} (normalised; within typical screening range).` };

  const trunk: Finding =
    trunkOffset > 0.06
      ? { area: "Trunk Alignment", status: "marked", text: `Measured trunk lateral shift ${trunkOffset.toFixed(3)} (normalised). May indicate compensatory lean — for therapist review.` }
      : trunkOffset > 0.03
        ? { area: "Trunk Alignment", status: "mild", text: `Measured trunk lateral shift ${trunkOffset.toFixed(3)} (normalised). May indicate habitual weight-shift — for therapist review.` }
        : { area: "Trunk Alignment", status: "normal", text: `Measured trunk lateral shift ${trunkOffset.toFixed(3)} (normalised; within typical screening range).` };

  const hip: Finding =
    hipTilt > 8
      ? { area: "Hip / Pelvic Symmetry", status: "marked", text: `Measured hip tilt ${hipTilt.toFixed(1)}°. May indicate pelvic obliquity or asymmetric loading — for therapist review.` }
      : hipTilt > 4
        ? { area: "Hip / Pelvic Symmetry", status: "mild", text: `Measured hip tilt ${hipTilt.toFixed(1)}°. May warrant monitoring of loading pattern — for therapist review.` }
        : { area: "Hip / Pelvic Symmetry", status: "normal", text: `Measured hip tilt ${hipTilt.toFixed(1)}° (within typical screening range).` };

  return [shoulder, head, trunk, hip];
}

function buildInterpretation(
  score: number | null,
  label: PostureLabel | null,
  isInsufficient: boolean
): string {
  if (isInsufficient) {
    return "Insufficient pose frames were available for measured postural analysis. Legacy composite score/label retained for system compatibility must not be treated as clinical findings — for therapist review.";
  }
  if (score === null || label === null) {
    return "Assessment data is unavailable — for therapist review.";
  }

  if (score >= 80) {
    return "Measured observations may be consistent with generally aligned static posture across the evaluated planes. For therapist review only — not a diagnosis.";
  }
  if (score >= 60) {
    return "Measured observations may indicate mild asymmetry in one or more regions. These signals warrant therapist review and are not a clinical diagnosis or severity rating.";
  }
  return "Measured observations may indicate more noticeable postural offsets. Further clinical evaluation by a therapist may be considered. This automated summary is not a diagnosis and does not prescribe treatment.";
}

function buildRecommendations(
  score: number | null,
  findings: Finding[],
  isInsufficient: boolean
): string[] {
  if (isInsufficient) {
    return [
      "Repeat postural capture with full body visible and stable camera framing — for therapist review.",
      "Do not use placeholder composite scores from insufficient captures for clinical decisions.",
    ];
  }

  const base: string[] = [];
  const flagged = findings.filter((f) => f.status !== "normal");

  if (flagged.some((f) => f.area === "Shoulder Alignment")) {
    base.push("Therapist may consider reviewing upper-trapezius / levator flexibility and scapular control if clinically indicated.");
  }
  if (flagged.some((f) => f.area === "Head Position")) {
    base.push("Therapist may consider cervical postural awareness cues and workstation ergonomics review if clinically indicated.");
  }
  if (flagged.some((f) => f.area === "Trunk Alignment")) {
    base.push("Therapist may consider core control and lateral trunk assessment if clinically indicated.");
  }
  if (flagged.some((f) => f.area.includes("Hip"))) {
    base.push("Therapist may consider hip-abductor strength and pelvic symmetry screening if clinically indicated.");
  }

  if (base.length === 0 || (score !== null && score >= 80)) {
    base.push("Maintaining current activity and postural habits may be reasonable — for therapist review.");
    base.push("Reassessment after new symptoms or at a clinically chosen interval may be considered — for therapist review.");
  } else {
    base.push("Follow-up reassessment timing should be set by the treating therapist.");
    base.push("Patient education on postural awareness during daily activity may be considered — for therapist review.");
  }

  return base;
}

/* ─────────────────────────────────────────────
   Print helper
   Opens a new browser window with clean white
   HTML, then calls window.print() on it.
───────────────────────────────────────────── */
function printReport(payload: {
  patientId: string;
  patientName: string;
  assessmentId: string;
  displayedScore: string;
  displayedClassification: string;
  scoreForBadge: number | null;
  exposeLegacyClinicalFields: boolean;
  date: string;
  findings: Finding[];
  interpretation: string;
  recommendations: string[];
  summary: string;
}) {
  const statusColor = (status: Finding["status"]) =>
    status === "normal" ? "#166534" : status === "mild" ? "#92400e" : status === "marked" ? "#991b1b" : "#475569";
  const statusBg = (status: Finding["status"]) =>
    status === "normal" ? "#dcfce7" : status === "mild" ? "#fef3c7" : status === "marked" ? "#fee2e2" : "#f1f5f9";
  const statusLabel = (status: Finding["status"]) =>
    status === "normal" ? "Normal" : status === "mild" ? "Mild deviation" : status === "marked" ? "Marked deviation" : "Insufficient data";

  const findingRows = payload.findings
    .map(
      (f) => `
      <tr>
        <td style="padding:8px 12px;font-weight:600;color:#1e293b;border-bottom:1px solid #e2e8f0">${f.area}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0">
          <span style="background:${statusBg(f.status)};color:${statusColor(f.status)};padding:2px 10px;border-radius:999px;font-size:11px;font-weight:700">
            ${statusLabel(f.status)}
          </span>
        </td>
        <td style="padding:8px 12px;color:#374151;font-size:13px;border-bottom:1px solid #e2e8f0">${f.text}</td>
      </tr>`
    )
    .join("");

  const recList = payload.recommendations
    .map((r) => `<li style="margin-bottom:6px;color:#374151">${r}</li>`)
    .join("");

  const badgeScore = payload.exposeLegacyClinicalFields
    ? payload.scoreForBadge
    : null;
  const badgeBg =
    badgeScore !== null && badgeScore >= 80
      ? "#dcfce7"
      : badgeScore !== null && badgeScore >= 60
        ? "#fef3c7"
        : badgeScore !== null
          ? "#fee2e2"
          : "#f1f5f9";
  const badgeFg =
    badgeScore !== null && badgeScore >= 80
      ? "#166534"
      : badgeScore !== null && badgeScore >= 60
        ? "#92400e"
        : badgeScore !== null
          ? "#991b1b"
          : "#334155";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>Postural Assessment Report — ${payload.assessmentId}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Segoe UI',Arial,sans-serif;background:#fff;color:#1e293b;padding:32px 48px;font-size:14px;line-height:1.6}
    h1{font-size:22px;font-weight:700;color:#0f172a}
    h2{font-size:15px;font-weight:700;color:#0f172a;margin:24px 0 10px;text-transform:uppercase;letter-spacing:.06em;border-bottom:2px solid #e2e8f0;padding-bottom:6px}
    .header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #0891b2;padding-bottom:16px;margin-bottom:24px}
    .clinic-name{font-size:18px;font-weight:800;color:#0891b2}
    .clinic-sub{font-size:12px;color:#64748b;margin-top:2px}
    .meta-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:8px}
    .meta-box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px}
    .meta-label{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em}
    .meta-value{font-size:14px;font-weight:600;color:#0f172a;margin-top:2px}
    .score-badge{display:inline-block;padding:4px 18px;border-radius:999px;font-weight:700;font-size:18px}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden}
    th{background:#f1f5f9;padding:10px 12px;text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#475569}
    p.interp{background:#f8fafc;border-left:4px solid #0891b2;padding:12px 16px;border-radius:0 8px 8px 0;color:#1e293b;margin-bottom:8px}
    ul{padding-left:20px}
    .footer{margin-top:32px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;display:flex;justify-content:space-between}
    @media print{body{padding:20px 36px}button{display:none!important}}
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="clinic-name">RASQ</div>
      <div class="clinic-sub">Rehabilitation Platform</div>
    </div>
    <div style="text-align:right">
      <div style="font-size:12px;color:#64748b">Report generated</div>
      <div style="font-weight:600">${payload.date}</div>
    </div>
  </div>

  <h1>Postural Assessment Report</h1>
  <p style="margin-top:8px;color:#64748b;font-size:13px">For therapist review — not a diagnosis.</p>

  <div class="meta-grid" style="margin-top:16px">
    <div class="meta-box">
      <div class="meta-label">Patient Name</div>
      <div class="meta-value">${payload.patientName}</div>
    </div>
    <div class="meta-box">
      <div class="meta-label">Patient ID</div>
      <div class="meta-value">${payload.patientId}</div>
    </div>
    <div class="meta-box">
      <div class="meta-label">Assessment ID</div>
      <div class="meta-value">${payload.assessmentId}</div>
    </div>
    <div class="meta-box">
      <div class="meta-label">Overall Score</div>
      <div class="meta-value">
        <span class="score-badge" style="background:${badgeBg};color:${badgeFg}">
          ${payload.displayedScore}
        </span>
      </div>
    </div>
    <div class="meta-box" style="grid-column:span 2">
      <div class="meta-label">Classification</div>
      <div class="meta-value">${payload.displayedClassification}</div>
    </div>
  </div>

  <h2>Postural Findings</h2>
  <table>
    <thead>
      <tr>
        <th style="width:22%">Region</th>
        <th style="width:18%">Status</th>
        <th>Observation</th>
      </tr>
    </thead>
    <tbody>${findingRows}</tbody>
  </table>

  <h2>Clinical Interpretation</h2>
  <p class="interp">${payload.interpretation}</p>
  <p style="margin-top:8px;color:#475569;font-size:13px">${payload.summary}</p>

  <h2>Recommendations</h2>
  <ul>${recList}</ul>

  <div class="footer">
    <span>RASQ — Rehabilitation, precisely.</span>
    <span>Automated support for therapist review only. Does not provide diagnosis.</span>
  </div>
</body>
</html>`;

  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) {
    alert("Pop-up blocked. Please allow pop-ups for this site to download the report.");
    return;
  }
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 600);
}

/* ─────────────────────────────────────────────
   Status badge colours (in-page display)
───────────────────────────────────────────── */
const STATUS_STYLES: Record<Finding["status"], string> = {
  normal: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  mild: "border-amber-400/30   bg-amber-400/10   text-amber-200",
  marked: "border-rose-400/30    bg-rose-400/10    text-rose-200",
  insufficient: "border-slate-400/30 bg-slate-400/10 text-slate-200",
};
const STATUS_LABELS: Record<Finding["status"], string> = {
  normal: "Normal",
  mild: "Mild deviation",
  marked: "Marked deviation",
  insufficient: "Insufficient data",
};

/* ─────────────────────────────────────────────
   Component
───────────────────────────────────────────── */
export default function PostureReport({
  score,
  assessmentId,
  patientId,
  patientName,
  lastFrame,
  reportSummary,
  dataSufficiency,
}: PostureReportProps) {
  const label: PostureLabel | null = labelFromPostureScore(score);
  const presentation = resolvePostureReportPresentation({
    dataSufficiency,
    lastFrame,
    score,
    label,
  });
  const findings = buildFindings(lastFrame, presentation.isInsufficient);
  const interpretation = buildInterpretation(
    score,
    label,
    presentation.isInsufficient
  );
  const recommendations = buildRecommendations(
    score,
    findings,
    presentation.isInsufficient
  );
  const date = new Date().toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  function handleDownload() {
    printReport({
      patientId,
      patientName,
      assessmentId,
      displayedScore: presentation.displayedScore,
      displayedClassification: presentation.displayedClassification,
      scoreForBadge: presentation.exposeLegacyClinicalFields ? score : null,
      exposeLegacyClinicalFields: presentation.exposeLegacyClinicalFields,
      date,
      findings,
      interpretation,
      recommendations,
      summary: reportSummary,
    });
  }

  return (
    <div className="mt-6 rounded-2xl border border-cyan-300/18 bg-white/[0.03] p-5">
      {/* Header row */}
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-lg font-semibold text-cyan-200">
          Clinical Posture Report
        </h3>
        <button
          type="button"
          onClick={handleDownload}
          className="rounded-xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
        >
          Download Report
        </button>
      </div>

      <p className="mt-1 text-xs text-white/50">
        Generated {date} &nbsp;·&nbsp; Assessment {assessmentId}
      </p>
      <p className="mt-2 text-xs text-white/45">
        For therapist review — not a diagnosis. Measured values remain separate
        from interpretation.
      </p>

      {presentation.isInsufficient && (
        <div className="mt-4 rounded-xl border border-amber-300/30 bg-amber-400/10 px-4 py-3 text-sm leading-6 text-amber-100">
          Insufficient data. Legacy composite score/label retained by the system
          are persistence placeholders only and must not be used as clinical
          findings.
        </div>
      )}

      {/* Postural Findings */}
      <div className="mt-5">
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-400">
          Postural Findings
        </p>
        <div className="space-y-3">
          {findings.map((f) => (
            <div
              key={f.area}
              className="rounded-xl border border-white/10 bg-white/[0.04] p-4"
            >
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-semibold text-white/90">
                  {f.area}
                </span>
                <span
                  className={`rounded-full border px-3 py-0.5 text-[11px] font-semibold ${STATUS_STYLES[f.status]}`}
                >
                  {STATUS_LABELS[f.status]}
                </span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-white/65">
                {f.text}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Clinical Interpretation */}
      <div className="mt-5">
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-400">
          Clinical Interpretation
        </p>
        <div className="rounded-xl border-l-4 border-cyan-400/60 bg-white/[0.04] px-4 py-3 text-sm leading-7 text-white/80">
          {interpretation}
        </div>
        {presentation.exposeLegacyClinicalFields && (
          <p className="mt-2 text-xs text-white/40">
            Displayed score {presentation.displayedScore} · classification “
            {presentation.displayedClassification}” — for therapist review; not
            a diagnosis.
          </p>
        )}
      </div>

      {/* Recommendations */}
      <div className="mt-5">
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-400">
          Recommendations
        </p>
        <ul className="space-y-2">
          {recommendations.map((rec, i) => (
            <li key={i} className="flex gap-3 text-sm text-white/75">
              <span className="mt-0.5 flex-none rounded-full bg-cyan-400/20 px-2 py-0.5 text-[10px] font-bold text-cyan-300">
                {String(i + 1).padStart(2, "0")}
              </span>
              {rec}
            </li>
          ))}
        </ul>
      </div>

      <p className="mt-5 text-[11px] text-white/35">
        Automated postural analysis for therapist review only. RASQ does not
        provide diagnosis. Clinical judgement must be applied before
        intervention.
      </p>
    </div>
  );
}
