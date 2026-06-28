import type {
  SkillRuntimeActionType,
  SkillRuntimeAdapter,
  SkillRuntimeAuditSummary,
  SkillRuntimeRequest,
  SkillRuntimeResult,
  SkillRuntimeSafetyCheck,
} from "./types";
import type { DryRunRiskLevel } from "../skill-system/execution-plan";

type ActionSafetyProfile = {
  capabilities: string[];
  permissions: string[];
  riskLevel: DryRunRiskLevel;
  requiresApproval: boolean;
  blockedByDefault: boolean;
};

const actionSafetyProfiles: Record<SkillRuntimeActionType, ActionSafetyProfile> = {
  "github:read": {
    capabilities: ["github_read"],
    permissions: ["network:github:mock-read"],
    riskLevel: "low",
    requiresApproval: false,
    blockedByDefault: false,
  },
  "github:write": {
    capabilities: ["github_write"],
    permissions: ["network:github:write"],
    riskLevel: "high",
    requiresApproval: true,
    blockedByDefault: true,
  },
  "browser:read": {
    capabilities: ["browser_read"],
    permissions: ["browser:read"],
    riskLevel: "low",
    requiresApproval: false,
    blockedByDefault: false,
  },
  "browser:write": {
    capabilities: ["browser_write"],
    permissions: ["browser:write"],
    riskLevel: "blocked",
    requiresApproval: true,
    blockedByDefault: true,
  },
  "computer:observe": {
    capabilities: ["computer_observe"],
    permissions: ["computer:observe"],
    riskLevel: "medium",
    requiresApproval: true,
    blockedByDefault: false,
  },
  "computer:act": {
    capabilities: ["computer_act"],
    permissions: ["computer:act"],
    riskLevel: "blocked",
    requiresApproval: true,
    blockedByDefault: true,
  },
  "file:read": {
    capabilities: ["file_read"],
    permissions: ["file:read"],
    riskLevel: "low",
    requiresApproval: false,
    blockedByDefault: false,
  },
  "file:write": {
    capabilities: ["file_write"],
    permissions: ["file:write:preview"],
    riskLevel: "medium",
    requiresApproval: true,
    blockedByDefault: false,
  },
  "content:create": {
    capabilities: ["content_create"],
    permissions: ["content:create:local"],
    riskLevel: "low",
    requiresApproval: false,
    blockedByDefault: false,
  },
  "content:schedule": {
    capabilities: ["content_schedule"],
    permissions: ["content:schedule:preview"],
    riskLevel: "medium",
    requiresApproval: true,
    blockedByDefault: false,
  },
  "content:publish": {
    capabilities: ["content_publish"],
    permissions: ["content:publish"],
    riskLevel: "high",
    requiresApproval: true,
    blockedByDefault: true,
  },
  "content:reply": {
    capabilities: ["content_reply"],
    permissions: ["content:reply:preview"],
    riskLevel: "medium",
    requiresApproval: true,
    blockedByDefault: false,
  },
};

const sideEffectActionTypes = new Set<SkillRuntimeActionType>([
  "github:write",
  "browser:write",
  "computer:act",
  "content:publish",
]);

export function createSkillRuntimeAdapter(): SkillRuntimeAdapter {
  return {
    run: runSkillRuntimeRequest,
  };
}

export function runSkillRuntimeRequest(request: SkillRuntimeRequest): SkillRuntimeResult {
  const profile = actionSafetyProfiles[request.action.type];
  const capabilities = mergeUnique(profile.capabilities, request.capabilities ?? []);
  const permissions = mergeUnique(profile.permissions, request.permissions ?? []);
  const blockedReasons = collectBlockedReasons(request, profile);
  const requiresApproval =
    blockedReasons.length > 0 ||
    profile.requiresApproval ||
    Boolean(request.changeSetPreview?.requiresApproval);
  const safetyChecks = createSafetyChecks(request, blockedReasons);
  const status = determineStatus(request, profile, blockedReasons, requiresApproval);
  const requestId = request.requestId ?? createDeterministicRuntimeRequestId(request);

  return {
    requestId,
    skillName: request.skillName,
    mode: request.mode,
    status,
    actionType: request.action.type,
    capabilities,
    permissions,
    riskLevel: blockedReasons.length > 0 ? "blocked" : profile.riskLevel,
    requiresApproval,
    blockedReasons,
    safetyChecks,
    auditSummary: createAuditSummary(request.mode),
    approvalRecordId: request.approvalRecordId,
    changeSetId: request.changeSetPreview?.changeSetId,
    summary: summarizeRuntimeResult(request, status, blockedReasons),
    output: createMockOutput(request, status),
  };
}

function collectBlockedReasons(request: SkillRuntimeRequest, profile: ActionSafetyProfile): string[] {
  const reasons = new Set<string>();

  if (request.mode === "external") {
    reasons.add("External runtime mode is disabled in V4.10");
  }

  if (profile.blockedByDefault && request.allowHighRiskMockAction !== true) {
    reasons.add(`${request.action.type} is disabled unless explicitly approved for mock/local preview`);
  }

  if (sideEffectActionTypes.has(request.action.type) && request.approvalGranted !== true) {
    reasons.add(`${request.action.type} requires approval before runtime execution`);
  }

  if (request.permissions?.includes("shell:execute")) {
    reasons.add("shell:execute permission is blocked by Skill Runtime Adapter");
  }

  if (request.changeSetPreview?.status === "blocked") {
    reasons.add("Linked ChangeSet preview is blocked");
  }

  return [...reasons];
}

function determineStatus(
  request: SkillRuntimeRequest,
  profile: ActionSafetyProfile,
  blockedReasons: string[],
  requiresApproval: boolean,
): SkillRuntimeResult["status"] {
  if (blockedReasons.length > 0) {
    return "blocked";
  }

  if (requiresApproval && request.approvalGranted !== true) {
    return "requires_approval";
  }

  if (profile.requiresApproval && request.approvalGranted === true && request.allowHighRiskMockAction !== true) {
    return "requires_approval";
  }

  return "completed";
}

function createSafetyChecks(request: SkillRuntimeRequest, blockedReasons: string[]): SkillRuntimeSafetyCheck[] {
  return [
    {
      name: "offline-runtime-mode",
      passed: request.mode === "mock" || request.mode === "local",
      reason:
        request.mode === "mock" || request.mode === "local"
          ? "Only mock/local runtime mode is used."
          : "External runtime mode is disabled.",
    },
    {
      name: "no-real-side-effects",
      passed: true,
      reason: "Adapter returns structured mock/local results and performs no browser, computer, shell, network, or publish operation.",
    },
    {
      name: "blocked-reasons-empty",
      passed: blockedReasons.length === 0,
      reason: blockedReasons.length === 0 ? "No blocking runtime safety reasons." : blockedReasons.join("; "),
    },
  ];
}

function createAuditSummary(mode: SkillRuntimeRequest["mode"]): SkillRuntimeAuditSummary {
  return {
    realNetworkOperation: false,
    realBrowserOperation: false,
    realComputerOperation: false,
    realShellOperation: false,
    realPublishOperation: false,
    mode,
  };
}

function summarizeRuntimeResult(
  request: SkillRuntimeRequest,
  status: SkillRuntimeResult["status"],
  blockedReasons: string[],
): string {
  if (status === "blocked") {
    return `Skill runtime action ${request.action.type} blocked: ${blockedReasons.join("; ")}. No real operation was performed.`;
  }

  if (status === "requires_approval") {
    return `Skill runtime action ${request.action.type} requires approval before any real operation. V4.10 returned a preview only.`;
  }

  return `Skill runtime action ${request.action.type} completed in ${request.mode} mode with mock/local output only. No real operation was performed.`;
}

function createMockOutput(request: SkillRuntimeRequest, status: SkillRuntimeResult["status"]): unknown {
  return {
    type: "skill_runtime_mock_output",
    status,
    actionType: request.action.type,
    description: request.action.description,
    wouldExecute: status === "completed",
    realOperationPerformed: false,
  };
}

function mergeUnique(first: string[], second: string[]): string[] {
  return [...new Set([...first, ...second])];
}

function createDeterministicRuntimeRequestId(request: SkillRuntimeRequest): string {
  const text = JSON.stringify({
    goal: request.goal,
    skillName: request.skillName,
    mode: request.mode,
    actionType: request.action.type,
    description: request.action.description,
  });
  let hash = 0;

  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }

  return `runtime-${hash.toString(16).padStart(8, "0")}`;
}
