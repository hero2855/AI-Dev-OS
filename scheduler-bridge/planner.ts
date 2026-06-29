import type { SkillRuntimeAuditSummary } from "../skill-runtime";
import type { DryRunRiskLevel } from "../skill-system/execution-plan";
import { decideAutopilotApprovalPolicy } from "../autopilot-approval";
import type {
  SchedulerBridgePlanRequest,
  SchedulerBridgePlanResult,
  SchedulerBridgeType,
} from "./types";

const supportedSchedulerTypes = new Set<SchedulerBridgeType>([
  "windows_task_scheduler",
  "local_runner",
  "hermes",
  "n8n",
  "chatgpt_scheduled_task",
  "github_actions_private_runner",
  "manual",
]);

const externalSchedulerTypes = new Set<SchedulerBridgeType>([
  "windows_task_scheduler",
  "hermes",
  "n8n",
  "chatgpt_scheduled_task",
  "github_actions_private_runner",
]);

const unsafeIntentPatterns: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\b(?:create|register|start|enable|install)\s+(?:a\s+)?(?:real\s+)?(?:task|scheduled task|scheduler|timer)\b/i,
    reason: "Real scheduler task creation is blocked in Scheduler Bridge Plan v1",
  },
  {
    pattern: /\b(?:run|execute|trigger)\s+(?:the\s+)?(?:workflow|job|automation)\s+(?:now|for real|live)\b/i,
    reason: "Real workflow execution is blocked in Scheduler Bridge Plan v1",
  },
  {
    pattern: /\b(?:open|control)\s+(?:a\s+)?(?:real\s+)?browser\b|\bclick\b|\btype\b|\bsubmit\b|\bupload\b|\blogin\b/i,
    reason: "Real browser/computer actions are blocked in Scheduler Bridge Plan v1",
  },
  {
    pattern: /\b(?:publish|post|reply|comment|send)\s+(?:now|for real|live)?\b/i,
    reason: "Publish/reply/send actions are blocked in Scheduler Bridge Plan v1",
  },
];

const riskRank: Record<DryRunRiskLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
  blocked: 4,
};

export function createSchedulerBridgePlan(request: SchedulerBridgePlanRequest): SchedulerBridgePlanResult {
  const blockedReasons = collectBlockedReasons(request);
  const schedulerType = request.schedulerType;
  const requiredApprovals = collectRequiredApprovals(request, blockedReasons);
  const riskLevel = determineRiskLevel(request, blockedReasons);
  const approvalPolicyDecision = decideAutopilotApprovalPolicy({
    action: "content:schedule",
    description: `Plan scheduler bridge ${schedulerType} for ${request.targetWorkflow.workflowName}.`,
    riskLevel,
    context: { plannedOnly: true },
  });
  const requiresApproval =
    blockedReasons.length > 0 ||
    requiredApprovals.length > 0 ||
    approvalPolicyDecision.requiresApproval ||
    approvalPolicyDecision.policyDecision === "blocked";

  return {
    planId: createDeterministicPlanId(request),
    schedulerType,
    triggerTime: request.triggerTime,
    recurrence: normalizeRecurrence(request.recurrence),
    targetWorkflow: request.targetWorkflow,
    dryRunCommand: request.dryRunCommand?.trim() || createDefaultDryRunCommand(request),
    requiredApprovals,
    environmentRequirements: createEnvironmentRequirements(request),
    safetyNotes: createSafetyNotes(request, blockedReasons),
    riskLevel,
    requiresApproval,
    blockedReasons,
    approvalPolicyDecision,
    summary: summarizePlan(request, requiredApprovals, blockedReasons),
    plannedOnly: true,
    auditSummary: createAuditSummary(),
  };
}

function collectBlockedReasons(request: SchedulerBridgePlanRequest): string[] {
  const reasons = new Set<string>();

  if (!supportedSchedulerTypes.has(request.schedulerType as SchedulerBridgeType)) {
    reasons.add(`Unsupported scheduler type: ${request.schedulerType}`);
  }

  if (request.createRealTask === true) {
    reasons.add("Real scheduler task creation is blocked in Scheduler Bridge Plan v1");
  }

  if (request.runWorkflowNow === true) {
    reasons.add("Real workflow execution is blocked in Scheduler Bridge Plan v1");
  }

  const text = stringifyRequestForSafety(request);
  for (const intent of unsafeIntentPatterns) {
    if (intent.pattern.test(text)) {
      reasons.add(intent.reason);
    }
  }

  return [...reasons];
}

function collectRequiredApprovals(request: SchedulerBridgePlanRequest, blockedReasons: string[]): string[] {
  const approvals = new Set<string>();

  if (externalSchedulerTypes.has(request.schedulerType as SchedulerBridgeType)) {
    approvals.add("external_scheduler_bridge");
  }

  if (request.schedulerType === "local_runner") {
    approvals.add("local_runner_bridge");
  }

  if (request.createRealTask === true || blockedReasons.some((reason) => reason.toLowerCase().includes("scheduler task"))) {
    approvals.add("real_task_creation_blocked");
  }

  if (request.runWorkflowNow === true || blockedReasons.some((reason) => reason.toLowerCase().includes("workflow execution"))) {
    approvals.add("workflow_execution_blocked");
  }

  if (request.targetWorkflow.unattendedRunnerPlan) {
    approvals.add("unattended_runner_bridge");
  }

  return [...approvals];
}

function determineRiskLevel(request: SchedulerBridgePlanRequest, blockedReasons: string[]): DryRunRiskLevel {
  if (blockedReasons.length > 0) {
    return "blocked";
  }

  let riskLevel: DryRunRiskLevel = "low";

  if (externalSchedulerTypes.has(request.schedulerType as SchedulerBridgeType)) {
    riskLevel = maxRisk(riskLevel, "medium");
  }

  if (request.targetWorkflow.unattendedRunnerPlan) {
    riskLevel = maxRisk(riskLevel, "medium");
  }

  return riskLevel;
}

function normalizeRecurrence(recurrence: SchedulerBridgePlanRequest["recurrence"]): SchedulerBridgePlanRequest["recurrence"] {
  if (recurrence.type === "one-time") {
    return {
      type: "one-time",
      runAt: recurrence.runAt,
      timezone: recurrence.timezone ?? "UTC",
    };
  }

  return {
    type: "recurring",
    startsAt: recurrence.startsAt,
    timezone: recurrence.timezone ?? "UTC",
    interval: recurrence.interval,
    cron: recurrence.cron,
    endsAt: recurrence.endsAt,
    maxOccurrences: recurrence.maxOccurrences,
  };
}

function createDefaultDryRunCommand(request: SchedulerBridgePlanRequest): string {
  const encodedWorkflow = request.targetWorkflow.workflowName.replace(/[^a-zA-Z0-9:_-]/g, "-");
  return `ai-dev-os scheduler-bridge dry-run --scheduler ${request.schedulerType} --workflow ${encodedWorkflow}`;
}

function createEnvironmentRequirements(request: SchedulerBridgePlanRequest): string[] {
  const requirements = new Set<string>(request.environmentRequirements ?? []);
  requirements.add("planning-only runtime");
  requirements.add("approval policy metadata available");
  requirements.add("no real scheduler registration");

  switch (request.schedulerType) {
    case "windows_task_scheduler":
      requirements.add("Windows Task Scheduler available only after separate human-approved setup");
      break;
    case "local_runner":
      requirements.add("local runner dry-run entrypoint available");
      break;
    case "hermes":
      requirements.add("Hermes bridge credentials withheld from planner");
      break;
    case "n8n":
      requirements.add("n8n webhook or workflow id stored outside planner");
      break;
    case "chatgpt_scheduled_task":
      requirements.add("ChatGPT Scheduled Task must be created manually outside this planner");
      break;
    case "github_actions_private_runner":
      requirements.add("private runner workflow dispatch remains disabled until approval");
      break;
    case "manual":
      requirements.add("manual dry-run trigger only");
      break;
  }

  return [...requirements];
}

function createSafetyNotes(request: SchedulerBridgePlanRequest, blockedReasons: string[]): string[] {
  const notes = new Set<string>(request.safetyNotes ?? []);
  notes.add("Planning-only scheduler bridge; no OS task, timer, workflow, browser, computer, network, publish, reply, send, upload, login, click, type, submit, pay, or delete action is performed.");
  notes.add("Dry-run command is metadata for a future human-approved runner.");
  notes.add("Autopilot approval policy metadata is attached before any future execution.");

  if (blockedReasons.length > 0) {
    notes.add(`Blocked reasons: ${blockedReasons.join("; ")}`);
  }

  return [...notes];
}

function summarizePlan(
  request: SchedulerBridgePlanRequest,
  requiredApprovals: string[],
  blockedReasons: string[],
): string {
  const recurrenceText =
    request.recurrence.type === "one-time"
      ? `one-time trigger at ${request.triggerTime}`
      : `recurring ${request.recurrence.interval} trigger starting ${request.triggerTime}`;
  const approvalText =
    requiredApprovals.length > 0
      ? ` Required approvals: ${requiredApprovals.join(", ")}.`
      : " No bridge-specific approval is required for the current manual dry-run plan.";
  const blockedText = blockedReasons.length > 0 ? ` Blocked reasons: ${blockedReasons.join("; ")}.` : "";

  return `Scheduler Bridge Plan v1 created a deterministic planned-only ${request.schedulerType} bridge for ${request.targetWorkflow.workflowName} with ${recurrenceText}.${approvalText} No real scheduler, timer, workflow, browser, computer, network, publish, reply, comment, send, upload, login, click, type, submit, pay, or delete action was performed.${blockedText}`;
}

function stringifyRequestForSafety(request: SchedulerBridgePlanRequest): string {
  try {
    return JSON.stringify({
      schedulerType: request.schedulerType,
      targetWorkflow: request.targetWorkflow,
      dryRunCommand: request.dryRunCommand,
      environmentRequirements: request.environmentRequirements,
      safetyNotes: request.safetyNotes,
    });
  } catch {
    return `${request.schedulerType} ${request.targetWorkflow.workflowName}`;
  }
}

function createAuditSummary(): SchedulerBridgePlanResult["auditSummary"] {
  const base: SkillRuntimeAuditSummary = {
    realNetworkOperation: false,
    realBrowserOperation: false,
    realComputerOperation: false,
    realShellOperation: false,
    realPublishOperation: false,
    mode: "mock",
  };

  return {
    ...base,
    realTimerOperation: false,
    realSchedulerOperation: false,
    realWorkflowExecution: false,
    realReplyOperation: false,
    realCommentReadOperation: false,
  };
}

function maxRisk(current: DryRunRiskLevel, next: DryRunRiskLevel): DryRunRiskLevel {
  return riskRank[next] > riskRank[current] ? next : current;
}

function createDeterministicPlanId(request: SchedulerBridgePlanRequest): string {
  const text = JSON.stringify({
    schedulerType: request.schedulerType,
    triggerTime: request.triggerTime,
    recurrence: normalizeRecurrence(request.recurrence),
    targetWorkflow: request.targetWorkflow,
    dryRunCommand: request.dryRunCommand,
    createRealTask: request.createRealTask,
    runWorkflowNow: request.runWorkflowNow,
    environmentRequirements: request.environmentRequirements,
    safetyNotes: request.safetyNotes,
  });
  let hash = 0;

  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }

  return `scheduler-bridge-v1-${hash.toString(16).padStart(8, "0")}`;
}
