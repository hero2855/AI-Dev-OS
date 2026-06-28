import type {
  SkillRuntimeAuditSummary,
  SkillRuntimeMode,
  SkillRuntimeSafetyCheck,
  SkillRuntimeStatus,
} from "../skill-runtime";
import type { DryRunRiskLevel } from "../skill-system/execution-plan";

export type BrowserSkillV1ActionType = "browser:read" | "browser:write";

export type BrowserSkillV1Action = {
  type: BrowserSkillV1ActionType | string;
  description: string;
  input?: unknown;
};

export type BrowserSkillV1Request = {
  requestId?: string;
  goal: string;
  skillName?: string;
  mode: SkillRuntimeMode;
  action: BrowserSkillV1Action;
  capabilities?: string[];
  permissions?: string[];
  approvalRecordId?: string;
  approvalGranted?: boolean;
  allowHighRiskMockAction?: boolean;
};

export type BrowserSkillV1PlannedAction = {
  actionType: string;
  description: string;
  mode: SkillRuntimeMode;
  advisoryOnly: true;
  realOperationPerformed: false;
  requiresApproval: boolean;
};

export type BrowserSkillV1Result = {
  requestId: string;
  browserSkillVersion: "v1";
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
  plannedAction: BrowserSkillV1PlannedAction;
  output?: unknown;
};
