import { executeSkill, listSkills } from "../skill-system";
import { routeSkillStep } from "../agent-core/skillRouter";
import { selectSkill } from "../agent-core/skillSelector";

type TestStatus = "PASS" | "FAIL" | "SKIP";

type TestResult = {
  name: string;
  status: TestStatus;
  details?: string;
};

const results: TestResult[] = [];

function record(status: TestStatus, name: string, details?: string): void {
  results.push({ name, status, details });
  const suffix = details ? ` - ${details}` : "";
  console.log(`[${status}] ${name}${suffix}`);
}

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
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

async function testRegistry(): Promise<string> {
  const skills = listSkills();
  const names = skills.map((skill) => skill.name).sort();
  const required = [
    "browser_tool",
    "content_writer",
    "github-search-skill",
    "auto-readme-generator",
    "code-refactor-skill",
  ];

  for (const name of required) {
    assert(names.includes(name), `Missing registered skill: ${name}`);
  }

  return `Registered skills: ${names.join(", ")}`;
}

async function testLocalSkillExecution(): Promise<string> {
  const output = await executeSkill("content_writer", "write a short product description");

  assert(output !== undefined && output !== null, "content_writer returned empty output");
  assert(String(output).trim().length > 0, "content_writer returned blank output");

  return `Output: ${String(output)}`;
}

async function testGitHubMockSkillExecution(): Promise<string> {
  const output = await executeSkill("github-search-skill", "search github repo for AI agents");
  const text = String(output);

  assert(text.trim().length > 0, "github-search-skill returned blank output");
  assert(
    text.includes("github-search-skill") || text.toLowerCase().includes("github repo search"),
    `Output does not look like GitHub mock result: ${text}`,
  );

  return `Output: ${text}`;
}

async function testSkillSelector(): Promise<string> {
  const cases = [
    {
      goal: "search github repo for AI agents",
      expected: ["github-search-skill", "browser_tool"],
    },
    {
      goal: "write a README for a React project",
      expected: ["auto-readme-generator", "content_writer"],
    },
    {
      goal: "refactor this code for performance",
      expected: ["code-refactor-skill", "code_editor"],
    },
    {
      goal: "analyze this resume",
      expected: ["resume_analyzer"],
    },
  ];

  const lines: string[] = [];

  for (const item of cases) {
    const selected = selectSkill(item.goal);

    assert(
      item.expected.includes(selected.skill),
      `Goal "${item.goal}" selected "${selected.skill}", expected one of ${item.expected.join(", ")}`,
    );

    lines.push(
      [
        `goal="${item.goal}"`,
        `selected=${selected.skill}`,
        `confidence=${selected.confidence}`,
        `reasoning=${selected.reasoning}`,
      ].join(" | "),
    );
  }

  return `\n${lines.join("\n")}`;
}

async function testSkillRouter(): Promise<string> {
  const result = await routeSkillStep({
    action: "execute",
    skill: "github-search-skill",
    input: "search github repo for AI agents",
  });

  assert(result.output !== undefined && result.output !== null, "Router returned empty output");
  assert(String(result.output).trim().length > 0, "Router returned blank output");
  assert(result.skill === "github-search-skill", `Router used unexpected skill: ${result.skill}`);
  assert(
    String(result.output).toLowerCase().includes("github"),
    `Router output does not look like skill-system output: ${String(result.output)}`,
  );

  return `Output: ${String(result.output)}`;
}

async function testMultiAgentLoopSmoke(): Promise<void> {
  try {
    const { runMultiAgentLoop } = await import("../agent-core/loop");
    const output = await runMultiAgentLoop("write a README for a React project");

    record(
      "PASS",
      "Multi-agent loop smoke test",
      `completed=${output.completed}, decision=${output.decision}, finalResult=${stringify(output.finalResult)}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    record("FAIL", "Multi-agent loop smoke test", message);
  }
}

async function main(): Promise<void> {
  console.log("AI Dev OS V4.3 Verification");
  console.log("");

  await runTest("Registry loaded skills", testRegistry);
  await runTest("Local skill execution", testLocalSkillExecution);
  await runTest("GitHub mock skill execution", testGitHubMockSkillExecution);
  await runTest("Skill selector", testSkillSelector);
  await runTest("Skill router", testSkillRouter);
  await testMultiAgentLoopSmoke();

  const passed = results.filter((result) => result.status === "PASS").length;
  const failed = results.filter((result) => result.status === "FAIL").length;
  const skipped = results.filter((result) => result.status === "SKIP").length;

  console.log("");
  console.log("Final:");
  console.log(`- Passed: ${passed}`);
  console.log(`- Failed: ${failed}`);
  console.log(`- Skipped: ${skipped}`);

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
  console.log(`- Skipped: ${results.filter((result) => result.status === "SKIP").length}`);
  process.exitCode = 1;
});
