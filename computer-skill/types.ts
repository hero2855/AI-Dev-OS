import type {
  SkillRuntimeAuditSummary,
  SkillRuntimeMode,
  SkillRuntimeSafetyCheck,
  SkillRuntimeStatus,
} from "../skill-runtime";
import type { DryRunRiskLevel } from "../skill-system/execution-plan";

export type ComputerSkillV1ActionType = "computer:observe" | "computer:act";

export type ComputerSkillV1Action = {
  type: ComputerSkillV1ActionType | string;
  description: string;
  input?: unknown;
};

export type ComputerSkillV1Request = {
  requestId?: string;
  goal: string;
  skillName?: string;
  mode: SkillRuntimeMode;
  action: ComputerSkillV1Action;
  capabilities?: string[];
  permissions?: string[];
  approvalRecordId?: string;
  approvalGranted?: boolean;
  allowHighRiskMockAction?: boolean;
};

export type ComputerSkillV1PlannedAction = {
  actionType: string;
  description: string;
  mode: SkillRuntimeMode;
  advisoryOnly: true;
  realOperationPerformed: false;
  requiresApproval: boolean;
};

export type ComputerSkillV1Result = {
  requestId: string;
  computerSkillVersion: "v1";
  skillName: string;
  mode: SkillRuntimeMode;
  status: SkillRuntimeStatus;
  actionType: string;
  capabilities: string[];
  permissions: string[];
  riskLevel: DryRunRiskLevel;
  requiresApproval: boolean;
  blockedReasons: string[];
  safetyChecks: SkillRuntimeSafetyCheck[];
  auditSummary: SkillRuntimeAuditSummary;
  approvalRecordId?: string;
  summary: string;
  plannedAction: ComputerSkillV1PlannedAction;
  output?: unknown;
};
