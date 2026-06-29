import type { SkillRuntimeAuditSummary } from "../skill-runtime";
import type { DryRunRiskLevel } from "../skill-system/execution-plan";

export type ReplyMonitorPlatform =
  | "xiaohongshu"
  | "douyin"
  | "wechat_public_account"
  | "generic_web_platform";

export type ReplyMonitorStepType =
  | "open_platform"
  | "check_notifications"
  | "read_comments"
  | "classify_comments"
  | "detect_leads_questions_negative_feedback"
  | "draft_reply"
  | "plan_reply_action"
  | "plan_follow_up_content_idea";

export type ReplyMonitorStepInput = {
  id?: string;
  type: ReplyMonitorStepType | string;
  description?: string;
  input?: unknown;
};

export type ReplyMonitorPlanRequest = {
  platform: ReplyMonitorPlatform | string;
  goal: string;
  monitorWindow?: {
    startsAt?: string;
    endsAt?: string;
    timezone?: string;
  };
  steps?: ReplyMonitorStepInput[];
};

export type ReplyMonitorStepPlan = {
  id: string;
  type: string;
  description: string;
  status: "planned" | "requires_approval" | "blocked";
  plannedOnly: true;
  riskLevel: DryRunRiskLevel;
  requiresApproval: boolean;
  blockedReasons: string[];
  permissions: string[];
  capabilities: string[];
  summary: string;
};

export type ReplyMonitorPlanResult = {
  planId: string;
  platform: string;
  goal: string;
  steps: ReplyMonitorStepPlan[];
  riskLevel: DryRunRiskLevel;
  requiresApproval: boolean;
  blockedReasons: string[];
  permissions: string[];
  capabilities: string[];
  summary: string;
  plannedOnly: true;
  auditSummary: SkillRuntimeAuditSummary & {
    realSchedulerOperation: false;
    realReplyOperation: false;
    realCommentReadOperation: false;
  };
};
