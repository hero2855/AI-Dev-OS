import type { ChangeSetPreview } from "../change-set";
import type { DryRunRiskLevel } from "../skill-system/execution-plan";

export type SkillRuntimeMode = "mock" | "local" | "external";

export type SkillRuntimeStatus = "ready" | "blocked" | "requires_approval" | "completed" | "failed";

export type SkillRuntimeActionType =
  | "github:read"
  | "github:write"
  | "browser:read"
  | "browser:write"
  | "computer:observe"
  | "computer:act"
  | "file:read"
  | "file:write"
  | "content:create"
  | "content:schedule"
  | "content:publish"
  | "content:reply";

export type SkillRuntimeAction = {
  type: SkillRuntimeActionType;
  description: string;
  input?: unknown;
};

export type SkillRuntimeRequest = {
  requestId?: string;
  goal: string;
  skillName: string;
  mode: SkillRuntimeMode;
  action: SkillRuntimeAction;
  capabilities?: string[];
  permissions?: string[];
  approvalRecordId?: string;
  approvalGranted?: boolean;
  allowHighRiskMockAction?: boolean;
  changeSetPreview?: ChangeSetPreview;
};

export type SkillRuntimeSafetyCheck = {
  name: string;
  passed: boolean;
  reason: string;
};

export type SkillRuntimeAuditSummary = {
  realNetworkOperation: false;
  realBrowserOperation: false;
  realComputerOperation: false;
  realShellOperation: false;
  realPublishOperation: false;
  mode: SkillRuntimeMode;
};

export type SkillRuntimeResult = {
  requestId: string;
  skillName: string;
  mode: SkillRuntimeMode;
  status: SkillRuntimeStatus;
  actionType: SkillRuntimeActionType;
  capabilities: string[];
  permissions: string[];
  riskLevel: DryRunRiskLevel;
  requiresApproval: boolean;
  blockedReasons: string[];
  safetyChecks: SkillRuntimeSafetyCheck[];
  auditSummary: SkillRuntimeAuditSummary;
  approvalRecordId?: string;
  changeSetId?: string;
  summary: string;
  output?: unknown;
};

export type SkillRuntimeAdapter = {
  run(request: SkillRuntimeRequest): SkillRuntimeResult;
};
