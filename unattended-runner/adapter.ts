import type { SkillRuntimeAuditSummary } from "../skill-runtime";
import type { DryRunRiskLevel } from "../skill-system/execution-plan";
import { createContentFollowUpPlan } from "../content-follow-up";
import { createPlatformPublisherPlan } from "../platform-publisher";
import { createReplyMonitorPlan } from "../reply-monitor";
import { createScheduledWorkflowPlan } from "../scheduled-workflow";
import { decideAutopilotApprovalPolicy } from "../autopilot-approval";
import type { AutopilotApprovalPolicyRequest } from "../autopilot-approval";
import type {
  UnattendedRunnerPlanRequest,
  UnattendedRunnerPlanResult,
  UnattendedRunnerPlatform,
  UnattendedRunnerPlannedModule,
  UnattendedRunnerStagePlan,
  UnattendedRunnerStageType,
} from "./types";

const supportedPlatforms = new Set<UnattendedRunnerPlatform>([
  "xiaohongshu",
  "douyin",
  "wechat_public_account",
  "generic_web_platform",
]);

const unsafeIntentPatterns: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\b(?:run|create|start)\s+(?:a\s+)?(?:real\s+)?(?:timer|scheduler|scheduled task)\b/i,
    reason: "Real scheduler actions are blocked in Unattended Workflow Runner Plan v1",
  },
  {
    pattern: /\b(?:open|run|control)\s+(?:a\s+)?(?:real\s+)?browser\b/i,
    reason: "Real browser actions are blocked in Unattended Workflow Runner Plan v1",
  },
  {
    pattern: /\b(?:control|operate|use)\s+(?:the\s+)?(?:real\s+)?computer\b/i,
    reason: "Real computer actions are blocked in Unattended Workflow Runner Plan v1",
  },
  {
    pattern: /\b(?:publish|post)\s+(?:now|for real|live)\b|\breal\s+publish\b/i,
    reason: "Publish actions are blocked in Unattended Workflow Runner Plan v1",
  },
  {
    pattern: /\b(?:reply|comment)\s+(?:now|for real|live)\b|\breal\s+(?:reply|comment)\b/i,
    reason: "Reply/comment actions are blocked in Unattended Workflow Runner Plan v1",
  },
  {
    pattern: /\bsend(?:\s+(?:reply|replies|message|messages|email|emails))?\s+(?:now|for real|live)?\b/i,
    reason: "Send actions are blocked in Unattended Workflow Runner Plan v1",
  },
  {
    pattern: /\bupload\b/i,
    reason: "Upload actions are blocked in Unattended Workflow Runner Plan v1",
  },
  {
    pattern: /\b(?:login|log in|sign in)\b/i,
    reason: "Login actions are blocked in Unattended Workflow Runner Plan v1",
  },
  {
    pattern: /\bclick\b/i,
    reason: "Click actions are blocked in Unattended Workflow Runner Plan v1",
  },
  {
    pattern: /\b(?:type|enter text)\b/i,
    reason: "Type actions are blocked in Unattended Workflow Runner Plan v1",
  },
  {
    pattern: /\bsubmit\b/i,
    reason: "Submit actions are blocked in Unattended Workflow Runner Plan v1",
  },
  {
    pattern: /\bpay(?:ment)?\b/i,
    reason: "Pay actions are blocked in Unattended Workflow Runner Plan v1",
  },
  {
    pattern: /\bdelete\b/i,
    reason: "Delete actions are blocked in Unattended Workflow Runner Plan v1",
  },
];

const riskRank: Record<DryRunRiskLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
  blocked: 4,
};

export function createUnattendedWorkflowRunnerPlan(
  request: UnattendedRunnerPlanRequest,
): UnattendedRunnerPlanResult {
  const platformPublisherPlan = createPlatformPublisherPlan({
    platform: request.platform,
    goal: `Plan platform publishing for unattended workflow: ${request.goal}`,
    post: request.post,
  });
  const replyMonitorPlan = createReplyMonitorPlan({
    platform: request.platform,
    goal: `Plan reply monitoring for unattended workflow: ${request.goal}`,
  });
  const contentFollowUpPlan = createContentFollowUpPlan({
    platform: request.platform,
    goal: `Plan follow-up content for unattended workflow: ${request.goal}`,
    signals: request.signals,
    replyMonitorPlan: {
      planId: replyMonitorPlan.planId,
      platform: replyMonitorPlan.platform,
      plannedOnly: true,
    },
  });
  const scheduledWorkflowPlan = createScheduledWorkflowPlan({
    workflowName: request.workflowName ?? "unattended-workflow-runner-v1",
    goal: request.goal,
    schedule: request.schedule,
    steps: [
      {
        id: "content-create",
        type: "content:create",
        description: "Create planned follow-up content locally.",
        contentFollowUpPlan: {
          planId: contentFollowUpPlan.planId,
          platform: contentFollowUpPlan.platform,
          plannedOnly: true,
        },
      },
      {
        id: "platform-publish",
        type: "content:publish",
        description: "Plan platform publishing only.",
        publisherPlan: {
          planId: platformPublisherPlan.planId,
          platform: platformPublisherPlan.platform,
          plannedOnly: true,
        },
      },
      {
        id: "reply-monitor",
        type: "content:reply",
        description: "Plan reply monitoring and reply drafting only.",
        replyMonitorPlan: {
          planId: replyMonitorPlan.planId,
          platform: replyMonitorPlan.platform,
          plannedOnly: true,
        },
      },
    ],
  });
  const requestBlockedReasons = collectRequestBlockedReasons(request);
  const stages = [
    createScheduledTriggerStage(scheduledWorkflowPlan, requestBlockedReasons),
    createContentCreationStage(contentFollowUpPlan, requestBlockedReasons),
    createPlatformPublishStage(platformPublisherPlan, requestBlockedReasons),
    createReplyMonitorStage(replyMonitorPlan, requestBlockedReasons),
    createFollowUpContentStage(contentFollowUpPlan, requestBlockedReasons),
    createNextCycleStage(scheduledWorkflowPlan, contentFollowUpPlan, requestBlockedReasons),
  ];
  const platformBlockedReasons = supportedPlatforms.has(request.platform as UnattendedRunnerPlatform)
    ? []
    : [`Unsupported platform: ${request.platform}`];
  const blockedReasons = [
    ...platformBlockedReasons,
    ...stages.flatMap((stage) => stage.blockedReasons.map((reason) => `${stage.id}: ${reason}`)),
  ];
  const riskLevel = stages.reduce<DryRunRiskLevel>(
    (current, stage) => maxRisk(current, stage.riskLevel),
    blockedReasons.length > 0 ? "blocked" : "low",
  );
  const approvalsNeeded = mergeUnique(stages.flatMap((stage) => stage.approvalsNeeded));
  const requiresApproval = blockedReasons.length > 0 || stages.some((stage) => stage.requiresApproval);

  return {
    planId: createDeterministicPlanId(request),
    platform: request.platform,
    goal: request.goal,
    schedule: scheduledWorkflowPlan.schedule,
    stages,
    scheduledWorkflowPlan,
    platformPublisherPlan,
    replyMonitorPlan,
    contentFollowUpPlan,
    riskLevel,
    requiresApproval,
    blockedReasons,
    approvalsNeeded,
    permissions: mergeUnique(stages.flatMap((stage) => stage.permissions)),
    capabilities: mergeUnique(stages.flatMap((stage) => stage.capabilities)),
    summary: summarizeRunnerPlan(request, stages, blockedReasons, approvalsNeeded),
    plannedOnly: true,
    auditSummary: createAuditSummary(),
  };
}

function createScheduledTriggerStage(
  scheduledWorkflowPlan: ReturnType<typeof createScheduledWorkflowPlan>,
  requestBlockedReasons: string[],
): UnattendedRunnerStagePlan {
  return createStage({
    id: "runner-stage-1",
    type: "scheduled_trigger",
    description: "Represent the scheduled trigger as planned-only workflow metadata.",
    riskLevel: scheduledWorkflowPlan.riskLevel,
    requiresApproval: scheduledWorkflowPlan.requiresApproval,
    blockedReasons: [...requestBlockedReasons, ...scheduledWorkflowPlan.blockedReasons],
    approvalsNeeded: scheduledWorkflowPlan.requiresApproval ? ["scheduled_trigger"] : [],
    permissions: ["content:schedule:preview"],
    capabilities: ["content_schedule"],
    modules: [
      {
        module: "scheduled-workflow",
        planId: scheduledWorkflowPlan.workflowId,
        plannedOnly: true,
        requiresApproval: scheduledWorkflowPlan.requiresApproval,
        riskLevel: scheduledWorkflowPlan.riskLevel,
      },
    ],
  });
}

function createContentCreationStage(
  contentFollowUpPlan: ReturnType<typeof createContentFollowUpPlan>,
  requestBlockedReasons: string[],
): UnattendedRunnerStagePlan {
  return createStage({
    id: "runner-stage-2",
    type: "content_creation_plan",
    description: "Plan local content creation from follow-up ideas.",
    riskLevel: contentFollowUpPlan.riskLevel === "blocked" ? "blocked" : "low",
    requiresApproval: contentFollowUpPlan.requiresApproval,
    blockedReasons: requestBlockedReasons,
    approvalsNeeded: contentFollowUpPlan.requiresApproval ? ["content_creation_plan"] : [],
    permissions: ["content:create:local"],
    capabilities: ["content_create"],
    modules: [
      {
        module: "content-follow-up",
        planId: contentFollowUpPlan.planId,
        plannedOnly: true,
        requiresApproval: contentFollowUpPlan.requiresApproval,
        riskLevel: contentFollowUpPlan.riskLevel,
      },
    ],
  });
}

function createPlatformPublishStage(
  platformPublisherPlan: ReturnType<typeof createPlatformPublisherPlan>,
  requestBlockedReasons: string[],
): UnattendedRunnerStagePlan {
  return createStage({
    id: "runner-stage-3",
    type: "platform_publish_plan",
    description: "Plan platform publishing only; browser/computer execution remains disabled.",
    riskLevel: platformPublisherPlan.riskLevel,
    requiresApproval: true,
    blockedReasons: [...requestBlockedReasons, ...platformPublisherPlan.blockedReasons],
    approvalsNeeded: ["platform_publish_plan"],
    permissions: mergeUnique(["browser:read", "computer:observe"], platformPublisherPlan.permissions),
    capabilities: mergeUnique(["browser_read", "computer_observe"], platformPublisherPlan.capabilities),
    modules: [
      {
        module: "platform-publisher",
        planId: platformPublisherPlan.planId,
        plannedOnly: true,
        requiresApproval: true,
        riskLevel: platformPublisherPlan.riskLevel,
      },
      plannedBrowserModule("browser:read", "medium", false),
      plannedComputerModule("computer:observe", "medium", false),
    ],
  });
}

function createReplyMonitorStage(
  replyMonitorPlan: ReturnType<typeof createReplyMonitorPlan>,
  requestBlockedReasons: string[],
): UnattendedRunnerStagePlan {
  return createStage({
    id: "runner-stage-4",
    type: "reply_monitor_plan",
    description: "Plan reply monitoring and reply drafting from mock/local signals only.",
    riskLevel: replyMonitorPlan.riskLevel,
    requiresApproval: replyMonitorPlan.requiresApproval,
    blockedReasons: [...requestBlockedReasons, ...replyMonitorPlan.blockedReasons],
    approvalsNeeded: replyMonitorPlan.requiresApproval ? ["reply_monitor_plan"] : [],
    permissions: mergeUnique(["browser:read", "computer:observe"], replyMonitorPlan.permissions),
    capabilities: mergeUnique(["browser_read", "computer_observe"], replyMonitorPlan.capabilities),
    modules: [
      {
        module: "reply-monitor",
        planId: replyMonitorPlan.planId,
        plannedOnly: true,
        requiresApproval: replyMonitorPlan.requiresApproval,
        riskLevel: replyMonitorPlan.riskLevel,
      },
      plannedBrowserModule("browser:read", "medium", false),
      plannedComputerModule("computer:observe", "medium", false),
    ],
  });
}

function createFollowUpContentStage(
  contentFollowUpPlan: ReturnType<typeof createContentFollowUpPlan>,
  requestBlockedReasons: string[],
): UnattendedRunnerStagePlan {
  return createStage({
    id: "runner-stage-5",
    type: "follow_up_content_plan",
    description: "Plan follow-up content ideas from mock/local monitored categories.",
    riskLevel: contentFollowUpPlan.riskLevel,
    requiresApproval: contentFollowUpPlan.requiresApproval,
    blockedReasons: [...requestBlockedReasons, ...contentFollowUpPlan.blockedReasons],
    approvalsNeeded: contentFollowUpPlan.requiresApproval ? ["follow_up_content_plan"] : [],
    permissions: contentFollowUpPlan.permissions,
    capabilities: contentFollowUpPlan.capabilities,
    modules: [
      {
        module: "content-follow-up",
        planId: contentFollowUpPlan.planId,
        plannedOnly: true,
        requiresApproval: contentFollowUpPlan.requiresApproval,
        riskLevel: contentFollowUpPlan.riskLevel,
      },
    ],
  });
}

function createNextCycleStage(
  scheduledWorkflowPlan: ReturnType<typeof createScheduledWorkflowPlan>,
  contentFollowUpPlan: ReturnType<typeof createContentFollowUpPlan>,
  requestBlockedReasons: string[],
): UnattendedRunnerStagePlan {
  return createStage({
    id: "runner-stage-6",
    type: "next_cycle_plan",
    description: "Plan the next cycle as metadata only; no timer or scheduler is created.",
    riskLevel: maxRisk(scheduledWorkflowPlan.riskLevel, contentFollowUpPlan.riskLevel),
    requiresApproval: scheduledWorkflowPlan.requiresApproval || contentFollowUpPlan.requiresApproval,
    blockedReasons: requestBlockedReasons,
    approvalsNeeded: scheduledWorkflowPlan.requiresApproval || contentFollowUpPlan.requiresApproval ? ["next_cycle_plan"] : [],
    permissions: ["content:schedule:preview", "content:follow-up:plan"],
    capabilities: ["content_schedule", "content_follow_up_planning"],
    modules: [
      {
        module: "scheduled-workflow",
        planId: scheduledWorkflowPlan.workflowId,
        plannedOnly: true,
        requiresApproval: scheduledWorkflowPlan.requiresApproval,
        riskLevel: scheduledWorkflowPlan.riskLevel,
      },
      {
        module: "content-follow-up",
        planId: contentFollowUpPlan.planId,
        plannedOnly: true,
        requiresApproval: contentFollowUpPlan.requiresApproval,
        riskLevel: contentFollowUpPlan.riskLevel,
      },
    ],
  });
}

function createStage(
  input: Omit<UnattendedRunnerStagePlan, "status" | "plannedOnly" | "summary" | "approvalPolicyDecision">,
): UnattendedRunnerStagePlan {
  const blockedReasons = mergeUnique(input.blockedReasons);
  const status = blockedReasons.length > 0 ? "blocked" : input.requiresApproval ? "requires_approval" : "planned";
  const riskLevel = blockedReasons.length > 0 ? "blocked" : input.riskLevel;
  const approvalPolicyDecision = decideAutopilotApprovalPolicy(createPolicyRequest(input.type, input.description, riskLevel));

  return {
    ...input,
    status,
    plannedOnly: true,
    riskLevel,
    blockedReasons,
    approvalsNeeded: mergeUnique(input.approvalsNeeded),
    permissions: mergeUnique(input.permissions),
    capabilities: mergeUnique(input.capabilities),
    approvalPolicyDecision,
    summary: summarizeStage(input.type, status, blockedReasons),
  };
}

function createPolicyRequest(
  stageType: UnattendedRunnerStageType,
  description: string,
  riskLevel: DryRunRiskLevel,
): AutopilotApprovalPolicyRequest {
  switch (stageType) {
    case "scheduled_trigger":
    case "next_cycle_plan":
      return {
        action: "content:schedule",
        description,
        riskLevel,
        context: { plannedOnly: true },
      };
    case "content_creation_plan":
    case "follow_up_content_plan":
      return {
        action: "content:create",
        description,
        riskLevel,
        context: {
          plannedOnly: true,
          negativeFeedback: riskLevel === "high",
        },
      };
    case "platform_publish_plan":
      return {
        action: "content:publish",
        description,
        riskLevel,
        context: { plannedOnly: true },
      };
    case "reply_monitor_plan":
      return {
        action: "content:reply",
        description,
        riskLevel,
        context: { plannedOnly: true },
      };
  }
}

function plannedBrowserModule(
  actionType: string,
  riskLevel: DryRunRiskLevel,
  requiresApproval: boolean,
): UnattendedRunnerPlannedModule {
  return {
    module: "browser-skill",
    actionType,
    plannedOnly: true,
    requiresApproval,
    riskLevel,
  };
}

function plannedComputerModule(
  actionType: string,
  riskLevel: DryRunRiskLevel,
  requiresApproval: boolean,
): UnattendedRunnerPlannedModule {
  return {
    module: "computer-skill",
    actionType,
    plannedOnly: true,
    requiresApproval,
    riskLevel,
  };
}

function collectRequestBlockedReasons(request: UnattendedRunnerPlanRequest): string[] {
  const reasons = new Set<string>();
  const text = stringifyRequestForSafety(request);

  for (const intent of unsafeIntentPatterns) {
    if (intent.pattern.test(text)) {
      reasons.add(intent.reason);
    }
  }

  return [...reasons];
}

function summarizeRunnerPlan(
  request: UnattendedRunnerPlanRequest,
  stages: UnattendedRunnerStagePlan[],
  blockedReasons: string[],
  approvalsNeeded: string[],
): string {
  const blockedText =
    blockedReasons.length > 0 ? ` Blocked reasons: ${blockedReasons.join("; ")}.` : "";
  const approvalText =
    approvalsNeeded.length > 0
      ? ` Approval is required for: ${approvalsNeeded.join(", ")}.`
      : " No approval is required for the current low-risk advisory plan.";

  return `Unattended Workflow Runner Plan v1 created a deterministic planned-only end-to-end workflow for ${request.platform} with ${stages.length} stage(s).${approvalText} Real execution remains disabled; no timer, scheduler, browser, computer, network, publish, reply, comment, send, upload, login, click, type, submit, pay, or delete action was performed.${blockedText}`;
}

function summarizeStage(
  stageType: UnattendedRunnerStageType,
  status: UnattendedRunnerStagePlan["status"],
  blockedReasons: string[],
): string {
  if (status === "blocked") {
    return `Unattended runner stage ${stageType} blocked: ${blockedReasons.join("; ")}. Planned only; no real action was performed.`;
  }

  if (status === "requires_approval") {
    return `Unattended runner stage ${stageType} requires approval and remains planned only. No real action was performed.`;
  }

  return `Unattended runner stage ${stageType} planned only. No real action was performed.`;
}

function stringifyRequestForSafety(request: UnattendedRunnerPlanRequest): string {
  const safeProjection = {
    goal: request.goal,
    notes: request.notes,
    post: request.post,
    signals: request.signals,
  };

  try {
    return JSON.stringify(safeProjection);
  } catch {
    return `${request.goal} ${(request.notes ?? []).join(" ")}`;
  }
}

function createAuditSummary(): UnattendedRunnerPlanResult["auditSummary"] {
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
    realReplyOperation: false,
    realCommentReadOperation: false,
  };
}

function mergeUnique(values: string[]): string[];
function mergeUnique(first: string[], second: string[]): string[];
function mergeUnique(first: string[], second: string[] = []): string[] {
  return [...new Set([...first, ...second])];
}

function maxRisk(current: DryRunRiskLevel, next: DryRunRiskLevel): DryRunRiskLevel {
  return riskRank[next] > riskRank[current] ? next : current;
}

function createDeterministicPlanId(request: UnattendedRunnerPlanRequest): string {
  const text = JSON.stringify({
    platform: request.platform,
    goal: request.goal,
    workflowName: request.workflowName,
    schedule: request.schedule,
    post: request.post,
    signals: request.signals,
    notes: request.notes,
  });
  let hash = 0;

  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }

  return `unattended-runner-v1-${hash.toString(16).padStart(8, "0")}`;
}
