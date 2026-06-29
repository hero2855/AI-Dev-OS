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
  runBrowserSkillV1Request,
  runComputerSkillV1Request,
  createScheduledWorkflowPlan,
  createPlatformPublisherPlan,
  createReplyMonitorPlan,
  createContentFollowUpPlan,
  createUnattendedWorkflowRunnerPlan,
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

async function testBrowserSkillV1ReadMockPlanWorks(): Promise<string> {
  const result = runBrowserSkillV1Request({
    goal: "read a local mock page",
    mode: "mock",
    action: {
      type: "browser:read",
      description: "Read a mock/local page snapshot.",
      input: { url: "mock://local/page" },
    },
  });

  assert(result.status === "completed", `Expected completed browser:read, got ${result.status}`);
  assert(result.actionType === "browser:read", `Unexpected action type: ${result.actionType}`);
  assert(result.riskLevel === "low", `Expected low risk, got ${result.riskLevel}`);
  assert(result.requiresApproval === false, "browser:read mock/local plan should not require approval");
  assert(result.permissions.includes("browser:read"), "browser:read permission should be reported");
  assert(result.capabilities.includes("browser_read"), "browser_read capability should be reported");
  assert(result.plannedAction.advisoryOnly === true, "Browser Skill v1 read should be advisory only");
  assert(result.auditSummary.realBrowserOperation === false, "browser:read must not perform real browser work");
  assert(result.auditSummary.realNetworkOperation === false, "browser:read must not perform real network work");

  return result.summary;
}

async function testBrowserSkillV1WriteRequiresApproval(): Promise<string> {
  const result = runBrowserSkillV1Request({
    goal: "plan browser write",
    mode: "mock",
    action: {
      type: "browser:write",
      description: "Plan a browser write without executing it.",
    },
  });

  assert(result.status === "blocked" || result.status === "requires_approval", `Expected blocked/approval browser:write, got ${result.status}`);
  assert(result.requiresApproval === true, "browser:write should require approval");
  assert(result.riskLevel === "blocked", `Expected blocked risk, got ${result.riskLevel}`);
  assert(result.permissions.includes("browser:write"), "browser:write permission should be reported");
  assert(result.capabilities.includes("browser_write"), "browser_write capability should be reported");
  assert(result.plannedAction.realOperationPerformed === false, "browser:write should only return a planned action");
  assert(result.summary.includes("No real browser action was performed"), `Unexpected summary: ${result.summary}`);

  return "Browser Skill v1 browser:write is approval-gated/planned only";
}

async function testBrowserSkillV1PublishingIntentsApprovalGated(): Promise<string> {
  const cases = [
    { label: "publish", description: "Plan to publish a post from a browser." },
    { label: "comment", description: "Plan to comment on a browser page." },
    { label: "reply", description: "Plan to reply to a browser thread." },
    { label: "upload", description: "Plan to upload a file through a browser." },
  ];

  for (const item of cases) {
    const result = runBrowserSkillV1Request({
      goal: `plan browser ${item.label}`,
      mode: "mock",
      action: {
        type: "browser:write",
        description: item.description,
      },
    });

    assert(result.status === "blocked" || result.status === "requires_approval", `${item.label} should be blocked/approval-gated, got ${result.status}`);
    assert(result.requiresApproval === true, `${item.label} should require approval`);
    assert(
      result.blockedReasons.some((reason) => reason.toLowerCase().includes(item.label)),
      `${item.label} blocked reasons should mention the intent: ${result.blockedReasons.join(", ")}`,
    );
    assert(result.auditSummary.realPublishOperation === false, `${item.label} must not publish`);
    assert(result.auditSummary.realBrowserOperation === false, `${item.label} must not use a real browser`);
  }

  return "Browser publish/comment/reply/upload intents are blocked or approval-gated";
}

async function testBrowserSkillV1ResultIncludesRequiredShape(): Promise<string> {
  const result = runBrowserSkillV1Request({
    goal: "inspect browser result shape",
    mode: "local",
    action: {
      type: "browser:read",
      description: "Read local browser fixture.",
    },
    capabilities: ["browser_fixture_read"],
    permissions: ["browser:read"],
  });

  assert(typeof result.riskLevel === "string", "Result should include riskLevel");
  assert(typeof result.requiresApproval === "boolean", "Result should include requiresApproval");
  assert(Array.isArray(result.blockedReasons), "Result should include blockedReasons");
  assert(Array.isArray(result.permissions), "Result should include permissions");
  assert(Array.isArray(result.capabilities), "Result should include capabilities");
  assert(typeof result.summary === "string" && result.summary.length > 0, "Result should include summary");
  assert(result.permissions.includes("browser:read"), "Result should include browser:read permission");
  assert(result.capabilities.includes("browser_read"), "Result should include browser_read capability");
  assert(result.capabilities.includes("browser_fixture_read"), "Result should include requested capability");

  return "Browser Skill v1 result includes risk, approval, blocked reasons, permissions, capabilities, and summary";
}

async function testBrowserSkillV1ExternalRuntimeBlocked(): Promise<string> {
  const result = runBrowserSkillV1Request({
    goal: "try external browser runtime",
    mode: "external",
    action: {
      type: "browser:read",
      description: "Read using an external browser runtime.",
    },
  });

  assert(result.status === "blocked", `Expected blocked external browser runtime, got ${result.status}`);
  assert(result.requiresApproval === true, "External browser runtime should require approval/blocking");
  assert(
    result.blockedReasons.includes("External browser runtime is disabled in Browser Skill v1"),
    `Missing external browser block reason: ${result.blockedReasons.join(", ")}`,
  );

  return "External browser runtime blocked";
}

async function testBrowserSkillV1NoRealOperationsOccur(): Promise<string> {
  const before = spawnSync("git", ["status", "--short"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert(before.status === 0, `git status before browser adapter failed: ${before.stderr}`);

  const result = runBrowserSkillV1Request({
    goal: "browser no-op audit",
    mode: "mock",
    action: {
      type: "browser:read",
      description: "Read mock browser fixture only.",
    },
  });

  const after = spawnSync("git", ["status", "--short"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert(after.status === 0, `git status after browser adapter failed: ${after.stderr}`);
  assert(after.stdout === before.stdout, `Browser adapter changed git status:\nBefore:\n${before.stdout}\nAfter:\n${after.stdout}`);
  assert(result.auditSummary.realNetworkOperation === false, "Browser Skill v1 must not perform network operations");
  assert(result.auditSummary.realBrowserOperation === false, "Browser Skill v1 must not perform browser operations");
  assert(result.auditSummary.realComputerOperation === false, "Browser Skill v1 must not perform computer operations");
  assert(result.auditSummary.realShellOperation === false, "Browser Skill v1 must not perform shell operations");
  assert(result.auditSummary.realPublishOperation === false, "Browser Skill v1 must not perform publish operations");

  return "Browser Skill v1 performed no real network/browser/computer/shell/publish operation";
}

async function testComputerSkillV1ObserveMockPlanWorks(): Promise<string> {
  const result = runComputerSkillV1Request({
    goal: "observe local mock screen",
    mode: "mock",
    action: {
      type: "computer:observe",
      description: "Observe a mock/local screen snapshot.",
      input: { screen: "mock://local/screen" },
    },
  });

  assert(result.status === "completed", `Expected completed computer:observe, got ${result.status}`);
  assert(result.actionType === "computer:observe", `Unexpected action type: ${result.actionType}`);
  assert(result.riskLevel === "medium", `Expected medium risk, got ${result.riskLevel}`);
  assert(result.requiresApproval === false, "computer:observe mock/local plan should not require approval");
  assert(result.permissions.includes("computer:observe"), "computer:observe permission should be reported");
  assert(result.capabilities.includes("computer_observe"), "computer_observe capability should be reported");
  assert(result.plannedAction.advisoryOnly === true, "Computer Use Skill v1 observe should be advisory only");
  assert(result.auditSummary.realComputerOperation === false, "computer:observe must not perform real computer work");
  assert(result.auditSummary.realBrowserOperation === false, "computer:observe must not perform browser work");
  assert(result.auditSummary.realNetworkOperation === false, "computer:observe must not perform network work");

  return result.summary;
}

async function testComputerSkillV1ActRequiresApproval(): Promise<string> {
  const result = runComputerSkillV1Request({
    goal: "plan computer action",
    mode: "mock",
    action: {
      type: "computer:act",
      description: "Plan a computer action without executing it.",
    },
  });

  assert(result.status === "blocked" || result.status === "requires_approval", `Expected blocked/approval computer:act, got ${result.status}`);
  assert(result.requiresApproval === true, "computer:act should require approval");
  assert(result.riskLevel === "blocked", `Expected blocked risk, got ${result.riskLevel}`);
  assert(result.permissions.includes("computer:act"), "computer:act permission should be reported");
  assert(result.capabilities.includes("computer_act"), "computer_act capability should be reported");
  assert(result.plannedAction.realOperationPerformed === false, "computer:act should only return a planned action");
  assert(result.summary.includes("No real computer action was performed"), `Unexpected summary: ${result.summary}`);

  return "Computer Use Skill v1 computer:act is approval-gated/planned only";
}

async function testComputerSkillV1HighRiskActionsBlocked(): Promise<string> {
  const cases = [
    { label: "click", description: "Plan to click a desktop button." },
    { label: "type", description: "Plan to type into a desktop text field." },
    { label: "submit", description: "Plan to submit a desktop form." },
    { label: "upload", description: "Plan to upload a file from the computer." },
  ];

  for (const item of cases) {
    const result = runComputerSkillV1Request({
      goal: `plan computer ${item.label}`,
      mode: "mock",
      action: {
        type: "computer:act",
        description: item.description,
      },
    });

    assert(result.status === "blocked" || result.status === "requires_approval", `${item.label} should be blocked/approval-gated, got ${result.status}`);
    assert(result.requiresApproval === true, `${item.label} should require approval`);
    assert(
      result.blockedReasons.some((reason) => reason.toLowerCase().includes(item.label)),
      `${item.label} blocked reasons should mention the intent: ${result.blockedReasons.join(", ")}`,
    );
    assert(result.auditSummary.realComputerOperation === false, `${item.label} must not use a real computer`);
    assert(result.auditSummary.realBrowserOperation === false, `${item.label} must not use a real browser`);
  }

  return "Computer click/type/submit/upload intents are blocked or approval-gated";
}

async function testComputerSkillV1DangerousActionsBlocked(): Promise<string> {
  const cases = [
    { label: "delete", description: "Plan to delete a local item." },
    { label: "pay", description: "Plan to pay an invoice." },
    { label: "send", description: "Plan to send messages." },
    { label: "login", description: "Plan to login to an app." },
    { label: "system-setting", description: "Plan to change system settings." },
  ];

  for (const item of cases) {
    const result = runComputerSkillV1Request({
      goal: `plan computer ${item.label}`,
      mode: "mock",
      action: {
        type: "computer:act",
        description: item.description,
      },
    });

    assert(result.status === "blocked", `${item.label} should be blocked, got ${result.status}`);
    assert(result.requiresApproval === true, `${item.label} should require approval`);
    assert(
      result.blockedReasons.some((reason) => reason.toLowerCase().includes(item.label)),
      `${item.label} blocked reasons should mention the intent: ${result.blockedReasons.join(", ")}`,
    );
    assert(result.auditSummary.realComputerOperation === false, `${item.label} must not use a real computer`);
    assert(result.plannedAction.realOperationPerformed === false, `${item.label} should only be planned`);
  }

  return "Computer delete/pay/send/login/system-setting intents are blocked";
}

async function testComputerSkillV1ResultIncludesRequiredShape(): Promise<string> {
  const result = runComputerSkillV1Request({
    goal: "inspect computer result shape",
    mode: "local",
    action: {
      type: "computer:observe",
      description: "Observe local computer fixture.",
    },
    capabilities: ["computer_fixture_observe"],
    permissions: ["computer:observe"],
  });

  assert(typeof result.riskLevel === "string", "Result should include riskLevel");
  assert(typeof result.requiresApproval === "boolean", "Result should include requiresApproval");
  assert(Array.isArray(result.blockedReasons), "Result should include blockedReasons");
  assert(Array.isArray(result.permissions), "Result should include permissions");
  assert(Array.isArray(result.capabilities), "Result should include capabilities");
  assert(typeof result.summary === "string" && result.summary.length > 0, "Result should include summary");
  assert(result.permissions.includes("computer:observe"), "Result should include computer:observe permission");
  assert(result.capabilities.includes("computer_observe"), "Result should include computer_observe capability");
  assert(result.capabilities.includes("computer_fixture_observe"), "Result should include requested capability");

  return "Computer Use Skill v1 result includes risk, approval, blocked reasons, permissions, capabilities, and summary";
}

async function testComputerSkillV1ExternalRuntimeBlocked(): Promise<string> {
  const result = runComputerSkillV1Request({
    goal: "try external computer runtime",
    mode: "external",
    action: {
      type: "computer:observe",
      description: "Observe using an external computer runtime.",
    },
  });

  assert(result.status === "blocked", `Expected blocked external computer runtime, got ${result.status}`);
  assert(result.requiresApproval === true, "External computer runtime should require approval/blocking");
  assert(
    result.blockedReasons.includes("External computer runtime is disabled in Computer Use Skill v1"),
    `Missing external computer block reason: ${result.blockedReasons.join(", ")}`,
  );

  return "External computer runtime blocked";
}

async function testComputerSkillV1NoRealOperationsOccur(): Promise<string> {
  const before = spawnSync("git", ["status", "--short"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert(before.status === 0, `git status before computer adapter failed: ${before.stderr}`);

  const result = runComputerSkillV1Request({
    goal: "computer no-op audit",
    mode: "mock",
    action: {
      type: "computer:observe",
      description: "Observe mock computer fixture only.",
    },
  });

  const after = spawnSync("git", ["status", "--short"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert(after.status === 0, `git status after computer adapter failed: ${after.stderr}`);
  assert(after.stdout === before.stdout, `Computer adapter changed git status:\nBefore:\n${before.stdout}\nAfter:\n${after.stdout}`);
  assert(result.auditSummary.realNetworkOperation === false, "Computer Use Skill v1 must not perform network operations");
  assert(result.auditSummary.realBrowserOperation === false, "Computer Use Skill v1 must not perform browser operations");
  assert(result.auditSummary.realComputerOperation === false, "Computer Use Skill v1 must not perform computer operations");
  assert(result.auditSummary.realShellOperation === false, "Computer Use Skill v1 must not perform shell operations");
  assert(result.auditSummary.realPublishOperation === false, "Computer Use Skill v1 must not perform publish operations");

  return "Computer Use Skill v1 performed no real network/browser/computer/shell/publish operation";
}

async function testScheduledWorkflowDeterministicPlan(): Promise<string> {
  const input = {
    workflowName: "daily-content-draft",
    goal: "Create a draft and inspect source material later.",
    schedule: {
      type: "one-time" as const,
      runAt: "2026-07-01T09:00:00.000Z",
      timezone: "UTC",
    },
    steps: [
      {
        id: "draft",
        type: "content:create",
        description: "Create a local draft.",
      },
      {
        id: "research",
        type: "browser:read",
        description: "Read a mock/local source snapshot.",
      },
    ],
  };
  const first = createScheduledWorkflowPlan(input);
  const second = createScheduledWorkflowPlan(input);

  assert(first.workflowId === second.workflowId, "Scheduled workflow id should be deterministic");
  assert(first.schedule.type === "one-time", `Expected one-time schedule, got ${first.schedule.type}`);
  assert(first.steps.length === 2, `Expected 2 steps, got ${first.steps.length}`);
  assert(first.riskLevel === "low", `Expected low risk, got ${first.riskLevel}`);
  assert(first.requiresApproval === false, "Low-risk one-time plan should not require approval");
  assert(first.auditSummary.realTimerOperation === false, "Scheduled workflow must not create a real timer");
  assert(first.auditSummary.realSchedulerOperation === false, "Scheduled workflow must not create an OS scheduler task");

  return `Deterministic scheduled workflow plan id: ${first.workflowId}`;
}

async function testScheduledWorkflowRecurringPlanRepresented(): Promise<string> {
  const result = createScheduledWorkflowPlan({
    workflowName: "weekly-reply-monitor",
    goal: "Represent a recurring monitoring and follow-up workflow.",
    schedule: {
      type: "recurring",
      startsAt: "2026-07-06T10:00:00.000Z",
      timezone: "Asia/Shanghai",
      interval: "weekly",
      maxOccurrences: 4,
    },
    steps: [
      {
        id: "observe",
        type: "computer:observe",
        description: "Observe a mock/local inbox state.",
      },
      {
        id: "follow-up",
        type: "content:create",
        description: "Create follow-up content draft.",
      },
    ],
  });

  assert(result.schedule.type === "recurring", `Expected recurring schedule, got ${result.schedule.type}`);
  assert(result.schedule.type === "recurring" && result.schedule.interval === "weekly", "Recurring interval should be weekly");
  assert(result.schedule.type === "recurring" && result.schedule.maxOccurrences === 4, "Recurring max occurrences should be represented");
  assert(result.steps.every((step) => step.plannedOnly === true), "All recurring workflow steps should be planned only");
  assert(result.auditSummary.realTimerOperation === false, "Recurring workflow must not create a real timer");
  assert(result.auditSummary.realSchedulerOperation === false, "Recurring workflow must not create an OS scheduler task");

  return "Recurring scheduled workflow metadata represented";
}

async function testScheduledWorkflowHighRiskStepsRequireApproval(): Promise<string> {
  const result = createScheduledWorkflowPlan({
    workflowName: "approval-gated-publishing-flow",
    goal: "Plan future publish and reply workflow after approval.",
    schedule: {
      type: "one-time",
      runAt: "2026-07-02T12:00:00.000Z",
    },
    steps: [
      {
        id: "browser-write",
        type: "browser:write",
        description: "Plan a future browser write without executing it.",
      },
      {
        id: "computer-act",
        type: "computer:act",
        description: "Plan a future computer action without executing it.",
      },
      {
        id: "publish",
        type: "content:publish",
        description: "Plan future content publishing only.",
      },
      {
        id: "reply",
        type: "content:reply",
        description: "Plan future reply content only.",
      },
    ],
  });

  assert(result.requiresApproval === true, "High-risk scheduled workflow should require approval");
  assert(result.riskLevel === "blocked", `Expected blocked aggregate risk, got ${result.riskLevel}`);
  assert(result.steps.every((step) => step.requiresApproval === true), "High-risk steps should require approval");
  assert(result.steps.every((step) => step.plannedOnly === true), "High-risk steps should remain planned only");
  assert(result.steps.every((step) => step.status === "requires_approval"), `Unexpected step statuses: ${result.steps.map((step) => step.status).join(", ")}`);
  assert(result.auditSummary.realPublishOperation === false, "Scheduled workflow must not publish");
  assert(result.auditSummary.realBrowserOperation === false, "Scheduled workflow must not run browser actions");
  assert(result.auditSummary.realComputerOperation === false, "Scheduled workflow must not run computer actions");

  return "Scheduled workflow high-risk browser/computer/publish/reply steps require approval and remain planned only";
}

async function testScheduledWorkflowResultIncludesRequiredShape(): Promise<string> {
  const result = createScheduledWorkflowPlan({
    goal: "Inspect scheduled workflow result shape.",
    schedule: {
      type: "one-time",
      runAt: "2026-07-03T08:30:00.000Z",
    },
    steps: [
      {
        type: "content:schedule",
        description: "Prepare content schedule preview only.",
      },
    ],
  });

  assert(result.schedule.type === "one-time", "Result should include schedule");
  assert(Array.isArray(result.steps) && result.steps.length === 1, "Result should include steps");
  assert(typeof result.riskLevel === "string", "Result should include riskLevel");
  assert(typeof result.requiresApproval === "boolean", "Result should include requiresApproval");
  assert(Array.isArray(result.blockedReasons), "Result should include blockedReasons");
  assert(typeof result.summary === "string" && result.summary.length > 0, "Result should include summary");
  assert(result.steps[0].permissions.includes("content:schedule:preview"), "Step should include permissions");
  assert(result.steps[0].capabilities.includes("content_schedule"), "Step should include capabilities");

  return "Scheduled workflow result includes schedule, steps, risk, approval, blocked reasons, and summary";
}

async function testScheduledWorkflowUnsafeStepsBlockedOrApprovalGated(): Promise<string> {
  const result = createScheduledWorkflowPlan({
    workflowName: "unsafe-action-preview",
    goal: "Attempt unsafe future actions.",
    schedule: {
      type: "one-time",
      runAt: "2026-07-04T11:00:00.000Z",
    },
    steps: [
      {
        id: "unsafe-browser",
        type: "browser:write",
        description: "Plan to click, type, submit, upload, and login through a browser.",
      },
      {
        id: "unsafe-computer",
        type: "computer:act",
        description: "Plan to pay, delete, and send messages from the computer.",
      },
      {
        id: "unsupported",
        type: "network:write",
        description: "Attempt unsupported remote write.",
      },
    ],
  });

  assert(result.requiresApproval === true, "Unsafe workflow should require approval");
  assert(result.riskLevel === "blocked", `Expected blocked risk, got ${result.riskLevel}`);
  assert(result.steps.every((step) => step.status === "blocked"), `Expected blocked steps, got ${result.steps.map((step) => step.status).join(", ")}`);
  assert(
    result.blockedReasons.some((reason) => reason.toLowerCase().includes("click")),
    `Blocked reasons should mention click: ${result.blockedReasons.join(", ")}`,
  );
  assert(
    result.blockedReasons.some((reason) => reason.toLowerCase().includes("pay")),
    `Blocked reasons should mention pay: ${result.blockedReasons.join(", ")}`,
  );
  assert(
    result.blockedReasons.some((reason) => reason.includes("Unsupported scheduled workflow step")),
    `Blocked reasons should mention unsupported step: ${result.blockedReasons.join(", ")}`,
  );

  return "Scheduled workflow unsafe steps are blocked or approval-gated";
}

async function testScheduledWorkflowNoRealOperationsOccur(): Promise<string> {
  const before = spawnSync("git", ["status", "--short"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert(before.status === 0, `git status before scheduled workflow failed: ${before.stderr}`);

  const result = createScheduledWorkflowPlan({
    workflowName: "no-op-scheduled-workflow",
    goal: "Create a no-op scheduled workflow plan.",
    schedule: {
      type: "recurring",
      startsAt: "2026-07-05T07:00:00.000Z",
      interval: "daily",
    },
    steps: [
      {
        id: "draft",
        type: "content:create",
        description: "Create a draft plan only.",
      },
      {
        id: "observe",
        type: "computer:observe",
        description: "Observe mock/local state only.",
      },
    ],
  });

  const after = spawnSync("git", ["status", "--short"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert(after.status === 0, `git status after scheduled workflow failed: ${after.stderr}`);
  assert(after.stdout === before.stdout, `Scheduled workflow changed git status:\nBefore:\n${before.stdout}\nAfter:\n${after.stdout}`);
  assert(result.auditSummary.realTimerOperation === false, "Scheduled workflow must not create real timers");
  assert(result.auditSummary.realSchedulerOperation === false, "Scheduled workflow must not create real OS scheduler tasks");
  assert(result.auditSummary.realNetworkOperation === false, "Scheduled workflow must not perform network operations");
  assert(result.auditSummary.realBrowserOperation === false, "Scheduled workflow must not perform browser operations");
  assert(result.auditSummary.realComputerOperation === false, "Scheduled workflow must not perform computer operations");
  assert(result.auditSummary.realShellOperation === false, "Scheduled workflow must not perform shell operations");
  assert(result.auditSummary.realPublishOperation === false, "Scheduled workflow must not perform publish operations");

  return "Scheduled workflow agent performed no real timer/scheduler/network/browser/computer/shell/publish operation";
}

async function testPlatformPublisherDeterministicPlan(): Promise<string> {
  const input = {
    platform: "xiaohongshu",
    goal: "Plan a post publication.",
    post: {
      title: "Launch note",
      body: "Draft body",
      tags: ["ai-dev-os", "planning"],
      media: ["mock://asset/image.png"],
      scheduledAt: "2026-07-08T09:00:00.000Z",
    },
  };
  const first = createPlatformPublisherPlan(input);
  const second = createPlatformPublisherPlan(input);

  assert(first.planId === second.planId, "Platform publisher plan id should be deterministic");
  assert(first.platform === "xiaohongshu", `Unexpected platform: ${first.platform}`);
  assert(first.steps.length === 9, `Expected default 9 publish steps, got ${first.steps.length}`);
  assert(first.riskLevel === "high", `Expected high risk for planned publish flow, got ${first.riskLevel}`);
  assert(first.requiresApproval === true, "Platform publish plan should require approval");
  assert(first.blockedReasons.length === 0, `Supported default publish plan should not be blocked: ${first.blockedReasons.join(", ")}`);
  assert(first.steps.every((step) => step.status === "requires_approval"), "All default publish steps should require approval");
  assert(first.steps.every((step) => step.plannedOnly === true), "All default publish steps should be planned only");

  return `Deterministic platform publish plan id: ${first.planId}`;
}

async function testPlatformPublisherSupportsGenericPlatforms(): Promise<string> {
  const platforms = ["xiaohongshu", "douyin", "wechat_public_account", "generic_web_platform"];

  for (const platform of platforms) {
    const result = createPlatformPublisherPlan({
      platform,
      goal: `Plan publish flow for ${platform}.`,
    });

    assert(result.platform === platform, `Unexpected platform: ${result.platform}`);
    assert(result.requiresApproval === true, `${platform} should require approval`);
    assert(result.blockedReasons.length === 0, `${platform} should be supported: ${result.blockedReasons.join(", ")}`);
    assert(result.permissions.includes("content:publish"), `${platform} should include content:publish permission`);
    assert(result.capabilities.includes("platform_publish_planning"), `${platform} should include platform publish planning capability`);
  }

  return `Platform publisher supports: ${platforms.join(", ")}`;
}

async function testPlatformPublisherPublishSubmitUploadLoginRequireApproval(): Promise<string> {
  const result = createPlatformPublisherPlan({
    platform: "douyin",
    goal: "Plan upload and publish steps.",
    steps: [
      {
        id: "login-state",
        type: "check_login_state",
        description: "Check login state without logging in.",
      },
      {
        id: "upload",
        type: "upload_media",
        description: "Plan media upload only.",
      },
      {
        id: "submit",
        type: "submit_publish",
        description: "Plan submit/publish only.",
      },
    ],
  });

  assert(result.requiresApproval === true, "Publish/upload/login-state plan should require approval");
  assert(result.steps.every((step) => step.requiresApproval === true), "Each publish step should require approval");
  assert(result.steps.every((step) => step.status === "requires_approval"), `Unexpected statuses: ${result.steps.map((step) => step.status).join(", ")}`);
  assert(result.steps.every((step) => step.plannedOnly === true), "Each publish step should remain planned only");
  assert(result.blockedReasons.length === 0, `Approval-gated publish steps should not be blocked: ${result.blockedReasons.join(", ")}`);
  assert(result.auditSummary.realPublishOperation === false, "Publish plan must not publish");
  assert(result.auditSummary.realBrowserOperation === false, "Publish plan must not run browser");
  assert(result.auditSummary.realComputerOperation === false, "Publish plan must not run computer");

  return "Platform publish/submit/upload/login-state steps require approval and remain planned only";
}

async function testPlatformPublisherUnsupportedPlatformBlocked(): Promise<string> {
  const result = createPlatformPublisherPlan({
    platform: "unsupported_platform",
    goal: "Plan unsupported platform publish.",
  });

  assert(result.riskLevel === "blocked", `Expected blocked risk, got ${result.riskLevel}`);
  assert(result.requiresApproval === true, "Unsupported platform should require approval/blocking");
  assert(
    result.blockedReasons.includes("Unsupported platform: unsupported_platform"),
    `Missing unsupported platform reason: ${result.blockedReasons.join(", ")}`,
  );
  assert(result.plannedOnly === true, "Unsupported platform result should still be planned only");

  return "Unsupported platform publisher plan blocked";
}

async function testPlatformPublisherResultIncludesRequiredShape(): Promise<string> {
  const result = createPlatformPublisherPlan({
    platform: "wechat_public_account",
    goal: "Inspect publisher result shape.",
  });

  assert(result.platform === "wechat_public_account", "Result should include platform");
  assert(Array.isArray(result.steps) && result.steps.length > 0, "Result should include steps");
  assert(typeof result.riskLevel === "string", "Result should include riskLevel");
  assert(typeof result.requiresApproval === "boolean", "Result should include requiresApproval");
  assert(Array.isArray(result.blockedReasons), "Result should include blockedReasons");
  assert(Array.isArray(result.permissions) && result.permissions.length > 0, "Result should include permissions");
  assert(Array.isArray(result.capabilities) && result.capabilities.length > 0, "Result should include capabilities");
  assert(typeof result.summary === "string" && result.summary.length > 0, "Result should include summary");

  return "Platform publisher result includes platform, steps, risk, approval, blocked reasons, permissions, capabilities, and summary";
}

async function testPlatformPublisherIntegratesWithScheduledWorkflow(): Promise<string> {
  const publisherPlan = createPlatformPublisherPlan({
    platform: "generic_web_platform",
    goal: "Plan scheduled generic web publish.",
  });
  const workflow = createScheduledWorkflowPlan({
    workflowName: "scheduled-platform-publish",
    goal: "Schedule a planned platform publish.",
    schedule: {
      type: "one-time",
      runAt: "2026-07-09T10:00:00.000Z",
    },
    steps: [
      {
        id: "publish",
        type: "content:publish",
        description: "Run planned platform publisher after approval.",
        publisherPlan: {
          planId: publisherPlan.planId,
          platform: publisherPlan.platform,
          plannedOnly: true,
        },
      },
    ],
  });
  const [publishStep] = workflow.steps;

  assert(workflow.requiresApproval === true, "Scheduled publisher workflow should require approval");
  assert(publishStep.type === "content:publish", `Unexpected scheduled step type: ${publishStep.type}`);
  assert(publishStep.publisherPlan?.planId === publisherPlan.planId, "Scheduled workflow should carry publisher plan id");
  assert(publishStep.publisherPlan?.platform === "generic_web_platform", "Scheduled workflow should carry publisher platform");
  assert(publishStep.publisherPlan?.plannedOnly === true, "Publisher plan handoff should be planned only");
  assert(workflow.auditSummary.realSchedulerOperation === false, "Publisher scheduled workflow must not create scheduler");
  assert(workflow.auditSummary.realPublishOperation === false, "Publisher scheduled workflow must not publish");

  return "Platform publisher integrates with scheduled content:publish steps as planned-only metadata";
}

async function testPlatformPublisherUnsafeStepsBlocked(): Promise<string> {
  const result = createPlatformPublisherPlan({
    platform: "xiaohongshu",
    goal: "Attempt unsafe publisher actions.",
    steps: [
      {
        id: "unsafe-login",
        type: "open_platform",
        description: "Login to the account.",
      },
      {
        id: "unsafe-comment",
        type: "preview_post",
        description: "Comment and reply after preview.",
      },
      {
        id: "unsupported-step",
        type: "direct_message",
        description: "Send a direct message.",
      },
    ],
  });

  assert(result.riskLevel === "blocked", `Expected blocked risk, got ${result.riskLevel}`);
  assert(result.requiresApproval === true, "Unsafe publisher plan should require approval/blocking");
  assert(result.steps.every((step) => step.status === "blocked"), `Expected blocked steps, got ${result.steps.map((step) => step.status).join(", ")}`);
  assert(
    result.blockedReasons.some((reason) => reason.toLowerCase().includes("login")),
    `Blocked reasons should mention login: ${result.blockedReasons.join(", ")}`,
  );
  assert(
    result.blockedReasons.some((reason) => reason.toLowerCase().includes("comment")),
    `Blocked reasons should mention comment: ${result.blockedReasons.join(", ")}`,
  );
  assert(
    result.blockedReasons.some((reason) => reason.includes("Unsupported platform publish step")),
    `Blocked reasons should mention unsupported step: ${result.blockedReasons.join(", ")}`,
  );

  return "Platform publisher unsafe login/comment/reply/send steps are blocked";
}

async function testPlatformPublisherNoRealOperationsOccur(): Promise<string> {
  const before = spawnSync("git", ["status", "--short"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert(before.status === 0, `git status before publisher adapter failed: ${before.stderr}`);

  const result = createPlatformPublisherPlan({
    platform: "generic_web_platform",
    goal: "Create no-op publisher plan.",
  });

  const after = spawnSync("git", ["status", "--short"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert(after.status === 0, `git status after publisher adapter failed: ${after.stderr}`);
  assert(after.stdout === before.stdout, `Publisher adapter changed git status:\nBefore:\n${before.stdout}\nAfter:\n${after.stdout}`);
  assert(result.auditSummary.realNetworkOperation === false, "Publisher must not perform network operations");
  assert(result.auditSummary.realBrowserOperation === false, "Publisher must not perform browser operations");
  assert(result.auditSummary.realComputerOperation === false, "Publisher must not perform computer operations");
  assert(result.auditSummary.realShellOperation === false, "Publisher must not perform shell operations");
  assert(result.auditSummary.realSchedulerOperation === false, "Publisher must not perform scheduler operations");
  assert(result.auditSummary.realPublishOperation === false, "Publisher must not perform publish operations");

  return "Platform publisher performed no real network/browser/computer/shell/scheduler/publish operation";
}

async function testReplyMonitorDeterministicPlan(): Promise<string> {
  const input = {
    platform: "xiaohongshu",
    goal: "Plan comment monitoring and reply drafting.",
    monitorWindow: {
      startsAt: "2026-07-10T09:00:00.000Z",
      endsAt: "2026-07-10T10:00:00.000Z",
      timezone: "Asia/Shanghai",
    },
  };
  const first = createReplyMonitorPlan(input);
  const second = createReplyMonitorPlan(input);

  assert(first.planId === second.planId, "Reply monitor plan id should be deterministic");
  assert(first.platform === "xiaohongshu", `Unexpected platform: ${first.platform}`);
  assert(first.steps.length === 8, `Expected default 8 monitor steps, got ${first.steps.length}`);
  assert(first.riskLevel === "high", `Expected high risk for planned reply action, got ${first.riskLevel}`);
  assert(first.requiresApproval === true, "Default reply monitor plan should require approval for reply actions");
  assert(first.blockedReasons.length === 0, `Supported default monitor plan should not be blocked: ${first.blockedReasons.join(", ")}`);
  assert(first.steps.some((step) => step.status === "requires_approval"), "Reply steps should require approval");
  assert(first.steps.every((step) => step.plannedOnly === true), "All default monitor steps should be planned only");

  return `Deterministic reply monitor plan id: ${first.planId}`;
}

async function testReplyMonitorSupportsGenericPlatforms(): Promise<string> {
  const platforms = ["xiaohongshu", "douyin", "wechat_public_account", "generic_web_platform"];

  for (const platform of platforms) {
    const result = createReplyMonitorPlan({
      platform,
      goal: `Plan reply monitoring flow for ${platform}.`,
    });

    assert(result.platform === platform, `Unexpected platform: ${result.platform}`);
    assert(result.blockedReasons.length === 0, `${platform} should be supported: ${result.blockedReasons.join(", ")}`);
    assert(result.permissions.includes("content:reply:preview"), `${platform} should include content:reply:preview permission`);
    assert(result.capabilities.includes("reply_monitor_planning"), `${platform} should include reply monitor planning capability`);
  }

  return `Reply monitor supports: ${platforms.join(", ")}`;
}

async function testReplyMonitorReplySendActionsRequireApproval(): Promise<string> {
  const result = createReplyMonitorPlan({
    platform: "douyin",
    goal: "Plan reply drafting and future reply action.",
    steps: [
      {
        id: "draft",
        type: "draft_reply",
        description: "Draft reply text from mock/local classified comments.",
      },
      {
        id: "reply-action",
        type: "plan_reply_action",
        description: "Plan a future reply action after approval.",
      },
    ],
  });

  assert(result.requiresApproval === true, "Reply action plan should require approval");
  assert(result.steps.every((step) => step.requiresApproval === true), "Each reply step should require approval");
  assert(result.steps.every((step) => step.status === "requires_approval"), `Unexpected statuses: ${result.steps.map((step) => step.status).join(", ")}`);
  assert(result.blockedReasons.length === 0, `Planned reply actions should not be blocked: ${result.blockedReasons.join(", ")}`);
  assert(result.auditSummary.realReplyOperation === false, "Reply monitor must not reply");
  assert(result.auditSummary.realCommentReadOperation === false, "Reply monitor must not read real comments");

  return "Reply monitor reply actions require approval and remain planned only";
}

async function testReplyMonitorUnsupportedPlatformBlocked(): Promise<string> {
  const result = createReplyMonitorPlan({
    platform: "unsupported_platform",
    goal: "Plan unsupported platform monitoring.",
  });

  assert(result.riskLevel === "blocked", `Expected blocked risk, got ${result.riskLevel}`);
  assert(result.requiresApproval === true, "Unsupported platform should require approval/blocking");
  assert(
    result.blockedReasons.includes("Unsupported platform: unsupported_platform"),
    `Missing unsupported platform reason: ${result.blockedReasons.join(", ")}`,
  );
  assert(result.plannedOnly === true, "Unsupported platform result should still be planned only");

  return "Unsupported reply monitor platform blocked";
}

async function testReplyMonitorResultIncludesRequiredShape(): Promise<string> {
  const result = createReplyMonitorPlan({
    platform: "wechat_public_account",
    goal: "Inspect reply monitor result shape.",
  });

  assert(result.platform === "wechat_public_account", "Result should include platform");
  assert(Array.isArray(result.steps) && result.steps.length > 0, "Result should include steps");
  assert(typeof result.riskLevel === "string", "Result should include riskLevel");
  assert(typeof result.requiresApproval === "boolean", "Result should include requiresApproval");
  assert(Array.isArray(result.blockedReasons), "Result should include blockedReasons");
  assert(Array.isArray(result.permissions) && result.permissions.length > 0, "Result should include permissions");
  assert(Array.isArray(result.capabilities) && result.capabilities.length > 0, "Result should include capabilities");
  assert(typeof result.summary === "string" && result.summary.length > 0, "Result should include summary");

  return "Reply monitor result includes platform, steps, risk, approval, blocked reasons, permissions, capabilities, and summary";
}

async function testReplyMonitorIntegratesWithScheduledWorkflow(): Promise<string> {
  const replyMonitorPlan = createReplyMonitorPlan({
    platform: "generic_web_platform",
    goal: "Plan scheduled reply monitoring.",
  });
  const workflow = createScheduledWorkflowPlan({
    workflowName: "scheduled-reply-monitor",
    goal: "Schedule a planned reply monitor.",
    schedule: {
      type: "recurring",
      startsAt: "2026-07-11T10:00:00.000Z",
      interval: "daily",
    },
    steps: [
      {
        id: "reply-monitor",
        type: "content:reply",
        description: "Run planned reply monitor after approval.",
        replyMonitorPlan: {
          planId: replyMonitorPlan.planId,
          platform: replyMonitorPlan.platform,
          plannedOnly: true,
        },
      },
    ],
  });
  const [replyStep] = workflow.steps;

  assert(workflow.requiresApproval === true, "Scheduled reply monitor workflow should require approval");
  assert(replyStep.type === "content:reply", `Unexpected scheduled step type: ${replyStep.type}`);
  assert(replyStep.replyMonitorPlan?.planId === replyMonitorPlan.planId, "Scheduled workflow should carry reply monitor plan id");
  assert(replyStep.replyMonitorPlan?.platform === "generic_web_platform", "Scheduled workflow should carry reply monitor platform");
  assert(replyStep.replyMonitorPlan?.plannedOnly === true, "Reply monitor plan handoff should be planned only");
  assert(workflow.auditSummary.realSchedulerOperation === false, "Reply monitor scheduled workflow must not create scheduler");
  assert(workflow.auditSummary.realPublishOperation === false, "Reply monitor scheduled workflow must not publish");

  return "Reply monitor integrates with scheduled content:reply steps as planned-only metadata";
}

async function testReplyMonitorUnsafeStepsBlocked(): Promise<string> {
  const result = createReplyMonitorPlan({
    platform: "xiaohongshu",
    goal: "Attempt unsafe reply monitor actions.",
    steps: [
      {
        id: "unsafe-live-read",
        type: "read_comments",
        description: "Fetch comments and read real comments now.",
      },
      {
        id: "unsafe-send",
        type: "plan_reply_action",
        description: "Send the reply immediately.",
      },
      {
        id: "unsupported-step",
        type: "direct_message",
        description: "Click and send a direct message.",
      },
    ],
  });

  assert(result.riskLevel === "blocked", `Expected blocked risk, got ${result.riskLevel}`);
  assert(result.requiresApproval === true, "Unsafe reply monitor plan should require approval/blocking");
  assert(result.steps.every((step) => step.status === "blocked"), `Expected blocked steps, got ${result.steps.map((step) => step.status).join(", ")}`);
  assert(
    result.blockedReasons.some((reason) => reason.toLowerCase().includes("real comments")),
    `Blocked reasons should mention real comments: ${result.blockedReasons.join(", ")}`,
  );
  assert(
    result.blockedReasons.some((reason) => reason.toLowerCase().includes("send")),
    `Blocked reasons should mention send: ${result.blockedReasons.join(", ")}`,
  );
  assert(
    result.blockedReasons.some((reason) => reason.includes("Unsupported reply monitor step")),
    `Blocked reasons should mention unsupported step: ${result.blockedReasons.join(", ")}`,
  );

  return "Reply monitor unsafe real-read/click/send steps are blocked";
}

async function testReplyMonitorNoRealOperationsOccur(): Promise<string> {
  const before = spawnSync("git", ["status", "--short"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert(before.status === 0, `git status before reply monitor adapter failed: ${before.stderr}`);

  const result = createReplyMonitorPlan({
    platform: "generic_web_platform",
    goal: "Create no-op reply monitor plan.",
  });

  const after = spawnSync("git", ["status", "--short"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert(after.status === 0, `git status after reply monitor adapter failed: ${after.stderr}`);
  assert(after.stdout === before.stdout, `Reply monitor adapter changed git status:\nBefore:\n${before.stdout}\nAfter:\n${after.stdout}`);
  assert(result.auditSummary.realNetworkOperation === false, "Reply monitor must not perform network operations");
  assert(result.auditSummary.realBrowserOperation === false, "Reply monitor must not perform browser operations");
  assert(result.auditSummary.realComputerOperation === false, "Reply monitor must not perform computer operations");
  assert(result.auditSummary.realShellOperation === false, "Reply monitor must not perform shell operations");
  assert(result.auditSummary.realSchedulerOperation === false, "Reply monitor must not perform scheduler operations");
  assert(result.auditSummary.realPublishOperation === false, "Reply monitor must not perform publish operations");
  assert(result.auditSummary.realReplyOperation === false, "Reply monitor must not perform reply operations");
  assert(result.auditSummary.realCommentReadOperation === false, "Reply monitor must not read real comments");

  return "Reply monitor performed no real network/browser/computer/shell/scheduler/publish/reply/comment-read operation";
}

async function testContentFollowUpDeterministicPlan(): Promise<string> {
  const input = {
    platform: "xiaohongshu",
    goal: "Plan follow-up content from mock comment categories.",
    signals: [
      {
        category: "questions",
        examples: ["How does this work?", "Can it support teams?"],
      },
      {
        category: "common_pain_points",
        summary: "People keep mentioning setup friction.",
      },
    ],
  };
  const first = createContentFollowUpPlan(input);
  const second = createContentFollowUpPlan(input);

  assert(first.planId === second.planId, "Content follow-up plan id should be deterministic");
  assert(first.platform === "xiaohongshu", `Unexpected platform: ${first.platform}`);
  assert(first.ideas.length === 2, `Expected 2 follow-up ideas, got ${first.ideas.length}`);
  assert(first.riskLevel === "low", `Expected low risk for question/pain point ideas, got ${first.riskLevel}`);
  assert(first.requiresApproval === false, "Low-risk follow-up plan should not require approval");
  assert(first.blockedReasons.length === 0, `Supported follow-up plan should not be blocked: ${first.blockedReasons.join(", ")}`);
  assert(first.ideas.every((idea) => idea.platform === "xiaohongshu"), "Each idea should carry platform");

  return `Deterministic content follow-up plan id: ${first.planId}`;
}

async function testContentFollowUpSupportsGenericPlatforms(): Promise<string> {
  const platforms = ["xiaohongshu", "douyin", "wechat_public_account", "generic_web_platform"];

  for (const platform of platforms) {
    const result = createContentFollowUpPlan({
      platform,
      goal: `Plan follow-up content for ${platform}.`,
    });

    assert(result.platform === platform, `Unexpected platform: ${result.platform}`);
    assert(result.blockedReasons.length === 0, `${platform} should be supported: ${result.blockedReasons.join(", ")}`);
    assert(result.permissions.includes("content:create:local"), `${platform} should include content:create:local permission`);
    assert(result.capabilities.includes("content_follow_up_planning"), `${platform} should include follow-up planning capability`);
  }

  return `Content follow-up supports: ${platforms.join(", ")}`;
}

async function testContentFollowUpHighRiskSignalsRequireApproval(): Promise<string> {
  const result = createContentFollowUpPlan({
    platform: "douyin",
    goal: "Plan high-risk follow-up topics.",
    signals: [
      {
        category: "negative_feedback",
        summary: "Mock/local comments mention reliability concerns.",
      },
      {
        category: "objections",
        summary: "Mock/local comments question pricing and fit.",
      },
    ],
  });

  assert(result.riskLevel === "high", `Expected high risk, got ${result.riskLevel}`);
  assert(result.requiresApproval === true, "Negative feedback and objections should require approval");
  assert(result.ideas.every((idea) => idea.requiresApproval === true), "Each high-risk idea should require approval");
  assert(result.ideas.every((idea) => idea.riskLevel === "high"), `Unexpected idea risks: ${result.ideas.map((idea) => idea.riskLevel).join(", ")}`);
  assert(result.blockedReasons.length === 0, `High-risk planned ideas should not be blocked: ${result.blockedReasons.join(", ")}`);

  return "Content follow-up high-risk negative-feedback/objection ideas require approval";
}

async function testContentFollowUpUnsupportedPlatformBlocked(): Promise<string> {
  const result = createContentFollowUpPlan({
    platform: "unsupported_platform",
    goal: "Plan unsupported follow-up content.",
  });

  assert(result.riskLevel === "blocked", `Expected blocked risk, got ${result.riskLevel}`);
  assert(result.requiresApproval === true, "Unsupported platform should require approval/blocking");
  assert(
    result.blockedReasons.includes("Unsupported platform: unsupported_platform"),
    `Missing unsupported platform reason: ${result.blockedReasons.join(", ")}`,
  );
  assert(result.plannedOnly === true, "Unsupported platform result should still be planned only");

  return "Unsupported content follow-up platform blocked";
}

async function testContentFollowUpResultIncludesRequiredShape(): Promise<string> {
  const result = createContentFollowUpPlan({
    platform: "wechat_public_account",
    goal: "Inspect content follow-up result shape.",
    signals: [
      {
        category: "feature_requests",
        summary: "Mock/local comments ask for templates.",
      },
    ],
  });
  const [idea] = result.ideas;

  assert(Array.isArray(result.ideas) && result.ideas.length === 1, "Result should include ideas");
  assert(typeof idea.title === "string" && idea.title.length > 0, "Idea should include title");
  assert(typeof idea.angle === "string" && idea.angle.length > 0, "Idea should include angle");
  assert(idea.platform === "wechat_public_account", "Idea should include platform");
  assert(typeof idea.contentType === "string" && idea.contentType.length > 0, "Idea should include contentType");
  assert(typeof idea.priority === "string" && idea.priority.length > 0, "Idea should include priority");
  assert(typeof idea.reason === "string" && idea.reason.length > 0, "Idea should include reason");
  assert(typeof idea.sourceSignal === "string" && idea.sourceSignal.length > 0, "Idea should include sourceSignal");
  assert(typeof idea.riskLevel === "string", "Idea should include riskLevel");
  assert(typeof idea.requiresApproval === "boolean", "Idea should include requiresApproval");
  assert(typeof result.riskLevel === "string", "Result should include riskLevel");
  assert(typeof result.requiresApproval === "boolean", "Result should include requiresApproval");
  assert(Array.isArray(result.blockedReasons), "Result should include blockedReasons");
  assert(Array.isArray(result.permissions) && result.permissions.length > 0, "Result should include permissions");
  assert(Array.isArray(result.capabilities) && result.capabilities.length > 0, "Result should include capabilities");
  assert(typeof result.summary === "string" && result.summary.length > 0, "Result should include summary");

  return "Content follow-up result includes ideas, risk, approval, blocked reasons, permissions, capabilities, and summary";
}

async function testContentFollowUpIntegratesWithReplyMonitorMetadata(): Promise<string> {
  const replyMonitorPlan = createReplyMonitorPlan({
    platform: "generic_web_platform",
    goal: "Plan reply monitoring with follow-up idea handoff.",
  });
  const followUpPlan = createContentFollowUpPlan({
    platform: "generic_web_platform",
    goal: "Plan follow-up content from reply monitor metadata.",
    replyMonitorPlan: {
      planId: replyMonitorPlan.planId,
      platform: replyMonitorPlan.platform,
      plannedOnly: true,
    },
    signals: [
      {
        category: "leads",
        summary: "Mock/local lead-like comments ask about next steps.",
      },
    ],
  });

  assert(followUpPlan.replyMonitorPlan?.planId === replyMonitorPlan.planId, "Follow-up plan should carry reply monitor plan id");
  assert(followUpPlan.replyMonitorPlan?.platform === "generic_web_platform", "Follow-up plan should carry reply monitor platform");
  assert(followUpPlan.replyMonitorPlan?.plannedOnly === true, "Reply monitor handoff should remain planned only");
  assert(followUpPlan.auditSummary.realCommentReadOperation === false, "Follow-up plan must not read real comments");

  return "Content follow-up integrates with reply monitor metadata as planned-only input";
}

async function testContentFollowUpIntegratesWithScheduledWorkflow(): Promise<string> {
  const followUpPlan = createContentFollowUpPlan({
    platform: "generic_web_platform",
    goal: "Plan scheduled content creation from follow-up ideas.",
  });
  const workflow = createScheduledWorkflowPlan({
    workflowName: "scheduled-content-follow-up",
    goal: "Schedule planned follow-up content creation.",
    schedule: {
      type: "one-time",
      runAt: "2026-07-12T10:00:00.000Z",
    },
    steps: [
      {
        id: "follow-up-content",
        type: "content:create",
        description: "Create planned follow-up content locally.",
        contentFollowUpPlan: {
          planId: followUpPlan.planId,
          platform: followUpPlan.platform,
          plannedOnly: true,
        },
      },
    ],
  });
  const [createStep] = workflow.steps;

  assert(createStep.type === "content:create", `Unexpected scheduled step type: ${createStep.type}`);
  assert(createStep.contentFollowUpPlan?.planId === followUpPlan.planId, "Scheduled workflow should carry content follow-up plan id");
  assert(createStep.contentFollowUpPlan?.platform === "generic_web_platform", "Scheduled workflow should carry content follow-up platform");
  assert(createStep.contentFollowUpPlan?.plannedOnly === true, "Content follow-up plan handoff should be planned only");
  assert(workflow.auditSummary.realSchedulerOperation === false, "Content follow-up scheduled workflow must not create scheduler");
  assert(workflow.auditSummary.realPublishOperation === false, "Content follow-up scheduled workflow must not publish");

  return "Content follow-up integrates with scheduled content:create steps as planned-only metadata";
}

async function testContentFollowUpUnsafeSignalsBlocked(): Promise<string> {
  const result = createContentFollowUpPlan({
    platform: "xiaohongshu",
    goal: "Attempt unsafe follow-up content actions.",
    signals: [
      {
        category: "questions",
        summary: "Fetch comments, read real comments, then publish a reply.",
      },
      {
        category: "unsupported_category",
        summary: "Click, type, upload, submit, send, pay, and delete.",
      },
    ],
  });

  assert(result.riskLevel === "blocked", `Expected blocked risk, got ${result.riskLevel}`);
  assert(result.requiresApproval === true, "Unsafe follow-up plan should require approval/blocking");
  assert(result.ideas.every((idea) => idea.riskLevel === "blocked"), `Expected blocked ideas, got ${result.ideas.map((idea) => idea.riskLevel).join(", ")}`);
  assert(
    result.blockedReasons.some((reason) => reason.toLowerCase().includes("real comments")),
    `Blocked reasons should mention real comments: ${result.blockedReasons.join(", ")}`,
  );
  assert(
    result.blockedReasons.some((reason) => reason.toLowerCase().includes("publish")),
    `Blocked reasons should mention publish: ${result.blockedReasons.join(", ")}`,
  );
  assert(
    result.blockedReasons.some((reason) => reason.includes("Unsupported follow-up signal category")),
    `Blocked reasons should mention unsupported category: ${result.blockedReasons.join(", ")}`,
  );

  return "Content follow-up unsafe real-read/publish/action signals are blocked";
}

async function testContentFollowUpNoRealOperationsOccur(): Promise<string> {
  const before = spawnSync("git", ["status", "--short"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert(before.status === 0, `git status before content follow-up adapter failed: ${before.stderr}`);

  const result = createContentFollowUpPlan({
    platform: "generic_web_platform",
    goal: "Create no-op content follow-up plan.",
  });

  const after = spawnSync("git", ["status", "--short"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert(after.status === 0, `git status after content follow-up adapter failed: ${after.stderr}`);
  assert(after.stdout === before.stdout, `Content follow-up adapter changed git status:\nBefore:\n${before.stdout}\nAfter:\n${after.stdout}`);
  assert(result.auditSummary.realNetworkOperation === false, "Content follow-up must not perform network operations");
  assert(result.auditSummary.realBrowserOperation === false, "Content follow-up must not perform browser operations");
  assert(result.auditSummary.realComputerOperation === false, "Content follow-up must not perform computer operations");
  assert(result.auditSummary.realShellOperation === false, "Content follow-up must not perform shell operations");
  assert(result.auditSummary.realSchedulerOperation === false, "Content follow-up must not perform scheduler operations");
  assert(result.auditSummary.realPublishOperation === false, "Content follow-up must not perform publish operations");
  assert(result.auditSummary.realReplyOperation === false, "Content follow-up must not perform reply operations");
  assert(result.auditSummary.realCommentReadOperation === false, "Content follow-up must not read real comments");

  return "Content follow-up performed no real network/browser/computer/shell/scheduler/publish/reply/comment-read operation";
}

async function testUnattendedRunnerDeterministicPlan(): Promise<string> {
  const input = {
    platform: "xiaohongshu",
    goal: "Plan an unattended content workflow.",
    workflowName: "unattended-content-loop",
    schedule: {
      type: "recurring" as const,
      startsAt: "2026-07-13T09:00:00.000Z",
      timezone: "Asia/Shanghai",
      interval: "daily" as const,
      maxOccurrences: 3,
    },
    post: {
      title: "Planned launch note",
      body: "Mock/local draft body.",
      tags: ["ai-dev-os"],
    },
    signals: [
      {
        category: "questions",
        summary: "Mock/local audience questions.",
      },
    ],
  };
  const first = createUnattendedWorkflowRunnerPlan(input);
  const second = createUnattendedWorkflowRunnerPlan(input);

  assert(first.planId === second.planId, "Unattended runner plan id should be deterministic");
  assert(first.platform === "xiaohongshu", `Unexpected platform: ${first.platform}`);
  assert(first.stages.length === 6, `Expected 6 runner stages, got ${first.stages.length}`);
  assert(first.stages.map((stage) => stage.type).join(",") === "scheduled_trigger,content_creation_plan,platform_publish_plan,reply_monitor_plan,follow_up_content_plan,next_cycle_plan", "Runner stages should be in the required order");
  assert(first.riskLevel === "high", `Expected high aggregate risk, got ${first.riskLevel}`);
  assert(first.requiresApproval === true, "End-to-end unattended workflow should require approval for high-risk stages");
  assert(first.blockedReasons.length === 0, `Supported runner plan should not be blocked: ${first.blockedReasons.join(", ")}`);
  assert(first.stages.every((stage) => stage.plannedOnly === true), "All runner stages should be planned only");

  return `Deterministic unattended runner plan id: ${first.planId}`;
}

async function testUnattendedRunnerOrchestratesPlanningModules(): Promise<string> {
  const result = createUnattendedWorkflowRunnerPlan({
    platform: "generic_web_platform",
    goal: "Plan all modules for unattended content operations.",
    schedule: {
      type: "one-time",
      runAt: "2026-07-14T10:00:00.000Z",
    },
  });
  const modules = new Set<string>(result.stages.flatMap((stage) => stage.modules.map((module) => module.module)));

  for (const module of ["scheduled-workflow", "platform-publisher", "reply-monitor", "content-follow-up", "browser-skill", "computer-skill"]) {
    assert(modules.has(module), `Runner should include ${module}`);
  }

  assert(result.scheduledWorkflowPlan.workflowId.length > 0, "Runner should include scheduled workflow plan");
  assert(result.platformPublisherPlan.planId.length > 0, "Runner should include platform publisher plan");
  assert(result.replyMonitorPlan.planId.length > 0, "Runner should include reply monitor plan");
  assert(result.contentFollowUpPlan.planId.length > 0, "Runner should include content follow-up plan");

  return "Unattended runner orchestrates scheduled-workflow, platform-publisher, reply-monitor, content-follow-up, browser-skill, and computer-skill";
}

async function testUnattendedRunnerHighRiskStagesRequireApproval(): Promise<string> {
  const result = createUnattendedWorkflowRunnerPlan({
    platform: "douyin",
    goal: "Plan approval-gated unattended workflow.",
    schedule: {
      type: "recurring",
      startsAt: "2026-07-15T08:00:00.000Z",
      interval: "weekly",
    },
    signals: [
      {
        category: "negative_feedback",
        summary: "Mock/local comments mention trust concerns.",
      },
      {
        category: "objections",
        summary: "Mock/local comments raise buying objections.",
      },
    ],
  });

  assert(result.requiresApproval === true, "High-risk unattended runner should require approval");
  assert(result.riskLevel === "high", `Expected high risk, got ${result.riskLevel}`);
  assert(result.approvalsNeeded.includes("platform_publish_plan"), "Platform publish stage should need approval");
  assert(result.approvalsNeeded.includes("reply_monitor_plan"), "Reply monitor stage should need approval");
  assert(result.approvalsNeeded.includes("follow_up_content_plan"), "High-risk follow-up stage should need approval");
  assert(result.stages.some((stage) => stage.type === "platform_publish_plan" && stage.status === "requires_approval"), "Publish stage should be approval-gated");
  assert(result.stages.some((stage) => stage.type === "follow_up_content_plan" && stage.status === "requires_approval"), "Follow-up stage should be approval-gated");

  return "Unattended runner high-risk publish/reply/follow-up stages require approval";
}

async function testUnattendedRunnerUnsupportedPlatformBlocked(): Promise<string> {
  const result = createUnattendedWorkflowRunnerPlan({
    platform: "unsupported_platform",
    goal: "Plan unsupported unattended workflow.",
    schedule: {
      type: "one-time",
      runAt: "2026-07-16T10:00:00.000Z",
    },
  });

  assert(result.riskLevel === "blocked", `Expected blocked risk, got ${result.riskLevel}`);
  assert(result.requiresApproval === true, "Unsupported platform should require approval/blocking");
  assert(
    result.blockedReasons.some((reason) => reason.includes("Unsupported platform: unsupported_platform")),
    `Missing unsupported platform reason: ${result.blockedReasons.join(", ")}`,
  );
  assert(result.stages.some((stage) => stage.status === "blocked"), "Unsupported platform should block one or more stages");
  assert(result.plannedOnly === true, "Unsupported platform result should still be planned only");

  return "Unsupported unattended runner platform blocked";
}

async function testUnattendedRunnerResultIncludesRequiredShape(): Promise<string> {
  const result = createUnattendedWorkflowRunnerPlan({
    platform: "wechat_public_account",
    goal: "Inspect unattended runner result shape.",
    schedule: {
      type: "one-time",
      runAt: "2026-07-17T09:30:00.000Z",
    },
  });

  assert(Array.isArray(result.stages) && result.stages.length === 6, "Result should include stages");
  assert(result.schedule.type === "one-time", "Result should include schedule");
  assert(typeof result.riskLevel === "string", "Result should include riskLevel");
  assert(typeof result.requiresApproval === "boolean", "Result should include requiresApproval");
  assert(Array.isArray(result.blockedReasons), "Result should include blockedReasons");
  assert(Array.isArray(result.approvalsNeeded), "Result should include approvalsNeeded");
  assert(Array.isArray(result.permissions) && result.permissions.length > 0, "Result should include permissions");
  assert(Array.isArray(result.capabilities) && result.capabilities.length > 0, "Result should include capabilities");
  assert(typeof result.summary === "string" && result.summary.length > 0, "Result should include summary");
  assert(result.stages.every((stage) => Array.isArray(stage.modules) && stage.modules.length > 0), "Each stage should include planned modules");

  return "Unattended runner result includes stages, schedule, risk, approval, blocked reasons, approvals, permissions, capabilities, and summary";
}

async function testUnattendedRunnerIntegratesWithScheduledWorkflowMetadata(): Promise<string> {
  const runnerPlan = createUnattendedWorkflowRunnerPlan({
    platform: "generic_web_platform",
    goal: "Plan unattended runner metadata handoff.",
    schedule: {
      type: "one-time",
      runAt: "2026-07-18T10:00:00.000Z",
    },
  });
  const workflow = createScheduledWorkflowPlan({
    workflowName: "scheduled-unattended-runner",
    goal: "Represent planned unattended runner as content creation metadata.",
    schedule: {
      type: "one-time",
      runAt: "2026-07-18T10:00:00.000Z",
    },
    steps: [
      {
        id: "runner",
        type: "content:create",
        description: "Create planned unattended runner content locally.",
        unattendedRunnerPlan: {
          planId: runnerPlan.planId,
          platform: runnerPlan.platform,
          plannedOnly: true,
        },
      },
    ],
  });
  const [runnerStep] = workflow.steps;

  assert(runnerStep.type === "content:create", `Unexpected scheduled step type: ${runnerStep.type}`);
  assert(runnerStep.unattendedRunnerPlan?.planId === runnerPlan.planId, "Scheduled workflow should carry unattended runner plan id");
  assert(runnerStep.unattendedRunnerPlan?.platform === "generic_web_platform", "Scheduled workflow should carry unattended runner platform");
  assert(runnerStep.unattendedRunnerPlan?.plannedOnly === true, "Unattended runner handoff should be planned only");
  assert(workflow.auditSummary.realSchedulerOperation === false, "Scheduled workflow must not create scheduler");
  assert(workflow.auditSummary.realPublishOperation === false, "Scheduled workflow must not publish");

  return "Unattended runner integrates with scheduled content:create metadata as planned-only handoff";
}

async function testUnattendedRunnerUnsafeActionsBlocked(): Promise<string> {
  const result = createUnattendedWorkflowRunnerPlan({
    platform: "xiaohongshu",
    goal: "Attempt unsafe unattended actions.",
    schedule: {
      type: "one-time",
      runAt: "2026-07-19T10:00:00.000Z",
    },
    notes: [
      "Open real browser, click, type, upload, submit, login, publish now, reply now, send now, pay, and delete.",
    ],
  });

  assert(result.riskLevel === "blocked", `Expected blocked risk, got ${result.riskLevel}`);
  assert(result.requiresApproval === true, "Unsafe runner should require approval/blocking");
  assert(result.stages.every((stage) => stage.status === "blocked"), `Expected blocked stages, got ${result.stages.map((stage) => stage.status).join(", ")}`);
  assert(
    result.blockedReasons.some((reason) => reason.toLowerCase().includes("click")),
    `Blocked reasons should mention click: ${result.blockedReasons.join(", ")}`,
  );
  assert(
    result.blockedReasons.some((reason) => reason.toLowerCase().includes("publish")),
    `Blocked reasons should mention publish: ${result.blockedReasons.join(", ")}`,
  );
  assert(
    result.blockedReasons.some((reason) => reason.toLowerCase().includes("reply")),
    `Blocked reasons should mention reply: ${result.blockedReasons.join(", ")}`,
  );

  return "Unattended runner unsafe real execution actions are blocked";
}

async function testUnattendedRunnerNoRealOperationsOccur(): Promise<string> {
  const before = spawnSync("git", ["status", "--short"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert(before.status === 0, `git status before unattended runner failed: ${before.stderr}`);

  const result = createUnattendedWorkflowRunnerPlan({
    platform: "generic_web_platform",
    goal: "Create no-op unattended runner plan.",
    schedule: {
      type: "recurring",
      startsAt: "2026-07-20T07:00:00.000Z",
      interval: "daily",
    },
  });

  const after = spawnSync("git", ["status", "--short"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert(after.status === 0, `git status after unattended runner failed: ${after.stderr}`);
  assert(after.stdout === before.stdout, `Unattended runner changed git status:\nBefore:\n${before.stdout}\nAfter:\n${after.stdout}`);
  assert(result.auditSummary.realTimerOperation === false, "Runner must not create timers");
  assert(result.auditSummary.realSchedulerOperation === false, "Runner must not create scheduler tasks");
  assert(result.auditSummary.realNetworkOperation === false, "Runner must not perform network operations");
  assert(result.auditSummary.realBrowserOperation === false, "Runner must not perform browser operations");
  assert(result.auditSummary.realComputerOperation === false, "Runner must not perform computer operations");
  assert(result.auditSummary.realShellOperation === false, "Runner must not perform shell operations");
  assert(result.auditSummary.realPublishOperation === false, "Runner must not publish");
  assert(result.auditSummary.realReplyOperation === false, "Runner must not reply");
  assert(result.auditSummary.realCommentReadOperation === false, "Runner must not read real comments");

  return "Unattended runner performed no real timer/scheduler/network/browser/computer/shell/publish/reply/comment-read operation";
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

async function testCodingTaskGetsPonytailGuidanceByDefault(): Promise<string> {
  const plan = createDryRunExecutionPlan({
    goal: "implement a small source code fix",
    skill: createPolicyTestManifest({
      name: "code-refactor-skill",
      capabilities: ["code_refactor", "source_editing"],
      permissions: ["file:read", "file:write:src"],
    }),
  });
  const [guidance] = plan.guidance;
  const instructionText = guidance?.instructions.join(" ").toLowerCase() ?? "";

  assert(guidance?.source === "ponytail", "Coding task should include Ponytail guidance");
  assert(guidance.advisoryOnly === true, "Ponytail guidance must be advisory only");
  assert(instructionText.includes("smallest correct change"), "Guidance should prefer smallest correct change");
  assert(instructionText.includes("avoid over-engineering"), "Guidance should avoid over-engineering");
  assert(instructionText.includes("unnecessary abstractions"), "Guidance should avoid unnecessary abstractions");
  assert(instructionText.includes("preserve existing behavior"), "Guidance should preserve existing behavior");
  assert(instructionText.includes("readable and maintainable"), "Guidance should keep code readable and maintainable");
  assert(instructionText.includes("required checks"), "Guidance should require checks before reporting");

  return "Coding dry-run plan includes Ponytail guidance by default";
}

async function testNonCodingTaskDoesNotForcePonytailGuidance(): Promise<string> {
  const plan = createDryRunExecutionPlan({
    goal: "search GitHub repository metadata",
    skill: createPolicyTestManifest({
      name: "github-search-skill",
      capabilities: ["github_search", "repo_discovery"],
      permissions: ["network:github"],
    }),
  });

  assert(plan.guidance.length === 0, `Non-coding plan should not force Ponytail guidance: ${JSON.stringify(plan.guidance)}`);

  return "Non-coding dry-run plan does not force Ponytail guidance";
}

async function testDefaultPonytailGuidanceRemoteExecutionBlocked(): Promise<string> {
  const result = runGitHubSkillV1Request({
    repoUrl: ponytailRepo,
    manifestPath: ".ai-dev-os/skills/ponytail/skill.json",
    manifest: createPonytailManifest(),
    mode: "external",
    action: {
      type: "github:read",
      description: "Attempt to turn default Ponytail guidance into remote execution.",
    },
  });

  assert(result.status === "blocked", `Expected remote Ponytail execution blocked, got ${result.status}`);
  assert(
    result.blockedReasons.includes("External GitHub Skill v1 runtime mode is disabled"),
    `Missing external runtime block reason: ${result.blockedReasons.join(", ")}`,
  );

  return "Default Ponytail guidance does not enable remote execution";
}

async function testDefaultPonytailGuidanceInstallScriptsHooksBlocked(): Promise<string> {
  const scriptResult = runGitHubSkillV1Request({
    repoUrl: ponytailRepo,
    manifestPath: ".ai-dev-os/skills/ponytail-script/skill.json",
    manifest: createPonytailManifest({
      name: "ponytail-script",
      entry: "package.json#scripts.test",
      capabilities: ["shell_execute"],
      permissions: ["shell:execute"],
    }),
    mode: "mock",
    action: {
      type: "github:read",
      description: "Attempt Ponytail script execution.",
    },
  });
  const hookResult = runGitHubSkillV1Request({
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

  assert(scriptResult.status === "blocked", `Expected Ponytail script execution blocked, got ${scriptResult.status}`);
  assert(hookResult.status === "blocked", `Expected Ponytail hook execution blocked, got ${hookResult.status}`);
  assert(
    scriptResult.blockedReasons.includes("Permission shell:execute is disabled in V4.4.4"),
    `Missing script execution block reason: ${scriptResult.blockedReasons.join(", ")}`,
  );
  assert(
    hookResult.blockedReasons.includes("Permission shell:execute is disabled in V4.4.4"),
    `Missing hook execution block reason: ${hookResult.blockedReasons.join(", ")}`,
  );

  return "Default Ponytail guidance does not enable install, script, or hook execution";
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
  await runTest("Browser Skill v1 mock browser:read plan works", testBrowserSkillV1ReadMockPlanWorks);
  await runTest("Browser Skill v1 browser:write requires approval", testBrowserSkillV1WriteRequiresApproval);
  await runTest("Browser Skill v1 publish/comment/reply/upload intents are blocked or approval-gated", testBrowserSkillV1PublishingIntentsApprovalGated);
  await runTest("Browser Skill v1 result includes required action shape", testBrowserSkillV1ResultIncludesRequiredShape);
  await runTest("Browser Skill v1 external runtime is blocked", testBrowserSkillV1ExternalRuntimeBlocked);
  await runTest("Browser Skill v1 performs no real network/browser/computer/shell operation", testBrowserSkillV1NoRealOperationsOccur);
  await runTest("Computer Use Skill v1 mock computer:observe plan works", testComputerSkillV1ObserveMockPlanWorks);
  await runTest("Computer Use Skill v1 computer:act requires approval", testComputerSkillV1ActRequiresApproval);
  await runTest("Computer Use Skill v1 high-risk actions are blocked or approval-gated", testComputerSkillV1HighRiskActionsBlocked);
  await runTest("Computer Use Skill v1 delete/pay/send/login/system-setting intents are blocked", testComputerSkillV1DangerousActionsBlocked);
  await runTest("Computer Use Skill v1 result includes required action shape", testComputerSkillV1ResultIncludesRequiredShape);
  await runTest("Computer Use Skill v1 external runtime is blocked", testComputerSkillV1ExternalRuntimeBlocked);
  await runTest("Computer Use Skill v1 performs no real network/browser/computer/shell operation", testComputerSkillV1NoRealOperationsOccur);
  await runTest("Scheduled Workflow Agent v1 creates deterministic one-time plans", testScheduledWorkflowDeterministicPlan);
  await runTest("Scheduled Workflow Agent v1 represents recurring workflows", testScheduledWorkflowRecurringPlanRepresented);
  await runTest("Scheduled Workflow Agent v1 high-risk steps require approval", testScheduledWorkflowHighRiskStepsRequireApproval);
  await runTest("Scheduled Workflow Agent v1 result includes required shape", testScheduledWorkflowResultIncludesRequiredShape);
  await runTest("Scheduled Workflow Agent v1 unsafe steps are blocked or approval-gated", testScheduledWorkflowUnsafeStepsBlockedOrApprovalGated);
  await runTest("Scheduled Workflow Agent v1 performs no real timer/scheduler/browser/computer action", testScheduledWorkflowNoRealOperationsOccur);
  await runTest("Platform Publisher Skill v1 creates deterministic publish plans", testPlatformPublisherDeterministicPlan);
  await runTest("Platform Publisher Skill v1 supports generic platforms", testPlatformPublisherSupportsGenericPlatforms);
  await runTest("Platform Publisher Skill v1 publish/submit/upload/login steps require approval", testPlatformPublisherPublishSubmitUploadLoginRequireApproval);
  await runTest("Platform Publisher Skill v1 unsupported platform is blocked", testPlatformPublisherUnsupportedPlatformBlocked);
  await runTest("Platform Publisher Skill v1 result includes required shape", testPlatformPublisherResultIncludesRequiredShape);
  await runTest("Platform Publisher Skill v1 integrates with scheduled content publish", testPlatformPublisherIntegratesWithScheduledWorkflow);
  await runTest("Platform Publisher Skill v1 unsafe steps are blocked", testPlatformPublisherUnsafeStepsBlocked);
  await runTest("Platform Publisher Skill v1 performs no real network/browser/computer/scheduler/publish action", testPlatformPublisherNoRealOperationsOccur);
  await runTest("Reply Monitor Skill v1 creates deterministic monitor plans", testReplyMonitorDeterministicPlan);
  await runTest("Reply Monitor Skill v1 supports generic platforms", testReplyMonitorSupportsGenericPlatforms);
  await runTest("Reply Monitor Skill v1 reply/send actions require approval", testReplyMonitorReplySendActionsRequireApproval);
  await runTest("Reply Monitor Skill v1 unsupported platform is blocked", testReplyMonitorUnsupportedPlatformBlocked);
  await runTest("Reply Monitor Skill v1 result includes required shape", testReplyMonitorResultIncludesRequiredShape);
  await runTest("Reply Monitor Skill v1 integrates with scheduled content reply", testReplyMonitorIntegratesWithScheduledWorkflow);
  await runTest("Reply Monitor Skill v1 unsafe steps are blocked", testReplyMonitorUnsafeStepsBlocked);
  await runTest("Reply Monitor Skill v1 performs no real network/browser/computer/scheduler/reply action", testReplyMonitorNoRealOperationsOccur);
  await runTest("Content Follow-up Agent v1 creates deterministic follow-up plans", testContentFollowUpDeterministicPlan);
  await runTest("Content Follow-up Agent v1 supports generic platforms", testContentFollowUpSupportsGenericPlatforms);
  await runTest("Content Follow-up Agent v1 high-risk signals require approval", testContentFollowUpHighRiskSignalsRequireApproval);
  await runTest("Content Follow-up Agent v1 unsupported platform is blocked", testContentFollowUpUnsupportedPlatformBlocked);
  await runTest("Content Follow-up Agent v1 result includes required shape", testContentFollowUpResultIncludesRequiredShape);
  await runTest("Content Follow-up Agent v1 integrates with reply monitor metadata", testContentFollowUpIntegratesWithReplyMonitorMetadata);
  await runTest("Content Follow-up Agent v1 integrates with scheduled content create", testContentFollowUpIntegratesWithScheduledWorkflow);
  await runTest("Content Follow-up Agent v1 unsafe signals are blocked", testContentFollowUpUnsafeSignalsBlocked);
  await runTest("Content Follow-up Agent v1 performs no real network/browser/computer/scheduler/publish/reply action", testContentFollowUpNoRealOperationsOccur);
  await runTest("Unattended Workflow Runner Plan v1 creates deterministic end-to-end plans", testUnattendedRunnerDeterministicPlan);
  await runTest("Unattended Workflow Runner Plan v1 orchestrates existing planning modules", testUnattendedRunnerOrchestratesPlanningModules);
  await runTest("Unattended Workflow Runner Plan v1 high-risk stages require approval", testUnattendedRunnerHighRiskStagesRequireApproval);
  await runTest("Unattended Workflow Runner Plan v1 unsupported platform is blocked", testUnattendedRunnerUnsupportedPlatformBlocked);
  await runTest("Unattended Workflow Runner Plan v1 result includes required shape", testUnattendedRunnerResultIncludesRequiredShape);
  await runTest("Unattended Workflow Runner Plan v1 integrates with scheduled content create", testUnattendedRunnerIntegratesWithScheduledWorkflowMetadata);
  await runTest("Unattended Workflow Runner Plan v1 unsafe actions are blocked", testUnattendedRunnerUnsafeActionsBlocked);
  await runTest("Unattended Workflow Runner Plan v1 performs no real scheduler/browser/computer/publish/reply action", testUnattendedRunnerNoRealOperationsOccur);
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
  await runTest("Coding task gets Ponytail guidance by default", testCodingTaskGetsPonytailGuidanceByDefault);
  await runTest("Non-coding task does not force Ponytail guidance", testNonCodingTaskDoesNotForcePonytailGuidance);
  await runTest("Default Ponytail guidance keeps remote execution blocked", testDefaultPonytailGuidanceRemoteExecutionBlocked);
  await runTest("Default Ponytail guidance keeps install/scripts/hooks blocked", testDefaultPonytailGuidanceInstallScriptsHooksBlocked);
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
