import type { SkillRuntimeAuditSummary } from "../skill-runtime";
import type { DryRunRiskLevel } from "../skill-system/execution-plan";
import type {
  AutopilotApprovalActionCategory,
  AutopilotApprovalDecisionLevel,
  AutopilotApprovalPolicyRequest,
  AutopilotApprovalPolicyResult,
} from "./types";

type ActionProfile = {
  defaultDecision: AutopilotApprovalDecisionLevel;
  riskLevel: DryRunRiskLevel;
  capabilities: string[];
  permissions: string[];
  approvalReason: string;
};

const actionProfiles: Record<AutopilotApprovalActionCategory, ActionProfile> = {
  "content:create": {
    defaultDecision: "auto_allowed",
    riskLevel: "low",
    capabilities: ["content_create"],
    permissions: ["content:create:local"],
    approvalReason: "Low-risk local content planning can be auto-approved.",
  },
  "content:schedule": {
    defaultDecision: "approval_required",
    riskLevel: "medium",
    capabilities: ["content_schedule"],
    permissions: ["content:schedule:preview"],
    approvalReason: "Scheduling remains planned-only and requires approval before any future execution.",
  },
  "content:publish": {
    defaultDecision: "approval_required",
    riskLevel: "high",
    capabilities: ["content_publish"],
    permissions: ["content:publish"],
    approvalReason: "Publishing can affect external platforms and requires approval.",
  },
  "content:reply": {
    defaultDecision: "approval_required",
    riskLevel: "medium",
    capabilities: ["content_reply"],
    permissions: ["content:reply:preview"],
    approvalReason: "Replies and reply drafts require approval before any future send action.",
  },
  "content:delete": {
    defaultDecision: "blocked",
    riskLevel: "blocked",
    capabilities: ["content_delete"],
    permissions: ["content:delete"],
    approvalReason: "Delete actions are blocked by default.",
  },
  "browser:read": {
    defaultDecision: "auto_allowed",
    riskLevel: "low",
    capabilities: ["browser_read"],
    permissions: ["browser:read"],
    approvalReason: "Low-risk planned browser reads can be auto-approved when mock/local.",
  },
  "browser:write": {
    defaultDecision: "approval_required",
    riskLevel: "high",
    capabilities: ["browser_write", "browser_action_planning"],
    permissions: ["browser:write"],
    approvalReason: "Browser write actions can click, type, submit, or upload and require approval.",
  },
  "computer:observe": {
    defaultDecision: "auto_allowed",
    riskLevel: "medium",
    capabilities: ["computer_observe"],
    permissions: ["computer:observe"],
    approvalReason: "Planned computer observation can be auto-approved only as mock/local metadata.",
  },
  "computer:act": {
    defaultDecision: "approval_required",
    riskLevel: "high",
    capabilities: ["computer_act", "computer_action_planning"],
    permissions: ["computer:act"],
    approvalReason: "Computer actions can affect the local environment and require approval.",
  },
  "account:login": {
    defaultDecision: "blocked",
    riskLevel: "blocked",
    capabilities: ["account_login"],
    permissions: ["account:login"],
    approvalReason: "Account login actions are blocked by default.",
  },
  "payment:act": {
    defaultDecision: "blocked",
    riskLevel: "blocked",
    capabilities: ["payment_act"],
    permissions: ["payment:act"],
    approvalReason: "Payment actions are blocked by default.",
  },
  "file:read": {
    defaultDecision: "auto_allowed",
    riskLevel: "low",
    capabilities: ["file_read"],
    permissions: ["file:read"],
    approvalReason: "Low-risk non-sensitive file reads can be auto-approved.",
  },
  "file:write": {
    defaultDecision: "approval_required",
    riskLevel: "medium",
    capabilities: ["file_write"],
    permissions: ["file:write"],
    approvalReason: "File writes require approval.",
  },
};

const blockedIntentPatterns: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\bdelete\b/i,
    reason: "Delete actions are blocked by Autopilot Approval Policy v1",
  },
  {
    pattern: /\bpay(?:ment)?\b/i,
    reason: "Payment actions are blocked by Autopilot Approval Policy v1",
  },
  {
    pattern: /\baccount\s+setting\b|\bchange\s+(?:account|password|email)\b/i,
    reason: "Account-setting actions are blocked by Autopilot Approval Policy v1",
  },
];

const approvalIntentPatterns: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\bpublish\b/i,
    reason: "Publish actions require approval by Autopilot Approval Policy v1",
  },
  {
    pattern: /\brepl(?:y|ies|ied)\b|\bcomment\b|\bsend\b/i,
    reason: "Reply/comment/send actions require approval by Autopilot Approval Policy v1",
  },
  {
    pattern: /\bupload\b|\blogin\b|\blog in\b|\bsign in\b|\bclick\b|\btype\b|\bsubmit\b/i,
    reason: "Upload/login/click/type/submit actions require approval by Autopilot Approval Policy v1",
  },
  {
    pattern: /\bnegative feedback\b|\bsensitive\b|\bcomplaint\b|\bcrisis\b/i,
    reason: "Sensitive or negative-feedback scenarios require approval by Autopilot Approval Policy v1",
  },
];

const riskRank: Record<DryRunRiskLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
  blocked: 4,
};

export function decideAutopilotApprovalPolicy(
  request: AutopilotApprovalPolicyRequest,
): AutopilotApprovalPolicyResult {
  const profile = actionProfiles[request.action as AutopilotApprovalActionCategory];
  const unsupportedReasons = profile ? [] : [`Unsupported autopilot action: ${request.action}`];
  const text = stringifyRequest(request);
  const blockedReasons = [
    ...unsupportedReasons,
    ...collectProfileBlockedReasons(profile),
    ...collectPatternReasons(text, blockedIntentPatterns),
    ...collectContextBlockedReasons(request),
  ];
  const approvalReasons = [
    ...(profile ? [profile.approvalReason] : []),
    ...collectPatternReasons(text, approvalIntentPatterns),
    ...collectContextApprovalReasons(request),
  ];
  const requestedRisk = request.riskLevel ?? "low";
  const baseRisk = profile?.riskLevel ?? "blocked";
  const riskLevel = blockedReasons.length > 0 ? "blocked" : maxRisk(baseRisk, requestedRisk);
  const policyDecision = decideLevel(profile, riskLevel, blockedReasons, approvalReasons);
  const requiresApproval = policyDecision === "approval_required";
  const approvalReason = summarizeApprovalReason(policyDecision, approvalReasons, blockedReasons);

  return {
    policyDecision,
    action: request.action,
    riskLevel,
    requiresApproval,
    blockedReasons,
    approvalReason,
    capabilities: profile?.capabilities ?? [],
    permissions: profile?.permissions ?? [],
    summary: summarizeDecision(request, policyDecision, riskLevel, approvalReason, blockedReasons),
    plannedOnly: true,
    auditSummary: createAuditSummary(),
  };
}

function decideLevel(
  profile: ActionProfile | undefined,
  riskLevel: DryRunRiskLevel,
  blockedReasons: string[],
  approvalReasons: string[],
): AutopilotApprovalDecisionLevel {
  if (!profile || blockedReasons.length > 0 || riskLevel === "blocked") {
    return "blocked";
  }

  if (profile.defaultDecision === "blocked") {
    return "blocked";
  }

  if (profile.defaultDecision === "approval_required" || riskLevel === "high" || approvalReasons.length > 1) {
    return "approval_required";
  }

  return "auto_allowed";
}

function collectProfileBlockedReasons(profile: ActionProfile | undefined): string[] {
  if (profile?.defaultDecision !== "blocked") {
    return [];
  }

  return [profile.approvalReason];
}

function collectPatternReasons(
  text: string,
  patterns: Array<{ pattern: RegExp; reason: string }>,
): string[] {
  const reasons = new Set<string>();

  for (const entry of patterns) {
    if (entry.pattern.test(text)) {
      reasons.add(entry.reason);
    }
  }

  return [...reasons];
}

function collectContextBlockedReasons(request: AutopilotApprovalPolicyRequest): string[] {
  const reasons = new Set<string>();

  if (request.context?.accountSetting === true) {
    reasons.add("Account-setting actions are blocked by Autopilot Approval Policy v1");
  }

  return [...reasons];
}

function collectContextApprovalReasons(request: AutopilotApprovalPolicyRequest): string[] {
  const reasons = new Set<string>();

  if (request.context?.sensitive === true || request.context?.negativeFeedback === true) {
    reasons.add("Sensitive or negative-feedback scenarios require approval by Autopilot Approval Policy v1");
  }

  return [...reasons];
}

function summarizeApprovalReason(
  policyDecision: AutopilotApprovalDecisionLevel,
  approvalReasons: string[],
  blockedReasons: string[],
): string {
  if (policyDecision === "blocked") {
    return blockedReasons[0] ?? "Action is blocked by Autopilot Approval Policy v1.";
  }

  if (policyDecision === "approval_required") {
    return approvalReasons[approvalReasons.length - 1] ?? "Action requires approval by Autopilot Approval Policy v1.";
  }

  return approvalReasons[0] ?? "Action is low-risk and auto-allowed by Autopilot Approval Policy v1.";
}

function summarizeDecision(
  request: AutopilotApprovalPolicyRequest,
  policyDecision: AutopilotApprovalDecisionLevel,
  riskLevel: DryRunRiskLevel,
  approvalReason: string,
  blockedReasons: string[],
): string {
  const blockedText =
    blockedReasons.length > 0 ? ` Blocked reasons: ${blockedReasons.join("; ")}.` : "";

  return `Autopilot Approval Policy v1 decided ${policyDecision} for ${request.action} at ${riskLevel} risk. ${approvalReason} Policy evaluation is planning-only; no scheduler, browser, computer, network, publish, reply, comment, send, upload, login, click, type, submit, pay, or delete action was performed.${blockedText}`;
}

function stringifyRequest(request: AutopilotApprovalPolicyRequest): string {
  try {
    return JSON.stringify({
      action: request.action,
      description: request.description,
      context: request.context,
    });
  } catch {
    return `${request.action} ${request.description ?? ""}`;
  }
}

function createAuditSummary(): AutopilotApprovalPolicyResult["auditSummary"] {
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

function maxRisk(current: DryRunRiskLevel, next: DryRunRiskLevel): DryRunRiskLevel {
  return riskRank[next] > riskRank[current] ? next : current;
}
