/**
 * SSR-safe radio group identifiers for PrescribedSideSelector instances.
 */

export type PrescribedSideRadioIds = {
  groupName: string;
  leftInputId: string;
  rightInputId: string;
};

function sanitizeIdPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

/** Builds unique radio group and input ids for one selector instance. */
export function buildPrescribedSideRadioIds(
  groupIdPrefix: string,
  instanceId: string,
): PrescribedSideRadioIds {
  const prefix = sanitizeIdPart(groupIdPrefix);
  const instance = sanitizeIdPart(instanceId);
  const groupName = `${prefix}-${instance}`;
  return {
    groupName,
    leftInputId: `${groupName}-left`,
    rightInputId: `${groupName}-right`,
  };
}
