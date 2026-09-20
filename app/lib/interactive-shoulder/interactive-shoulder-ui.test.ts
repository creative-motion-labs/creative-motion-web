/**
 * Run: npx tsx --test app/lib/interactive-shoulder/interactive-shoulder-ui.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  interactiveShoulderSetupGuidanceCopy,
  interactiveShoulderUi,
  resolveInteractiveShoulderExperienceTitle,
  resolveInteractiveShoulderLiveMessage,
  resolveInteractiveShoulderStartError,
  shouldTickTargetLifecycle,
} from "./interactive-shoulder-ui";
import { CLINICAL_MOTION_PATTERN_SEQUENCE_SESSION } from "./clinical-motion-pattern-session-definition";
import { resolveFeedbackInteractionMode } from "./motion-patterns/motion-pattern-registry";
import { PATIENT_CAMERA_NO_FRAMES_ERROR } from "../cv/patient-camera-stream";
import { SHOULDER_ABDUCTION_REACH_INTERACTIVE_SESSION } from "./shoulder-abduction-reach-session-definition";

const FORBIDDEN_CLINICAL_UI_CLAIMS = ["PNF D1 Flexion", "PNF Accuracy", "Clinical Accuracy"];

describe("interactiveShoulderUi", () => {
  it("provides English and Arabic copy for core patient messages", () => {
    const en = interactiveShoulderUi("en");
    const ar = interactiveShoulderUi("ar");
    assert.ok(en.consentTitle.length > 0);
    assert.ok(ar.consentTitle.length > 0);
    assert.notEqual(en.consentTitle, ar.consentTitle);
    assert.ok(en.pause.length > 0);
    assert.ok(ar.pause.length > 0);
    assert.ok(en.trackingLostHold.length > 0);
    assert.ok(ar.trackingLostHold.length > 0);
    assert.equal(en.experienceTitle, "Reach the Light");
    assert.ok(ar.experienceTitle.length > 0);
    assert.notEqual(en.experienceTitle, ar.experienceTitle);
    assert.equal(ar.experienceTitle, "الوصول إلى الضوء");
    assert.ok(en.interactionTargetsLabel(2, 5).includes("Interaction targets"));
    assert.ok(ar.interactionTargetsLabel(2, 5).includes("أهداف التفاعل"));
    assert.ok(en.interactionPatternsLabel(1, 2).includes("Paths completed"));
    assert.ok(ar.interactionPatternsLabel(1, 2).includes("المسارات المكتملة"));
    assert.ok(!en.interactionPatternsLabel(1, 2).includes("PNF"));
    assert.ok(!en.interactionPatternsLabel(1, 2).includes("Clinical Accuracy"));
    assert.ok(en.blockCompleteTitle.length > 0);
    assert.ok(ar.blockCompleteTitle.length > 0);
    assert.ok(en.readyLabel.length > 0);
    assert.ok(ar.readyLabel.length > 0);
    assert.ok(en.sessionCompleteTitle.length > 0);
    assert.ok(ar.sessionCompleteTitle.length > 0);
    assert.ok(en.goodReachFeedback.length > 0);
    assert.ok(ar.goodReachFeedback.length > 0);
    assert.notEqual(en.goodReachFeedback, ar.goodReachFeedback);
    assert.ok(en.devMouseSimulation.includes("Development"));
    assert.ok(ar.devMouseSimulation.includes("محاكاة"));
  });

  it("maps setup guidance to localized reposition copy", () => {
    assert.ok(interactiveShoulderSetupGuidanceCopy("en", "move_farther").includes("Move back"));
    assert.ok(interactiveShoulderSetupGuidanceCopy("ar", "move_farther").includes("تراجع"));
  });

  it("localizes safety hold messages by reason", () => {
    const block = SHOULDER_ABDUCTION_REACH_INTERACTIVE_SESSION.blocks[0]!;
    const trackerHold = resolveInteractiveShoulderLiveMessage("en", {
      sessionState: "safetyHold",
      safetyStatus: "hold",
      safetyHoldReason: "trackerLost",
      isPaused: false,
      patientFeedbackState: { message: "Tracking issue detected — please wait.", encouragement: null },
      currentBlock: block,
    } as never);
    assert.equal(trackerHold, interactiveShoulderUi("en").trackingLostHold);

    const compHold = resolveInteractiveShoulderLiveMessage("ar", {
      sessionState: "safetyHold",
      safetyStatus: "hold",
      safetyHoldReason: "compensation",
      isPaused: false,
      patientFeedbackState: { message: null, encouragement: null },
      currentBlock: block,
    } as never);
    assert.equal(compHold, interactiveShoulderUi("ar").compensationSafetyHold);
  });

  it("shouldTickTargetLifecycle allows only active state", () => {
    assert.equal(shouldTickTargetLifecycle("active"), true);
    assert.equal(shouldTickTargetLifecycle("paused"), false);
    assert.equal(shouldTickTargetLifecycle("safetyHold"), false);
    assert.equal(shouldTickTargetLifecycle("completed"), false);
  });

  it("localizes camera start errors", () => {
    const denied = resolveInteractiveShoulderStartError("en", new DOMException("denied", "NotAllowedError"));
    assert.equal(denied, interactiveShoulderUi("en").cameraAccessDenied);
    const arDenied = resolveInteractiveShoulderStartError("ar", new DOMException("denied", "NotAllowedError"));
    assert.equal(arDenied, interactiveShoulderUi("ar").cameraAccessDenied);
    const noFrames = resolveInteractiveShoulderStartError("en", new Error(PATIENT_CAMERA_NO_FRAMES_ERROR));
    assert.equal(noFrames, interactiveShoulderUi("en").cameraNoFrames);
  });
});

describe("resolveInteractiveShoulderExperienceTitle", () => {
  it("shows Reach the Light in English and Arabic for target mode", () => {
    assert.equal(
      resolveInteractiveShoulderExperienceTitle("en", "reach-the-light-targets"),
      "Reach the Light",
    );
    assert.equal(
      resolveInteractiveShoulderExperienceTitle("ar", "reach-the-light-targets"),
      "الوصول إلى الضوء",
    );
  });

  it("shows D1-Inspired Diagonal Reach in English and Arabic for pattern mode", () => {
    assert.equal(
      resolveInteractiveShoulderExperienceTitle("en", "motion-pattern"),
      "D1-Inspired Diagonal Reach",
    );
    assert.equal(
      resolveInteractiveShoulderExperienceTitle("ar", "motion-pattern"),
      "الوصول القطري المستوحى من D1",
    );
  });

  it("updates the title when a sequential session transitions from pattern to target blocks", () => {
    const patternBlock = CLINICAL_MOTION_PATTERN_SEQUENCE_SESSION.blocks[0]!;
    const targetBlock = CLINICAL_MOTION_PATTERN_SEQUENCE_SESSION.blocks[1]!;
    const patternMode = resolveFeedbackInteractionMode(patternBlock.feedbackProfile);
    const targetMode = resolveFeedbackInteractionMode(targetBlock.feedbackProfile);

    const patternTitleEn = resolveInteractiveShoulderExperienceTitle("en", patternMode);
    const targetTitleEn = resolveInteractiveShoulderExperienceTitle("en", targetMode);
    assert.notEqual(patternTitleEn, targetTitleEn);
    assert.equal(targetTitleEn, "Reach the Light");
    assert.equal(patternTitleEn, "D1-Inspired Diagonal Reach");

    const patternTitleAr = resolveInteractiveShoulderExperienceTitle("ar", patternMode);
    const targetTitleAr = resolveInteractiveShoulderExperienceTitle("ar", targetMode);
    assert.notEqual(patternTitleAr, targetTitleAr);
    assert.equal(targetTitleAr, "الوصول إلى الضوء");
    assert.equal(patternTitleAr, "الوصول القطري المستوحى من D1");
  });

  it("does not expose PNF or clinical accuracy claims in experience titles", () => {
    const titles = [
      resolveInteractiveShoulderExperienceTitle("en", "motion-pattern"),
      resolveInteractiveShoulderExperienceTitle("ar", "motion-pattern"),
      resolveInteractiveShoulderExperienceTitle("en", "reach-the-light-targets"),
      resolveInteractiveShoulderExperienceTitle("ar", "reach-the-light-targets"),
      interactiveShoulderUi("en").interactionPatternsLabel(1, 2),
      interactiveShoulderUi("ar").interactionPatternsLabel(1, 2),
    ];
    for (const copy of titles) {
      for (const forbidden of FORBIDDEN_CLINICAL_UI_CLAIMS) {
        assert.ok(!copy.includes(forbidden), `unexpected claim "${forbidden}" in "${copy}"`);
      }
    }
  });
});
