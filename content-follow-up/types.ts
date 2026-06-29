import type { SkillRuntimeAuditSummary } from "../skill-runtime";
import type { DryRunRiskLevel } from "../skill-system/execution-plan";

export type ContentFollowUpPlatform =
  | "xiaohongshu"
  | "douyin"
  | "wechat_public_account"
  | "generic_web_platform";

export type ContentFollowUpSignalCategory =
  | "leads"
  | "questions"
  | "negative_feedback"
  | "objections"
  | "feature_requests"
  | "common_pain_points";

export type ContentFollowUpContentType =
  | "short_post"
  | "long_post"
  | "faq"
  | "tutorial"
  | "case_study"
  | "comparison";

export type ContentFollowUpPriority = "low" | "medium" | "high";

export type ContentFollowUpSignalInput = {
  category: ContentFollowUpSignalCategory | string;
  examples?: string[];
  summary?: string;
};

export type ContentFollowUpPlanRequest = {
  platform: ContentFollowUpPlatform | string;
  goal: string;
  signals?: ContentFollowUpSignalInput[];
  replyMonitorPlan?: {
    planId: string;
    platform: string;
    plannedOnly: true;
  };
};

export type ContentFollowUpIdea = {
  id: string;
  title: string;
  angle: string;
  platform: string;
  contentType: ContentFollowUpContentType;
  priority: ContentFollowUpPriority;
  reason: string;
  sourceSignal: string;
  riskLevel: DryRunRiskLevel;
  requiresApproval: boolean;
  blockedReasons: string[];
};

export type ContentFollowUpPlanResult = {
  planId: string;
  platform: string;
  goal: string;
  ideas: ContentFollowUpIdea[];
  riskLevel: DryRunRiskLevel;
  requiresApproval: boolean;
  blockedReasons: string[];
  permissions: string[];
  capabilities: string[];
  summary: string;
  plannedOnly: true;
  replyMonitorPlan?: {
    planId: string;
    platform: string;
    plannedOnly: true;
  };
  auditSummary: SkillRuntimeAuditSummary & {
    realSchedulerOperation: false;
    realReplyOperation: false;
    realCommentReadOperation: false;
  };
};
