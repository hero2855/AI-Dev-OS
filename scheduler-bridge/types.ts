import type { SkillRuntimeAuditSummary } from "../skill-runtime";
import type { DryRunRiskLevel } from "../skill-system/execution-plan";
import type { ScheduledWorkflowPlanResult, ScheduledWorkflowSchedule } from "../scheduled-workflow";
import type { AutopilotApprovalPolicyResult } from "../autopilot-approval";

export type SchedulerBridgeType =
  | "windows_task_scheduler"
  | "local_runner"
  | "hermes"
  | "n8n"
  | "chatgpt_scheduled_task"
  | "github_actions_private_runner"
  | "manual";

export type SchedulerBridgeTargetWorkflow = {
  workflowName: string;
  goal: string;
  plannedOnly: true;
  scheduledWorkflowPlan?: Pick<ScheduledWorkflowPlanResult, "workflowId" | "workflowName"> & {
    plannedOnly: true;
  };
  unattendedRunnerPlan?: {
    planId: string;
    platform: string;
    plannedOnly: true;
  };
};

export type SchedulerBridgePlanRequest = {
  schedulerType: SchedulerBridgeType | string;
  triggerTime: string;
  recurrence: ScheduledWorkflowSchedule;
  targetWorkflow: SchedulerBridgeTargetWorkflow;
  dryRunCommand?: string;
  createRealTask?: boolean;
  runWorkflowNow?: boolean;
  environmentRequirements?: string[];
  safetyNotes?: string[];
  approvalGranted?: boolean;
};

export type SchedulerBridgePlanResult = {
  planId: string;
  schedulerType: string;
  triggerTime: string;
  recurrence: ScheduledWorkflowSchedule;
  targetWorkflow: SchedulerBridgeTargetWorkflow;
  dryRunCommand: string;
  requiredApprovals: string[];
  environmentRequirements: string[];
  safetyNotes: string[];
  riskLevel: DryRunRiskLevel;
  requiresApproval: boolean;
  blockedReasons: string[];
  approvalPolicyDecision: AutopilotApprovalPolicyResult;
  summary: string;
  plannedOnly: true;
  auditSummary: SkillRuntimeAuditSummary & {
    realTimerOperation: false;
    realSchedulerOperation: false;
    realWorkflowExecution: false;
    realReplyOperation: false;
    realCommentReadOperation: false;
  };
};
