import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import {
  assertManifestMatchesLock,
  assertSha256Integrity,
  createDryRunExecutionPlan,
  executeSkill,
  getSkill,
  getSkillManifestLock,
  loadGitHubSkillManifestIndex,
  registerGitHubSkillsFromManifestIndex,
  validateSkillPolicy,
} from "../skill-system";
import type { GitHubSkillManifest } from "../skill-system";

type TestStatus = "PASS" | "FAIL";

type TestResult = {
  name: string;
  status: TestStatus;
  details?: string;
};

const results: TestResult[] = [];
const trustedRepo = "https://github.com/hero2855/AI-Dev-OS-skills";
const untrustedRepo = "https://github.com/unknown/bad-skill";
let cachedManifests: GitHubSkillManifest[] | null = null;

function loadLocalEnv(): void {
  const envPath = resolve(process.cwd(), ".env");

  if (!existsSync(envPath)) {
    return;
  }

  const content = readFileSync(envPath, "utf8");

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^["']|["']$/g, "");

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadLocalEnv();

function record(status: TestStatus, name: string, details?: string): void {
  results.push({ name, status, details });
  const suffix = details ? ` - ${details}` : "";
  console.log(`[${status}] ${name}${suffix}`);
}

async function runTest(name: string, test: () => Promise<string | void> | string | void): Promise<void> {
  try {
    const details = await test();
    record("PASS", name, details);
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

async function getTrustedManifests(): Promise<GitHubSkillManifest[]> {
  if (!cachedManifests) {
    cachedManifests = await loadGitHubSkillManifestIndex(trustedRepo);
  }

  return cachedManifests;
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

async function testTrustedRepoFetchesIndexWithIntegrity(): Promise<string> {
  const manifests = await getTrustedManifests();
  const lock = getSkillManifestLock();

  assert(manifests.length > 0, "Trusted repo index returned no manifests");
  assert(lock.index.path === "skills/index.json", `Unexpected locked index path: ${lock.index.path}`);

  return `Fetched index and verified sha256 ${lock.index.sha256}`;
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
    message.includes("remote execution is disabled in V4.4.4"),
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

async function main(): Promise<void> {
  console.log("AI Dev OS V4.4.5 Verification");
  console.log("");

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
