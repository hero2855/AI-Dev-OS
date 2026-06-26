import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import {
  executeSkill,
  getSkill,
  loadGitHubSkillManifest,
  registerGitHubSkillFromManifest,
} from "../skill-system";

type TestStatus = "PASS" | "FAIL";

type TestResult = {
  name: string;
  status: TestStatus;
  details?: string;
};

const results: TestResult[] = [];
const trustedRepo = "https://github.com/hero2855/AI-Dev-OS-skills";
const untrustedRepo = "https://github.com/unknown/bad-skill";

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

async function testTrustedRepoManifest(): Promise<string> {
  const manifest = await loadGitHubSkillManifest(trustedRepo);

  assert(manifest.name.trim().length > 0, "Manifest name is empty");
  assert(manifest.version.trim().length > 0, "Manifest version is empty");
  assert(manifest.description.trim().length > 0, "Manifest description is empty");
  assert(Array.isArray(manifest.capabilities), "Manifest capabilities is not an array");
  assert(Array.isArray(manifest.permissions), "Manifest permissions is not an array");

  return `Loaded manifest: ${manifest.name}@${manifest.version}`;
}

async function testUntrustedRepoRejected(): Promise<string> {
  try {
    await loadGitHubSkillManifest(untrustedRepo);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert(message === "Untrusted GitHub skill repo", `Unexpected error message: ${message}`);
    return "Rejected untrusted repo with expected error";
  }

  throw new Error("Untrusted repo was not rejected");
}

async function testManifestSkillRegistration(): Promise<string> {
  const manifest = await loadGitHubSkillManifest(trustedRepo);
  const skill = registerGitHubSkillFromManifest(manifest);
  const registeredSkill = getSkill(manifest.name);

  assert(skill.name === manifest.name, "Registered skill name does not match manifest");
  assert(registeredSkill?.name === manifest.name, "Manifest skill is not available in registry");

  return `Registered manifest skill: ${skill.name}`;
}

async function testManifestSkillExecutionPlaceholder(): Promise<string> {
  const manifest = await loadGitHubSkillManifest(trustedRepo);
  registerGitHubSkillFromManifest(manifest);

  const output = await executeSkill(manifest.name, "safe manifest execution test");
  const message = String(output?.message || "");

  assert(output?.type === "github_skill_manifest_placeholder", "Unexpected manifest skill output type");
  assert(
    message.includes("remote execution is disabled in V4.4.1"),
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
  console.log("AI Dev OS V4.4.1 Verification");
  console.log("");

  await runTest("Trusted repo can load manifest", testTrustedRepoManifest);
  await runTest("Untrusted repo is rejected", testUntrustedRepoRejected);
  await runTest("Manifest skill can register", testManifestSkillRegistration);
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
