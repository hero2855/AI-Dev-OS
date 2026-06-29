import type { SkillRuntimeAuditSummary } from "../skill-runtime";
import type { DryRunRiskLevel } from "../skill-system/execution-plan";

export type AutopilotApprovalDecisionLevel = "auto_allowed" | "approval_required" | "blocked";

export type AutopilotApprovalActionCategory =
  | "content:create"
  | "content:schedule"
  | "content:publish"
  | "content:reply"
  | "content:delete"
  | "browser:read"
  | "browser:write"
  | "computer:observe"
  | "computer:act"
  | "account:login"
  | "payment:act"
  | "file:read"
  | "file:write";

export type AutopilotApprovalPolicyRequest = {
  action: AutopilotApprovalActionCategory | string;
  description?: string;
  riskLevel?: DryRunRiskLevel;
  context?: {
    sensitive?: boolean;
    negativeFeedback?: boolean;
    accountSetting?: boolean;
    plannedOnly?: boolean;
  };
};

export type AutopilotApprovalPolicyResult = {
  policyDecision: AutopilotApprovalDecisionLevel;
  action: string;
  riskLevel: DryRunRiskLevel;
  requiresApproval: boolean;
  blockedReasons: string[];
  approvalReason: string;
  capabilities: string[];
  permissions: string[];
  summary: string;
  plannedOnly: true;
  auditSummary: SkillRuntimeAuditSummary & {
    realTimerOperation: false;
    realSchedulerOperation: false;
    realReplyOperation: false;
    realCommentReadOperation: false;
  };
};
