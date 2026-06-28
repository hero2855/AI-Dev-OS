import { assertSha256Integrity } from "../skill-system/github/integrity";
import { validateGitHubSkillManifest } from "../skill-system/github/manifest";
import { isTrustedRepo } from "../skill-system/github/trustedRepos";
import { validateSkillPolicy } from "../skill-system/policy/policy";
import { runSkillRuntimeRequest } from "../skill-runtime";
import type {
  GitHubSkillV1ManifestInput,
  GitHubSkillV1ManifestValidation,
  GitHubSkillV1Request,
  GitHubSkillV1Result,
} from "./types";

const githubActionTypes = new Set(["github:read", "github:write"]);

export function validateGitHubSkillV1Manifest(input: GitHubSkillV1ManifestInput): GitHubSkillV1ManifestValidation {
  const blockedReasons: string[] = [];
  const trustedRepo = isTrustedRepo(input.repoUrl);

  if (!trustedRepo) {
    blockedReasons.push("Untrusted GitHub skill repo");
  }

  let integrityChecked = false;
  let integrityValid = true;

  if (input.expectedSha256 !== undefined) {
    integrityChecked = true;

    if (input.manifestText === undefined) {
      integrityValid = false;
      blockedReasons.push("Manifest integrity check requires manifest text");
    } else {
      try {
        assertSha256Integrity(input.manifestText, input.expectedSha256, input.manifestPath ?? "GitHub skill manifest");
      } catch (error) {
        integrityValid = false;
        blockedReasons.push(error instanceof Error ? error.message : String(error));
      }
    }
  }

  let manifest;
  let schemaValid = false;
  let policyValid = false;
  let nameValid = false;
  let versionValid = false;
  let permissionsValid = false;
  let capabilitiesValid = false;

  try {
    manifest = validateGitHubSkillManifest(input.manifest);
    schemaValid = true;
    nameValid = manifest.name.trim().length > 0;
    versionValid = manifest.version.trim().length > 0;
    permissionsValid = manifest.permissions.length > 0 && manifest.permissions.every((permission) => permission.trim().length > 0);
    capabilitiesValid = manifest.capabilities.length > 0 && manifest.capabilities.every((capability) => capability.trim().length > 0);

    if (!nameValid) {
      blockedReasons.push("GitHub skill manifest name is invalid");
    }

    if (!versionValid) {
      blockedReasons.push("GitHub skill manifest version is invalid");
    }

    if (!permissionsValid) {
      blockedReasons.push("GitHub skill manifest permissions are invalid");
    }

    if (!capabilitiesValid) {
      blockedReasons.push("GitHub skill manifest capabilities are invalid");
    }

    try {
      validateSkillPolicy(manifest);
      policyValid = true;
    } catch (error) {
      blockedReasons.push(error instanceof Error ? error.message : String(error));
    }
  } catch (error) {
    blockedReasons.push(error instanceof Error ? error.message : String(error));
  }

  return {
    trustedRepo,
    schemaValid,
    integrityChecked,
    integrityValid,
    policyValid,
    nameValid,
    versionValid,
    permissionsValid,
    capabilitiesValid,
    manifest,
    blockedReasons,
  };
}

export function runGitHubSkillV1Request(request: GitHubSkillV1Request): GitHubSkillV1Result {
  const manifestValidation = validateGitHubSkillV1Manifest(request);
  const manifest = manifestValidation.manifest;
  const capabilities = manifest?.capabilities ?? [];
  const permissions = manifest?.permissions ?? [];
  const blockedReasons = [...manifestValidation.blockedReasons];

  if (!githubActionTypes.has(request.action.type)) {
    blockedReasons.push(`Unsupported GitHub Skill v1 action: ${request.action.type}`);
  }

  if (request.mode === "external") {
    blockedReasons.push("External GitHub Skill v1 runtime mode is disabled");
  }

  if (blockedReasons.length > 0 || !manifest) {
    return {
      skillName: manifest?.name,
      repoUrl: request.repoUrl,
      manifestPath: request.manifestPath,
      mode: request.mode,
      status: "blocked",
      actionType: request.action.type,
      riskLevel: "blocked",
      requiresApproval: true,
      blockedReasons,
      permissions,
      capabilities,
      summary: `GitHub Skill v1 action ${request.action.type} blocked during manifest/runtime validation. No remote code or GitHub operation was performed.`,
      manifestValidation,
    };
  }

  if (request.action.type === "github:write") {
    return {
      skillName: manifest.name,
      repoUrl: request.repoUrl,
      manifestPath: request.manifestPath,
      mode: request.mode,
      status: "requires_approval",
      actionType: request.action.type,
      riskLevel: "high",
      requiresApproval: true,
      blockedReasons: [],
      permissions,
      capabilities,
      summary: "GitHub Skill v1 write action recorded as a planned approval-gated action only. No real GitHub write was performed.",
      manifestValidation,
    };
  }

  const runtimeResult = runSkillRuntimeRequest({
    goal: `GitHub Skill v1: ${request.action.description}`,
    skillName: manifest.name,
    mode: request.mode,
    action: request.action,
    capabilities,
    permissions,
    approvalRecordId: request.approvalRecordId,
    approvalGranted: request.approvalGranted,
  });

  return {
    skillName: manifest.name,
    repoUrl: request.repoUrl,
    manifestPath: request.manifestPath,
    mode: request.mode,
    status: runtimeResult.status,
    actionType: runtimeResult.actionType,
    riskLevel: runtimeResult.riskLevel,
    requiresApproval: runtimeResult.requiresApproval,
    blockedReasons: runtimeResult.blockedReasons,
    permissions: runtimeResult.permissions,
    capabilities: runtimeResult.capabilities,
    summary: `GitHub Skill v1 read action completed through local/mock runtime. ${runtimeResult.summary}`,
    manifestValidation,
    runtimeResult,
  };
}
