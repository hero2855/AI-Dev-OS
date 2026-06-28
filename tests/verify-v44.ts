import { existsSync, mkdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { createChangeSetPreview } from "../change-set";
import { classifyGitHubPushVerification } from "../github-helper";
import { analyzeTypeScriptHealth } from "../project-health";
import {
  assertManifestMatchesLock,
  assertSha256Integrity,
  createSafeDevelopmentWorkflow,
  createWorkflowApprovalRecord,
  createDryRunExecutionPlan,
  createDefaultSandboxConfig,
  executeSkill,
  executeSandboxOperation,
  getSkill,
  getSkillManifestLock,
  getPinnedPonytailManifestTexts,
  createWorkspaceManager,
  getWorkspaceProjectById,
  loadGitHubSkillManifestIndex,
  loadPinnedPonytailSkillManifestIndex,
  listSkills,
  listWorkspaceProjects,
  PONYTAIL_MANIFEST_PATH,
  PONYTAIL_MANIFEST_SHA256,
  PONYTAIL_SKILL_MANIFEST,
  registerGitHubSkillsFromManifestIndex,
  runProjectHealthCheck,
  runGitHubSkillV1Request,
  runSkillRuntimeRequest,
  selectProjectForGoal,
  shouldBlockWorkflow,
  sha256Text,
  validateGitHubSkillV1Manifest,
  validateSkillPolicy,
} from "../skill-system";
import type { GitHubSkillManifest, ProjectHealthCheckResult, SkillManifestLock, WorkspaceProject } from "../skill-system";

type TestStatus = "PASS" | "FAIL";

type TestResult = {
  name: string;
  status: TestStatus;
  details?: string;
};

const results: TestResult[] = [];
const trustedRepo = "https://github.com/hero2855/AI-Dev-OS-skills";
const ponytailRepo = "https://github.com/DietrichGebert/ponytail";
const untrustedRepo = "https://github.com/unknown/bad-skill";
const sandboxRoot = resolve(process.cwd(), ".tmp", "ai-dev-os-sandbox-test");
let cachedManifests: GitHubSkillManifest[] | null = null;

function record(status: TestStatus, name: string, details?: string): void {
  results.push({ name, status, details });
  const suffix = details ? ` - ${details}` : "";
  console.log(`[${status}] ${name}${suffix}`);
}

async function runTest(name: string, test: () => Promise<string | void> | string | void): Promise<void> {
  try {
    const details = await test();
    record("PASS", name, details === undefined ? undefined : details);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    record("FAIL", name, message);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function createPolicyTestManifest(overrides: Partial<GitHubSkillManifest> = {}): GitHubSkillManifest {
  return {
    name: "policy-test-skill",
    version: "0.1.0",
    description: "Policy test skill",
    entry: "index.ts",
    capabilities: ["github_search"],
    permissions: ["network:github"],
    ...overrides,
  };
}

function expectPolicyError(manifest: GitHubSkillManifest, expectedMessage: string): string {
  try {
    validateSkillPolicy(manifest);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert(message === expectedMessage, `Unexpected error message: ${message}`);
    return message;
  }

  throw new Error(`Expected policy error: ${expectedMessage}`);
}

function assertRiskAtLeast(actual: string, expected: "low" | "medium" | "high" | "blocked"): void {
  const rank = {
    low: 1,
    medium: 2,
    high: 3,
    blocked: 4,
  };

  assert(
    rank[actual as keyof typeof rank] >= rank[expected],
    `Expected risk at least ${expected}, got ${actual}`,
  );
}

function prepareSandboxTestDir(): void {
  rmSync(sandboxRoot, { recursive: true, force: true });
  mkdirSync(sandboxRoot, { recursive: true });
}

function cleanupSandboxTestDir(): void {
  rmSync(sandboxRoot, { recursive: true, force: true });
}

function expectWorkspacePathError(operation: () => unknown, expectedMessage: string): string {
  try {
    operation();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert(message === expectedMessage, `Unexpected workspace path error: ${message}`);
    return message;
  }

  throw new Error(`Expected workspace path error: ${expectedMessage}`);
}

function assertHealthShape(result: ProjectHealthCheckResult): void {
  assert(typeof result.exists === "boolean", "Health result exists must be boolean");
  assert(["node", "nextjs", "unknown"].includes(result.runtime), `Unexpected runtime: ${result.runtime}`);
  assert(
    ["pnpm", "npm", "yarn", "unknown"].includes(result.packageManager),
    `Unexpected package manager: ${result.packageManager}`,
  );
  assert(typeof result.scripts === "object" && result.scripts !== null, "Scripts result must be an object");
  assert(Array.isArray(result.lockfiles), "Lockfiles result must be an array");
  assert(Array.isArray(result.deploymentHints), "Deployment hints result must be an array");
  assert(result.envFilesWereRead === false, "Health check must never read env files");
}

async function getTrustedManifests(): Promise<GitHubSkillManifest[]> {
  if (!cachedManifests) {
    const fixture = createOfflineManifestFixture();
    cachedManifests = await loadGitHubSkillManifestIndex(trustedRepo, {
      lock: fixture.lock,
      fetchText: async (url: string) => {
        const path = Object.keys(fixture.textByPath).find((item) => url.endsWith(item));

        if (!path) {
          throw new Error(`Unexpected offline manifest fetch path: ${url}`);
        }

        return fixture.textByPath[path];
      },
    });
  }

  return cachedManifests;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function createOfflineManifestFixture(): { lock: SkillManifestLock; textByPath: Record<string, string> } {
  const manifestValues: GitHubSkillManifest[] = [
    {
      name: "github-search-skill",
      version: "0.1.0",
      description: "Offline mock skill for searching GitHub repository metadata.",
      entry: "index.ts",
      capabilities: ["github_search", "repo_discovery"],
      permissions: ["network:github"],
    },
    {
      name: "auto-readme-generator",
      version: "0.1.0",
      description: "Offline mock skill for README and documentation generation.",
      entry: "index.ts",
      capabilities: ["readme_generation", "docs_generation"],
      permissions: ["file:read", "file:write:docs"],
    },
    {
      name: "code-refactor-skill",
      version: "0.1.0",
      description: "Offline mock skill for source code refactoring.",
      entry: "index.ts",
      capabilities: ["code_refactor", "source_editing"],
      permissions: ["file:read", "file:write:src"],
    },
  ];
  const paths = [
    "skills/github-search/skill.json",
    "skills/readme-generator/skill.json",
    "skills/code-refactor/skill.json",
  ];
  const indexPath = "skills/index.json";
  const indexText = stableJson({
    skills: paths.map((path) => ({ path })),
  });
  const textByPath: Record<string, string> = {
    [indexPath]: indexText,
  };

  for (let index = 0; index < manifestValues.length; index += 1) {
    textByPath[paths[index]] = stableJson(manifestValues[index]);
  }

  return {
    lock: {
      trustedRepo,
      index: {
        path: indexPath,
        sha256: sha256Text(indexText),
      },
      skills: manifestValues.map((manifest, index) => ({
        name: manifest.name,
        version: manifest.version,
        path: paths[index],
        sha256: sha256Text(textByPath[paths[index]]),
      })),
    },
    textByPath,
  };
}

function createPonytailManifest(overrides: Partial<GitHubSkillManifest> = {}): GitHubSkillManifest {
  return {
    ...PONYTAIL_SKILL_MANIFEST,
    ...overrides,
  };
}

function createOfflinePonytailManifestFixture(): { lock: SkillManifestLock; textByPath: Record<string, string> } {
  const manifest = createPonytailManifest();
  const manifestPath = ".ai-dev-os/skills/ponytail/skill.json";
  const indexPath = ".ai-dev-os/skills/index.json";
  const indexText = stableJson({
    skills: [{ path: manifestPath }],
  });
  const manifestText = stableJson(manifest);

  return {
    lock: {
      trustedRepo: ponytailRepo,
      index: {
        path: indexPath,
        sha256: sha256Text(indexText),
      },
      skills: [
        {
          name: manifest.name,
          version: manifest.version,
          path: manifestPath,
          sha256: sha256Text(manifestText),
        },
      ],
    },
    textByPath: {
      [indexPath]: indexText,
      [manifestPath]: manifestText,
    },
  };
}

async function loadPonytailFixtureManifests(): Promise<GitHubSkillManifest[]> {
  const fixture = createOfflinePonytailManifestFixture();

  return loadGitHubSkillManifestIndex(ponytailRepo, {
    lock: fixture.lock,
    fetchText: async (url: string) => {
      const path = Object.keys(fixture.textByPath).find((item) => url.endsWith(item));

      if (!path) {
        throw new Error(`Unexpected offline Ponytail manifest fetch path: ${url}`);
      }

      return fixture.textByPath[path];
    },
  });
}

async function testWorkspaceProjectListContainsThreeProjects(): Promise<string> {
  const projects = listWorkspaceProjects();
  const projectIds = projects.map((project) => project.id).sort();

  assert(projects.length === 3, `Expected 3 workspace projects, got ${projects.length}`);
  assert(projectIds.includes("ai-dev-os"), "Missing ai-dev-os project");
  assert(projectIds.includes("ai-dev-os-skills"), "Missing ai-dev-os-skills project");
  assert(projectIds.includes("project-001-resume-ai"), "Missing project-001-resume-ai project");

  return `Workspace projects: ${projectIds.join(", ")}`;
}

async function testWorkspaceGetAiDevOsById(): Promise<string> {
  const manager = createWorkspaceManager();
  const project = manager.getProject("ai-dev-os");

  assert(project?.id === "ai-dev-os", "Could not load ai-dev-os project by id");
  assert(project.protected === true, "ai-dev-os should be protected");

  return `${project.name} is protected`;
}

async function testWorkspaceGetSkillsById(): Promise<string> {
  const manager = createWorkspaceManager();
  const project = manager.getProject("ai-dev-os-skills");

  assert(project?.id === "ai-dev-os-skills", "Could not load ai-dev-os-skills project by id");
  assert(project.protected === true, "ai-dev-os-skills should be protected");

  return `${project.name} is protected`;
}

async function testWorkspaceGetResumeAiById(): Promise<string> {
  const manager = createWorkspaceManager();
  const project = manager.getProject("project-001-resume-ai");

  assert(project?.id === "project-001-resume-ai", "Could not load project-001-resume-ai project by id");
  assert(project.protected === false, "project-001-resume-ai should not be protected");

  return `${project.name} is available as product-app`;
}

async function testWorkspaceSelectsResumeAiGoal(): Promise<string> {
  const result = selectProjectForGoal("优化简历 AI 首页");

  assert(result.selectedProject?.id === "project-001-resume-ai", "Resume AI goal did not select product project");
  assert(result.requiresClarification === false, "Non-destructive product-app goal should not require clarification");
  assert(result.riskLevel === "medium", `Expected medium risk, got ${result.riskLevel}`);

  return result.reason;
}

async function testWorkspaceSelectsProtectedSkillsGoal(): Promise<string> {
  const result = selectProjectForGoal("更新 skill manifest repo");

  assert(result.selectedProject?.id === "ai-dev-os-skills", "Skill manifest goal did not select skills repo");
  assert(result.requiresClarification === true, "Protected skills repo should require clarification");
  assert(result.riskLevel === "high", `Expected high risk, got ${result.riskLevel}`);
  assert(result.reason.includes("protected project"), `Reason should mention protected project: ${result.reason}`);

  return result.reason;
}

async function testWorkspaceSelectsProtectedCoreGoal(): Promise<string> {
  const result = selectProjectForGoal("继续 AI Dev OS sandbox");

  assert(result.selectedProject?.id === "ai-dev-os", "AI Dev OS sandbox goal did not select system core");
  assert(result.requiresClarification === true, "Protected system core should require clarification");
  assert(result.riskLevel === "high", `Expected high risk, got ${result.riskLevel}`);
  assert(result.reason.includes("protected project"), `Reason should mention protected project: ${result.reason}`);

  return result.reason;
}

async function testWorkspaceUnknownGoalNeedsClarification(): Promise<string> {
  const result = selectProjectForGoal("build the thing tomorrow");

  assert(result.selectedProject === undefined, "Unknown goal should not select a project");
  assert(result.confidence === 0, `Expected confidence 0, got ${result.confidence}`);
  assert(result.requiresClarification === true, "Unknown goal should require clarification");
  assert(result.reason === "Unable to confidently select a project from the goal.", `Unexpected reason: ${result.reason}`);

  return result.reason;
}

async function testWorkspaceResolvePathAllowsProjectFile(): Promise<string> {
  const manager = createWorkspaceManager();
  const resolvedPath = manager.resolvePath("ai-dev-os", "package.json");

  assert(resolvedPath.endsWith("AI-Dev-OS\\package.json"), `Unexpected resolved path: ${resolvedPath}`);

  return resolvedPath;
}

async function testWorkspaceResolvePathBlocksEscape(): Promise<string> {
  const manager = createWorkspaceManager();
  const message = expectWorkspacePathError(
    () => manager.resolvePath("ai-dev-os", "..\\Project-001-Resume-AI\\package.json"),
    "Workspace path escape blocked",
  );

  return message;
}

async function testWorkspaceResolvePathBlocksEnv(): Promise<string> {
  const manager = createWorkspaceManager();
  const message = expectWorkspacePathError(
    () => manager.resolvePath("ai-dev-os", ".env"),
    "Workspace sensitive file access blocked",
  );

  return message;
}

async function testWorkspaceBusinessGoalDoesNotSelectCore(): Promise<string> {
  const result = selectProjectForGoal("优化 resume AI paid Vercel page");
  const selectedProjectId: string | undefined = result.selectedProject?.id;

  assert(selectedProjectId !== "ai-dev-os", "Business goal must not select AI Dev OS core");
  assert(selectedProjectId === "project-001-resume-ai", "Business goal should select Resume AI");

  return `Selected ${selectedProjectId}`;
}

async function testWorkspaceManagerDoesNotModifyResumeAi(): Promise<string> {
  const manager = createWorkspaceManager();
  const result = manager.selectProject("优化简历 AI 首页");

  assert(result.selectedProject?.id === "project-001-resume-ai", "Resume AI selection failed");
  assert(result.requiresClarification === false, "Selection-only product goal should not require clarification");

  return "Workspace Manager only selected Project-001-Resume-AI metadata";
}

async function testWorkspaceManagerDoesNotModifySkillsRepo(): Promise<string> {
  const manager = createWorkspaceManager();
  const result = manager.selectProject("更新 skill manifest repo");

  assert(result.selectedProject?.id === "ai-dev-os-skills", "Skills repo selection failed");
  assert(result.requiresClarification === true, "Protected skills repo should require clarification before changes");

  return "Workspace Manager only selected AI-Dev-OS-skills metadata";
}

async function testChangeSetSafeCreateUpdatePreview(): Promise<string> {
  const project = getWorkspaceProjectById("project-001-resume-ai");

  assert(project, "Missing Project-001-Resume-AI metadata");

  const preview = createChangeSetPreview({
    goal: "preview safe product copy changes",
    project,
    plannedReads: ["README.md"],
    plannedChanges: [
      {
        operation: "create",
        path: "docs/preview.md",
        changeSummary: "Create preview documentation.",
      },
      {
        operation: "update",
        path: "src/page.tsx",
        changeSummary: "Update page copy.",
      },
    ],
  });

  assert(preview.status === "preview_ready", `Expected preview_ready, got ${preview.status}`);
  assert(preview.riskLevel === "medium", `Expected medium risk, got ${preview.riskLevel}`);
  assert(preview.requiresApproval === false, "Allowed product preview should not require approval");
  assert(preview.plannedChanges.length === 2, `Expected 2 planned changes, got ${preview.plannedChanges.length}`);

  return `${preview.changeSetId} ${preview.summary}`;
}

async function testChangeSetBlocksEnvWrite(): Promise<string> {
  const project = getWorkspaceProjectById("project-001-resume-ai");

  assert(project, "Missing Project-001-Resume-AI metadata");

  const preview = createChangeSetPreview({
    goal: "preview env write",
    project,
    plannedChanges: [
      {
        operation: "update",
        path: ".env",
        changeSummary: "Would update env configuration.",
      },
    ],
  });

  assert(preview.status === "blocked", `Expected blocked env preview, got ${preview.status}`);
  assert(preview.riskLevel === "blocked", `Expected blocked risk, got ${preview.riskLevel}`);
  assert(preview.plannedChanges[0]?.isEnvFile === true, "Env write should be marked as env file");
  assert(
    preview.blockedReasons.includes("ChangeSet sensitive env file write blocked"),
    `Missing env blocked reason: ${preview.blockedReasons.join(", ")}`,
  );

  return "ChangeSet blocked .env planned write";
}

async function testChangeSetBlocksPathEscape(): Promise<string> {
  const project = getWorkspaceProjectById("project-001-resume-ai");

  assert(project, "Missing Project-001-Resume-AI metadata");

  const preview = createChangeSetPreview({
    goal: "preview path escape",
    project,
    plannedChanges: [
      {
        operation: "update",
        path: "../AI-Dev-OS/package.json",
        changeSummary: "Would escape project root.",
      },
    ],
  });

  assert(preview.status === "blocked", `Expected blocked path escape preview, got ${preview.status}`);
  assert(preview.plannedChanges[0]?.isPathEscape === true, "Path escape should be marked");
  assert(
    preview.blockedReasons.includes("ChangeSet path escape blocked"),
    `Missing path escape blocked reason: ${preview.blockedReasons.join(", ")}`,
  );

  return "ChangeSet blocked ../ path escape";
}

async function testChangeSetDeleteBlockedByDefault(): Promise<string> {
  const project = getWorkspaceProjectById("project-001-resume-ai");

  assert(project, "Missing Project-001-Resume-AI metadata");

  const preview = createChangeSetPreview({
    goal: "preview delete",
    project,
    plannedChanges: [
      {
        operation: "delete",
        path: "docs/old.md",
        changeSummary: "Would remove old documentation.",
      },
    ],
  });

  assert(preview.status === "blocked", `Expected blocked delete preview, got ${preview.status}`);
  assert(preview.riskLevel === "blocked", `Expected blocked delete risk, got ${preview.riskLevel}`);
  assert(
    preview.blockedReasons.includes("ChangeSet delete operation blocked by default"),
    `Missing delete blocked reason: ${preview.blockedReasons.join(", ")}`,
  );

  return "ChangeSet blocked delete by default";
}

async function testChangeSetProtectedProjectRequiresApproval(): Promise<string> {
  const project = getWorkspaceProjectById("ai-dev-os");

  assert(project, "Missing AI Dev OS project metadata");

  const preview = createChangeSetPreview({
    goal: "preview protected core change",
    project,
    plannedChanges: [
      {
        operation: "update",
        path: "README.md",
        changeSummary: "Would update protected core docs.",
      },
    ],
    approvalRecordId: "approval-preview-test",
  });

  assert(preview.status === "pending_approval", `Expected pending approval, got ${preview.status}`);
  assert(preview.requiresApproval === true, "Protected project preview should require approval");
  assert(preview.riskLevel === "high", `Expected high risk, got ${preview.riskLevel}`);
  assert(preview.approvalRecordId === "approval-preview-test", "Approval record id should be included");
  assert(preview.plannedChanges[0]?.isProtectedPath === true, "Protected path should be marked");

  return "ChangeSet protected project preview requires approval";
}

async function testChangeSetPreviewIncludesShape(): Promise<string> {
  const project = getWorkspaceProjectById("project-001-resume-ai");

  assert(project, "Missing Project-001-Resume-AI metadata");

  const preview = createChangeSetPreview({
    goal: "preview result shape",
    project,
    plannedReads: ["package.json", "README.md"],
    plannedChanges: [
      {
        operation: "rename",
        path: "docs/old.md",
        targetPath: "docs/new.md",
        changeSummary: "Would rename docs file.",
      },
    ],
  });

  assert(Array.isArray(preview.plannedReads), "plannedReads should be an array");
  assert(Array.isArray(preview.plannedWrites), "plannedWrites should be an array");
  assert(typeof preview.riskLevel === "string", "riskLevel should be present");
  assert(Array.isArray(preview.blockedReasons), "blockedReasons should be an array");
  assert(preview.summary.includes("No files were modified"), `Summary should mention no files modified: ${preview.summary}`);
  assert(preview.plannedWrites.includes("docs/old.md"), "Rename source should be in plannedWrites");
  assert(preview.plannedWrites.includes("docs/new.md"), "Rename target should be in plannedWrites");

  return "ChangeSet preview includes plannedReads, plannedWrites, riskLevel, blockedReasons, and summary";
}

async function testChangeSetPreviewDoesNotModifyFiles(): Promise<string> {
  const project = getWorkspaceProjectById("project-001-resume-ai");

  assert(project, "Missing Project-001-Resume-AI metadata");

  const before = spawnSync("git", ["status", "--short"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert(before.status === 0, `git status before ChangeSet preview failed: ${before.stderr}`);

  createChangeSetPreview({
    goal: "preview only without writing",
    project,
    plannedReads: ["README.md"],
    plannedChanges: [
      {
        operation: "create",
        path: "docs/preview-only.md",
        changeSummary: "Would create preview-only docs.",
      },
    ],
  });

  const after = spawnSync("git", ["status", "--short"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert(after.status === 0, `git status after ChangeSet preview failed: ${after.stderr}`);
  assert(after.stdout === before.stdout, `ChangeSet preview changed git status:\nBefore:\n${before.stdout}\nAfter:\n${after.stdout}`);

  return "ChangeSet preview did not modify repo files";
}

async function testSkillRuntimeMockGithubReadCompletes(): Promise<string> {
  const result = runSkillRuntimeRequest({
    goal: "mock GitHub read",
    skillName: "github-search-skill",
    mode: "mock",
    action: {
      type: "github:read",
      description: "Read mock GitHub metadata.",
    },
  });

  assert(result.status === "completed", `Expected completed github:read, got ${result.status}`);
  assert(result.actionType === "github:read", `Unexpected action type: ${result.actionType}`);
  assert(result.auditSummary.realNetworkOperation === false, "github:read mock must not perform real network");
  assert(result.requiresApproval === false, "github:read mock should not require approval");

  return result.summary;
}

async function testSkillRuntimeGithubWriteBlocked(): Promise<string> {
  const result = runSkillRuntimeRequest({
    goal: "mock GitHub write",
    skillName: "github-writer",
    mode: "mock",
    action: {
      type: "github:write",
      description: "Would open or update a GitHub resource.",
    },
  });

  assert(result.status === "blocked", `Expected blocked github:write, got ${result.status}`);
  assert(result.requiresApproval === true, "github:write should require approval");
  assert(result.riskLevel === "blocked", `Expected blocked risk, got ${result.riskLevel}`);
  assert(result.blockedReasons.some((reason) => reason.includes("github:write")), "Blocked reason should mention github:write");

  return "github:write blocked until explicit approval";
}

async function testSkillRuntimeBrowserWriteBlocked(): Promise<string> {
  const result = runSkillRuntimeRequest({
    goal: "mock browser write",
    skillName: "browser-skill",
    mode: "mock",
    action: {
      type: "browser:write",
      description: "Would click a browser button.",
    },
  });

  assert(result.status === "blocked", `Expected blocked browser:write, got ${result.status}`);
  assert(result.requiresApproval === true, "browser:write should require approval");
  assert(result.auditSummary.realBrowserOperation === false, "browser:write must not perform real browser work");

  return "browser:write blocked in V4.10";
}

async function testSkillRuntimeComputerActBlocked(): Promise<string> {
  const result = runSkillRuntimeRequest({
    goal: "mock computer action",
    skillName: "computer-use-skill",
    mode: "mock",
    action: {
      type: "computer:act",
      description: "Would perform an OS action.",
    },
  });

  assert(result.status === "blocked", `Expected blocked computer:act, got ${result.status}`);
  assert(result.requiresApproval === true, "computer:act should require approval");
  assert(result.auditSummary.realComputerOperation === false, "computer:act must not perform real computer work");

  return "computer:act blocked in V4.10";
}

async function testSkillRuntimeContentCreateCompletes(): Promise<string> {
  const result = runSkillRuntimeRequest({
    goal: "create draft content",
    skillName: "content-writer",
    mode: "local",
    action: {
      type: "content:create",
      description: "Create mock draft content.",
      input: { topic: "safe local draft" },
    },
  });

  assert(result.status === "completed", `Expected completed content:create, got ${result.status}`);
  assert(result.riskLevel === "low", `Expected low risk, got ${result.riskLevel}`);
  assert(result.auditSummary.realPublishOperation === false, "content:create must not publish");

  return "content:create completed in local mode";
}

async function testSkillRuntimeContentPublishBlocked(): Promise<string> {
  const result = runSkillRuntimeRequest({
    goal: "publish content",
    skillName: "publisher",
    mode: "mock",
    action: {
      type: "content:publish",
      description: "Would publish approved content.",
    },
  });

  assert(result.status === "blocked", `Expected blocked content:publish, got ${result.status}`);
  assert(result.requiresApproval === true, "content:publish should require approval");
  assert(result.auditSummary.realPublishOperation === false, "content:publish must not perform real publishing");

  return "content:publish blocked in V4.10";
}

async function testSkillRuntimeResultIncludesRequiredShape(): Promise<string> {
  const result = runSkillRuntimeRequest({
    goal: "inspect runtime result shape",
    skillName: "content-writer",
    mode: "mock",
    action: {
      type: "content:create",
      description: "Create mock draft content.",
    },
    capabilities: ["custom_content_capability"],
    permissions: ["custom:local"],
  });

  assert(result.actionType === "content:create", `Unexpected action type: ${result.actionType}`);
  assert(result.capabilities.includes("content_create"), "Result should include inferred capability");
  assert(result.capabilities.includes("custom_content_capability"), "Result should include requested capability");
  assert(result.permissions.includes("content:create:local"), "Result should include inferred permission");
  assert(result.permissions.includes("custom:local"), "Result should include requested permission");
  assert(typeof result.riskLevel === "string", "Result should include riskLevel");
  assert(typeof result.requiresApproval === "boolean", "Result should include requiresApproval");
  assert(Array.isArray(result.blockedReasons), "Result should include blockedReasons");
  assert(result.summary.includes("No real operation was performed"), `Unexpected summary: ${result.summary}`);

  return "Skill runtime result includes action type, capabilities, permissions, risk, approval, blocked reasons, and summary";
}

async function testSkillRuntimeExternalModeBlocked(): Promise<string> {
  const result = runSkillRuntimeRequest({
    goal: "external runtime test",
    skillName: "external-skill",
    mode: "external",
    action: {
      type: "github:read",
      description: "Would use an external runtime.",
    },
  });

  assert(result.status === "blocked", `Expected blocked external mode, got ${result.status}`);
  assert(
    result.blockedReasons.includes("External runtime mode is disabled in V4.10"),
    `Missing external mode blocked reason: ${result.blockedReasons.join(", ")}`,
  );

  return "external runtime mode blocked";
}

async function testSkillRuntimeNoRealOperationsOccur(): Promise<string> {
  const before = spawnSync("git", ["status", "--short"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert(before.status === 0, `git status before runtime adapter failed: ${before.stderr}`);

  const result = runSkillRuntimeRequest({
    goal: "mock offline runtime audit",
    skillName: "offline-runtime-skill",
    mode: "mock",
    action: {
      type: "content:create",
      description: "Would create local mock content.",
    },
  });

  const after = spawnSync("git", ["status", "--short"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert(after.status === 0, `git status after runtime adapter failed: ${after.stderr}`);
  assert(after.stdout === before.stdout, `Runtime adapter changed git status:\nBefore:\n${before.stdout}\nAfter:\n${after.stdout}`);
  assert(result.auditSummary.realNetworkOperation === false, "Runtime adapter must not perform network operations");
  assert(result.auditSummary.realBrowserOperation === false, "Runtime adapter must not perform browser operations");
  assert(result.auditSummary.realComputerOperation === false, "Runtime adapter must not perform computer operations");
  assert(result.auditSummary.realShellOperation === false, "Runtime adapter must not perform shell operations");
  assert(result.auditSummary.realPublishOperation === false, "Runtime adapter must not perform publish operations");

  return "Skill runtime adapter performed no real network/browser/computer/shell/publish operation";
}

function createGitHubSkillV1TestManifest(overrides: Partial<GitHubSkillManifest> = {}): GitHubSkillManifest {
  return {
    name: "github-v1-test-skill",
    version: "0.1.0",
    description: "GitHub Skill v1 test manifest",
    entry: "index.ts",
    capabilities: ["github_search", "repo_discovery"],
    permissions: ["network:github"],
    ...overrides,
  };
}

async function testGitHubSkillV1ReadCompletesOffline(): Promise<string> {
  const manifest = createGitHubSkillV1TestManifest();
  const result = runGitHubSkillV1Request({
    repoUrl: trustedRepo,
    manifestPath: "skills/github-v1-test/skill.json",
    manifest,
    mode: "mock",
    action: {
      type: "github:read",
      description: "Read repository metadata offline.",
    },
  });

  assert(result.status === "completed", `Expected completed GitHub Skill v1 read, got ${result.status}`);
  assert(result.actionType === "github:read", `Unexpected action type: ${result.actionType}`);
  assert(result.riskLevel === "low", `Expected low risk, got ${result.riskLevel}`);
  assert(result.requiresApproval === false, "GitHub Skill v1 read should not require approval");
  assert(result.capabilities.includes("github_search"), "Manifest capability should be present");
  assert(result.permissions.includes("network:github"), "Manifest permission should be present");
  assert(result.runtimeResult?.auditSummary.realNetworkOperation === false, "GitHub Skill v1 read must not perform real network");

  return result.summary;
}

async function testGitHubSkillV1WriteRequiresApprovalOnly(): Promise<string> {
  const manifest = createGitHubSkillV1TestManifest();
  const result = runGitHubSkillV1Request({
    repoUrl: trustedRepo,
    manifestPath: "skills/github-v1-test/skill.json",
    manifest,
    mode: "mock",
    action: {
      type: "github:write",
      description: "Would write to GitHub.",
    },
  });

  assert(result.status === "requires_approval", `Expected requires_approval, got ${result.status}`);
  assert(result.actionType === "github:write", `Unexpected action type: ${result.actionType}`);
  assert(result.riskLevel === "high", `Expected high risk, got ${result.riskLevel}`);
  assert(result.requiresApproval === true, "GitHub Skill v1 write should require approval");
  assert(result.blockedReasons.length === 0, `Valid planned write should not be blocked: ${result.blockedReasons.join(", ")}`);
  assert(result.summary.includes("planned approval-gated action only"), `Unexpected summary: ${result.summary}`);

  return "GitHub Skill v1 write is planned and approval-gated only";
}

async function testGitHubSkillV1UntrustedManifestBlocked(): Promise<string> {
  const result = runGitHubSkillV1Request({
    repoUrl: untrustedRepo,
    manifestPath: "skills/bad/skill.json",
    manifest: createGitHubSkillV1TestManifest(),
    mode: "mock",
    action: {
      type: "github:read",
      description: "Read untrusted manifest.",
    },
  });

  assert(result.status === "blocked", `Expected blocked untrusted manifest, got ${result.status}`);
  assert(result.manifestValidation.trustedRepo === false, "Untrusted repo should be reported");
  assert(result.blockedReasons.includes("Untrusted GitHub skill repo"), `Missing untrusted reason: ${result.blockedReasons.join(", ")}`);

  return "Untrusted GitHub Skill v1 manifest blocked";
}

async function testGitHubSkillV1InvalidSchemaBlocked(): Promise<string> {
  const result = runGitHubSkillV1Request({
    repoUrl: trustedRepo,
    manifestPath: "skills/invalid/skill.json",
    manifest: {
      name: "missing-version",
      description: "Invalid manifest without version",
      entry: "index.ts",
      capabilities: ["github_search"],
      permissions: ["network:github"],
    },
    mode: "mock",
    action: {
      type: "github:read",
      description: "Read invalid manifest.",
    },
  });

  assert(result.status === "blocked", `Expected blocked invalid schema, got ${result.status}`);
  assert(result.manifestValidation.schemaValid === false, "Invalid schema should be reported");
  assert(
    result.blockedReasons.some((reason) => reason.includes("version is required")),
    `Missing version schema reason: ${result.blockedReasons.join(", ")}`,
  );

  return "Invalid GitHub Skill v1 manifest schema blocked";
}

async function testGitHubSkillV1UnknownPolicyBlocked(): Promise<string> {
  const result = runGitHubSkillV1Request({
    repoUrl: trustedRepo,
    manifestPath: "skills/unknown-policy/skill.json",
    manifest: createGitHubSkillV1TestManifest({
      capabilities: ["unknown_capability"],
      permissions: ["network:github"],
    }),
    mode: "mock",
    action: {
      type: "github:read",
      description: "Read unknown policy manifest.",
    },
  });

  assert(result.status === "blocked", `Expected blocked unknown policy, got ${result.status}`);
  assert(result.manifestValidation.policyValid === false, "Unknown capability should fail policy validation");
  assert(
    result.blockedReasons.some((reason) => reason.includes("Unknown skill capability")),
    `Missing unknown capability reason: ${result.blockedReasons.join(", ")}`,
  );

  return "Unknown GitHub Skill v1 manifest capability blocked";
}

async function testGitHubSkillV1IntegrityValidation(): Promise<string> {
  const manifest = createGitHubSkillV1TestManifest();
  const manifestText = stableJson(manifest);
  const ok = validateGitHubSkillV1Manifest({
    repoUrl: trustedRepo,
    manifestPath: "skills/github-v1-test/skill.json",
    manifest,
    manifestText,
    expectedSha256: sha256Text(manifestText),
  });
  const bad = validateGitHubSkillV1Manifest({
    repoUrl: trustedRepo,
    manifestPath: "skills/github-v1-test/skill.json",
    manifest,
    manifestText,
    expectedSha256: "0".repeat(64),
  });

  assert(ok.integrityChecked === true, "Integrity should be checked when sha is provided");
  assert(ok.integrityValid === true, "Expected matching integrity to pass");
  assert(ok.blockedReasons.length === 0, `Matching integrity should not block: ${ok.blockedReasons.join(", ")}`);
  assert(bad.integrityValid === false, "Expected mismatched integrity to fail");
  assert(
    bad.blockedReasons.some((reason) => reason.includes("Integrity check failed")),
    `Missing integrity failure reason: ${bad.blockedReasons.join(", ")}`,
  );

  return "GitHub Skill v1 integrity validation supports pass and failure";
}

async function testGitHubSkillV1ResultIncludesRequiredShape(): Promise<string> {
  const manifest = createGitHubSkillV1TestManifest();
  const result = runGitHubSkillV1Request({
    repoUrl: trustedRepo,
    manifestPath: "skills/github-v1-test/skill.json",
    manifest,
    mode: "mock",
    action: {
      type: "github:read",
      description: "Read repository metadata offline.",
    },
  });

  assert(result.actionType === "github:read", `Unexpected action type: ${result.actionType}`);
  assert(typeof result.riskLevel === "string", "Result should include riskLevel");
  assert(typeof result.requiresApproval === "boolean", "Result should include requiresApproval");
  assert(Array.isArray(result.blockedReasons), "Result should include blockedReasons");
  assert(result.permissions.length > 0, "Result should include permissions");
  assert(result.capabilities.length > 0, "Result should include capabilities");
  assert(result.summary.includes("GitHub Skill v1"), `Result should include summary: ${result.summary}`);

  return "GitHub Skill v1 result includes action, risk, approval, blocked reasons, permissions, capabilities, and summary";
}

async function testPonytailTrustedRepoAcceptedMetadataOnly(): Promise<string> {
  const manifests = await loadPonytailFixtureManifests();
  const [manifest] = manifests;
  const manifestText = stableJson(manifest);
  const result = runGitHubSkillV1Request({
    repoUrl: ponytailRepo,
    manifestPath: ".ai-dev-os/skills/ponytail/skill.json",
    manifest,
    manifestText,
    expectedSha256: sha256Text(manifestText),
    mode: "mock",
    action: {
      type: "github:read",
      description: "Evaluate Ponytail metadata only.",
    },
  });

  assert(manifests.length === 1, `Expected one Ponytail manifest, got ${manifests.length}`);
  assert(result.status === "completed", `Expected metadata-only Ponytail read to complete, got ${result.status}`);
  assert(result.manifestValidation.trustedRepo === true, "Ponytail repo should be trusted for metadata-only evaluation");
  assert(result.manifestValidation.integrityValid === true, "Ponytail metadata fixture should pass integrity validation");
  assert(result.runtimeResult?.auditSummary.realNetworkOperation === false, "Ponytail metadata read must not perform real network");

  return "Ponytail trusted repo accepted as metadata-only source";
}

async function testPonytailCodingSkillCapabilitiesRecognized(): Promise<string> {
  const [manifest] = await loadPonytailFixtureManifests();

  assert(manifest.capabilities.includes("code_refactor"), "Ponytail should expose code_refactor capability");
  assert(manifest.capabilities.includes("source_editing"), "Ponytail should expose source_editing capability");
  validateSkillPolicy(manifest);

  return `Ponytail capabilities recognized: ${manifest.capabilities.join(", ")}`;
}

async function testPonytailRemoteCodeExecutionBlocked(): Promise<string> {
  const manifest = createPonytailManifest();
  const result = runGitHubSkillV1Request({
    repoUrl: ponytailRepo,
    manifestPath: ".ai-dev-os/skills/ponytail/skill.json",
    manifest,
    mode: "external",
    action: {
      type: "github:read",
      description: "Attempt external Ponytail execution.",
    },
  });

  assert(result.status === "blocked", `Expected external Ponytail execution blocked, got ${result.status}`);
  assert(
    result.blockedReasons.includes("External GitHub Skill v1 runtime mode is disabled"),
    `Missing external runtime block reason: ${result.blockedReasons.join(", ")}`,
  );

  return "Ponytail remote code execution remains blocked";
}

async function testPonytailInstallAndScriptExecutionBlocked(): Promise<string> {
  const result = runGitHubSkillV1Request({
    repoUrl: ponytailRepo,
    manifestPath: ".ai-dev-os/skills/ponytail-install/skill.json",
    manifest: createPonytailManifest({
      name: "ponytail-install-script",
      entry: "package.json#scripts.test",
      capabilities: ["shell_execute"],
      permissions: ["shell:execute"],
    }),
    mode: "mock",
    action: {
      type: "github:read",
      description: "Attempt Ponytail install or script execution.",
    },
  });

  assert(result.status === "blocked", `Expected Ponytail install/script execution blocked, got ${result.status}`);
  assert(result.manifestValidation.policyValid === false, "shell:execute policy should be invalid");
  assert(
    result.blockedReasons.includes("Permission shell:execute is disabled in V4.4.4"),
    `Missing shell execute block reason: ${result.blockedReasons.join(", ")}`,
  );

  return "Ponytail install/script execution remains blocked";
}

async function testUntrustedPonytailLikeRepoBlocked(): Promise<string> {
  const result = runGitHubSkillV1Request({
    repoUrl: "https://github.com/example/ponytail",
    manifestPath: ".ai-dev-os/skills/ponytail/skill.json",
    manifest: createPonytailManifest(),
    mode: "mock",
    action: {
      type: "github:read",
      description: "Evaluate Ponytail-like metadata.",
    },
  });

  assert(result.status === "blocked", `Expected untrusted Ponytail-like repo blocked, got ${result.status}`);
  assert(result.manifestValidation.trustedRepo === false, "Ponytail-like repo should not be trusted");
  assert(result.blockedReasons.includes("Untrusted GitHub skill repo"), `Missing untrusted reason: ${result.blockedReasons.join(", ")}`);

  return "Untrusted Ponytail-like repo blocked";
}

async function testPonytailInvalidPermissionsBlocked(): Promise<string> {
  const result = runGitHubSkillV1Request({
    repoUrl: ponytailRepo,
    manifestPath: ".ai-dev-os/skills/ponytail-invalid/skill.json",
    manifest: createPonytailManifest({
      permissions: ["network:anywhere"],
    }),
    mode: "mock",
    action: {
      type: "github:read",
      description: "Evaluate Ponytail metadata with invalid permissions.",
    },
  });

  assert(result.status === "blocked", `Expected invalid Ponytail permissions blocked, got ${result.status}`);
  assert(result.manifestValidation.policyValid === false, "Invalid permissions should fail policy validation");
  assert(
    result.blockedReasons.includes("Unknown skill permission: network:anywhere"),
    `Missing invalid permission reason: ${result.blockedReasons.join(", ")}`,
  );

  return "Ponytail invalid permissions blocked";
}

async function testPinnedPonytailManifestLoadsOffline(): Promise<string> {
  const manifests = loadPinnedPonytailSkillManifestIndex(ponytailRepo);
  const [manifest] = manifests;
  const texts = getPinnedPonytailManifestTexts();

  assert(manifests.length === 1, `Expected one pinned Ponytail manifest, got ${manifests.length}`);
  assert(manifest.name === "ponytail", `Unexpected pinned manifest name: ${manifest.name}`);
  assert(manifest.version === "4.8.3", `Unexpected pinned manifest version: ${manifest.version}`);
  assert(texts[PONYTAIL_MANIFEST_PATH] === stableJson(PONYTAIL_SKILL_MANIFEST), "Pinned manifest text should be stable JSON");
  assertSha256Integrity(texts[PONYTAIL_MANIFEST_PATH], PONYTAIL_MANIFEST_SHA256, PONYTAIL_MANIFEST_PATH);
  validateSkillPolicy(manifest);

  return "Pinned Ponytail manifest loaded offline with sha256 integrity";
}

async function testPonytailRegistryDiscoversPinnedSkill(): Promise<string> {
  const skill = getSkill("ponytail");
  const skillNames = listSkills().map((item) => item.name);

  assert(skill?.name === "ponytail", "Registry should discover pinned Ponytail skill");
  assert(skillNames.includes("ponytail"), "listSkills should include pinned Ponytail skill");
  assert(skill.description.includes("Metadata-only Ponytail programming skill"), `Unexpected description: ${skill.description}`);

  return "Ponytail skill discovered through registry";
}

async function testPonytailPinnedCapabilitiesRecognized(): Promise<string> {
  const [manifest] = loadPinnedPonytailSkillManifestIndex(ponytailRepo);

  assert(manifest.capabilities.includes("programming_guidance"), "Ponytail should expose programming_guidance capability");
  assert(manifest.capabilities.includes("code_refactor"), "Ponytail should expose code_refactor capability");
  assert(manifest.capabilities.includes("source_editing"), "Ponytail should expose source_editing capability");
  assert(manifest.capabilities.includes("code_review"), "Ponytail should expose code_review capability");
  validateSkillPolicy(manifest);

  return `Pinned Ponytail capabilities recognized: ${manifest.capabilities.join(", ")}`;
}

async function testPonytailRegistryExecutionAdvisoryOnly(): Promise<string> {
  const output = await executeSkill("ponytail", "review this diff for over-engineering");
  const message = String(output?.message || "");

  assert(output?.type === "github_skill_manifest_placeholder", `Unexpected Ponytail output type: ${JSON.stringify(output)}`);
  assert(output?.skill === "ponytail", `Unexpected Ponytail skill output: ${JSON.stringify(output)}`);
  assert(message.includes("metadata-only advisory/planned use"), `Output should be advisory only: ${JSON.stringify(output)}`);
  assert(message.includes("Remote execution, install scripts, and hooks are disabled"), `Output should block execution surfaces: ${JSON.stringify(output)}`);

  return "Ponytail execution returns advisory/planned placeholder only";
}

async function testPonytailBadIntegrityBlocked(): Promise<string> {
  const texts = getPinnedPonytailManifestTexts();

  try {
    assertSha256Integrity(texts[PONYTAIL_MANIFEST_PATH], "0".repeat(64), PONYTAIL_MANIFEST_PATH);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert(message.includes("Integrity check failed"), `Unexpected integrity failure: ${message}`);
    return "Ponytail bad integrity blocked";
  }

  throw new Error("Ponytail bad integrity did not fail");
}

async function testPonytailHookExecutionBlocked(): Promise<string> {
  const result = runGitHubSkillV1Request({
    repoUrl: ponytailRepo,
    manifestPath: ".ai-dev-os/skills/ponytail-hook/skill.json",
    manifest: createPonytailManifest({
      name: "ponytail-hook",
      entry: "hooks/claude-codex-hooks.json",
      capabilities: ["shell_execute"],
      permissions: ["shell:execute"],
    }),
    mode: "mock",
    action: {
      type: "github:read",
      description: "Attempt Ponytail hook execution.",
    },
  });

  assert(result.status === "blocked", `Expected Ponytail hook execution blocked, got ${result.status}`);
  assert(
    result.blockedReasons.includes("Permission shell:execute is disabled in V4.4.4"),
    `Missing hook execution block reason: ${result.blockedReasons.join(", ")}`,
  );

  return "Ponytail hook execution remains blocked";
}

async function testHealthCheckAiDevOs(): Promise<string> {
  const manager = createWorkspaceManager();
  const result = manager.checkHealth("ai-dev-os");

  assert(result.projectId === "ai-dev-os", `Unexpected project id: ${result.projectId}`);
  assert(result.exists === true, "Expected ai-dev-os root path to exist");
  assertHealthShape(result);

  return `status=${result.status}, runtime=${result.runtime}, packageManager=${result.packageManager}`;
}

async function testHealthCheckResumeAiDoesNotModify(): Promise<string> {
  const manager = createWorkspaceManager();
  const beforeRootExists = existsSync("D:\\Atlas-OS\\Projects\\Project-001-Resume-AI");
  const result = manager.checkHealth("project-001-resume-ai");
  const afterRootExists = existsSync("D:\\Atlas-OS\\Projects\\Project-001-Resume-AI");

  assert(result.projectId === "project-001-resume-ai", `Unexpected project id: ${result.projectId}`);
  assert(beforeRootExists === afterRootExists, "Health check changed Resume AI root path existence");
  assertHealthShape(result);

  return `status=${result.status}, exists=${result.exists}, runtime=${result.runtime}`;
}

async function testHealthCheckProtectedWarning(): Promise<string> {
  const manager = createWorkspaceManager();
  const result = manager.checkHealth("ai-dev-os");

  assert(
    result.warnings.includes("Protected project requires explicit confirmation before modification"),
    `Missing protected warning: ${result.warnings.join(", ")}`,
  );

  return "Protected warning present";
}

async function testHealthCheckResumeAiNotSystemCore(): Promise<string> {
  const project = getWorkspaceProjectById("project-001-resume-ai");
  const projectType = project?.type;

  assert(projectType === "product-app", `Unexpected Resume AI project type: ${projectType}`);
  assert(String(projectType) !== "system-core", "Resume AI must not be system-core");

  return `type=${projectType}`;
}

async function testHealthCheckPackageJsonDetection(): Promise<string> {
  const manager = createWorkspaceManager();
  const result = manager.checkHealth("ai-dev-os");

  assert(result.packageJsonExists === true, "Expected ai-dev-os package.json to exist");

  return "packageJsonExists=true";
}

async function testHealthCheckPackageManagerDetection(): Promise<string> {
  const manager = createWorkspaceManager();
  const result = manager.checkHealth("ai-dev-os");

  assert(["pnpm", "npm", "yarn", "unknown"].includes(result.packageManager), "Package manager detection failed");

  return `packageManager=${result.packageManager}`;
}

async function testHealthCheckScriptsDetection(): Promise<string> {
  const manager = createWorkspaceManager();
  const result = manager.checkHealth("ai-dev-os");

  assert(typeof result.scripts === "object" && result.scripts !== null, "Scripts detection failed");

  return `scripts=${Object.keys(result.scripts).join(", ") || "none"}`;
}

async function testHealthCheckDeploymentHintsDetection(): Promise<string> {
  const manager = createWorkspaceManager();
  const result = manager.checkHealth("ai-dev-os");

  assert(Array.isArray(result.deploymentHints), "Deployment hints detection failed");

  return `deploymentHints=${result.deploymentHints.join(", ") || "none"}`;
}

async function testHealthCheckEnvFilesWereReadFalse(): Promise<string> {
  const manager = createWorkspaceManager();
  const result = manager.checkHealth("ai-dev-os");

  assert(result.envFilesWereRead === false, "envFilesWereRead must always be false");

  return "envFilesWereRead=false";
}

async function testHealthCheckDoesNotReadEnv(): Promise<string> {
  const manager = createWorkspaceManager();
  const result = manager.checkHealth("ai-dev-os");

  assert(result.envFilesWereRead === false, "Health check reported env file access");

  return "Health check reports no env file reads";
}

async function testHealthCheckDoesNotModifyEnv(): Promise<string> {
  const manager = createWorkspaceManager();
  const envPath = resolve(process.cwd(), ".env");
  const beforeExists = existsSync(envPath);
  const result = manager.checkHealth("ai-dev-os");
  const afterExists = existsSync(envPath);

  assert(result.envFilesWereRead === false, "Health check reported env file access");
  assert(beforeExists === afterExists, ".env existence changed during health check");

  return ".env existence unchanged and content was not read";
}

async function testHealthCheckDoesNotModifyResumeAi(): Promise<string> {
  const manager = createWorkspaceManager();
  const beforeRootExists = existsSync("D:\\Atlas-OS\\Projects\\Project-001-Resume-AI");
  const result = manager.checkHealth("project-001-resume-ai");
  const afterRootExists = existsSync("D:\\Atlas-OS\\Projects\\Project-001-Resume-AI");

  assert(result.projectId === "project-001-resume-ai", "Resume AI health check selected wrong project");
  assert(beforeRootExists === afterRootExists, "Resume AI root existence changed during health check");

  return "Project-001-Resume-AI root existence unchanged";
}

async function testHealthCheckDoesNotModifySkillsRepo(): Promise<string> {
  const manager = createWorkspaceManager();
  const beforeRootExists = existsSync("D:\\Atlas-OS\\Projects\\AI-Dev-OS-skills");
  const result = manager.checkHealth("ai-dev-os-skills");
  const afterRootExists = existsSync("D:\\Atlas-OS\\Projects\\AI-Dev-OS-skills");

  assert(result.projectId === "ai-dev-os-skills", "Skills repo health check selected wrong project");
  assert(beforeRootExists === afterRootExists, "AI-Dev-OS-skills root existence changed during health check");

  return "AI-Dev-OS-skills root existence unchanged";
}

async function testTypeScriptHealthBlocksMissingNodeTypes(): Promise<string> {
  const diagnostic = analyzeTypeScriptHealth({
    hasTypeScriptDependency: true,
    hasNodeTypesDependency: false,
    hasTypecheckScript: true,
    exitCode: 2,
    output: [
      "project-health/detectors.ts(1,42): error TS2307: Cannot find module 'node:fs' or its corresponding type declarations.",
      "tests/verify-v44.ts(40,29): error TS2580: Cannot find name 'process'. Do you need to install type definitions for node?",
    ].join("\n"),
  });

  assert(diagnostic.status === "blocked", `Expected blocked TypeScript health, got ${diagnostic.status}`);
  assert(diagnostic.canRunLocalTypecheck === true, "Local typecheck should be runnable when TypeScript and script exist");
  assert(diagnostic.missingDependencies.includes("@types/node"), "Diagnostic should report missing @types/node");
  assert(
    diagnostic.issues.some((issue) => issue.kind === "missing_node_types"),
    `Expected missing_node_types issue, got ${diagnostic.issues.map((issue) => issue.kind).join(", ")}`,
  );

  return "TypeScript health reports missing Node typings as blocked";
}

async function testTypeScriptHealthPassesCleanLocalTypecheck(): Promise<string> {
  const diagnostic = analyzeTypeScriptHealth({
    hasTypeScriptDependency: true,
    hasNodeTypesDependency: true,
    hasTypecheckScript: true,
    exitCode: 0,
    output: "",
  });

  assert(diagnostic.status === "pass", `Expected pass TypeScript health, got ${diagnostic.status}`);
  assert(diagnostic.issues.length === 0, `Expected no TypeScript health issues, got ${diagnostic.issues.length}`);
  assert(diagnostic.missingDependencies.length === 0, "Clean local typecheck should not report missing dependencies");

  return "TypeScript health can report a passing local typecheck";
}

async function testTypeScriptHealthFailsStrictErrorsWhenDependenciesPresent(): Promise<string> {
  const diagnostic = analyzeTypeScriptHealth({
    hasTypeScriptDependency: true,
    hasNodeTypesDependency: true,
    hasTypecheckScript: true,
    exitCode: 2,
    output: "agent-core/loop.ts(73,13): error TS7022: 'plan' implicitly has type 'any' because it is referenced directly or indirectly in its own initializer.",
  });

  assert(diagnostic.status === "fail", `Expected fail TypeScript health, got ${diagnostic.status}`);
  assert(
    diagnostic.issues.some((issue) => issue.kind === "strict_type_error"),
    `Expected strict_type_error issue, got ${diagnostic.issues.map((issue) => issue.kind).join(", ")}`,
  );
  assert(diagnostic.missingDependencies.length === 0, "Strict errors should not be reported as missing dependencies");

  return "TypeScript health reports strict errors once dependencies are present";
}

async function testHealthCheckFakeProjectBlocked(): Promise<string> {
  const fakeProject: WorkspaceProject = {
    id: "fake-project",
    name: "Fake Project",
    type: "product-app",
    rootPath: resolve(process.cwd(), ".tmp", "does-not-exist-v46"),
    description: "Fake missing project for health check verification.",
    protected: false,
    tags: ["fake"],
  };
  const result = runProjectHealthCheck(fakeProject);

  assert(result.status === "blocked", `Expected blocked fake project, got ${result.status}`);
  assert(
    result.blockingIssues.includes("Project root path does not exist"),
    `Missing root path blocking issue: ${result.blockingIssues.join(", ")}`,
  );
  assert(result.envFilesWereRead === false, "Fake project health check should not read env files");

  return "Fake project returned blocked";
}

async function testWorkflowSelectsResumeAiSampleGoal(): Promise<string> {
  const result = createSafeDevelopmentWorkflow("优化简历 AI 首页");

  assert(result.selectedProjectId === "project-001-resume-ai", `Unexpected selected project: ${result.selectedProjectId}`);

  return `selectedProject=${result.selectedProjectId}`;
}

async function testWorkflowGeneratesResumeAiSampleResult(): Promise<string> {
  const result = createSafeDevelopmentWorkflow("优化简历 AI 首页");

  assert(result.goal === "优化简历 AI 首页", "Workflow result should preserve goal");
  assert(["ready", "needs-approval", "needs-clarification", "blocked"].includes(result.status), `Unexpected status: ${result.status}`);
  assert(result.currentStage !== undefined, "Workflow result should include current stage");

  return `status=${result.status}, stage=${result.currentStage}`;
}

async function testWorkflowResumeAiDoesNotSelectCore(): Promise<string> {
  const result = createSafeDevelopmentWorkflow("优化简历 AI 首页");

  assert(result.selectedProjectId !== "ai-dev-os", "Resume AI sample workflow must not select AI Dev OS core");
  assert(result.selectedProjectId === "project-001-resume-ai", `Unexpected selected project: ${result.selectedProjectId}`);

  return `selectedProject=${result.selectedProjectId}`;
}

async function testWorkflowRunsHealthCheck(): Promise<string> {
  const result = createSafeDevelopmentWorkflow("优化简历 AI 首页");

  assert(typeof result.projectHealthStatus === "string", "Workflow should include project health status");

  return `projectHealthStatus=${result.projectHealthStatus}`;
}

async function testWorkflowGeneratesDryRunSummary(): Promise<string> {
  const result = createSafeDevelopmentWorkflow("优化简历 AI 首页");

  assert(typeof result.dryRunSummary === "string" && result.dryRunSummary.length > 0, "Workflow should include dry-run summary");
  assert(result.dryRunSummary.includes("Dry run only"), `Unexpected dry-run summary: ${result.dryRunSummary}`);

  return result.dryRunSummary;
}

async function testWorkflowDoesNotModifyResumeAi(): Promise<string> {
  const beforeRootExists = existsSync("D:\\Atlas-OS\\Projects\\Project-001-Resume-AI");
  const result = createSafeDevelopmentWorkflow("优化简历 AI 首页");
  const afterRootExists = existsSync("D:\\Atlas-OS\\Projects\\Project-001-Resume-AI");

  assert(result.selectedProjectId === "project-001-resume-ai", "Workflow should use Resume AI sample project");
  assert(beforeRootExists === afterRootExists, "Workflow changed Resume AI root path existence");

  return "Project-001-Resume-AI root existence unchanged";
}

async function testWorkflowDoesNotReadOrModifyEnv(): Promise<string> {
  const envPath = resolve(process.cwd(), ".env");
  const beforeExists = existsSync(envPath);
  const result = createSafeDevelopmentWorkflow("优化简历 AI 首页");
  const afterExists = existsSync(envPath);

  assert(result.safetySummary.includes("no env files read"), `Safety summary missing env read boundary: ${result.safetySummary}`);
  assert(beforeExists === afterExists, ".env existence changed during workflow");

  return "Workflow reports no env reads and .env existence is unchanged";
}

async function testWorkflowProtectsAiDevOsCore(): Promise<string> {
  const result = createSafeDevelopmentWorkflow("继续开发 AI Dev OS sandbox");

  assert(result.selectedProjectId === "ai-dev-os", `Unexpected selected project: ${result.selectedProjectId}`);
  assert(
    result.status === "needs-approval" || result.status === "needs-clarification",
    `Protected AI Dev OS workflow should not be ready: ${result.status}`,
  );
  assert(result.requiresApproval === true, "Protected AI Dev OS workflow should require approval");

  return `status=${result.status}`;
}

async function testWorkflowUnknownGoalNeedsClarification(): Promise<string> {
  const result = createSafeDevelopmentWorkflow("make it better somehow");

  assert(result.status === "needs-clarification", `Unknown workflow should need clarification, got ${result.status}`);
  assert(result.currentStage === "project-selection", `Unexpected stage: ${result.currentStage}`);

  return "Unknown target requires clarification";
}

async function testWorkflowBlocksEnvPlannedWrites(): Promise<string> {
  const project = getWorkspaceProjectById("project-001-resume-ai");
  assert(project, "Missing project-001-resume-ai");
  const guard = shouldBlockWorkflow({
    selectedProject: project,
    dryRunPlan: {
      riskLevel: "low",
      blockedReasons: [],
      plannedWrites: [".env"],
    },
  });

  assert(guard.blocked === true, "Expected env planned write to be blocked");
  assert(
    guard.blockedReasons.includes("Workflow cannot write sensitive env files"),
    `Missing env blocked reason: ${guard.blockedReasons.join(", ")}`,
  );

  return "Sensitive env planned write blocked";
}

async function testWorkflowBlocksPathEscapePlannedWrites(): Promise<string> {
  const project = getWorkspaceProjectById("project-001-resume-ai");
  assert(project, "Missing project-001-resume-ai");
  const guard = shouldBlockWorkflow({
    selectedProject: project,
    dryRunPlan: {
      riskLevel: "low",
      blockedReasons: [],
      plannedWrites: ["..\\AI-Dev-OS\\package.json"],
    },
  });

  assert(guard.blocked === true, "Expected path escape planned write to be blocked");
  assert(
    guard.blockedReasons.includes("Workflow path escape detected"),
    `Missing path escape blocked reason: ${guard.blockedReasons.join(", ")}`,
  );

  return "Path escape planned write blocked";
}

async function testWorkflowBlocksDryRunBlockedRisk(): Promise<string> {
  const project = getWorkspaceProjectById("project-001-resume-ai");
  assert(project, "Missing project-001-resume-ai");
  const guard = shouldBlockWorkflow({
    selectedProject: project,
    dryRunPlan: {
      riskLevel: "blocked",
      blockedReasons: ["shell:execute is disabled before sandbox execution"],
      plannedWrites: [],
    },
  });

  assert(guard.blocked === true, "Expected blocked dry-run risk to block workflow");
  assert(
    guard.blockedReasons.includes("shell:execute is disabled before sandbox execution"),
    `Missing dry-run blocked reason: ${guard.blockedReasons.join(", ")}`,
  );

  return "Blocked dry-run risk blocks workflow";
}

async function testWorkflowSafetySummary(): Promise<string> {
  const result = createSafeDevelopmentWorkflow("优化简历 AI 首页");

  for (const phrase of ["no files modified", "no env files read", "no remote code executed"]) {
    assert(result.safetySummary.includes(phrase), `Safety summary missing phrase: ${phrase}`);
  }

  return result.safetySummary;
}

async function testWorkflowDoesNotExecuteShell(): Promise<string> {
  const result = createSafeDevelopmentWorkflow("重构某个产品项目的 src 代码");

  assert(result.safetySummary.includes("no shell/network/browser execution"), "Workflow should not execute shell");

  return "Workflow reports no shell execution";
}

async function testWorkflowDoesNotExecuteNetwork(): Promise<string> {
  const result = createSafeDevelopmentWorkflow("更新 skill manifest repo");

  assert(result.safetySummary.includes("no shell/network/browser execution"), "Workflow should not execute network");

  return "Workflow reports no network execution";
}

async function testWorkflowDoesNotExecuteBrowser(): Promise<string> {
  const result = createSafeDevelopmentWorkflow("为一个 Next.js 产品优化首页文案");

  assert(result.safetySummary.includes("no shell/network/browser execution"), "Workflow should not execute browser");

  return "Workflow reports no browser execution";
}

async function testWorkflowGenericNextProductGoal(): Promise<string> {
  const result = createSafeDevelopmentWorkflow("为一个 Next.js 产品优化首页文案");

  assert(result.selectedProjectId === "project-001-resume-ai", `Unexpected selected project: ${result.selectedProjectId}`);
  assert(result.dryRunSummary?.includes("Dry run only"), "Generic product workflow should generate dry-run summary");

  return `selectedProject=${result.selectedProjectId}, status=${result.status}`;
}

async function testWorkflowGenericProductRefactorGoal(): Promise<string> {
  const result = createSafeDevelopmentWorkflow("重构某个产品项目的 src 代码");

  assert(result.selectedProjectId === "project-001-resume-ai", `Unexpected selected project: ${result.selectedProjectId}`);
  assert(result.plannedWrites.includes("src/**"), `Expected src/** planned write, got ${result.plannedWrites.join(", ")}`);

  return `plannedWrites=${result.plannedWrites.join(", ")}`;
}

async function testWorkflowSkillManifestRepoGoal(): Promise<string> {
  const result = createSafeDevelopmentWorkflow("更新 skill manifest repo");

  assert(result.selectedProjectId === "ai-dev-os-skills", `Unexpected selected project: ${result.selectedProjectId}`);
  assert(
    result.status === "needs-approval" || result.status === "needs-clarification",
    `Protected skill manifest repo workflow should not be ready: ${result.status}`,
  );

  return `selectedProject=${result.selectedProjectId}, status=${result.status}`;
}

async function testWorkflowAiDevOsSandboxGoal(): Promise<string> {
  const result = createSafeDevelopmentWorkflow("继续开发 AI Dev OS sandbox");

  assert(result.selectedProjectId === "ai-dev-os", `Unexpected selected project: ${result.selectedProjectId}`);
  assert(result.requiresApproval === true, "AI Dev OS sandbox workflow should require approval");

  return `selectedProject=${result.selectedProjectId}, status=${result.status}`;
}

async function testApprovalRequiredNoDecisionPending(): Promise<string> {
  const result = createSafeDevelopmentWorkflow("为一个 Next.js 产品优化首页文案", {
    requestedBy: "test-runner",
    requestedAt: "2026-06-28T00:00:00.000Z",
  });

  assert(result.approvalRecord.status === "pending", `Expected pending approval, got ${result.approvalRecord.status}`);
  assert(result.approvalRecord.requiresApproval === true, "Approval record should require approval");
  assert(result.status === "needs-approval", `Expected workflow needs-approval, got ${result.status}`);

  return result.approvalRecord.approvalId;
}

async function testApprovalRequiredApprovedDecision(): Promise<string> {
  const result = createSafeDevelopmentWorkflow("为一个 Next.js 产品优化首页文案", {
    requestedBy: "test-runner",
    requestedAt: "2026-06-28T00:00:00.000Z",
    approvalDecision: {
      status: "approved",
      decidedBy: "owner",
      decidedAt: "2026-06-28T00:01:00.000Z",
    },
  });

  assert(result.approvalRecord.status === "approved", `Expected approved approval, got ${result.approvalRecord.status}`);
  assert(result.approvalRecord.approvedBy === "owner", `Unexpected approver: ${result.approvalRecord.approvedBy}`);
  assert(result.approvalRecord.decidedAt === "2026-06-28T00:01:00.000Z", "Approved decision timestamp was not recorded");
  assert(result.status === "ready", `Approved non-blocked workflow should be ready, got ${result.status}`);

  return result.approvalRecord.approvalSummary;
}

async function testApprovalRequiredRejectedDecision(): Promise<string> {
  const result = createSafeDevelopmentWorkflow("为一个 Next.js 产品优化首页文案", {
    requestedBy: "test-runner",
    requestedAt: "2026-06-28T00:00:00.000Z",
    approvalDecision: {
      status: "rejected",
      decidedBy: "owner",
      decidedAt: "2026-06-28T00:01:00.000Z",
    },
  });

  assert(result.approvalRecord.status === "rejected", `Expected rejected approval, got ${result.approvalRecord.status}`);
  assert(result.status === "blocked", `Rejected workflow should be blocked, got ${result.status}`);
  assert(result.blockedReasons.includes("Workflow approval rejected"), `Missing rejection reason: ${result.blockedReasons.join(", ")}`);

  return result.approvalRecord.approvalSummary;
}

async function testApprovalRecordBlockedByPolicy(): Promise<string> {
  const project = getWorkspaceProjectById("project-001-resume-ai");
  assert(project, "Missing project-001-resume-ai");
  const record = createWorkflowApprovalRecord({
    goal: "attempt unsafe env write",
    project,
    riskLevel: "high",
    requiresApproval: true,
    plannedReads: ["package.json"],
    plannedWrites: [".env"],
    permissions: ["file:read", "file:write:src"],
    capabilities: ["source_editing"],
    blockedReasons: ["Workflow cannot write sensitive env files"],
    requestedBy: "test-runner",
    requestedAt: "2026-06-28T00:00:00.000Z",
  });

  assert(record.status === "blocked", `Expected blocked approval record, got ${record.status}`);
  assert(
    record.blockedReasons.includes("Workflow cannot write sensitive env files"),
    `Missing blocked reason: ${record.blockedReasons.join(", ")}`,
  );

  return record.approvalSummary;
}

async function testApprovalNotRequiredRecord(): Promise<string> {
  const result = createSafeDevelopmentWorkflow("search product documentation", {
    requestedBy: "test-runner",
    requestedAt: "2026-06-28T00:00:00.000Z",
  });

  assert(result.approvalRecord.status === "not_required", `Expected not_required, got ${result.approvalRecord.status}`);
  assert(result.approvalRecord.requiresApproval === false, "Approval record should not require approval");
  assert(result.status === "ready", `No-approval workflow should be ready, got ${result.status}`);

  return result.approvalRecord.approvalSummary;
}

async function testApprovalRecordIncludesPlanDetails(): Promise<string> {
  const result = createSafeDevelopmentWorkflow("重构某个产品项目的 src 代码", {
    requestedBy: "test-runner",
    requestedAt: "2026-06-28T00:00:00.000Z",
  });
  const record = result.approvalRecord;

  assert(record.riskLevel === result.projectRiskLevel, `Unexpected risk level: ${record.riskLevel}`);
  assert(record.approvedPlannedReads.includes("src/**"), `Missing planned read: ${record.approvedPlannedReads.join(", ")}`);
  assert(record.approvedPlannedWrites.includes("src/**"), `Missing planned write: ${record.approvedPlannedWrites.join(", ")}`);
  assert(record.approvedPermissions.includes("file:write:src"), `Missing permission: ${record.approvedPermissions.join(", ")}`);
  assert(record.approvedCapabilities.includes("source_editing"), `Missing capability: ${record.approvedCapabilities.join(", ")}`);
  assert(Array.isArray(record.blockedReasons), "Approval record blockedReasons should be an array");

  return `permissions=${record.approvedPermissions.join(", ")}`;
}

async function testApprovalRecordDeterministicId(): Promise<string> {
  const options = {
    requestedBy: "test-runner",
    requestedAt: "2026-06-28T00:00:00.000Z",
  };
  const first = createSafeDevelopmentWorkflow("为一个 Next.js 产品优化首页文案", options);
  const second = createSafeDevelopmentWorkflow("为一个 Next.js 产品优化首页文案", options);

  assert(first.approvalRecord.approvalId === second.approvalRecord.approvalId, "Approval id should be deterministic");

  return first.approvalRecord.approvalId;
}

async function testWorkflowResultHasNoResumeOnlyApprovalFields(): Promise<string> {
  const result = createSafeDevelopmentWorkflow("为一个 Next.js 产品优化首页文案");
  const keys = Object.keys(result).join(" ").toLowerCase();
  const approvalKeys = Object.keys(result.approvalRecord).join(" ").toLowerCase();

  assert(!keys.includes("resume"), `Workflow result has Resume-only key: ${keys}`);
  assert(!approvalKeys.includes("resume"), `Approval record has Resume-only key: ${approvalKeys}`);

  return "Workflow and approval record fields are generic";
}

async function testLegalPermissionsPass(): Promise<string> {
  validateSkillPolicy(createPolicyTestManifest());
  return "Known permissions satisfy declared capabilities";
}

async function testUnknownPermissionFails(): Promise<string> {
  const message = expectPolicyError(
    createPolicyTestManifest({
      permissions: ["network:github", "network:anywhere"],
    }),
    "Unknown skill permission: network:anywhere",
  );

  return message;
}

async function testUnknownCapabilityFails(): Promise<string> {
  const message = expectPolicyError(
    createPolicyTestManifest({
      capabilities: ["github_search", "unknown_capability"],
    }),
    "Unknown skill capability: unknown_capability",
  );

  return message;
}

async function testMissingRequiredPermissionFails(): Promise<string> {
  const message = expectPolicyError(
    createPolicyTestManifest({
      capabilities: ["readme_generation"],
      permissions: ["file:read"],
    }),
    "Capability readme_generation requires permission file:write:docs",
  );

  return message;
}

async function testShellExecuteDisabled(): Promise<string> {
  const message = expectPolicyError(
    createPolicyTestManifest({
      capabilities: ["shell_execute"],
      permissions: ["shell:execute"],
    }),
    "Permission shell:execute is disabled in V4.4.4",
  );

  return message;
}

async function testBrowserWriteDisabled(): Promise<string> {
  const message = expectPolicyError(
    createPolicyTestManifest({
      capabilities: ["browser_write"],
      permissions: ["browser:write"],
    }),
    "Permission browser:write is disabled in V4.4.4",
  );

  return message;
}

async function testGithubSearchDryRunPlan(): Promise<string> {
  const plan = createDryRunExecutionPlan({
    goal: "search github repo for AI Dev OS skills",
    skill: createPolicyTestManifest({
      name: "github-search-skill",
      capabilities: ["github_search", "repo_discovery"],
      permissions: ["network:github"],
    }),
  });

  assert(plan.mode === "dry-run", `Unexpected mode: ${plan.mode}`);
  assert(plan.networkAccess === true, "Expected GitHub search to require network access");
  assert(plan.plannedWrites.length === 0, `Expected no planned writes, got ${plan.plannedWrites.join(", ")}`);
  assert(plan.riskLevel === "low", `Expected low risk, got ${plan.riskLevel}`);
  assert(plan.requiresApproval === false, "Expected no approval requirement for read-only GitHub search");

  return "GitHub search dry-run plan is low-risk and read-only";
}

async function testReadmeDryRunPlan(): Promise<string> {
  const plan = createDryRunExecutionPlan({
    goal: "write a README for this project",
    skill: createPolicyTestManifest({
      name: "auto-readme-generator",
      capabilities: ["readme_generation", "docs_generation"],
      permissions: ["file:read", "file:write:docs"],
    }),
  });

  assert(plan.plannedReads.includes("README.md"), "Expected README.md planned read");
  assert(plan.plannedReads.includes("package.json"), "Expected package.json planned read");
  assert(plan.plannedWrites.includes("README.md"), "Expected README.md planned write");
  assert(plan.requiresApproval === true, "Expected approval for docs write plan");

  return "README dry-run plan includes docs reads and write approval";
}

async function testCodeRefactorDryRunPlan(): Promise<string> {
  const plan = createDryRunExecutionPlan({
    goal: "refactor source code safely",
    skill: createPolicyTestManifest({
      name: "code-refactor-skill",
      capabilities: ["code_refactor", "source_editing"],
      permissions: ["file:read", "file:write:src"],
    }),
  });

  assert(plan.plannedReads.includes("src/**"), "Expected src/** planned read");
  assert(plan.plannedWrites.includes("src/**"), "Expected src/** planned write");
  assertRiskAtLeast(plan.riskLevel, "medium");
  assert(plan.requiresApproval === true, "Expected approval for source write plan");

  return "Code refactor dry-run plan requires approval and medium risk";
}

async function testShellExecuteDryRunBlocked(): Promise<string> {
  const plan = createDryRunExecutionPlan({
    goal: "run a shell command",
    skill: createPolicyTestManifest({
      name: "shell-runner-test",
      capabilities: ["shell_execute"],
      permissions: ["shell:execute"],
    }),
  });

  assert(plan.riskLevel === "blocked", `Expected blocked risk, got ${plan.riskLevel}`);
  assert(plan.requiresApproval === true, "Expected approval requirement for blocked shell execution");
  assert(
    plan.blockedReasons.includes("shell:execute is disabled before sandbox execution"),
    `Missing shell blocked reason: ${plan.blockedReasons.join(", ")}`,
  );

  return "shell:execute dry-run plan is blocked";
}

async function testBrowserWriteDryRunBlocked(): Promise<string> {
  const plan = createDryRunExecutionPlan({
    goal: "write in a browser",
    skill: createPolicyTestManifest({
      name: "browser-writer-test",
      capabilities: ["browser_write"],
      permissions: ["browser:write"],
    }),
  });

  assert(plan.riskLevel === "blocked", `Expected blocked risk, got ${plan.riskLevel}`);
  assert(plan.requiresApproval === true, "Expected approval requirement for blocked browser write");
  assert(
    plan.blockedReasons.includes("browser:write is disabled before browser sandbox"),
    `Missing browser blocked reason: ${plan.blockedReasons.join(", ")}`,
  );

  return "browser:write dry-run plan is blocked";
}

async function testUnknownSkillDryRunRequiresApproval(): Promise<string> {
  const plan = createDryRunExecutionPlan({
    goal: "plan an unknown skill safely",
    skill: createPolicyTestManifest({
      name: "unknown-skill",
      capabilities: [],
      permissions: [],
    }),
  });

  assert(plan.plannedReads.length === 0, `Expected no planned reads, got ${plan.plannedReads.join(", ")}`);
  assert(plan.plannedWrites.length === 0, `Expected no planned writes, got ${plan.plannedWrites.join(", ")}`);
  assertRiskAtLeast(plan.riskLevel, "medium");
  assert(plan.requiresApproval === true, "Expected approval requirement for unknown skill");

  return "Unknown skill dry-run plan is conservative and requires approval";
}

async function testDryRunPlanDoesNotModifyFiles(): Promise<string> {
  const before = spawnSync("git", ["status", "--short"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert(before.status === 0, `git status before dry-run failed: ${before.stderr}`);

  createDryRunExecutionPlan({
    goal: "plan README update without writing",
    skill: createPolicyTestManifest({
      name: "auto-readme-generator",
      capabilities: ["readme_generation", "docs_generation"],
      permissions: ["file:read", "file:write:docs"],
    }),
  });

  const after = spawnSync("git", ["status", "--short"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert(after.status === 0, `git status after dry-run failed: ${after.stderr}`);
  assert(after.stdout === before.stdout, "Dry-run changed git working tree status");

  return "Dry-run plan generation did not change git working tree status";
}

async function testDryRunPlanDoesNotExecuteRemoteCode(): Promise<string> {
  let executed = false;
  const skillWithExecutable = {
    ...createPolicyTestManifest({
      name: "github-search-skill",
      capabilities: ["github_search", "repo_discovery"],
      permissions: ["network:github"],
    }),
    execute: () => {
      executed = true;
    },
  };

  const plan = createDryRunExecutionPlan({
    goal: "plan remote skill execution only",
    skill: skillWithExecutable,
  });

  assert(plan.mode === "dry-run", `Unexpected mode: ${plan.mode}`);
  assert(executed === false, "Dry-run planner executed a skill function");

  return "Dry-run planner used metadata only and did not call execute";
}

async function testV444PolicyStillPasses(): Promise<string> {
  validateSkillPolicy(createPolicyTestManifest());
  expectPolicyError(
    createPolicyTestManifest({
      permissions: ["network:github", "network:anywhere"],
    }),
    "Unknown skill permission: network:anywhere",
  );
  expectPolicyError(
    createPolicyTestManifest({
      capabilities: ["unknown_capability"],
      permissions: ["network:github"],
    }),
    "Unknown skill capability: unknown_capability",
  );

  return "V4.4.4 policy validation still rejects unsafe manifests";
}

async function testSandboxWritesSafeFile(): Promise<string> {
  prepareSandboxTestDir();
  const config = createDefaultSandboxConfig(sandboxRoot);
  const result = await executeSandboxOperation(config, "write", "safe.txt", "sandbox safe content");

  assert(result.success === true, `Expected sandbox write to succeed: ${result.message}`);
  assert(result.normalizedPath.startsWith(sandboxRoot), `Write escaped sandbox: ${result.normalizedPath}`);

  return "Sandbox wrote safe.txt inside rootDir";
}

async function testSandboxReadsSafeFile(): Promise<string> {
  const config = createDefaultSandboxConfig(sandboxRoot);
  const result = await executeSandboxOperation(config, "read", "safe.txt");

  assert(result.success === true, `Expected sandbox read to succeed: ${result.message}`);
  assert("content" in result && result.content === "sandbox safe content", "Unexpected sandbox read content");

  return "Sandbox read safe.txt inside rootDir";
}

async function testSandboxListsRootDir(): Promise<string> {
  const config = createDefaultSandboxConfig(sandboxRoot);
  const result = await executeSandboxOperation(config, "list", ".");

  assert(result.success === true, `Expected sandbox list to succeed: ${result.message}`);
  assert("entries" in result && result.entries?.includes("safe.txt"), "Sandbox list did not include safe.txt");

  return "Sandbox listed rootDir";
}

async function testSandboxBlocksPathEscape(): Promise<string> {
  const config = createDefaultSandboxConfig(sandboxRoot);
  const result = await executeSandboxOperation(config, "read", "../outside.txt");

  assert(result.success === false, "Expected path escape read to be blocked");
  assert(
    result.blockedReasons.includes("Sandbox path escape blocked"),
    `Unexpected blocked reasons: ${result.blockedReasons.join(", ")}`,
  );

  return "Sandbox blocked ../outside.txt path escape";
}

async function testSandboxBlocksEnvRead(): Promise<string> {
  const config = createDefaultSandboxConfig(sandboxRoot);
  const result = await executeSandboxOperation(config, "read", ".env");

  assert(result.success === false, "Expected .env read to be blocked");
  assert(
    result.blockedReasons.includes("Blocked sensitive file access"),
    `Unexpected blocked reasons: ${result.blockedReasons.join(", ")}`,
  );

  return "Sandbox blocked .env read before file access";
}

async function testSandboxBlocksEnvWrite(): Promise<string> {
  const config = createDefaultSandboxConfig(sandboxRoot);
  const result = await executeSandboxOperation(config, "write", ".env", "SHOULD_NOT_WRITE=true");

  assert(result.success === false, "Expected .env write to be blocked");
  assert(
    result.blockedReasons.includes("Blocked sensitive file access"),
    `Unexpected blocked reasons: ${result.blockedReasons.join(", ")}`,
  );

  return "Sandbox blocked .env write";
}

async function testSandboxRejectsDeleteByDefault(): Promise<string> {
  const config = createDefaultSandboxConfig(sandboxRoot);
  const result = await executeSandboxOperation(config, "delete", "safe.txt");

  assert(result.success === false, "Expected delete to be rejected by default");
  assert(
    result.blockedReasons.includes("Sandbox deletes are disabled"),
    `Unexpected blocked reasons: ${result.blockedReasons.join(", ")}`,
  );

  return "Sandbox rejected delete by default";
}

async function testSandboxBlocksBusinessProjectPath(): Promise<string> {
  const config = createDefaultSandboxConfig(sandboxRoot);
  const businessProjectPath = "D:\\Atlas-OS\\Projects\\Project-001-Resume-AI\\README.md";
  const result = await executeSandboxOperation(config, "read", businessProjectPath);

  assert(result.success === false, "Expected business project path to be blocked");
  assert(
    result.blockedReasons.includes("Sandbox path escape blocked"),
    `Unexpected blocked reasons: ${result.blockedReasons.join(", ")}`,
  );

  return "Sandbox blocked Project-001-Resume-AI path access";
}

async function testSandboxExecutorDoesNotExecuteShell(): Promise<string> {
  const config = createDefaultSandboxConfig(sandboxRoot);
  const result = await executeSandboxOperation(config, "shell" as any, "echo should-not-run");

  assert(result.success === false, "Expected unsupported shell operation to be blocked");
  assert(result.message.includes("Unsupported sandbox operation: shell"), `Unexpected message: ${result.message}`);

  return "Sandbox executor rejected shell operation";
}

async function testSandboxExecutorDoesNotExecuteNetwork(): Promise<string> {
  const config = createDefaultSandboxConfig(sandboxRoot);
  const result = await executeSandboxOperation(config, "network" as any, "https://github.com");

  assert(result.success === false, "Expected unsupported network operation to be blocked");
  assert(result.message.includes("Unsupported sandbox operation: network"), `Unexpected message: ${result.message}`);

  return "Sandbox executor rejected network operation";
}

async function testSandboxExecutorDoesNotExecuteBrowser(): Promise<string> {
  const config = createDefaultSandboxConfig(sandboxRoot);
  const result = await executeSandboxOperation(config, "browser" as any, "https://example.com");

  assert(result.success === false, "Expected unsupported browser operation to be blocked");
  assert(result.message.includes("Unsupported sandbox operation: browser"), `Unexpected message: ${result.message}`);
  cleanupSandboxTestDir();

  return "Sandbox executor rejected browser operation";
}

async function testTrustedRepoFetchesIndexWithIntegrity(): Promise<string> {
  const manifests = await getTrustedManifests();
  const fixture = createOfflineManifestFixture();

  assert(manifests.length > 0, "Trusted repo index returned no manifests");
  assert(fixture.lock.index.path === "skills/index.json", `Unexpected locked index path: ${fixture.lock.index.path}`);

  return `Verified offline index with sha256 ${fixture.lock.index.sha256}`;
}

async function testTrustedRepoFetchesSkillManifestsWithIntegrity(): Promise<string> {
  const manifests = await getTrustedManifests();
  const names = manifests.map((manifest) => manifest.name).sort();

  assert(manifests.length === 3, `Expected 3 manifests, got ${manifests.length}`);

  return `Fetched and verified manifests: ${names.join(", ")}`;
}

async function testManifestVersionsMatchLock(): Promise<string> {
  const manifests = await getTrustedManifests();
  const lock = getSkillManifestLock();

  for (const manifest of manifests) {
    const lockedSkill = lock.skills.find((skill) => skill.name === manifest.name);
    assert(lockedSkill, `Missing lock entry for ${manifest.name}`);
    assert(manifest.version === lockedSkill.version, `Version mismatch for ${manifest.name}`);
  }

  return "All manifest versions match lock";
}

async function testManifestNamesMatchLock(): Promise<string> {
  const manifests = await getTrustedManifests();
  const lock = getSkillManifestLock();

  for (const lockedSkill of lock.skills) {
    assert(
      manifests.some((manifest) => manifest.name === lockedSkill.name),
      `Missing fetched manifest for locked skill ${lockedSkill.name}`,
    );
  }

  return "All manifest names match lock";
}

async function testTrustedRepoManifestsPassPolicy(): Promise<string> {
  const manifests = await getTrustedManifests();

  assert(manifests.length === 3, `Expected 3 manifests, got ${manifests.length}`);

  for (const manifest of manifests) {
    validateSkillPolicy(manifest);
  }

  return "Trusted repo manifests pass policy validation";
}

async function testWrongShaFails(): Promise<string> {
  try {
    assertSha256Integrity("tampered manifest text", "0".repeat(64), "tampered-test");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert(message.includes("Integrity check failed for tampered-test"), `Unexpected error: ${message}`);
    return "Wrong sha256 fails with integrity check failed";
  }

  throw new Error("Wrong sha256 did not fail");
}

async function testVersionMismatchFails(): Promise<string> {
  const manifests = await getTrustedManifests();
  const lock = getSkillManifestLock();
  const [manifest] = manifests;
  const lockedSkill = lock.skills.find((skill) => skill.name === manifest.name);

  assert(lockedSkill, `Missing lock entry for ${manifest.name}`);

  try {
    assertManifestMatchesLock(
      {
        ...manifest,
        version: "999.0.0",
      },
      lockedSkill,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert(message.includes("Version mismatch"), `Unexpected error: ${message}`);
    return "Version mismatch fails";
  }

  throw new Error("Version mismatch did not fail");
}

async function testUntrustedRepoRejected(): Promise<string> {
  try {
    await loadGitHubSkillManifestIndex(untrustedRepo);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert(message === "Untrusted GitHub skill repo", `Unexpected error message: ${message}`);
    return "Rejected untrusted repo with expected error";
  }

  throw new Error("Untrusted repo was not rejected");
}

async function testManifestSkillsBatchRegistration(): Promise<string> {
  const manifests = await getTrustedManifests();
  const skills = registerGitHubSkillsFromManifestIndex(manifests);

  for (const manifest of manifests) {
    assert(getSkill(manifest.name)?.name === manifest.name, `Manifest skill not registered: ${manifest.name}`);
  }

  return `Registered ${skills.length} manifest skills`;
}

async function testManifestSkillExecutionPlaceholder(): Promise<string> {
  const manifests = await getTrustedManifests();
  const [manifest] = manifests;

  assert(manifest, "No manifest available for execution test");
  registerGitHubSkillsFromManifestIndex(manifests);

  const output = await executeSkill(manifest.name, "safe remote manifest placeholder test");
  const message = String(output?.message || "");

  assert(output?.type === "github_skill_manifest_placeholder", "Unexpected manifest skill output type");
  assert(
    message.includes("metadata-only advisory/planned use"),
    `Output did not clearly disable remote execution: ${JSON.stringify(output)}`,
  );

  return `Output: ${JSON.stringify(output)}`;
}

async function testV43StillPasses(): Promise<string> {
  const result = spawnSync(process.execPath, ["--import", "tsx", "tests/verify-v43.ts"], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
  });

  const output = `${result.stdout || ""}${result.stderr || ""}`;

  assert(result.status === 0, `verify:v43 exited with ${result.status}\n${output}`);
  assert(output.includes("- Failed: 0"), `verify:v43 did not report Failed: 0\n${output}`);
  assert(output.includes("- Skipped: 0"), `verify:v43 did not report Skipped: 0\n${output}`);
  assert(output.includes("- Passed: 6"), `verify:v43 did not report Passed: 6\n${output}`);

  return "verify:v43 reported Passed: 6, Failed: 0, Skipped: 0";
}

async function testGitHubPushConnectionResetClassifiedAsNetworkRetry(): Promise<string> {
  const result = classifyGitHubPushVerification({
    stderr: "fatal: unable to access 'https://github.com/example/repo.git/': Recv failure: Connection was reset",
    exitCode: 128,
  });
  const repeated = classifyGitHubPushVerification({
    stderr: "fatal: unable to access 'https://github.com/example/repo.git/': Recv failure: Connection was reset",
    exitCode: 128,
    repeatedFailure: true,
  });

  assert(result.status === "failed", "Connection reset should fail verification");
  assert(result.failureKind === "connection_reset", `Unexpected kind: ${result.failureKind}`);
  assert(result.isNetworkIssue === true, "Connection reset should be a network issue");
  assert(result.shouldRetry === true, "First connection reset should allow one retry");
  assert(repeated.shouldStop === true, "Repeated connection reset should stop");
  assert(repeated.shouldRetry === false, "Repeated connection reset should not keep retrying");

  return "connection_reset => network retry once, repeated stop";
}

async function testGitHubPushPort443ClassifiedAsNetwork(): Promise<string> {
  const result = classifyGitHubPushVerification({
    stderr: "fatal: unable to access 'https://github.com/example/repo.git/': Failed to connect to github.com port 443 after 21090 ms: Could not connect to server",
    exitCode: 128,
  });

  assert(result.failureKind === "port_443_connection_failure", `Unexpected kind: ${result.failureKind}`);
  assert(result.isNetworkIssue === true, "Port 443 failure should be a network issue");
  assert(result.safeToUseTemporaryCurlResolve === true, "Port 443 failure can use temporary curl resolve guidance");
  assert(result.shouldRetry === true, "Port 443 failure should allow one retry");

  return "port_443_connection_failure => network issue";
}

async function testGitHubPushDnsFailureClassified(): Promise<string> {
  const result = classifyGitHubPushVerification({
    stderr: "fatal: unable to access 'https://github.com/example/repo.git/': Could not resolve host: github.com",
    exitCode: 128,
  });

  assert(result.failureKind === "dns_failure", `Unexpected kind: ${result.failureKind}`);
  assert(result.isNetworkIssue === true, "DNS failure should be a network issue");
  assert(result.safeToUseTemporaryCurlResolve === true, "DNS failure can use temporary curl resolve guidance");
  assert(result.shouldRetry === true, "DNS failure should allow one retry");

  return "dns_failure => network issue";
}

async function testGitHubPushAuthenticationFailureClassified(): Promise<string> {
  const result = classifyGitHubPushVerification({
    stderr: "remote: Invalid username or password.\nfatal: Authentication failed for 'https://github.com/example/repo.git/'",
    exitCode: 128,
  });

  assert(result.failureKind === "authentication_failure", `Unexpected kind: ${result.failureKind}`);
  assert(result.isAuthIssue === true, "Authentication failure should be an auth issue");
  assert(result.shouldRetry === false, "Authentication failure should not retry blindly");
  assert(result.shouldStop === true, "Authentication failure should stop");

  return "authentication_failure => stop for credentials";
}

async function testGitHubPushPermissionDeniedClassified(): Promise<string> {
  const result = classifyGitHubPushVerification({
    stderr: "ERROR: Permission denied to github-user/example.git.\nfatal: Could not read from remote repository.",
    exitCode: 128,
  });

  assert(result.failureKind === "permission_denied", `Unexpected kind: ${result.failureKind}`);
  assert(result.isAuthIssue === true, "Permission denied should be an auth/permission issue");
  assert(result.shouldRetry === false, "Permission denied should not retry blindly");
  assert(result.shouldStop === true, "Permission denied should stop");

  return "permission_denied => stop for access review";
}

async function testGitHubPushNonFastForwardClassified(): Promise<string> {
  const result = classifyGitHubPushVerification({
    stderr: "! [rejected] main -> main (non-fast-forward)\nerror: failed to push some refs to 'https://github.com/example/repo.git'",
    exitCode: 1,
  });

  assert(result.failureKind === "non_fast_forward", `Unexpected kind: ${result.failureKind}`);
  assert(result.isRepoStateIssue === true, "Non-fast-forward should be a repo state issue");
  assert(result.shouldRetry === false, "Non-fast-forward should not retry blindly");
  assert(result.recommendedNextStep.includes("Do not force push"), "Non-fast-forward guidance must reject force push");

  return "non_fast_forward => stop without force push";
}

async function testGitHubPushRemoteRejectedClassified(): Promise<string> {
  const result = classifyGitHubPushVerification({
    stderr: "! [remote rejected] main -> main (protected branch hook declined)",
    exitCode: 1,
  });

  assert(result.failureKind === "remote_rejected", `Unexpected kind: ${result.failureKind}`);
  assert(result.isRepoStateIssue === true, "Remote rejected should be a repo state issue");
  assert(result.shouldRetry === false, "Remote rejected should not retry blindly");
  assert(result.shouldStop === true, "Remote rejected should stop");

  return "remote_rejected => stop for remote policy";
}

async function testGitHubPushSuccessClassified(): Promise<string> {
  const result = classifyGitHubPushVerification({
    stdout: "To github.com:example/repo.git\n   1234567..89abcde  main -> main",
    exitCode: 0,
  });

  assert(result.status === "success", "Successful output should pass verification");
  assert(result.failureKind === undefined, `Success should not have failure kind: ${result.failureKind}`);
  assert(result.shouldStop === false, "Success should not stop");
  assert(result.shouldRetry === false, "Success should not retry");

  return "success => verification succeeded";
}

async function testGitHubPushUnknownErrorClassified(): Promise<string> {
  const result = classifyGitHubPushVerification({
    stderr: "fatal: unexpected remote helper failure without a known signature",
    exitCode: 128,
  });

  assert(result.failureKind === "unknown_failure", `Unexpected kind: ${result.failureKind}`);
  assert(result.isNetworkIssue === false, "Unknown failure should not be guessed as network");
  assert(result.shouldRetry === false, "Unknown failure should not retry");
  assert(result.shouldStop === true, "Unknown failure should stop and report");

  return "unknown_failure => stop and report";
}

async function main(): Promise<void> {
  console.log("AI Dev OS V4.4.6 Verification");
  console.log("");

  await runTest("Workflow Approval Record pending when approval required without decision", testApprovalRequiredNoDecisionPending);
  await runTest("Workflow Approval Record approved with explicit approval decision", testApprovalRequiredApprovedDecision);
  await runTest("Workflow Approval Record rejected blocks workflow", testApprovalRequiredRejectedDecision);
  await runTest("Workflow Approval Record blocked for policy-blocked workflow", testApprovalRecordBlockedByPolicy);
  await runTest("Workflow Approval Record not_required when approval is not required", testApprovalNotRequiredRecord);
  await runTest("Workflow Approval Record includes plan details", testApprovalRecordIncludesPlanDetails);
  await runTest("Workflow Approval Record uses deterministic approval id", testApprovalRecordDeterministicId);
  await runTest("Workflow Approval Record keeps generic result fields", testWorkflowResultHasNoResumeOnlyApprovalFields);
  await runTest("Safe Development Workflow selects Resume AI sample goal", testWorkflowSelectsResumeAiSampleGoal);
  await runTest("Safe Development Workflow generates workflow result", testWorkflowGeneratesResumeAiSampleResult);
  await runTest("Safe Development Workflow does not select AI Dev OS for Resume AI sample", testWorkflowResumeAiDoesNotSelectCore);
  await runTest("Safe Development Workflow runs project health check", testWorkflowRunsHealthCheck);
  await runTest("Safe Development Workflow generates dry-run summary", testWorkflowGeneratesDryRunSummary);
  await runTest("Safe Development Workflow does not modify Project-001-Resume-AI", testWorkflowDoesNotModifyResumeAi);
  await runTest("Safe Development Workflow does not read or modify .env", testWorkflowDoesNotReadOrModifyEnv);
  await runTest("Safe Development Workflow protects AI Dev OS core", testWorkflowProtectsAiDevOsCore);
  await runTest("Safe Development Workflow unknown target needs clarification", testWorkflowUnknownGoalNeedsClarification);
  await runTest("Safe Development Workflow blocks .env planned writes", testWorkflowBlocksEnvPlannedWrites);
  await runTest("Safe Development Workflow blocks path escape planned writes", testWorkflowBlocksPathEscapePlannedWrites);
  await runTest("Safe Development Workflow blocks dry-run blocked risk", testWorkflowBlocksDryRunBlockedRisk);
  await runTest("Safe Development Workflow safety summary is explicit", testWorkflowSafetySummary);
  await runTest("Safe Development Workflow does not execute shell", testWorkflowDoesNotExecuteShell);
  await runTest("Safe Development Workflow does not execute network", testWorkflowDoesNotExecuteNetwork);
  await runTest("Safe Development Workflow does not execute browser", testWorkflowDoesNotExecuteBrowser);
  await runTest("Safe Development Workflow supports generic Next.js product goal", testWorkflowGenericNextProductGoal);
  await runTest("Safe Development Workflow supports generic product refactor goal", testWorkflowGenericProductRefactorGoal);
  await runTest("Safe Development Workflow supports skill manifest repo goal", testWorkflowSkillManifestRepoGoal);
  await runTest("Safe Development Workflow supports AI Dev OS sandbox goal", testWorkflowAiDevOsSandboxGoal);
  await runTest("Project Health Check can inspect ai-dev-os", testHealthCheckAiDevOs);
  await runTest("Project Health Check can inspect Project-001-Resume-AI without modification", testHealthCheckResumeAiDoesNotModify);
  await runTest("Project Health Check includes protected warning for ai-dev-os", testHealthCheckProtectedWarning);
  await runTest("Project Health Check does not classify Resume AI as system-core", testHealthCheckResumeAiNotSystemCore);
  await runTest("Project Health Check detects package.json", testHealthCheckPackageJsonDetection);
  await runTest("Project Health Check detects package manager safely", testHealthCheckPackageManagerDetection);
  await runTest("Project Health Check detects scripts safely", testHealthCheckScriptsDetection);
  await runTest("Project Health Check detects deployment hints safely", testHealthCheckDeploymentHintsDetection);
  await runTest("Project Health Check envFilesWereRead is false", testHealthCheckEnvFilesWereReadFalse);
  await runTest("Project Health Check does not read .env", testHealthCheckDoesNotReadEnv);
  await runTest("Project Health Check does not modify .env", testHealthCheckDoesNotModifyEnv);
  await runTest("Project Health Check does not modify Project-001-Resume-AI", testHealthCheckDoesNotModifyResumeAi);
  await runTest("Project Health Check does not modify AI-Dev-OS-skills", testHealthCheckDoesNotModifySkillsRepo);
  await runTest("TypeScript Health reports missing Node typings as blocked", testTypeScriptHealthBlocksMissingNodeTypes);
  await runTest("TypeScript Health can report passing local typecheck", testTypeScriptHealthPassesCleanLocalTypecheck);
  await runTest("TypeScript Health reports strict errors when dependencies are present", testTypeScriptHealthFailsStrictErrorsWhenDependenciesPresent);
  await runTest("Project Health Check blocks missing fake project", testHealthCheckFakeProjectBlocked);
  await runTest("Workspace project list contains 3 projects", testWorkspaceProjectListContainsThreeProjects);
  await runTest("Workspace can get ai-dev-os by id", testWorkspaceGetAiDevOsById);
  await runTest("Workspace can get ai-dev-os-skills by id", testWorkspaceGetSkillsById);
  await runTest("Workspace can get project-001-resume-ai by id", testWorkspaceGetResumeAiById);
  await runTest("Workspace selects Resume AI goal", testWorkspaceSelectsResumeAiGoal);
  await runTest("Workspace selects protected skill manifest repo goal", testWorkspaceSelectsProtectedSkillsGoal);
  await runTest("Workspace selects protected AI Dev OS sandbox goal", testWorkspaceSelectsProtectedCoreGoal);
  await runTest("Workspace unknown goal requires clarification", testWorkspaceUnknownGoalNeedsClarification);
  await runTest("Workspace resolvePath allows package.json", testWorkspaceResolvePathAllowsProjectFile);
  await runTest("Workspace resolvePath blocks ../ escape", testWorkspaceResolvePathBlocksEscape);
  await runTest("Workspace resolvePath blocks .env", testWorkspaceResolvePathBlocksEnv);
  await runTest("Workspace business goal does not select AI Dev OS core", testWorkspaceBusinessGoalDoesNotSelectCore);
  await runTest("Workspace Manager does not modify Project-001-Resume-AI", testWorkspaceManagerDoesNotModifyResumeAi);
  await runTest("Workspace Manager does not modify AI-Dev-OS-skills", testWorkspaceManagerDoesNotModifySkillsRepo);
  await runTest("ChangeSet preview supports safe create/update in allowed project path", testChangeSetSafeCreateUpdatePreview);
  await runTest("ChangeSet preview blocks .env planned writes", testChangeSetBlocksEnvWrite);
  await runTest("ChangeSet preview blocks ../ path escape", testChangeSetBlocksPathEscape);
  await runTest("ChangeSet preview blocks delete by default", testChangeSetDeleteBlockedByDefault);
  await runTest("ChangeSet preview requires approval for protected project changes", testChangeSetProtectedProjectRequiresApproval);
  await runTest("ChangeSet preview includes required result shape", testChangeSetPreviewIncludesShape);
  await runTest("ChangeSet preview does not modify files", testChangeSetPreviewDoesNotModifyFiles);
  await runTest("Skill Runtime mock github:read action can complete safely", testSkillRuntimeMockGithubReadCompletes);
  await runTest("Skill Runtime github:write requires approval or is blocked", testSkillRuntimeGithubWriteBlocked);
  await runTest("Skill Runtime browser:write requires approval or is blocked", testSkillRuntimeBrowserWriteBlocked);
  await runTest("Skill Runtime computer:act requires approval or is blocked", testSkillRuntimeComputerActBlocked);
  await runTest("Skill Runtime content:create can run as mock/local action", testSkillRuntimeContentCreateCompletes);
  await runTest("Skill Runtime content:publish requires approval or is blocked", testSkillRuntimeContentPublishBlocked);
  await runTest("Skill Runtime result includes required safety shape", testSkillRuntimeResultIncludesRequiredShape);
  await runTest("Skill Runtime unsupported external mode is blocked", testSkillRuntimeExternalModeBlocked);
  await runTest("Skill Runtime performs no real network/browser/computer/shell operation", testSkillRuntimeNoRealOperationsOccur);
  await runTest("GitHub Skill v1 mock github:read can complete offline", testGitHubSkillV1ReadCompletesOffline);
  await runTest("GitHub Skill v1 github:write is planned and approval-gated only", testGitHubSkillV1WriteRequiresApprovalOnly);
  await runTest("GitHub Skill v1 untrusted manifests are blocked", testGitHubSkillV1UntrustedManifestBlocked);
  await runTest("GitHub Skill v1 invalid schema is blocked", testGitHubSkillV1InvalidSchemaBlocked);
  await runTest("GitHub Skill v1 unknown policy is blocked", testGitHubSkillV1UnknownPolicyBlocked);
  await runTest("GitHub Skill v1 validates integrity when available", testGitHubSkillV1IntegrityValidation);
  await runTest("GitHub Skill v1 result includes required action shape", testGitHubSkillV1ResultIncludesRequiredShape);
  await runTest("Ponytail trusted repo accepted as metadata-only source", testPonytailTrustedRepoAcceptedMetadataOnly);
  await runTest("Ponytail coding skill capabilities recognized", testPonytailCodingSkillCapabilitiesRecognized);
  await runTest("Ponytail remote code execution remains blocked", testPonytailRemoteCodeExecutionBlocked);
  await runTest("Ponytail install/script execution remains blocked", testPonytailInstallAndScriptExecutionBlocked);
  await runTest("Untrusted Ponytail-like repo blocked", testUntrustedPonytailLikeRepoBlocked);
  await runTest("Ponytail invalid permissions blocked", testPonytailInvalidPermissionsBlocked);
  await runTest("Pinned Ponytail manifest loads offline", testPinnedPonytailManifestLoadsOffline);
  await runTest("Ponytail registry discovers pinned skill", testPonytailRegistryDiscoversPinnedSkill);
  await runTest("Ponytail pinned capabilities recognized", testPonytailPinnedCapabilitiesRecognized);
  await runTest("Ponytail registry execution is advisory only", testPonytailRegistryExecutionAdvisoryOnly);
  await runTest("Ponytail bad integrity is blocked", testPonytailBadIntegrityBlocked);
  await runTest("Ponytail hook execution remains blocked", testPonytailHookExecutionBlocked);
  await runTest("Sandbox can write safe.txt inside rootDir", testSandboxWritesSafeFile);
  await runTest("Sandbox can read safe.txt inside rootDir", testSandboxReadsSafeFile);
  await runTest("Sandbox can list rootDir", testSandboxListsRootDir);
  await runTest("Sandbox blocks ../outside.txt path escape", testSandboxBlocksPathEscape);
  await runTest("Sandbox blocks .env read", testSandboxBlocksEnvRead);
  await runTest("Sandbox blocks .env write", testSandboxBlocksEnvWrite);
  await runTest("Sandbox rejects delete by default", testSandboxRejectsDeleteByDefault);
  await runTest("Sandbox blocks Project-001-Resume-AI path", testSandboxBlocksBusinessProjectPath);
  await runTest("Sandbox executor does not execute shell", testSandboxExecutorDoesNotExecuteShell);
  await runTest("Sandbox executor does not execute network", testSandboxExecutorDoesNotExecuteNetwork);
  await runTest("Sandbox executor does not execute browser", testSandboxExecutorDoesNotExecuteBrowser);
  await runTest("github-search-skill can generate dry-run plan", testGithubSearchDryRunPlan);
  await runTest("auto-readme-generator can generate dry-run plan", testReadmeDryRunPlan);
  await runTest("code-refactor-skill can generate dry-run plan", testCodeRefactorDryRunPlan);
  await runTest("shell:execute dry-run plan is blocked", testShellExecuteDryRunBlocked);
  await runTest("browser:write dry-run plan is blocked", testBrowserWriteDryRunBlocked);
  await runTest("Unknown skill dry-run plan requires approval", testUnknownSkillDryRunRequiresApproval);
  await runTest("Dry-run plan does not modify files", testDryRunPlanDoesNotModifyFiles);
  await runTest("Dry-run plan does not execute remote code", testDryRunPlanDoesNotExecuteRemoteCode);
  await runTest("V4.4.4 permission policy tests still pass", testV444PolicyStillPasses);
  await runTest("Legal permissions can pass policy validation", testLegalPermissionsPass);
  await runTest("Unknown permission fails policy validation", testUnknownPermissionFails);
  await runTest("Unknown capability fails policy validation", testUnknownCapabilityFails);
  await runTest("Capability missing required permission fails", testMissingRequiredPermissionFails);
  await runTest("shell:execute is disabled in V4.4.4", testShellExecuteDisabled);
  await runTest("browser:write is disabled in V4.4.4", testBrowserWriteDisabled);
  await runTest("Trusted repo fetches index.json with sha256 integrity", testTrustedRepoFetchesIndexWithIntegrity);
  await runTest("Trusted repo fetches 3 skill.json files with sha256 integrity", testTrustedRepoFetchesSkillManifestsWithIntegrity);
  await runTest("Manifest versions match lock", testManifestVersionsMatchLock);
  await runTest("Manifest names match lock", testManifestNamesMatchLock);
  await runTest("Trusted repo manifests pass policy validation", testTrustedRepoManifestsPassPolicy);
  await runTest("Wrong sha256 fails integrity check", testWrongShaFails);
  await runTest("Version mismatch fails", testVersionMismatchFails);
  await runTest("Untrusted repo is rejected", testUntrustedRepoRejected);
  await runTest("Manifest skills can batch register", testManifestSkillsBatchRegistration);
  await runTest("Manifest skill execution is placeholder only", testManifestSkillExecutionPlaceholder);
  await runTest("GitHub push helper classifies connection reset as retryable network issue", testGitHubPushConnectionResetClassifiedAsNetworkRetry);
  await runTest("GitHub push helper classifies port 443 connection failure", testGitHubPushPort443ClassifiedAsNetwork);
  await runTest("GitHub push helper classifies DNS failure", testGitHubPushDnsFailureClassified);
  await runTest("GitHub push helper classifies authentication failure", testGitHubPushAuthenticationFailureClassified);
  await runTest("GitHub push helper classifies permission denied", testGitHubPushPermissionDeniedClassified);
  await runTest("GitHub push helper classifies non-fast-forward", testGitHubPushNonFastForwardClassified);
  await runTest("GitHub push helper classifies remote rejected", testGitHubPushRemoteRejectedClassified);
  await runTest("GitHub push helper classifies successful push output", testGitHubPushSuccessClassified);
  await runTest("GitHub push helper classifies unknown errors", testGitHubPushUnknownErrorClassified);
  await runTest("V4.3 verification still passes", testV43StillPasses);

  const passed = results.filter((result) => result.status === "PASS").length;
  const failed = results.filter((result) => result.status === "FAIL").length;

  console.log("");
  console.log("Final:");
  console.log(`- Passed: ${passed}`);
  console.log(`- Failed: ${failed}`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  record("FAIL", "Verification runner", message);
  console.log("");
  console.log("Final:");
  console.log(`- Passed: ${results.filter((result) => result.status === "PASS").length}`);
  console.log(`- Failed: ${results.filter((result) => result.status === "FAIL").length}`);
  process.exitCode = 1;
});
