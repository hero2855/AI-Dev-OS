import { runSkillRuntimeRequest } from "../skill-runtime";
import type { SkillRuntimeActionType, SkillRuntimeAuditSummary, SkillRuntimeSafetyCheck } from "../skill-runtime";
import type { DryRunRiskLevel } from "../skill-system/execution-plan";
import type { BrowserSkillV1Request, BrowserSkillV1Result } from "./types";

type BrowserActionProfile = {
  capabilities: string[];
  permissions: string[];
  riskLevel: DryRunRiskLevel;
  requiresApproval: boolean;
};

const browserActionProfiles: Record<string, BrowserActionProfile> = {
  "browser:read": {
    capabilities: ["browser_read", "browser_action_planning"],
    permissions: ["browser:read"],
    riskLevel: "low",
    requiresApproval: false,
  },
  "browser:write": {
    capabilities: ["browser_write", "browser_action_planning"],
    permissions: ["browser:write"],
    riskLevel: "blocked",
    requiresApproval: true,
  },
};

const approvalGatedIntentPatterns: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\b(?:publish|post)\b/i,
    reason: "Browser publishing/posting is approval-gated and remains planned only in Browser Skill v1",
  },
  {
    pattern: /\bcomment\b/i,
    reason: "Browser commenting is approval-gated and remains planned only in Browser Skill v1",
  },
  {
    pattern: /\brepl(?:y|ies|ied)\b/i,
    reason: "Browser reply actions are approval-gated and remain planned only in Browser Skill v1",
  },
  {
    pattern: /\bupload\b/i,
    reason: "Browser uploads are approval-gated and remain planned only in Browser Skill v1",
  },
  {
    pattern: /\b(?:login|log in|sign in)\b/i,
    reason: "Browser login is blocked in Browser Skill v1",
  },
  {
    pattern: /\bclick\b/i,
    reason: "Browser click actions are blocked in Browser Skill v1",
  },
  {
    pattern: /\b(?:type|enter text)\b/i,
    reason: "Browser typing actions are blocked in Browser Skill v1",
  },
  {
    pattern: /\bsubmit\b/i,
    reason: "Browser submit actions are blocked in Browser Skill v1",
  },
];

const supportedBrowserActionTypes = new Set(["browser:read", "browser:write"]);

export function runBrowserSkillV1Request(request: BrowserSkillV1Request): BrowserSkillV1Result {
  const skillName = request.skillName ?? "browser-skill-v1";
  const requestId = request.requestId ?? createDeterministicBrowserRequestId(request);
  const profile = browserActionProfiles[request.action.type];

  if (!profile || !supportedBrowserActionTypes.has(request.action.type)) {
    return createBrowserResult({
      request,
      requestId,
      skillName,
      profile: {
        capabilities: ["browser_action_planning"],
        permissions: [],
        riskLevel: "blocked",
        requiresApproval: true,
      },
      blockedReasons: [`Unsupported Browser Skill v1 action: ${request.action.type}`],
      status: "blocked",
    });
  }

  const runtimeResult = runSkillRuntimeRequest({
    requestId,
    goal: request.goal,
    skillName,
    mode: request.mode,
    action: {
      type: request.action.type as SkillRuntimeActionType,
      description: request.action.description,
      input: request.action.input,
    },
    capabilities: mergeUnique(profile.capabilities, request.capabilities ?? []),
    permissions: mergeUnique(profile.permissions, request.permissions ?? []),
    approvalRecordId: request.approvalRecordId,
    approvalGranted: request.approvalGranted,
    allowHighRiskMockAction: request.allowHighRiskMockAction,
  });

  const blockedReasons = mergeUnique(runtimeResult.blockedReasons, collectBrowserBlockedReasons(request));
  const requiresApproval = runtimeResult.requiresApproval || profile.requiresApproval || blockedReasons.length > 0;
  const status = determineBrowserStatus(request, runtimeResult.status, blockedReasons);
  const riskLevel = blockedReasons.length > 0 ? "blocked" : runtimeResult.riskLevel;

  return {
    requestId,
    browserSkillVersion: "v1",
    skillName,
    mode: request.mode,
    status,
    actionType: request.action.type,
    capabilities: runtimeResult.capabilities,
    permissions: runtimeResult.permissions,
    riskLevel,
    requiresApproval,
    blockedReasons,
    safetyChecks: createBrowserSafetyChecks(runtimeResult.safetyChecks, blockedReasons),
    auditSummary: runtimeResult.auditSummary,
    approvalRecordId: request.approvalRecordId,
    summary: summarizeBrowserResult(request, status, blockedReasons),
    plannedAction: {
      actionType: request.action.type,
      description: request.action.description,
      mode: request.mode,
      advisoryOnly: true,
      realOperationPerformed: false,
      requiresApproval,
    },
    output: {
      type: "browser_skill_v1_plan",
      actionType: request.action.type,
      mode: request.mode,
      advisoryOnly: true,
      realOperationPerformed: false,
      runtimeOutput: runtimeResult.output,
    },
  };
}

function collectBrowserBlockedReasons(request: BrowserSkillV1Request): string[] {
  const reasons: string[] = [];
  const actionText = stringifyAction(request.action.description, request.action.input);

  if (request.mode === "external") {
    reasons.push("External browser runtime is disabled in Browser Skill v1");
  }

  for (const intent of approvalGatedIntentPatterns) {
    if (intent.pattern.test(actionText)) {
      reasons.push(intent.reason);
    }
  }

  return reasons;
}

function determineBrowserStatus(
  request: BrowserSkillV1Request,
  runtimeStatus: BrowserSkillV1Result["status"],
  blockedReasons: string[],
): BrowserSkillV1Result["status"] {
  if (blockedReasons.length > 0) {
    return "blocked";
  }

  if (request.action.type === "browser:write") {
    return "requires_approval";
  }

  return runtimeStatus;
}

function createBrowserResult(params: {
  request: BrowserSkillV1Request;
  requestId: string;
  skillName: string;
  profile: BrowserActionProfile;
  blockedReasons: string[];
  status: BrowserSkillV1Result["status"];
}): BrowserSkillV1Result {
  const capabilities = mergeUnique(params.profile.capabilities, params.request.capabilities ?? []);
  const permissions = mergeUnique(params.profile.permissions, params.request.permissions ?? []);
  const requiresApproval = params.profile.requiresApproval || params.blockedReasons.length > 0;

  return {
    requestId: params.requestId,
    browserSkillVersion: "v1",
    skillName: params.skillName,
    mode: params.request.mode,
    status: params.status,
    actionType: params.request.action.type,
    capabilities,
    permissions,
    riskLevel: params.blockedReasons.length > 0 ? "blocked" : params.profile.riskLevel,
    requiresApproval,
    blockedReasons: params.blockedReasons,
    safetyChecks: createBrowserSafetyChecks([], params.blockedReasons),
    auditSummary: createAuditSummary(params.request.mode),
    approvalRecordId: params.request.approvalRecordId,
    summary: summarizeBrowserResult(params.request, params.status, params.blockedReasons),
    plannedAction: {
      actionType: params.request.action.type,
      description: params.request.action.description,
      mode: params.request.mode,
      advisoryOnly: true,
      realOperationPerformed: false,
      requiresApproval,
    },
    output: {
      type: "browser_skill_v1_plan",
      actionType: params.request.action.type,
      mode: params.request.mode,
      advisoryOnly: true,
      realOperationPerformed: false,
    },
  };
}

function createBrowserSafetyChecks(
  runtimeChecks: SkillRuntimeSafetyCheck[],
  blockedReasons: string[],
): SkillRuntimeSafetyCheck[] {
  const browserChecks: SkillRuntimeSafetyCheck[] = [
    {
      name: "browser-skill-v1-advisory-only",
      passed: true,
      reason: "Browser Skill v1 only returns mock/local plans and performs no real browser action.",
    },
    {
      name: "browser-write-approval-gated",
      passed: true,
      reason: "Browser writes are blocked or approval-gated as planned actions only.",
    },
    {
      name: "browser-blocked-reasons-empty",
      passed: blockedReasons.length === 0,
      reason: blockedReasons.length === 0 ? "No Browser Skill v1 blocking reasons." : blockedReasons.join("; "),
    },
  ];

  return [...runtimeChecks, ...browserChecks];
}

function createAuditSummary(mode: BrowserSkillV1Request["mode"]): SkillRuntimeAuditSummary {
  return {
    realNetworkOperation: false,
    realBrowserOperation: false,
    realComputerOperation: false,
    realShellOperation: false,
    realPublishOperation: false,
    mode,
  };
}

function summarizeBrowserResult(
  request: BrowserSkillV1Request,
  status: BrowserSkillV1Result["status"],
  blockedReasons: string[],
): string {
  if (status === "blocked") {
    return `Browser Skill v1 action ${request.action.type} blocked: ${blockedReasons.join("; ")}. No real browser action was performed. No computer, network, publish, login, submit, or upload action was performed.`;
  }

  if (request.action.type === "browser:write") {
    return "Browser Skill v1 write action recorded as an approval-gated planned action only. No real browser action was performed.";
  }

  return `Browser Skill v1 read action completed in ${request.mode} mode with mock/local output only. No real browser, computer, or network action was performed.`;
}

function stringifyAction(description: string, input: unknown): string {
  if (input === undefined) {
    return description;
  }

  try {
    return `${description} ${JSON.stringify(input)}`;
  } catch {
    return description;
  }
}

function mergeUnique(first: string[], second: string[]): string[] {
  return [...new Set([...first, ...second])];
}

function createDeterministicBrowserRequestId(request: BrowserSkillV1Request): string {
  const text = JSON.stringify({
    goal: request.goal,
    skillName: request.skillName ?? "browser-skill-v1",
    mode: request.mode,
    actionType: request.action.type,
    description: request.action.description,
  });
  let hash = 0;

  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }

  return `browser-v1-${hash.toString(16).padStart(8, "0")}`;
}
