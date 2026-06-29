import type { SkillRuntimeAuditSummary } from "../skill-runtime";
import type { DryRunRiskLevel } from "../skill-system/execution-plan";
import type {
  ScheduledWorkflowPlanRequest,
  ScheduledWorkflowPlanResult,
  ScheduledWorkflowSchedule,
  ScheduledWorkflowStepInput,
  ScheduledWorkflowStepPlan,
  ScheduledWorkflowStepType,
} from "./types";

type StepSafetyProfile = {
  capabilities: string[];
  permissions: string[];
  riskLevel: DryRunRiskLevel;
  requiresApproval: boolean;
  plannedOnly: boolean;
};

const stepSafetyProfiles: Record<ScheduledWorkflowStepType, StepSafetyProfile> = {
  "content:create": {
    capabilities: ["content_create"],
    permissions: ["content:create:local"],
    riskLevel: "low",
    requiresApproval: false,
    plannedOnly: true,
  },
  "content:schedule": {
    capabilities: ["content_schedule"],
    permissions: ["content:schedule:preview"],
    riskLevel: "medium",
    requiresApproval: true,
    plannedOnly: true,
  },
  "browser:read": {
    capabilities: ["browser_read"],
    permissions: ["browser:read"],
    riskLevel: "low",
    requiresApproval: false,
    plannedOnly: true,
  },
  "browser:write": {
    capabilities: ["browser_write", "browser_action_planning"],
    permissions: ["browser:write"],
    riskLevel: "blocked",
    requiresApproval: true,
    plannedOnly: true,
  },
  "computer:observe": {
    capabilities: ["computer_observe"],
    permissions: ["computer:observe"],
    riskLevel: "medium",
    requiresApproval: false,
    plannedOnly: true,
  },
  "computer:act": {
    capabilities: ["computer_act", "computer_action_planning"],
    permissions: ["computer:act"],
    riskLevel: "blocked",
    requiresApproval: true,
    plannedOnly: true,
  },
  "content:publish": {
    capabilities: ["content_publish"],
    permissions: ["content:publish"],
    riskLevel: "high",
    requiresApproval: true,
    plannedOnly: true,
  },
  "content:reply": {
    capabilities: ["content_reply"],
    permissions: ["content:reply:preview"],
    riskLevel: "medium",
    requiresApproval: true,
    plannedOnly: true,
  },
};

const dangerousIntentPatterns: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\bclick\b/i,
    reason: "Click actions are blocked in Scheduled Workflow Agent v1",
  },
  {
    pattern: /\b(?:type|enter text)\b/i,
    reason: "Type actions are blocked in Scheduled Workflow Agent v1",
  },
  {
    pattern: /\bsubmit\b/i,
    reason: "Submit actions are blocked in Scheduled Workflow Agent v1",
  },
  {
    pattern: /\bupload\b/i,
    reason: "Upload actions are blocked in Scheduled Workflow Agent v1",
  },
  {
    pattern: /\b(?:login|log in|sign in)\b/i,
    reason: "Login actions are blocked in Scheduled Workflow Agent v1",
  },
  {
    pattern: /\bpay(?:ment)?\b/i,
    reason: "Pay actions are blocked in Scheduled Workflow Agent v1",
  },
  {
    pattern: /\bdelete\b/i,
    reason: "Delete actions are blocked in Scheduled Workflow Agent v1",
  },
  {
    pattern: /\bsend(?:\s+(?:message|messages|email|emails))?\b/i,
    reason: "Send actions are blocked in Scheduled Workflow Agent v1",
  },
];

const riskRank: Record<DryRunRiskLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
  blocked: 4,
};

export function createScheduledWorkflowPlan(request: ScheduledWorkflowPlanRequest): ScheduledWorkflowPlanResult {
  const mode = request.mode ?? "mock";
  const schedule = normalizeSchedule(request.schedule);
  const workflowName = request.workflowName?.trim() || "scheduled-workflow-agent-v1";
  const workflowId = createDeterministicWorkflowId({
    goal: request.goal,
    workflowName,
    schedule,
    steps: request.steps,
  });
  const steps = request.steps.map((step, index) => createStepPlan(step, index));
  const blockedReasons = [
    ...collectWorkflowBlockedReasons(mode),
    ...steps.flatMap((step) => step.blockedReasons.map((reason) => `${step.id}: ${reason}`)),
  ];
  const riskLevel = steps.reduce<DryRunRiskLevel>(
    (current, step) => maxRisk(current, step.riskLevel),
    blockedReasons.length > 0 ? "blocked" : "low",
  );
  const requiresApproval = steps.some((step) => step.requiresApproval) || blockedReasons.length > 0;

  return {
    workflowId,
    workflowName,
    goal: request.goal,
    mode,
    schedule,
    steps,
    riskLevel,
    requiresApproval,
    blockedReasons,
    summary: summarizeWorkflowPlan(schedule, steps, blockedReasons),
    auditSummary: createAuditSummary(mode),
  };
}

function collectWorkflowBlockedReasons(mode: ScheduledWorkflowPlanRequest["mode"]): string[] {
  return mode === "external" ? ["External scheduled workflow runtime is disabled in Scheduled Workflow Agent v1"] : [];
}

function createStepPlan(step: ScheduledWorkflowStepInput, index: number): ScheduledWorkflowStepPlan {
  const id = step.id?.trim() || `step-${index + 1}`;
  const profile = stepSafetyProfiles[step.type as ScheduledWorkflowStepType];
  const blockedReasons = collectStepBlockedReasons(step, profile);
  const requiresApproval = blockedReasons.length > 0 || Boolean(profile?.requiresApproval);
  const riskLevel = blockedReasons.length > 0 ? "blocked" : profile?.riskLevel ?? "blocked";
  const status =
    blockedReasons.length > 0 ? "blocked" : requiresApproval ? "requires_approval" : "planned";

  return {
    id,
    type: step.type,
    description: step.description,
    status,
    plannedOnly: true,
    riskLevel,
    requiresApproval,
    blockedReasons,
    permissions: profile?.permissions ?? [],
    capabilities: profile?.capabilities ?? [],
    publisherPlan: step.type === "content:publish" ? step.publisherPlan : undefined,
    replyMonitorPlan: step.type === "content:reply" ? step.replyMonitorPlan : undefined,
    contentFollowUpPlan: step.type === "content:create" ? step.contentFollowUpPlan : undefined,
    unattendedRunnerPlan: step.type === "content:create" ? step.unattendedRunnerPlan : undefined,
    summary: summarizeStep(step, status, blockedReasons),
  };
}

function collectStepBlockedReasons(
  step: ScheduledWorkflowStepInput,
  profile: StepSafetyProfile | undefined,
): string[] {
  const reasons = new Set<string>();

  if (!profile) {
    reasons.add(`Unsupported scheduled workflow step: ${step.type}`);
  }

  const actionText = stringifyStep(step);

  for (const intent of dangerousIntentPatterns) {
    if (intent.pattern.test(actionText)) {
      reasons.add(intent.reason);
    }
  }

  return [...reasons];
}

function normalizeSchedule(schedule: ScheduledWorkflowSchedule): ScheduledWorkflowSchedule {
  if (schedule.type === "one-time") {
    return {
      type: "one-time",
      runAt: schedule.runAt,
      timezone: schedule.timezone ?? "UTC",
    };
  }

  return {
    type: "recurring",
    startsAt: schedule.startsAt,
    timezone: schedule.timezone ?? "UTC",
    interval: schedule.interval,
    cron: schedule.cron,
    endsAt: schedule.endsAt,
    maxOccurrences: schedule.maxOccurrences,
  };
}

function summarizeWorkflowPlan(
  schedule: ScheduledWorkflowSchedule,
  steps: ScheduledWorkflowStepPlan[],
  blockedReasons: string[],
): string {
  const scheduleText =
    schedule.type === "one-time"
      ? `one-time schedule at ${schedule.runAt}`
      : `recurring ${schedule.interval} schedule starting ${schedule.startsAt}`;
  const approvalText = steps.some((step) => step.requiresApproval)
    ? "Approval is required before any future execution."
    : "No approval is required for the current advisory plan.";
  const blockedText =
    blockedReasons.length > 0
      ? ` Blocked reasons: ${blockedReasons.join("; ")}.`
      : "";

  return `Scheduled Workflow Agent v1 created a deterministic ${scheduleText} with ${steps.length} planned step(s). ${approvalText} No real timer, OS scheduler, browser, computer, network, or publish action was performed.${blockedText}`;
}

function summarizeStep(
  step: ScheduledWorkflowStepInput,
  status: ScheduledWorkflowStepPlan["status"],
  blockedReasons: string[],
): string {
  if (status === "blocked") {
    return `Scheduled workflow step ${step.type} blocked: ${blockedReasons.join("; ")}. Planned only; no real action was performed.`;
  }

  if (status === "requires_approval") {
    return `Scheduled workflow step ${step.type} requires approval and remains planned only. No real action was performed.`;
  }

  return `Scheduled workflow step ${step.type} planned only. No real action was performed.`;
}

function createAuditSummary(mode: ScheduledWorkflowPlanRequest["mode"]): ScheduledWorkflowPlanResult["auditSummary"] {
  const base: SkillRuntimeAuditSummary = {
    realNetworkOperation: false,
    realBrowserOperation: false,
    realComputerOperation: false,
    realShellOperation: false,
    realPublishOperation: false,
    mode: mode ?? "mock",
  };

  return {
    ...base,
    realTimerOperation: false,
    realSchedulerOperation: false,
  };
}

function stringifyStep(step: ScheduledWorkflowStepInput): string {
  if (step.input === undefined) {
    return step.description;
  }

  try {
    return `${step.description} ${JSON.stringify(step.input)}`;
  } catch {
    return step.description;
  }
}

function maxRisk(current: DryRunRiskLevel, next: DryRunRiskLevel): DryRunRiskLevel {
  return riskRank[next] > riskRank[current] ? next : current;
}

function createDeterministicWorkflowId(input: {
  goal: string;
  workflowName: string;
  schedule: ScheduledWorkflowSchedule;
  steps: ScheduledWorkflowStepInput[];
}): string {
  const text = JSON.stringify(input);
  let hash = 0;

  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }

  return `scheduled-v1-${hash.toString(16).padStart(8, "0")}`;
}
