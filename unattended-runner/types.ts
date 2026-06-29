import type { SkillRuntimeAuditSummary } from "../skill-runtime";
import type { DryRunRiskLevel } from "../skill-system/execution-plan";
import type { ContentFollowUpSignalInput } from "../content-follow-up";
import type { PlatformPublisherPlanResult } from "../platform-publisher";
import type { ReplyMonitorPlanResult } from "../reply-monitor";
import type { ScheduledWorkflowPlanResult, ScheduledWorkflowSchedule } from "../scheduled-workflow";
import type { ContentFollowUpPlanResult } from "../content-follow-up";
import type { AutopilotApprovalPolicyResult } from "../autopilot-approval";

export type UnattendedRunnerPlatform =
  | "xiaohongshu"
  | "douyin"
  | "wechat_public_account"
  | "generic_web_platform";

export type UnattendedRunnerStageType =
  | "scheduled_trigger"
  | "content_creation_plan"
  | "platform_publish_plan"
  | "reply_monitor_plan"
  | "follow_up_content_plan"
  | "next_cycle_plan";

export type UnattendedRunnerStageModule =
  | "scheduled-workflow"
  | "platform-publisher"
  | "reply-monitor"
  | "content-follow-up"
  | "browser-skill"
  | "computer-skill";

export type UnattendedRunnerPlanRequest = {
  platform: UnattendedRunnerPlatform | string;
  goal: string;
  workflowName?: string;
  schedule: ScheduledWorkflowSchedule;
  post?: {
    title?: string;
    body?: string;
    tags?: string[];
    media?: string[];
    scheduledAt?: string;
  };
  signals?: ContentFollowUpSignalInput[];
  notes?: string[];
};

export type UnattendedRunnerPlannedModule = {
  module: UnattendedRunnerStageModule;
  planId?: string;
  actionType?: string;
  plannedOnly: true;
  requiresApproval: boolean;
  riskLevel: DryRunRiskLevel;
};

export type UnattendedRunnerStagePlan = {
  id: string;
  type: UnattendedRunnerStageType;
  description: string;
  status: "planned" | "requires_approval" | "blocked";
  plannedOnly: true;
  riskLevel: DryRunRiskLevel;
  requiresApproval: boolean;
  blockedReasons: string[];
  approvalsNeeded: string[];
  permissions: string[];
  capabilities: string[];
  modules: UnattendedRunnerPlannedModule[];
  approvalPolicyDecision: AutopilotApprovalPolicyResult;
  summary: string;
};

export type UnattendedRunnerPlanResult = {
  planId: string;
  platform: string;
  goal: string;
  schedule: ScheduledWorkflowSchedule;
  stages: UnattendedRunnerStagePlan[];
  scheduledWorkflowPlan: ScheduledWorkflowPlanResult;
  platformPublisherPlan: PlatformPublisherPlanResult;
  replyMonitorPlan: ReplyMonitorPlanResult;
  contentFollowUpPlan: ContentFollowUpPlanResult;
  riskLevel: DryRunRiskLevel;
  requiresApproval: boolean;
  blockedReasons: string[];
  approvalsNeeded: string[];
  permissions: string[];
  capabilities: string[];
  summary: string;
  plannedOnly: true;
  auditSummary: SkillRuntimeAuditSummary & {
    realTimerOperation: false;
    realSchedulerOperation: false;
    realReplyOperation: false;
    realCommentReadOperation: false;
  };
};
