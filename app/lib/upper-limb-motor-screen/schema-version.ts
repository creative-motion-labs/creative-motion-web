/**
 * Shared schema_version stamped on both persisted Upper-Limb Motor
 * Screen tables (assignment_payload and result_payload — migrations
 * 019/020). One value versions the whole persistence contract
 * generation; the two tables are not versioned independently.
 */
export const UPPER_LIMB_MOTOR_SCREEN_SCHEMA_VERSION = "upper-limb-motor-screen/v1" as const;
export type UpperLimbMotorScreenSchemaVersion = typeof UPPER_LIMB_MOTOR_SCREEN_SCHEMA_VERSION;
