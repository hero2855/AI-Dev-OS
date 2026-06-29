import type { SkillRuntimeAuditSummary } from "../skill-runtime";
import type { DryRunRiskLevel } from "../skill-system/execution-plan";

export type PlatformPublisherPlatform =
  | "xiaohongshu"
  | "douyin"
  | "wechat_public_account"
  | "generic_web_platform";

export type PlatformPublishStepType =
  | "open_platform"
  | "check_login_state"
  | "upload_media"
  | "fill_title"
  | "fill_body"
  | "add_tags"
  | "set_schedule_time"
  | "preview_post"
  | "submit_publish";

export type PlatformPublishStepInput = {
  id?: string;
  type: PlatformPublishStepType | string;
  description?: string;
  input?: unknown;
};

export type PlatformPublisherPlanRequest = {
  platform: PlatformPublisherPlatform | string;
  goal: string;
  post?: {
    title?: string;
    body?: string;
    tags?: string[];
    media?: string[];
    scheduledAt?: string;
  };
  steps?: PlatformPublishStepInput[];
};

export type PlatformPublisherStepPlan = {
  id: string;
  type: string;
  description: string;
  status: "requires_approval" | "blocked";
  plannedOnly: true;
  riskLevel: DryRunRiskLevel;
  requiresApproval: true;
  blockedReasons: string[];
  permissions: string[];
  capabilities: string[];
  summary: string;
};

export type PlatformPublisherPlanResult = {
  planId: string;
  platform: string;
  goal: string;
  steps: PlatformPublisherStepPlan[];
  riskLevel: DryRunRiskLevel;
  requiresApproval: boolean;
  blockedReasons: string[];
  permissions: string[];
  capabilities: string[];
  summary: string;
  plannedOnly: true;
  auditSummary: SkillRuntimeAuditSummary & {
    realSchedulerOperation: false;
  };
};
