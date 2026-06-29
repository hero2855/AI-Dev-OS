import type { SkillRuntimeAuditSummary } from "../skill-runtime";
import type { DryRunRiskLevel } from "../skill-system/execution-plan";
import type {
  PlatformPublishStepInput,
  PlatformPublishStepType,
  PlatformPublisherPlanRequest,
  PlatformPublisherPlanResult,
  PlatformPublisherPlatform,
  PlatformPublisherStepPlan,
} from "./types";

type StepProfile = {
  capability: string;
  permission: string;
  description: string;
};

const supportedPlatforms = new Set<PlatformPublisherPlatform>([
  "xiaohongshu",
  "douyin",
  "wechat_public_account",
  "generic_web_platform",
]);

const defaultPublishSteps: PlatformPublishStepInput[] = [
  { type: "open_platform" },
  { type: "check_login_state" },
  { type: "upload_media" },
  { type: "fill_title" },
  { type: "fill_body" },
  { type: "add_tags" },
  { type: "set_schedule_time" },
  { type: "preview_post" },
  { type: "submit_publish" },
];

const stepProfiles: Record<PlatformPublishStepType, StepProfile> = {
  open_platform: {
    capability: "platform_open_planning",
    permission: "platform:open:plan",
    description: "Open platform page planned only.",
  },
  check_login_state: {
    capability: "platform_login_state_planning",
    permission: "platform:login-state:plan",
    description: "Check login state planned only without logging in.",
  },
  upload_media: {
    capability: "platform_media_upload_planning",
    permission: "platform:upload:plan",
    description: "Upload media planned only.",
  },
  fill_title: {
    capability: "platform_title_fill_planning",
    permission: "platform:title:plan",
    description: "Fill title planned only.",
  },
  fill_body: {
    capability: "platform_body_fill_planning",
    permission: "platform:body:plan",
    description: "Fill body planned only.",
  },
  add_tags: {
    capability: "platform_tag_planning",
    permission: "platform:tags:plan",
    description: "Add tags planned only.",
  },
  set_schedule_time: {
    capability: "platform_schedule_time_planning",
    permission: "platform:schedule-time:plan",
    description: "Set platform schedule time planned only.",
  },
  preview_post: {
    capability: "platform_preview_planning",
    permission: "platform:preview:plan",
    description: "Preview post planned only.",
  },
  submit_publish: {
    capability: "platform_publish_planning",
    permission: "platform:publish:plan",
    description: "Submit/publish planned only.",
  },
};

const blockedIntentPatterns: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\b(?:login|log in|sign in)\b/i,
    reason: "Login actions are blocked in Platform Publisher Skill v1",
  },
  {
    pattern: /\bclick\b/i,
    reason: "Click actions are blocked in Platform Publisher Skill v1",
  },
  {
    pattern: /\b(?:type|enter text)\b/i,
    reason: "Type actions are blocked in Platform Publisher Skill v1",
  },
  {
    pattern: /\bpay(?:ment)?\b/i,
    reason: "Pay actions are blocked in Platform Publisher Skill v1",
  },
  {
    pattern: /\bdelete\b/i,
    reason: "Delete actions are blocked in Platform Publisher Skill v1",
  },
  {
    pattern: /\bsend(?:\s+(?:message|messages|email|emails))?\b/i,
    reason: "Send actions are blocked in Platform Publisher Skill v1",
  },
  {
    pattern: /\bcomment\b/i,
    reason: "Comment actions are blocked in Platform Publisher Skill v1",
  },
  {
    pattern: /\brepl(?:y|ies|ied)\b/i,
    reason: "Reply actions are blocked in Platform Publisher Skill v1",
  },
];

export function createPlatformPublisherPlan(request: PlatformPublisherPlanRequest): PlatformPublisherPlanResult {
  const steps = (request.steps && request.steps.length > 0 ? request.steps : defaultPublishSteps).map((step, index) =>
    createStepPlan(step, index),
  );
  const platformBlockedReasons = supportedPlatforms.has(request.platform as PlatformPublisherPlatform)
    ? []
    : [`Unsupported platform: ${request.platform}`];
  const blockedReasons = [
    ...platformBlockedReasons,
    ...steps.flatMap((step) => step.blockedReasons.map((reason) => `${step.id}: ${reason}`)),
  ];
  const riskLevel = blockedReasons.length > 0 ? "blocked" : "high";
  const permissions = mergeUnique(["content:publish"], steps.flatMap((step) => step.permissions));
  const capabilities = mergeUnique(["content_publish", "platform_publish_planning"], steps.flatMap((step) => step.capabilities));

  return {
    planId: createDeterministicPlanId(request),
    platform: request.platform,
    goal: request.goal,
    steps,
    riskLevel,
    requiresApproval: true,
    blockedReasons,
    permissions,
    capabilities,
    summary: summarizePlan(request, steps, blockedReasons),
    plannedOnly: true,
    auditSummary: createAuditSummary(),
  };
}

function createStepPlan(step: PlatformPublishStepInput, index: number): PlatformPublisherStepPlan {
  const id = step.id?.trim() || `publish-step-${index + 1}`;
  const profile = stepProfiles[step.type as PlatformPublishStepType];
  const blockedReasons = collectStepBlockedReasons(step, profile);
  const riskLevel: DryRunRiskLevel = blockedReasons.length > 0 ? "blocked" : "high";
  const status = blockedReasons.length > 0 ? "blocked" : "requires_approval";

  return {
    id,
    type: step.type,
    description: step.description ?? profile?.description ?? `Unsupported publish step: ${step.type}`,
    status,
    plannedOnly: true,
    riskLevel,
    requiresApproval: true,
    blockedReasons,
    permissions: profile ? [profile.permission] : [],
    capabilities: profile ? [profile.capability] : [],
    summary: summarizeStep(step.type, status, blockedReasons),
  };
}

function collectStepBlockedReasons(step: PlatformPublishStepInput, profile: StepProfile | undefined): string[] {
  const reasons = new Set<string>();

  if (!profile) {
    reasons.add(`Unsupported platform publish step: ${step.type}`);
  }

  const stepText = stringifyStep(step);

  for (const intent of blockedIntentPatterns) {
    if (step.type === "check_login_state" && intent.reason.startsWith("Login actions")) {
      continue;
    }

    if (intent.pattern.test(stepText)) {
      reasons.add(intent.reason);
    }
  }

  return [...reasons];
}

function summarizePlan(
  request: PlatformPublisherPlanRequest,
  steps: PlatformPublisherStepPlan[],
  blockedReasons: string[],
): string {
  const blockedText =
    blockedReasons.length > 0 ? ` Blocked reasons: ${blockedReasons.join("; ")}.` : "";

  return `Platform Publisher Skill v1 created a deterministic planned-only publish plan for ${request.platform} with ${steps.length} step(s). Approval is required before any future execution. No real browser, computer, network, scheduler, upload, submit, publish, comment, reply, login, click, type, or pay action was performed.${blockedText}`;
}

function summarizeStep(
  stepType: string,
  status: PlatformPublisherStepPlan["status"],
  blockedReasons: string[],
): string {
  if (status === "blocked") {
    return `Platform publish step ${stepType} blocked: ${blockedReasons.join("; ")}. Planned only; no real action was performed.`;
  }

  return `Platform publish step ${stepType} requires approval and remains planned only. No real action was performed.`;
}

function stringifyStep(step: PlatformPublishStepInput): string {
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

function createAuditSummary(): PlatformPublisherPlanResult["auditSummary"] {
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
  };
}

function mergeUnique(first: string[], second: string[]): string[] {
  return [...new Set([...first, ...second])];
}

function createDeterministicPlanId(request: PlatformPublisherPlanRequest): string {
  const text = JSON.stringify({
    platform: request.platform,
    goal: request.goal,
    post: request.post,
    steps: request.steps ?? defaultPublishSteps,
  });
  let hash = 0;

  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }

  return `publisher-v1-${hash.toString(16).padStart(8, "0")}`;
}
