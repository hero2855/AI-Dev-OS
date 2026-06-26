import type { AgentControllerOutput } from "../agent";
import type { MemoryEntry } from "../memory/memory";
import type { ExecutionOutput } from "../executor";

export type CriticDecision = "accept" | "retry" | "replan";

export type CriticAgentInput = {
  goal: string;
  plan: AgentControllerOutput;
  result: ExecutionOutput;
  memoryHistory: MemoryEntry[];
};

export type CriticResult = {
  decision: CriticDecision;
  feedback: string;
  improved_plan?: string;
  suggested_changes?: string[];
};

function normalizeAction(action: string): string {
  return action.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeStepKey(action: string, skill: unknown, input: unknown): string {
  let inputText = "";

  try {
    inputText = input === undefined ? "" : JSON.stringify(input);
  } catch {
    inputText = String(input);
  }

  return [normalizeAction(action), String(skill ?? ""), inputText].join("|").toLowerCase();
}

function getExecutionResults(entry: MemoryEntry): any[] {
  if (Array.isArray(entry?.results)) {
    return entry.results;
  }

  if (Array.isArray(entry?.results?.execution)) {
    return entry.results.execution;
  }

  return [];
}

function hasExecutionFailure(result: ExecutionOutput): boolean {
  return result.results.some((item) => {
    const output = item.output.toLowerCase();

    return (
      output.startsWith("error:") ||
      output.includes("skill not found") ||
      output.includes("skill execution failed")
    );
  });
}

function getFailedResults(result: ExecutionOutput): string[] {
  return result.results
    .filter((item) => {
      const output = item.output.toLowerCase();

      return (
        output.startsWith("error:") ||
        output.includes("skill not found") ||
        output.includes("skill execution failed")
      );
    })
    .map((item) => `Step ${item.stepId} using ${item.skill} failed for input: ${item.input}`);
}

function getPastActions(memoryHistory: MemoryEntry[]): Set<string> {
  const pastActions = new Set<string>();

  for (const entry of memoryHistory) {
    const planSteps = Array.isArray(entry?.plan?.steps) ? entry.plan.steps : [];
    const resultItems = getExecutionResults(entry);

    for (const step of planSteps) {
      if (typeof step?.action === "string" && step.action.trim()) {
        pastActions.add(normalizeStepKey(step.action, step.skill, step.input));
      }
    }

    for (const result of resultItems) {
      if (typeof result?.input === "string" && result.input.trim()) {
        pastActions.add(normalizeStepKey(result.input, result.skill, result.input));
      }
    }
  }

  return pastActions;
}

function getRepeatedActions(plan: AgentControllerOutput, memoryHistory: MemoryEntry[]): string[] {
  const pastActions = getPastActions(memoryHistory);

  return plan.steps
    .filter((step) => pastActions.has(normalizeStepKey(step.action, step.skill, step.input)))
    .map((step) => step.action);
}

function buildImprovedPlan(input: CriticAgentInput, feedback: string, suggestedChanges: string[]): string {
  const rejectedActions = input.plan.steps.map((step) => step.action);

  return [
    `Goal: ${input.goal}`,
    "",
    "Rejected plan:",
    JSON.stringify(input.plan, null, 2),
    "",
    "Critic feedback:",
    feedback,
    "",
    "Suggested changes:",
    ...suggestedChanges.map((change) => `- ${change}`),
    "",
    "Improved plan requirements:",
    "- Generate a fresh JSON plan for the original goal.",
    "- Do not repeat rejected step.action values.",
    "- Do not repeat actions already present in memoryHistory.",
    "- Prefer unfinished work that can move the goal forward.",
    "",
    "Rejected step.action values:",
    JSON.stringify(rejectedActions, null, 2),
  ].join("\n");
}

function replanResult(input: CriticAgentInput, feedback: string, suggestedChanges: string[]): CriticResult {
  return {
    decision: "replan",
    feedback,
    improved_plan: buildImprovedPlan(input, feedback, suggestedChanges),
    suggested_changes: suggestedChanges,
  };
}

export async function criticAgent(input: CriticAgentInput): Promise<CriticResult> {
  const memoryHistory = Array.isArray(input.memoryHistory) ? input.memoryHistory : [];
  const resultCount = Array.isArray(input.result.results) ? input.result.results.length : 0;

  if (resultCount === 0) {
    return replanResult(
      input,
      "No execution results were produced. Planner must create a different plan with executable steps.",
      [
        "Add concrete executable steps.",
        "Use only registered skills.",
        "Avoid broad or empty actions that cannot produce results.",
      ],
    );
  }

  const repeatedActions = getRepeatedActions(input.plan, memoryHistory);

  if (repeatedActions.length > 0) {
    return replanResult(
      input,
      "The plan repeats actions already present in memoryHistory. Planner must avoid repeated step.action values and choose unfinished work.",
      [
        "Remove repeated actions from the next plan.",
        `Avoid these repeated actions: ${repeatedActions.join("; ")}`,
        "Replace repeated actions with new work that advances unfinished parts of the goal.",
      ],
    );
  }

  if (hasExecutionFailure(input.result)) {
    return {
      decision: "retry",
      feedback:
        "Execution produced recoverable failures. Executor should retry the same plan once before Planner creates a new plan.",
      suggested_changes: getFailedResults(input.result),
    };
  }

  return {
    decision: "accept",
    feedback: "Execution completed without detected failures or repeated actions. The goal can be accepted.",
    suggested_changes: [],
  };
}

export default criticAgent;
