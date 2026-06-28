import type { GitHubSkillManifest } from "../skill-system/github/manifest";
import type { SkillRuntimeAction, SkillRuntimeMode, SkillRuntimeResult, SkillRuntimeStatus } from "../skill-runtime";
import type { DryRunRiskLevel } from "../skill-system/execution-plan";

export type GitHubSkillV1ManifestInput = {
  repoUrl: string;
  manifestPath?: string;
  manifest: unknown;
  manifestText?: string;
  expectedSha256?: string;
};

export type GitHubSkillV1ManifestValidation = {
  trustedRepo: boolean;
  schemaValid: boolean;
  integrityChecked: boolean;
  integrityValid: boolean;
  policyValid: boolean;
  nameValid: boolean;
  versionValid: boolean;
  permissionsValid: boolean;
  capabilitiesValid: boolean;
  manifest?: GitHubSkillManifest;
  blockedReasons: string[];
};

export type GitHubSkillV1Request = {
  repoUrl: string;
  manifestPath?: string;
  manifest: unknown;
  manifestText?: string;
  expectedSha256?: string;
  mode: SkillRuntimeMode;
  action: SkillRuntimeAction;
  approvalRecordId?: string;
  approvalGranted?: boolean;
};

export type GitHubSkillV1Result = {
  skillName?: string;
  repoUrl: string;
  manifestPath?: string;
  mode: SkillRuntimeMode;
  status: SkillRuntimeStatus;
  actionType: SkillRuntimeAction["type"];
  riskLevel: DryRunRiskLevel;
  requiresApproval: boolean;
  blockedReasons: string[];
  permissions: string[];
  capabilities: string[];
  summary: string;
  manifestValidation: GitHubSkillV1ManifestValidation;
  runtimeResult?: SkillRuntimeResult;
};
