import type { AutopilotApprovalPolicyResult } from "../autopilot-approval";
import type { ContentFollowUpPlanResult } from "../content-follow-up";
import type { PlatformPublisherPlanResult } from "../platform-publisher";
import type { ReplyMonitorPlanResult } from "../reply-monitor";
import type { ScheduledWorkflowPlanResult, ScheduledWorkflowSchedule } from "../scheduled-workflow";
import type { SchedulerBridgePlanResult, SchedulerBridgeType } from "../scheduler-bridge";
import type { SkillRuntimeAuditSummary } from "../skill-runtime";
import type { DryRunRiskLevel } from "../skill-system/execution-plan";
import type { UnattendedRunnerPlanResult } from "../unattended-runner";

export type ControlledEndToEndDemoPlatform =
  | "xiaohongshu"
  | "douyin"
  | "wechat_public_account"
  | "generic_web_platform";

export type ControlledEndToEndDemoMode = "mock" | "planned" | "local";

export type ControlledDemoContentIdea = {
  id: string;
  title: string;
  angle: string;
  bodyOutline: string[];
  shortPostBody: string;
  tags: string[];
  targetPlatform: string;
  suggestedPublishTime: string;
};

export type ControlledDemoStageName =
  | "content_idea"
  | "content_package"
  | "platform_publish_plan"
  | "scheduler_bridge_plan"
  | "reply_monitor_plan"
  | "follow_up_content_plan"
  | "unattended_runner_plan"
  | "autopilot_approval_decisions"
  | "final_demo_report";

export type ControlledDemoStage = {
  id: string;
  name: ControlledDemoStageName;
  status: "planned" | "requires_approval" | "blocked";
  plannedOnly: true;
  riskLevel: DryRunRiskLevel;
  requiresApproval: boolean;
  blockedReasons: string[];
  summary: string;
};

export type ControlledEndToEndDemoRequest = {
  platform?: ControlledEndToEndDemoPlatform | string;
  contentNiche?: string;
  mode?: ControlledEndToEndDemoMode;
  workflowName?: string;
  suggestedPublishTime?: string;
  schedulerType?: SchedulerBridgeType | string;
  recurrence?: ScheduledWorkflowSchedule;
  createRealTask?: boolean;
  runWorkflowNow?: boolean;
  notes?: string[];
};

export type ControlledEndToEndDemoResult = {
  demoId: string;
  mode: ControlledEndToEndDemoMode;
  plannedOnly: true;
  targetPlatform: string;
  contentNiche: string;
  contentIdea: ControlledDemoContentIdea;
  title: string;
  contentAngle: string;
  shortPostBody: string;
  bodyOutline: string[];
  tags: string[];
  suggestedPublishTime: string;
  publishPlan: PlatformPublisherPlanResult;
  schedulerPlan: SchedulerBridgePlanResult;
  scheduledWorkflowPlan: ScheduledWorkflowPlanResult;
  replyMonitorPlan: ReplyMonitorPlanResult;
  followUpContentPlan: ContentFollowUpPlanResult;
  unattendedRunnerPlan: UnattendedRunnerPlanResult;
  approvalPolicyDecisions: AutopilotApprovalPolicyResult[];
  stages: ControlledDemoStage[];
  riskLevel: DryRunRiskLevel;
  requiresApproval: boolean;
  blockedReasons: string[];
  blockedRealActions: string[];
  riskSummary: string;
  finalWorkflowSummary: string;
  summary: string;
  auditSummary: SkillRuntimeAuditSummary & {
    realTimerOperation: false;
    realSchedulerOperation: false;
    realWorkflowExecution: false;
    realReplyOperation: false;
    realCommentReadOperation: false;
    productAppModified: false;
    aiDevOsSkillsModified: false;
  };
};
