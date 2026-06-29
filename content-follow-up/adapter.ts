import type { SkillRuntimeAuditSummary } from "../skill-runtime";
import type { DryRunRiskLevel } from "../skill-system/execution-plan";
import type {
  ContentFollowUpContentType,
  ContentFollowUpIdea,
  ContentFollowUpPlanRequest,
  ContentFollowUpPlanResult,
  ContentFollowUpPlatform,
  ContentFollowUpPriority,
  ContentFollowUpSignalCategory,
  ContentFollowUpSignalInput,
} from "./types";

type SignalProfile = {
  title: string;
  angle: string;
  contentType: ContentFollowUpContentType;
  priority: ContentFollowUpPriority;
  riskLevel: DryRunRiskLevel;
  requiresApproval: boolean;
  reason: string;
};

const supportedPlatforms = new Set<ContentFollowUpPlatform>([
  "xiaohongshu",
  "douyin",
  "wechat_public_account",
  "generic_web_platform",
]);

const defaultSignals: ContentFollowUpSignalInput[] = [
  {
    category: "questions",
    summary: "Mock/local audience questions need a planned explainer.",
  },
  {
    category: "common_pain_points",
    summary: "Mock/local recurring pain points need a planned practical post.",
  },
];

const signalProfiles: Record<ContentFollowUpSignalCategory, SignalProfile> = {
  leads: {
    title: "Turn Interested Comments Into a Clear Next-Step Guide",
    angle: "Answer buying-intent signals with a helpful, non-pushy follow-up.",
    contentType: "case_study",
    priority: "high",
    riskLevel: "medium",
    requiresApproval: false,
    reason: "Lead signals can become educational follow-up content without contacting users directly.",
  },
  questions: {
    title: "Answer the Top Audience Questions",
    angle: "Convert repeated questions into a concise FAQ-style post.",
    contentType: "faq",
    priority: "medium",
    riskLevel: "low",
    requiresApproval: false,
    reason: "Question clusters are low-risk inputs for helpful planned content.",
  },
  negative_feedback: {
    title: "Address Concerns With a Calm Improvement Update",
    angle: "Acknowledge recurring negative feedback and explain what will improve.",
    contentType: "long_post",
    priority: "high",
    riskLevel: "high",
    requiresApproval: true,
    reason: "Negative feedback can affect reputation and requires approval before use.",
  },
  objections: {
    title: "Clarify Common Objections Before They Block Action",
    angle: "Explain tradeoffs, constraints, and decision criteria in a balanced post.",
    contentType: "comparison",
    priority: "high",
    riskLevel: "high",
    requiresApproval: true,
    reason: "Objection-handling content can influence decisions and requires approval.",
  },
  feature_requests: {
    title: "Share a Roadmap-Inspired Feature Request Roundup",
    angle: "Reflect requested features as planned exploration without promising delivery.",
    contentType: "short_post",
    priority: "medium",
    riskLevel: "medium",
    requiresApproval: false,
    reason: "Feature requests can inspire planned content when no commitment is made.",
  },
  common_pain_points: {
    title: "Create a Practical Guide for Recurring Pain Points",
    angle: "Turn repeated frustrations into a useful step-by-step education piece.",
    contentType: "tutorial",
    priority: "medium",
    riskLevel: "low",
    requiresApproval: false,
    reason: "Common pain points are suitable for planned educational follow-up content.",
  },
};

const blockedIntentPatterns: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\bread\s+real\s+comments\b|\blive\s+comments\b|\bfetch\s+comments\b/i,
    reason: "Reading real comments is blocked in Content Follow-up Agent v1",
  },
  {
    pattern: /\b(?:login|log in|sign in)\b/i,
    reason: "Login actions are blocked in Content Follow-up Agent v1",
  },
  {
    pattern: /\bclick\b/i,
    reason: "Click actions are blocked in Content Follow-up Agent v1",
  },
  {
    pattern: /\b(?:type|enter text)\b/i,
    reason: "Type actions are blocked in Content Follow-up Agent v1",
  },
  {
    pattern: /\bsubmit\b/i,
    reason: "Submit actions are blocked in Content Follow-up Agent v1",
  },
  {
    pattern: /\bupload\b/i,
    reason: "Upload actions are blocked in Content Follow-up Agent v1",
  },
  {
    pattern: /\bpublish\b/i,
    reason: "Publish actions are blocked in Content Follow-up Agent v1",
  },
  {
    pattern: /\bcomment\b/i,
    reason: "Comment actions are blocked in Content Follow-up Agent v1",
  },
  {
    pattern: /\brepl(?:y|ies|ied)\b/i,
    reason: "Reply actions are blocked in Content Follow-up Agent v1",
  },
  {
    pattern: /\bsend(?:\s+(?:reply|replies|message|messages|email|emails))?\b/i,
    reason: "Send actions are blocked in Content Follow-up Agent v1",
  },
  {
    pattern: /\bpay(?:ment)?\b/i,
    reason: "Pay actions are blocked in Content Follow-up Agent v1",
  },
  {
    pattern: /\bdelete\b/i,
    reason: "Delete actions are blocked in Content Follow-up Agent v1",
  },
  {
    pattern: /\bschedule\s+(?:a\s+)?(?:real\s+)?task\b|\bcreate\s+(?:a\s+)?scheduler\b/i,
    reason: "Real scheduler actions are blocked in Content Follow-up Agent v1",
  },
];

const riskRank: Record<DryRunRiskLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
  blocked: 4,
};

export function createContentFollowUpPlan(request: ContentFollowUpPlanRequest): ContentFollowUpPlanResult {
  const signals = request.signals && request.signals.length > 0 ? request.signals : defaultSignals;
  const platformBlockedReasons = supportedPlatforms.has(request.platform as ContentFollowUpPlatform)
    ? []
    : [`Unsupported platform: ${request.platform}`];
  const ideas = signals.map((signal, index) => createIdea(signal, request.platform, index));
  const blockedReasons = [
    ...platformBlockedReasons,
    ...ideas.flatMap((idea) => idea.blockedReasons.map((reason) => `${idea.id}: ${reason}`)),
  ];
  const riskLevel = ideas.reduce<DryRunRiskLevel>(
    (current, idea) => maxRisk(current, idea.riskLevel),
    blockedReasons.length > 0 ? "blocked" : "low",
  );
  const requiresApproval = blockedReasons.length > 0 || ideas.some((idea) => idea.requiresApproval);

  return {
    planId: createDeterministicPlanId(request),
    platform: request.platform,
    goal: request.goal,
    ideas,
    riskLevel,
    requiresApproval,
    blockedReasons,
    permissions: ["content:create:local", "content:follow-up:plan"],
    capabilities: ["content_create", "content_follow_up_planning"],
    summary: summarizePlan(request, ideas, blockedReasons, requiresApproval),
    plannedOnly: true,
    replyMonitorPlan: request.replyMonitorPlan,
    auditSummary: createAuditSummary(),
  };
}

function createIdea(signal: ContentFollowUpSignalInput, platform: string, index: number): ContentFollowUpIdea {
  const profile = signalProfiles[signal.category as ContentFollowUpSignalCategory];
  const blockedReasons = collectIdeaBlockedReasons(signal, profile);
  const riskLevel: DryRunRiskLevel = blockedReasons.length > 0 ? "blocked" : profile?.riskLevel ?? "blocked";
  const requiresApproval = blockedReasons.length > 0 || Boolean(profile?.requiresApproval);
  const sourceSignal = summarizeSignal(signal);

  return {
    id: signal.category.trim() || `follow-up-idea-${index + 1}`,
    title: profile?.title ?? `Unsupported follow-up signal: ${signal.category}`,
    angle: profile?.angle ?? "Unsupported signal category cannot be turned into follow-up content.",
    platform,
    contentType: profile?.contentType ?? "short_post",
    priority: profile?.priority ?? "high",
    reason: profile?.reason ?? `Unsupported follow-up signal category: ${signal.category}`,
    sourceSignal,
    riskLevel,
    requiresApproval,
    blockedReasons,
  };
}

function collectIdeaBlockedReasons(
  signal: ContentFollowUpSignalInput,
  profile: SignalProfile | undefined,
): string[] {
  const reasons = new Set<string>();

  if (!profile) {
    reasons.add(`Unsupported follow-up signal category: ${signal.category}`);
  }

  const signalText = stringifySignal(signal);

  for (const intent of blockedIntentPatterns) {
    if (intent.pattern.test(signalText)) {
      reasons.add(intent.reason);
    }
  }

  return [...reasons];
}

function summarizePlan(
  request: ContentFollowUpPlanRequest,
  ideas: ContentFollowUpIdea[],
  blockedReasons: string[],
  requiresApproval: boolean,
): string {
  const approvalText = requiresApproval
    ? "Approval is required before any future high-risk or negative-feedback content is used."
    : "No approval is required for the current low-risk planned content ideas.";
  const replyMonitorText = request.replyMonitorPlan
    ? ` It references reply monitor plan ${request.replyMonitorPlan.planId} as planned-only metadata.`
    : "";
  const blockedText =
    blockedReasons.length > 0 ? ` Blocked reasons: ${blockedReasons.join("; ")}.` : "";

  return `Content Follow-up Agent v1 created a deterministic planned-only follow-up content plan for ${request.platform} with ${ideas.length} idea(s). Input signals are mock/local/planned only; no real comments were read.${replyMonitorText} ${approvalText} No real browser, computer, network, scheduler, publish, reply, comment, send, upload, login, click, type, submit, pay, or delete action was performed.${blockedText}`;
}

function summarizeSignal(signal: ContentFollowUpSignalInput): string {
  const summary = signal.summary?.trim();

  if (summary) {
    return `${signal.category}: ${summary}`;
  }

  const examples = signal.examples?.filter((example) => example.trim().length > 0) ?? [];

  if (examples.length > 0) {
    return `${signal.category}: ${examples.join(" | ")}`;
  }

  return `${signal.category}: mock/local planned signal`;
}

function stringifySignal(signal: ContentFollowUpSignalInput): string {
  try {
    return JSON.stringify(signal);
  } catch {
    return `${signal.category} ${signal.summary ?? ""}`;
  }
}

function createAuditSummary(): ContentFollowUpPlanResult["auditSummary"] {
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

function maxRisk(current: DryRunRiskLevel, next: DryRunRiskLevel): DryRunRiskLevel {
  return riskRank[next] > riskRank[current] ? next : current;
}

function createDeterministicPlanId(request: ContentFollowUpPlanRequest): string {
  const text = JSON.stringify({
    platform: request.platform,
    goal: request.goal,
    signals: request.signals ?? defaultSignals,
    replyMonitorPlan: request.replyMonitorPlan,
  });
  let hash = 0;

  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }

  return `content-follow-up-v1-${hash.toString(16).padStart(8, "0")}`;
}
