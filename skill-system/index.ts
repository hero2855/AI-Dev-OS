import { registerGitHubSkillsFromManifestIndex, registerSkill } from "./registry";
import { defaultSkills } from "./skills";
import { mockGitHubSkills, selectMockGitHubSkill } from "./github/mockRegistry";
import { loadPinnedPonytailSkillManifestIndex } from "./github/pinnedPonytailManifest";

for (const skill of [...defaultSkills, ...mockGitHubSkills]) {
  registerSkill(skill);
}

registerGitHubSkillsFromManifestIndex(loadPinnedPonytailSkillManifestIndex());

export type { Skill, SkillName } from "./types";
export type { GitHubSkill } from "./github/types";
export type { GitHubSkillManifest } from "./github/manifest";
export {
  registerSkill,
  registerSkills,
  registerGitHubSkillFromManifest,
  registerGitHubSkillsFromManifestIndex,
  getSkill,
  listSkills,
} from "./registry";
export { executeSkill } from "./executor";
export { defaultSkills } from "./skills";
export { loadGitHubSkill } from "./github/loader";
export {
  assertManifestMatchesLock,
  getSkillManifestLock,
  loadGitHubSkillManifest,
  loadGitHubSkillManifestIndex,
} from "./github/manifestLoader";
export {
  PONYTAIL_MANIFEST_INDEX_PATH,
  PONYTAIL_MANIFEST_INDEX_SHA256,
  PONYTAIL_MANIFEST_PATH,
  PONYTAIL_MANIFEST_SHA256,
  PONYTAIL_REPO_URL,
  PONYTAIL_SKILL_MANIFEST,
  getPinnedPonytailManifestLock,
  getPinnedPonytailManifestTexts,
  loadPinnedPonytailSkillManifest,
  loadPinnedPonytailSkillManifestIndex,
} from "./github/pinnedPonytailManifest";
export type {
  LoadGitHubSkillManifestIndexOptions,
  SkillManifestLock,
  SkillManifestLockEntry,
  SkillManifestTextFetcher,
} from "./github/manifestLoader";
export { assertSha256Integrity, sha256Text, verifySha256Integrity } from "./github/integrity";
export { TRUSTED_GITHUB_SKILL_REPOS, isTrustedRepo } from "./github/trustedRepos";
export { validateSkillPolicy } from "./policy/policy";
export { requiredPermissionsForCapability, assertCapabilitiesAllowedByPermissions } from "./policy/capabilityGuard";
export { assertKnownPermissions, isKnownPermission, allowedSkillPermissions } from "./policy/permissions";
export type { SkillPermission } from "./policy/permissions";
export { createDryRunExecutionPlan, assessDryRunRisk } from "./execution-plan";
export type {
  CreateDryRunExecutionPlanParams,
  DryRunExecutionPlan,
  DryRunRiskAssessment,
  DryRunRiskLevel,
  DryRunSkillMetadata,
} from "./execution-plan";
export {
  assertNotBlockedFile,
  assertPathInsideRoot,
  assertSandboxPathAllowed,
  createDefaultSandboxConfig,
  executeSandboxOperation,
  normalizeSandboxPath,
  sandboxDeleteFile,
  sandboxListDir,
  sandboxReadFile,
  sandboxWriteFile,
} from "./sandbox";
export type {
  ExecuteSandboxOperationResult,
  SandboxConfig,
  SandboxExecutionMode,
  SandboxExecutionResult,
  SandboxListResult,
  SandboxOperation,
  SandboxReadResult,
} from "./sandbox";
export {
  assertNotSensitiveProjectPath,
  assertPathInsideProject,
  assertWorkspacePathAllowed,
  assertWorkspaceProjectExists,
  createWorkspaceManager,
  getDefaultWorkspaceProjects,
  getWorkspaceProjectById,
  listWorkspaceProjects,
  normalizeProjectPath,
  selectProjectForGoal,
} from "../workspace";
export type { ProjectRiskLevel, ProjectSelectionResult, ProjectType, WorkspaceProject } from "../workspace";
export {
  detectDeploymentHints,
  detectEnvExample,
  detectLockfiles,
  detectPackageManager,
  detectRuntime,
  detectScripts,
  fileExists,
  readJsonFileSafe,
  runProjectHealthCheck,
  analyzeTypeScriptHealth,
} from "../project-health";
export type {
  ProjectHealthCheckResult,
  ProjectHealthStatus,
  ProjectRuntime,
  TypeScriptHealthDiagnostic,
  TypeScriptHealthInput,
  TypeScriptHealthIssue,
  TypeScriptHealthIssueKind,
  TypeScriptHealthStatus,
} from "../project-health";
export { createSafeDevelopmentWorkflow, createWorkflowApprovalRecord, shouldBlockWorkflow } from "../development-workflow";
export type {
  CreateSafeDevelopmentWorkflowOptions,
  CreateWorkflowApprovalRecordInput,
  DevelopmentWorkflowGuardInput,
  DevelopmentWorkflowGuardResult,
  DevelopmentWorkflowResult,
  DevelopmentWorkflowStage,
  DevelopmentWorkflowStatus,
  WorkflowApprovalDecision,
  WorkflowApprovalRecord,
  WorkflowApprovalStatus,
} from "../development-workflow";
export { mockGitHubSkills, selectMockGitHubSkill };
export { createChangeSetPreview } from "../change-set";
export type {
  ChangeSetPreview,
  ChangeSetPreviewStatus,
  CreateChangeSetPreviewInput,
  PlannedChangeOperation,
  PlannedChangePreview,
  PlannedFileOperation,
} from "../change-set";
export { createSkillRuntimeAdapter, runSkillRuntimeRequest } from "../skill-runtime";
export type {
  SkillRuntimeAction,
  SkillRuntimeActionType,
  SkillRuntimeAdapter,
  SkillRuntimeAuditSummary,
  SkillRuntimeMode,
  SkillRuntimeRequest,
  SkillRuntimeResult,
  SkillRuntimeSafetyCheck,
  SkillRuntimeStatus,
} from "../skill-runtime";
export { runGitHubSkillV1Request, validateGitHubSkillV1Manifest } from "../github-skill";
export type {
  GitHubSkillV1ManifestInput,
  GitHubSkillV1ManifestValidation,
  GitHubSkillV1Request,
  GitHubSkillV1Result,
} from "../github-skill";
