/**

 * Run: npx tsx --test app/lib/remote-upper-limb-battery/battery-movement-guidance.test.ts

 */

import assert from "node:assert/strict";

import { readFileSync } from "node:fs";

import { join } from "node:path";

import { describe, it } from "node:test";

import { getMovementInstruction, getTestProgressLabel } from "./battery-patient-copy";

import {

  getBatteryElbowBendCopy,

  getBatteryFlexionRaiseCopy,

  getBatteryFunctionalReachCopy,

} from "./battery-voice-copy";

import {

  resolveBatterySpeechText,

  resolveBatteryTestStartSpeechCue,

  setBatterySpeechLang,

} from "./battery-speech";



const SESSION = join(process.cwd(), "app/components/patient/RemoteUpperLimbBatterySession.tsx");



describe("battery movement and orientation guidance", () => {

  it("uses shoulder flexion raise cue in EN and AR", () => {

    assert.equal(

      getBatteryFlexionRaiseCopy("right", "en"),

      "Raise your arm as high as you can.",

    );

    assert.equal(

      getMovementInstruction("shoulderFlexion", "right", "en"),

      resolveBatterySpeechText("flexion-raise", "right", "en"),

    );

    setBatterySpeechLang("ar");

    assert.match(getBatteryFlexionRaiseCopy("left", "ar"), /أعلى/);

    setBatterySpeechLang("en");

  });



  it("uses elbow flexion bend cue distinct from functional reach", () => {

    const elbowEn = getBatteryElbowBendCopy("right", "en");

    const reachEn = getBatteryFunctionalReachCopy("right", "en");

    assert.equal(elbowEn, "Bend your elbow as far as you can.");

    assert.equal(reachEn, "Reach forward toward the target as far as you can.");

    assert.notEqual(elbowEn, reachEn);

    assert.equal(getMovementInstruction("elbowFlexion", "right", "en"), elbowEn);

    assert.equal(getMovementInstruction("functionalReach", "left", "en"), reachEn);

    assert.equal(resolveBatterySpeechText("elbow-bend", "right", "en"), elbowEn);

    assert.equal(resolveBatterySpeechText("functional-reach", "right", "en"), reachEn);

    setBatterySpeechLang("ar");

    assert.match(getBatteryElbowBendCopy("right", "ar"), /مرفق/);

    assert.match(getBatteryFunctionalReachCopy("right", "ar"), /الهدف/);

    setBatterySpeechLang("en");

  });



  it("aligns progress subtitle with movement voice copy", () => {

    const label = getTestProgressLabel(1, "shoulderFlexion", 0, 3, "right", "en");

    assert.match(label, /Raise your arm as high as you can\./);

    assert.equal(resolveBatteryTestStartSpeechCue("shoulderFlexion"), "flexion-raise");

  });



  it("plays movement start at test_active without overlapping countdown or movement-smooth", () => {

    const source = readFileSync(SESSION, "utf8");

    assert.match(source, /armActiveTestProcessor\(activeTestId\)/);

    assert.match(source, /resolveBatteryTestStartSpeechCue/);

    assert.match(source, /side-view-setup/);

    assert.equal(source.includes("movement-smooth-comfort"), false);

    assert.match(source, /if \(orchestrator\.phase !== "test_active"\) return;/);

    assert.match(source, /shouldSpeakSideViewSetupInPositioning/);

    assert.match(source, /if \(!testStartCueSpokenRef\.current\)/);

  });

});


