import type { SkillRuntimeAuditSummary, SkillRuntimeMode } from "../skill-runtime";
import type { DryRunRiskLevel } from "../skill-system/execution-plan";

export type ScheduledWorkflowSchedule =
  | {
      type: "one-time";
      runAt: string;
      timezone?: string;
    }
  | {
      type: "recurring";
      startsAt: string;
      timezone?: string;
      interval: "hourly" | "daily" | "weekly" | "monthly" | "cron";
      cron?: string;
      endsAt?: string;
      maxOccurrences?: number;
    };

export type ScheduledWorkflowStepType =
  | "content:create"
  | "content:schedule"
  | "browser:read"
  | "browser:write"
  | "computer:observe"
  | "computer:act"
  | "content:publish"
  | "content:reply";

export type ScheduledWorkflowStepInput = {
  id?: string;
  type: ScheduledWorkflowStepType | string;
  description: string;
  input?: unknown;
  publisherPlan?: {
    planId: string;
    platform: string;
    plannedOnly: true;
  };
};

export type ScheduledWorkflowPlanRequest = {
  workflowName?: string;
  goal: string;
  mode?: SkillRuntimeMode;
  schedule: ScheduledWorkflowSchedule;
  steps: ScheduledWorkflowStepInput[];
};

export type ScheduledWorkflowStepPlan = {
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
  publisherPlan?: {
    planId: string;
    platform: string;
    plannedOnly: true;
  };
  summary: string;
};

export type ScheduledWorkflowPlanResult = {
  workflowId: string;
  workflowName: string;
  goal: string;
  mode: SkillRuntimeMode;
  schedule: ScheduledWorkflowSchedule;
  steps: ScheduledWorkflowStepPlan[];
  riskLevel: DryRunRiskLevel;
  requiresApproval: boolean;
  blockedReasons: string[];
  summary: string;
  auditSummary: SkillRuntimeAuditSummary & {
    realTimerOperation: false;
    realSchedulerOperation: false;
  };
};
