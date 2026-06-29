import type { SkillRuntimeAuditSummary } from "../skill-runtime";
import type { DryRunRiskLevel } from "../skill-system/execution-plan";
import type {
  ReplyMonitorPlanRequest,
  ReplyMonitorPlanResult,
  ReplyMonitorPlatform,
  ReplyMonitorStepInput,
  ReplyMonitorStepPlan,
  ReplyMonitorStepType,
} from "./types";

type StepProfile = {
  capabilities: string[];
  permissions: string[];
  riskLevel: DryRunRiskLevel;
  requiresApproval: boolean;
  description: string;
};

const supportedPlatforms = new Set<ReplyMonitorPlatform>([
  "xiaohongshu",
  "douyin",
  "wechat_public_account",
  "generic_web_platform",
]);

const defaultMonitorSteps: ReplyMonitorStepInput[] = [
  { type: "open_platform" },
  { type: "check_notifications" },
  { type: "read_comments" },
  { type: "classify_comments" },
  { type: "detect_leads_questions_negative_feedback" },
  { type: "draft_reply" },
  { type: "plan_reply_action" },
  { type: "plan_follow_up_content_idea" },
];

const stepProfiles: Record<ReplyMonitorStepType, StepProfile> = {
  open_platform: {
    capabilities: ["reply_monitor_open_planning"],
    permissions: ["reply-monitor:open:plan"],
    riskLevel: "low",
    requiresApproval: false,
    description: "Open platform page planned only.",
  },
  check_notifications: {
    capabilities: ["reply_monitor_notification_planning"],
    permissions: ["reply-monitor:notifications:plan"],
    riskLevel: "medium",
    requiresApproval: false,
    description: "Check notifications planned only without reading live platform data.",
  },
  read_comments: {
    capabilities: ["reply_monitor_comment_read_planning"],
    permissions: ["reply-monitor:comments:plan"],
    riskLevel: "medium",
    requiresApproval: false,
    description: "Read comments from mock/local planned context only.",
  },
  classify_comments: {
    capabilities: ["reply_monitor_comment_classification"],
    permissions: ["reply-monitor:comments:classify:plan"],
    riskLevel: "low",
    requiresApproval: false,
    description: "Classify comments from mock/local planned context only.",
  },
  detect_leads_questions_negative_feedback: {
    capabilities: ["reply_monitor_signal_detection"],
    permissions: ["reply-monitor:signals:plan"],
    riskLevel: "medium",
    requiresApproval: false,
    description: "Detect leads, questions, and negative feedback planned only.",
  },
  draft_reply: {
    capabilities: ["content_reply_draft_planning"],
    permissions: ["content:reply:preview"],
    riskLevel: "medium",
    requiresApproval: true,
    description: "Draft reply text planned only and approval-gated.",
  },
  plan_reply_action: {
    capabilities: ["content_reply_action_planning"],
    permissions: ["content:reply:plan"],
    riskLevel: "high",
    requiresApproval: true,
    description: "Plan reply action only; sending requires approval.",
  },
  plan_follow_up_content_idea: {
    capabilities: ["content_follow_up_idea_planning"],
    permissions: ["content:follow-up:plan"],
    riskLevel: "low",
    requiresApproval: false,
    description: "Plan a follow-up content idea from mock/local signals only.",
  },
};

const blockedIntentPatterns: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\b(?:login|log in|sign in)\b/i,
    reason: "Login actions are blocked in Reply Monitor Skill v1",
  },
  {
    pattern: /\bclick\b/i,
    reason: "Click actions are blocked in Reply Monitor Skill v1",
  },
  {
    pattern: /\b(?:type|enter text)\b/i,
    reason: "Type actions are blocked in Reply Monitor Skill v1",
  },
  {
    pattern: /\bsubmit\b/i,
    reason: "Submit actions are blocked in Reply Monitor Skill v1",
  },
  {
    pattern: /\bupload\b/i,
    reason: "Upload actions are blocked in Reply Monitor Skill v1",
  },
  {
    pattern: /\bpublish\b/i,
    reason: "Publish actions are blocked in Reply Monitor Skill v1",
  },
  {
    pattern: /\bpay(?:ment)?\b/i,
    reason: "Pay actions are blocked in Reply Monitor Skill v1",
  },
  {
    pattern: /\bdelete\b/i,
    reason: "Delete actions are blocked in Reply Monitor Skill v1",
  },
  {
    pattern: /\bsend(?:\s+(?:reply|replies|message|messages|email|emails))?\b/i,
    reason: "Send actions are blocked in Reply Monitor Skill v1",
  },
  {
    pattern: /\b(?:post|leave|write)\s+(?:a\s+)?comment\b/i,
    reason: "Comment actions are blocked in Reply Monitor Skill v1",
  },
  {
    pattern: /\bread\s+real\s+comments\b|\blive\s+comments\b|\bfetch\s+comments\b/i,
    reason: "Reading real comments is blocked in Reply Monitor Skill v1",
  },
];

const riskRank: Record<DryRunRiskLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
  blocked: 4,
};

export function createReplyMonitorPlan(request: ReplyMonitorPlanRequest): ReplyMonitorPlanResult {
  const steps = (request.steps && request.steps.length > 0 ? request.steps : defaultMonitorSteps).map((step, index) =>
    createStepPlan(step, index),
  );
  const platformBlockedReasons = supportedPlatforms.has(request.platform as ReplyMonitorPlatform)
    ? []
    : [`Unsupported platform: ${request.platform}`];
  const blockedReasons = [
    ...platformBlockedReasons,
    ...steps.flatMap((step) => step.blockedReasons.map((reason) => `${step.id}: ${reason}`)),
  ];
  const riskLevel = steps.reduce<DryRunRiskLevel>(
    (current, step) => maxRisk(current, step.riskLevel),
    blockedReasons.length > 0 ? "blocked" : "low",
  );
  const requiresApproval = blockedReasons.length > 0 || steps.some((step) => step.requiresApproval);
  const permissions = mergeUnique(["content:reply:preview"], steps.flatMap((step) => step.permissions));
  const capabilities = mergeUnique(["reply_monitor_planning"], steps.flatMap((step) => step.capabilities));

  return {
    planId: createDeterministicPlanId(request),
    platform: request.platform,
    goal: request.goal,
    steps,
    riskLevel,
    requiresApproval,
    blockedReasons,
    permissions,
    capabilities,
    summary: summarizePlan(request, steps, blockedReasons, requiresApproval),
    plannedOnly: true,
    auditSummary: createAuditSummary(),
  };
}

function createStepPlan(step: ReplyMonitorStepInput, index: number): ReplyMonitorStepPlan {
  const id = step.id?.trim() || `reply-monitor-step-${index + 1}`;
  const profile = stepProfiles[step.type as ReplyMonitorStepType];
  const blockedReasons = collectStepBlockedReasons(step, profile);
  const requiresApproval = blockedReasons.length > 0 || Boolean(profile?.requiresApproval);
  const riskLevel: DryRunRiskLevel = blockedReasons.length > 0 ? "blocked" : profile?.riskLevel ?? "blocked";
  const status =
    blockedReasons.length > 0 ? "blocked" : requiresApproval ? "requires_approval" : "planned";

  return {
    id,
    type: step.type,
    description: step.description ?? profile?.description ?? `Unsupported reply monitor step: ${step.type}`,
    status,
    plannedOnly: true,
    riskLevel,
    requiresApproval,
    blockedReasons,
    permissions: profile?.permissions ?? [],
    capabilities: profile?.capabilities ?? [],
    summary: summarizeStep(step.type, status, blockedReasons),
  };
}

function collectStepBlockedReasons(step: ReplyMonitorStepInput, profile: StepProfile | undefined): string[] {
  const reasons = new Set<string>();

  if (!profile) {
    reasons.add(`Unsupported reply monitor step: ${step.type}`);
  }

  const stepText = stringifyStep(step);

  for (const intent of blockedIntentPatterns) {
    if (intent.pattern.test(stepText)) {
      reasons.add(intent.reason);
    }
  }

  return [...reasons];
}

function summarizePlan(
  request: ReplyMonitorPlanRequest,
  steps: ReplyMonitorStepPlan[],
  blockedReasons: string[],
  requiresApproval: boolean,
): string {
  const approvalText = requiresApproval
    ? "Approval is required before any future reply/send action."
    : "No approval is required for the current mock/local monitoring plan.";
  const blockedText =
    blockedReasons.length > 0 ? ` Blocked reasons: ${blockedReasons.join("; ")}.` : "";

  return `Reply Monitor Skill v1 created a deterministic planned-only monitor plan for ${request.platform} with ${steps.length} step(s). Reading and monitoring are mock/local/planned only. ${approvalText} No real browser, computer, network, scheduler, comment read, reply, send, click, type, login, upload, submit, or publish action was performed.${blockedText}`;
}

function summarizeStep(
  stepType: string,
  status: ReplyMonitorStepPlan["status"],
  blockedReasons: string[],
): string {
  if (status === "blocked") {
    return `Reply monitor step ${stepType} blocked: ${blockedReasons.join("; ")}. Planned only; no real action was performed.`;
  }

  if (status === "requires_approval") {
    return `Reply monitor step ${stepType} requires approval and remains planned only. No real reply/send action was performed.`;
  }

  return `Reply monitor step ${stepType} planned only against mock/local context. No real action was performed.`;
}

function stringifyStep(step: ReplyMonitorStepInput): string {
  const description = step.description ?? "";

  if (step.input === undefined) {
    return `${step.type} ${description}`;
  }

  try {
    return `${step.type} ${description} ${JSON.stringify(step.input)}`;
  } catch {
    return `${step.type} ${description}`;
  }
}

function createAuditSummary(): ReplyMonitorPlanResult["auditSummary"] {
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
    realSchedulerOperation: false,
    realReplyOperation: false,
    realCommentReadOperation: false,
  };
}

function mergeUnique(first: string[], second: string[]): string[] {
  return [...new Set([...first, ...second])];
}

function maxRisk(current: DryRunRiskLevel, next: DryRunRiskLevel): DryRunRiskLevel {
  return riskRank[next] > riskRank[current] ? next : current;
}

function createDeterministicPlanId(request: ReplyMonitorPlanRequest): string {
  const text = JSON.stringify({
    platform: request.platform,
    goal: request.goal,
    monitorWindow: request.monitorWindow,
    steps: request.steps ?? defaultMonitorSteps,
  });
  let hash = 0;

  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }

  return `reply-monitor-v1-${hash.toString(16).padStart(8, "0")}`;
}
