/**
 * Run: npx tsx --test app/lib/upper-limb-motor-screen/assignment-validation.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateUpperLimbMotorScreenAssignment } from "@/app/lib/upper-limb-motor-screen/assignment-validation";

function validConfiguration(overrides: Record<string, unknown> = {}) {
  return {
    startingSittingPosition: "chair_with_armrests",
    backTrunkSupport: "full_back_support",
    affectedArmSupport: "armrest",
    baselinePainScore: 2,
    permittedMovementRange: { kind: "not_applicable" },
    caregiverSupervisionRequirement: "not_required",
    deliveryMode: "in_clinic",
    patientSpecificStopCriteria: [],
    ...overrides,
  };
}

function targetPlacement(overrides: Record<string, unknown> = {}) {
  return {
    direction: "forward",
    height: "shoulder height",
    distance: "arm's length",
    ...overrides,
  };
}

function taskGroup(overrides: Record<string, unknown> = {}) {
  return {
    taskId: "forwardReach",
    testedSide: "right",
    eligible: true,
    attempts: 5,
    restPeriodSeconds: 30,
    targetPlacement: targetPlacement(),
    ...overrides,
  };
}

function validAssignment(overrides: Record<string, unknown> = {}) {
  return {
    id: "assignment-1",
    screenDefinitionId: "upper-limb-motor-screen-v1",
    status: "assigned",
    assignedAt: "2026-07-30T10:00:00.000Z",
    assignedBy: "provider-1",
    affectedSide: "right",
    configuration: validConfiguration(),
    taskAssignmentGroups: [taskGroup()],
    ...overrides,
  };
}

describe("validateUpperLimbMotorScreenAssignment — valid assignments", () => {
  it("accepts a valid right-side assignment", () => {
    const result = validateUpperLimbMotorScreenAssignment(validAssignment());
    assert.equal(result.ok, true);
  });

  it("accepts a valid left-side assignment", () => {
    const result = validateUpperLimbMotorScreenAssignment(
      validAssignment({
        affectedSide: "left",
        taskAssignmentGroups: [taskGroup({ testedSide: "left" })],
      }),
    );
    assert.equal(result.ok, true);
  });

  it("keeps affectedSide and testedSide independent — affected left, tested right is valid", () => {
    const result = validateUpperLimbMotorScreenAssignment(
      validAssignment({
        affectedSide: "left",
        taskAssignmentGroups: [taskGroup({ testedSide: "right" })],
      }),
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.assignment.affectedSide, "left");
      assert.equal(result.assignment.taskAssignmentGroups[0].testedSide, "right");
    }
  });

  it("represents bilateral testing as two separate sequential groups", () => {
    const result = validateUpperLimbMotorScreenAssignment(
      validAssignment({
        taskAssignmentGroups: [
          taskGroup({ testedSide: "left" }),
          taskGroup({ testedSide: "right" }),
        ],
      }),
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.assignment.taskAssignmentGroups.length, 2);
    }
  });
});

describe("validateUpperLimbMotorScreenAssignment — affectedSide / testedSide rejection", () => {
  it("rejects a missing affectedSide", () => {
    const assignment = validAssignment();
    delete (assignment as Record<string, unknown>).affectedSide;
    const result = validateUpperLimbMotorScreenAssignment(assignment);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_affected_side");
  });

  it("rejects a missing testedSide inside a task assignment group", () => {
    const group = taskGroup();
    delete (group as Record<string, unknown>).testedSide;
    const result = validateUpperLimbMotorScreenAssignment(
      validAssignment({ taskAssignmentGroups: [group] }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_task_assignment_group");
  });

  it("rejects an unsupported bilateral value for affectedSide", () => {
    const result = validateUpperLimbMotorScreenAssignment(
      validAssignment({ affectedSide: "bilateral" }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_affected_side");
  });

  it("rejects an unsupported bilateral value for testedSide", () => {
    const result = validateUpperLimbMotorScreenAssignment(
      validAssignment({ taskAssignmentGroups: [taskGroup({ testedSide: "bilateral" })] }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_task_assignment_group");
  });
});

describe("validateUpperLimbMotorScreenAssignment — duplicate and malformed groups", () => {
  it("rejects duplicate task-and-tested-side groups", () => {
    const result = validateUpperLimbMotorScreenAssignment(
      validAssignment({
        taskAssignmentGroups: [
          taskGroup({ testedSide: "right" }),
          taskGroup({ testedSide: "right" }),
        ],
      }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "duplicate_task_assignment_group");
  });

  it("allows the same task on both sides since testedSide differs", () => {
    const result = validateUpperLimbMotorScreenAssignment(
      validAssignment({
        taskAssignmentGroups: [
          taskGroup({ testedSide: "right" }),
          taskGroup({ testedSide: "left" }),
        ],
      }),
    );
    assert.equal(result.ok, true);
  });

  it("rejects a malformed group missing attempts", () => {
    const group = taskGroup();
    delete (group as Record<string, unknown>).attempts;
    const result = validateUpperLimbMotorScreenAssignment(
      validAssignment({ taskAssignmentGroups: [group] }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_task_assignment_group");
  });

  it("rejects a malformed group missing restPeriodSeconds", () => {
    const group = taskGroup();
    delete (group as Record<string, unknown>).restPeriodSeconds;
    const result = validateUpperLimbMotorScreenAssignment(
      validAssignment({ taskAssignmentGroups: [group] }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_task_assignment_group");
  });

  it("rejects a malformed group missing eligible", () => {
    const group = taskGroup();
    delete (group as Record<string, unknown>).eligible;
    const result = validateUpperLimbMotorScreenAssignment(
      validAssignment({ taskAssignmentGroups: [group] }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_task_assignment_group");
  });

  it("rejects a malformed group missing targetPlacement fields", () => {
    const group = taskGroup({ targetPlacement: targetPlacement({ height: "" }) });
    const result = validateUpperLimbMotorScreenAssignment(
      validAssignment({ taskAssignmentGroups: [group] }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_task_assignment_group");
  });

  it("rejects an assignment with zero task assignment groups", () => {
    const result = validateUpperLimbMotorScreenAssignment(
      validAssignment({ taskAssignmentGroups: [] }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "no_task_assignment_groups");
  });
});

describe("validateUpperLimbMotorScreenAssignment — delivery mode", () => {
  it("accepts in_clinic and remote_supervised", () => {
    assert.equal(
      validateUpperLimbMotorScreenAssignment(
        validAssignment({ configuration: validConfiguration({ deliveryMode: "in_clinic" }) }),
      ).ok,
      true,
    );
    assert.equal(
      validateUpperLimbMotorScreenAssignment(
        validAssignment({
          configuration: validConfiguration({ deliveryMode: "remote_supervised" }),
        }),
      ).ok,
      true,
    );
  });

  it("rejects remote_self, self, unsupervised, remote, and unknown values", () => {
    for (const deliveryMode of ["remote_self", "self", "unsupervised", "remote", "teleport"]) {
      const result = validateUpperLimbMotorScreenAssignment(
        validAssignment({ configuration: validConfiguration({ deliveryMode }) }),
      );
      assert.equal(result.ok, false, `expected ${deliveryMode} to be rejected`);
      if (!result.ok) assert.equal(result.reason, "invalid_delivery_mode");
    }
  });
});

describe("validateUpperLimbMotorScreenAssignment — no silent defaults", () => {
  const requiredConfigurationFields = [
    "startingSittingPosition",
    "backTrunkSupport",
    "affectedArmSupport",
    "baselinePainScore",
    "permittedMovementRange",
    "caregiverSupervisionRequirement",
    "deliveryMode",
    "patientSpecificStopCriteria",
  ];

  for (const field of requiredConfigurationFields) {
    it(`rejects configuration missing ${field} rather than defaulting it`, () => {
      const configuration = validConfiguration();
      delete (configuration as Record<string, unknown>)[field];
      const result = validateUpperLimbMotorScreenAssignment(validAssignment({ configuration }));
      assert.equal(result.ok, false);
    });
  }

  it("never fabricates a value for a missing field — result carries no assignment on failure", () => {
    const configuration = validConfiguration();
    delete (configuration as Record<string, unknown>).deliveryMode;
    const result = validateUpperLimbMotorScreenAssignment(validAssignment({ configuration }));
    assert.equal(result.ok, false);
    assert.equal("assignment" in result, false);
  });

  it("rejects attempts, restPeriodSeconds, eligible, and testedSide when absent from a group (no defaulting)", () => {
    for (const field of ["attempts", "restPeriodSeconds", "eligible", "testedSide", "taskId"]) {
      const group = taskGroup();
      delete (group as Record<string, unknown>)[field];
      const result = validateUpperLimbMotorScreenAssignment(
        validAssignment({ taskAssignmentGroups: [group] }),
      );
      assert.equal(result.ok, false, `expected missing ${field} to be rejected`);
    }
  });
});

describe("validateUpperLimbMotorScreenAssignment — explicit structured values", () => {
  it("accepts explicit 'none' for backTrunkSupport and affectedArmSupport", () => {
    const result = validateUpperLimbMotorScreenAssignment(
      validAssignment({
        configuration: validConfiguration({ backTrunkSupport: "none", affectedArmSupport: "none" }),
      }),
    );
    assert.equal(result.ok, true);
  });

  it("accepts explicit 'not_required' for caregiverSupervisionRequirement", () => {
    const result = validateUpperLimbMotorScreenAssignment(
      validAssignment({
        configuration: validConfiguration({ caregiverSupervisionRequirement: "not_required" }),
      }),
    );
    assert.equal(result.ok, true);
  });

  it("accepts explicit 'not_applicable' for permittedMovementRange", () => {
    const result = validateUpperLimbMotorScreenAssignment(
      validAssignment({
        configuration: validConfiguration({ permittedMovementRange: { kind: "not_applicable" } }),
      }),
    );
    assert.equal(result.ok, true);
  });

  it("rejects 'not_applicable' where the contract does not permit it (deliveryMode)", () => {
    const result = validateUpperLimbMotorScreenAssignment(
      validAssignment({ configuration: validConfiguration({ deliveryMode: "not_applicable" }) }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid_delivery_mode");
  });

  it("rejects 'none' where the contract does not permit it (caregiverSupervisionRequirement)", () => {
    const result = validateUpperLimbMotorScreenAssignment(
      validAssignment({
        configuration: validConfiguration({ caregiverSupervisionRequirement: "none" }),
      }),
    );
    assert.equal(result.ok, false);
  });
});

describe("validateUpperLimbMotorScreenAssignment — attempts numeric boundaries", () => {
  it("rejects NaN attempts", () => {
    const result = validateUpperLimbMotorScreenAssignment(
      validAssignment({ taskAssignmentGroups: [taskGroup({ attempts: NaN })] }),
    );
    assert.equal(result.ok, false);
  });

  it("rejects Infinity attempts", () => {
    const result = validateUpperLimbMotorScreenAssignment(
      validAssignment({ taskAssignmentGroups: [taskGroup({ attempts: Infinity })] }),
    );
    assert.equal(result.ok, false);
  });

  it("rejects -1 attempts", () => {
    const result = validateUpperLimbMotorScreenAssignment(
      validAssignment({ taskAssignmentGroups: [taskGroup({ attempts: -1 })] }),
    );
    assert.equal(result.ok, false);
  });

  it("rejects 0 attempts", () => {
    const result = validateUpperLimbMotorScreenAssignment(
      validAssignment({ taskAssignmentGroups: [taskGroup({ attempts: 0 })] }),
    );
    assert.equal(result.ok, false);
  });

  it("rejects 1.5 (non-integer) attempts", () => {
    const result = validateUpperLimbMotorScreenAssignment(
      validAssignment({ taskAssignmentGroups: [taskGroup({ attempts: 1.5 })] }),
    );
    assert.equal(result.ok, false);
  });

  it("accepts a positive integer attempts value", () => {
    const result = validateUpperLimbMotorScreenAssignment(
      validAssignment({ taskAssignmentGroups: [taskGroup({ attempts: 1 })] }),
    );
    assert.equal(result.ok, true);
  });
});

describe("validateUpperLimbMotorScreenAssignment — restPeriodSeconds numeric boundaries", () => {
  it("rejects NaN restPeriodSeconds", () => {
    const result = validateUpperLimbMotorScreenAssignment(
      validAssignment({ taskAssignmentGroups: [taskGroup({ restPeriodSeconds: NaN })] }),
    );
    assert.equal(result.ok, false);
  });

  it("rejects Infinity restPeriodSeconds", () => {
    const result = validateUpperLimbMotorScreenAssignment(
      validAssignment({ taskAssignmentGroups: [taskGroup({ restPeriodSeconds: Infinity })] }),
    );
    assert.equal(result.ok, false);
  });

  it("rejects a negative restPeriodSeconds", () => {
    const result = validateUpperLimbMotorScreenAssignment(
      validAssignment({ taskAssignmentGroups: [taskGroup({ restPeriodSeconds: -1 })] }),
    );
    assert.equal(result.ok, false);
  });

  it("accepts restPeriodSeconds of exactly 0 — the approved contract only requires >= 0, not > 0, so an explicit no-rest-period choice is permitted", () => {
    const result = validateUpperLimbMotorScreenAssignment(
      validAssignment({ taskAssignmentGroups: [taskGroup({ restPeriodSeconds: 0 })] }),
    );
    assert.equal(result.ok, true);
  });

  it("accepts a non-integer restPeriodSeconds — the approved contract requires only a finite number >= 0, not an integer", () => {
    const result = validateUpperLimbMotorScreenAssignment(
      validAssignment({ taskAssignmentGroups: [taskGroup({ restPeriodSeconds: 30.5 })] }),
    );
    assert.equal(result.ok, true);
  });
});

describe("validateUpperLimbMotorScreenAssignment — baselinePainScore numeric boundaries", () => {
  it("rejects NaN baselinePainScore", () => {
    const result = validateUpperLimbMotorScreenAssignment(
      validAssignment({ configuration: validConfiguration({ baselinePainScore: NaN }) }),
    );
    assert.equal(result.ok, false);
  });

  it("rejects Infinity baselinePainScore", () => {
    const result = validateUpperLimbMotorScreenAssignment(
      validAssignment({ configuration: validConfiguration({ baselinePainScore: Infinity }) }),
    );
    assert.equal(result.ok, false);
  });

  it("rejects a baselinePainScore below the approved minimum of 0", () => {
    const result = validateUpperLimbMotorScreenAssignment(
      validAssignment({ configuration: validConfiguration({ baselinePainScore: -1 }) }),
    );
    assert.equal(result.ok, false);
  });

  it("rejects a baselinePainScore above the approved maximum of 10", () => {
    const result = validateUpperLimbMotorScreenAssignment(
      validAssignment({ configuration: validConfiguration({ baselinePainScore: 11 }) }),
    );
    assert.equal(result.ok, false);
  });

  it("accepts the approved minimum baselinePainScore of 0", () => {
    const result = validateUpperLimbMotorScreenAssignment(
      validAssignment({ configuration: validConfiguration({ baselinePainScore: 0 }) }),
    );
    assert.equal(result.ok, true);
  });

  it("accepts the approved maximum baselinePainScore of 10", () => {
    const result = validateUpperLimbMotorScreenAssignment(
      validAssignment({ configuration: validConfiguration({ baselinePainScore: 10 }) }),
    );
    assert.equal(result.ok, true);
  });

  it("rejects a non-integer baselinePainScore", () => {
    const result = validateUpperLimbMotorScreenAssignment(
      validAssignment({ configuration: validConfiguration({ baselinePainScore: 5.5 }) }),
    );
    assert.equal(result.ok, false);
  });
});

describe("validateUpperLimbMotorScreenAssignment — blank/whitespace-only strings", () => {
  const blankValues = ["", "   ", "\t", "\n "];

  for (const blank of blankValues) {
    it(`rejects a blank id (${JSON.stringify(blank)})`, () => {
      const result = validateUpperLimbMotorScreenAssignment(validAssignment({ id: blank }));
      assert.equal(result.ok, false);
    });

    it(`rejects a blank screenDefinitionId (${JSON.stringify(blank)})`, () => {
      const result = validateUpperLimbMotorScreenAssignment(
        validAssignment({ screenDefinitionId: blank }),
      );
      assert.equal(result.ok, false);
    });

    it(`rejects a blank assignedAt (${JSON.stringify(blank)})`, () => {
      const result = validateUpperLimbMotorScreenAssignment(validAssignment({ assignedAt: blank }));
      assert.equal(result.ok, false);
    });

    it(`rejects a blank assignedBy (${JSON.stringify(blank)})`, () => {
      const result = validateUpperLimbMotorScreenAssignment(validAssignment({ assignedBy: blank }));
      assert.equal(result.ok, false);
    });

    it(`rejects a blank targetPlacement.direction (${JSON.stringify(blank)})`, () => {
      const result = validateUpperLimbMotorScreenAssignment(
        validAssignment({
          taskAssignmentGroups: [taskGroup({ targetPlacement: targetPlacement({ direction: blank }) })],
        }),
      );
      assert.equal(result.ok, false);
    });

    it(`rejects a blank targetPlacement.height (${JSON.stringify(blank)})`, () => {
      const result = validateUpperLimbMotorScreenAssignment(
        validAssignment({
          taskAssignmentGroups: [taskGroup({ targetPlacement: targetPlacement({ height: blank }) })],
        }),
      );
      assert.equal(result.ok, false);
    });

    it(`rejects a blank targetPlacement.distance (${JSON.stringify(blank)})`, () => {
      const result = validateUpperLimbMotorScreenAssignment(
        validAssignment({
          taskAssignmentGroups: [taskGroup({ targetPlacement: targetPlacement({ distance: blank }) })],
        }),
      );
      assert.equal(result.ok, false);
    });

    it(`rejects a blank permittedMovementRange.clinicianDescription (${JSON.stringify(blank)})`, () => {
      const result = validateUpperLimbMotorScreenAssignment(
        validAssignment({
          configuration: validConfiguration({
            permittedMovementRange: { kind: "configured", clinicianDescription: blank },
          }),
        }),
      );
      assert.equal(result.ok, false);
    });
  }
});

describe("validateUpperLimbMotorScreenAssignment — malformed top-level candidates", () => {
  it("rejects null", () => {
    assert.equal(validateUpperLimbMotorScreenAssignment(null).ok, false);
  });

  it("rejects undefined", () => {
    assert.equal(validateUpperLimbMotorScreenAssignment(undefined).ok, false);
  });

  it("rejects a string", () => {
    assert.equal(validateUpperLimbMotorScreenAssignment("not-an-assignment").ok, false);
  });

  it("rejects a number", () => {
    assert.equal(validateUpperLimbMotorScreenAssignment(42).ok, false);
  });

  it("rejects an array", () => {
    assert.equal(validateUpperLimbMotorScreenAssignment([]).ok, false);
  });

  it("rejects an empty object", () => {
    assert.equal(validateUpperLimbMotorScreenAssignment({}).ok, false);
  });
});

describe("validateUpperLimbMotorScreenAssignment — malformed nested objects", () => {
  it("rejects configuration as null", () => {
    const result = validateUpperLimbMotorScreenAssignment(validAssignment({ configuration: null }));
    assert.equal(result.ok, false);
  });

  it("rejects taskAssignmentGroups as a non-array", () => {
    const result = validateUpperLimbMotorScreenAssignment(
      validAssignment({ taskAssignmentGroups: "not-an-array" }),
    );
    assert.equal(result.ok, false);
  });

  it("rejects a null group inside taskAssignmentGroups", () => {
    const result = validateUpperLimbMotorScreenAssignment(
      validAssignment({ taskAssignmentGroups: [null] }),
    );
    assert.equal(result.ok, false);
  });

  it("rejects targetPlacement as null", () => {
    const result = validateUpperLimbMotorScreenAssignment(
      validAssignment({ taskAssignmentGroups: [taskGroup({ targetPlacement: null })] }),
    );
    assert.equal(result.ok, false);
  });

  it("rejects a malformed permittedMovementRange object (unknown kind)", () => {
    const result = validateUpperLimbMotorScreenAssignment(
      validAssignment({
        configuration: validConfiguration({ permittedMovementRange: { kind: "unbounded" } }),
      }),
    );
    assert.equal(result.ok, false);
  });

  it("rejects a malformed permittedMovementRange object (no kind at all)", () => {
    const result = validateUpperLimbMotorScreenAssignment(
      validAssignment({
        configuration: validConfiguration({ permittedMovementRange: { foo: "bar" } }),
      }),
    );
    assert.equal(result.ok, false);
  });
});

describe("validateUpperLimbMotorScreenAssignment — safety vocabulary denylist", () => {
  it("rejects an assignment payload carrying a forbidden automated-claim key", () => {
    const assignment = validAssignment() as Record<string, unknown>;
    assignment.diagnosis = "stroke";
    const result = validateUpperLimbMotorScreenAssignment(assignment);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "forbidden_safety_vocabulary");
  });

  it("rejects an assignment payload carrying a nested fmaScore-style key", () => {
    const assignment = validAssignment() as Record<string, unknown>;
    (assignment.configuration as Record<string, unknown>).fmaItemScore = 3;
    const result = validateUpperLimbMotorScreenAssignment(assignment);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "forbidden_safety_vocabulary");
  });
});
