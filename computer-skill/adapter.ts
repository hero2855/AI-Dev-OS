import { runSkillRuntimeRequest } from "../skill-runtime";
import type { SkillRuntimeActionType, SkillRuntimeAuditSummary, SkillRuntimeSafetyCheck } from "../skill-runtime";
import type { DryRunRiskLevel } from "../skill-system/execution-plan";
import type { ComputerSkillV1Request, ComputerSkillV1Result } from "./types";

type ComputerActionProfile = {
  capabilities: string[];
  permissions: string[];
  riskLevel: DryRunRiskLevel;
  requiresApproval: boolean;
};

const computerActionProfiles: Record<string, ComputerActionProfile> = {
  "computer:observe": {
    capabilities: ["computer_observe", "computer_action_planning"],
    permissions: ["computer:observe"],
    riskLevel: "medium",
    requiresApproval: false,
  },
  "computer:act": {
    capabilities: ["computer_act", "computer_action_planning"],
    permissions: ["computer:act"],
    riskLevel: "blocked",
    requiresApproval: true,
  },
};

const highRiskIntentPatterns: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\bclick\b/i,
    reason: "Computer click actions are blocked in Computer Use Skill v1",
  },
  {
    pattern: /\b(?:type|enter text)\b/i,
    reason: "Computer type/typing actions are blocked in Computer Use Skill v1",
  },
  {
    pattern: /\bsubmit\b/i,
    reason: "Computer submit actions are blocked in Computer Use Skill v1",
  },
  {
    pattern: /\bupload\b/i,
    reason: "Computer upload actions are blocked in Computer Use Skill v1",
  },
  {
    pattern: /\bdelete\b/i,
    reason: "Computer delete actions are blocked in Computer Use Skill v1",
  },
  {
    pattern: /\b(?:login|log in|sign in)\b/i,
    reason: "Computer login actions are blocked in Computer Use Skill v1",
  },
  {
    pattern: /\bpay(?:ment)?\b/i,
    reason: "Computer pay actions are blocked in Computer Use Skill v1",
  },
  {
    pattern: /\bsend(?:\s+(?:message|messages|email|emails))?\b/i,
    reason: "Computer send actions are blocked in Computer Use Skill v1",
  },
  {
    pattern: /\b(?:system setting|system settings|change settings|settings change)\b/i,
    reason: "Computer system-setting actions are blocked in Computer Use Skill v1",
  },
];

const supportedComputerActionTypes = new Set(["computer:observe", "computer:act"]);

export function runComputerSkillV1Request(request: ComputerSkillV1Request): ComputerSkillV1Result {
  const skillName = request.skillName ?? "computer-use-skill-v1";
  const requestId = request.requestId ?? createDeterministicComputerRequestId(request);
  const profile = computerActionProfiles[request.action.type];

  if (!profile || !supportedComputerActionTypes.has(request.action.type)) {
    return createComputerResult({
      request,
      requestId,
      skillName,
      profile: {
        capabilities: ["computer_action_planning"],
        permissions: [],
        riskLevel: "blocked",
        requiresApproval: true,
      },
      blockedReasons: [`Unsupported Computer Use Skill v1 action: ${request.action.type}`],
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

  const blockedReasons = mergeUnique(runtimeResult.blockedReasons, collectComputerBlockedReasons(request));
  const requiresApproval = determineRequiresApproval(request, profile, runtimeResult.requiresApproval, blockedReasons);
  const status = determineComputerStatus(request, runtimeResult.status, blockedReasons);
  const riskLevel = blockedReasons.length > 0 ? "blocked" : profile.riskLevel;

  return {
    requestId,
    computerSkillVersion: "v1",
    skillName,
    mode: request.mode,
    status,
    actionType: request.action.type,
    capabilities: runtimeResult.capabilities,
    permissions: runtimeResult.permissions,
    riskLevel,
    requiresApproval,
    blockedReasons,
    safetyChecks: createComputerSafetyChecks(runtimeResult.safetyChecks, blockedReasons),
    auditSummary: runtimeResult.auditSummary,
    approvalRecordId: request.approvalRecordId,
    summary: summarizeComputerResult(request, status, blockedReasons),
    plannedAction: {
      actionType: request.action.type,
      description: request.action.description,
      mode: request.mode,
      advisoryOnly: true,
      realOperationPerformed: false,
      requiresApproval,
    },
    output: {
      type: "computer_skill_v1_plan",
      actionType: request.action.type,
      mode: request.mode,
      advisoryOnly: true,
      realOperationPerformed: false,
      runtimeOutput: runtimeResult.output,
    },
  };
}

function collectComputerBlockedReasons(request: ComputerSkillV1Request): string[] {
  const reasons: string[] = [];
  const actionText = stringifyAction(request.action.description, request.action.input);

  if (request.mode === "external") {
    reasons.push("External computer runtime is disabled in Computer Use Skill v1");
  }

  for (const intent of highRiskIntentPatterns) {
    if (intent.pattern.test(actionText)) {
      reasons.push(intent.reason);
    }
  }

  return reasons;
}

function determineRequiresApproval(
  request: ComputerSkillV1Request,
  profile: ComputerActionProfile,
  runtimeRequiresApproval: boolean,
  blockedReasons: string[],
): boolean {
  if (blockedReasons.length > 0 || profile.requiresApproval || request.action.type === "computer:act") {
    return true;
  }

  if (request.action.type === "computer:observe") {
    return false;
  }

  return runtimeRequiresApproval;
}

function determineComputerStatus(
  request: ComputerSkillV1Request,
  runtimeStatus: ComputerSkillV1Result["status"],
  blockedReasons: string[],
): ComputerSkillV1Result["status"] {
  if (blockedReasons.length > 0) {
    return "blocked";
  }

  if (request.action.type === "computer:observe") {
    return "completed";
  }

  if (request.action.type === "computer:act") {
    return "requires_approval";
  }

  return runtimeStatus;
}

function createComputerResult(params: {
  request: ComputerSkillV1Request;
  requestId: string;
  skillName: string;
  profile: ComputerActionProfile;
  blockedReasons: string[];
  status: ComputerSkillV1Result["status"];
}): ComputerSkillV1Result {
  const capabilities = mergeUnique(params.profile.capabilities, params.request.capabilities ?? []);
  const permissions = mergeUnique(params.profile.permissions, params.request.permissions ?? []);
  const requiresApproval = params.profile.requiresApproval || params.blockedReasons.length > 0;

  return {
    requestId: params.requestId,
    computerSkillVersion: "v1",
    skillName: params.skillName,
    mode: params.request.mode,
    status: params.status,
    actionType: params.request.action.type,
    capabilities,
    permissions,
    riskLevel: params.blockedReasons.length > 0 ? "blocked" : params.profile.riskLevel,
    requiresApproval,
    blockedReasons: params.blockedReasons,
    safetyChecks: createComputerSafetyChecks([], params.blockedReasons),
    auditSummary: createAuditSummary(params.request.mode),
    approvalRecordId: params.request.approvalRecordId,
    summary: summarizeComputerResult(params.request, params.status, params.blockedReasons),
    plannedAction: {
      actionType: params.request.action.type,
      description: params.request.action.description,
      mode: params.request.mode,
      advisoryOnly: true,
      realOperationPerformed: false,
      requiresApproval,
    },
    output: {
      type: "computer_skill_v1_plan",
      actionType: params.request.action.type,
      mode: params.request.mode,
      advisoryOnly: true,
      realOperationPerformed: false,
    },
  };
}

function createComputerSafetyChecks(
  runtimeChecks: SkillRuntimeSafetyCheck[],
  blockedReasons: string[],
): SkillRuntimeSafetyCheck[] {
  const computerChecks: SkillRuntimeSafetyCheck[] = [
    {
      name: "computer-use-skill-v1-advisory-only",
      passed: true,
      reason: "Computer Use Skill v1 only returns mock/local plans and performs no real computer action.",
    },
    {
      name: "computer-act-approval-gated",
      passed: true,
      reason: "Computer actions are blocked or approval-gated as planned actions only.",
    },
    {
      name: "computer-blocked-reasons-empty",
      passed: blockedReasons.length === 0,
      reason: blockedReasons.length === 0 ? "No Computer Use Skill v1 blocking reasons." : blockedReasons.join("; "),
    },
  ];

  return [...runtimeChecks, ...computerChecks];
}

function createAuditSummary(mode: ComputerSkillV1Request["mode"]): SkillRuntimeAuditSummary {
  return {
    realNetworkOperation: false,
    realBrowserOperation: false,
    realComputerOperation: false,
    realShellOperation: false,
    realPublishOperation: false,
    mode,
  };
}

function summarizeComputerResult(
  request: ComputerSkillV1Request,
  status: ComputerSkillV1Result["status"],
  blockedReasons: string[],
): string {
  if (status === "blocked") {
    return `Computer Use Skill v1 action ${request.action.type} blocked: ${blockedReasons.join("; ")}. No real computer action was performed. No browser, network, shell, publish, login, pay, send, delete, upload, submit, click, or type action was performed.`;
  }

  if (request.action.type === "computer:act") {
    return "Computer Use Skill v1 action recorded as an approval-gated planned action only. No real computer action was performed.";
  }

  return `Computer Use Skill v1 observe action completed in ${request.mode} mode with mock/local output only. No real computer, browser, network, or shell action was performed.`;
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

function createDeterministicComputerRequestId(request: ComputerSkillV1Request): string {
  const text = JSON.stringify({
    goal: request.goal,
    skillName: request.skillName ?? "computer-use-skill-v1",
    mode: request.mode,
    actionType: request.action.type,
    description: request.action.description,
  });
  let hash = 0;

  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }

  return `computer-v1-${hash.toString(16).padStart(8, "0")}`;
}
