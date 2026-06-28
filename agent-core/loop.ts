import plannerAgent from "./agents/plannerAgent";
import executorAgent from "./agents/executorAgent";
import criticAgent, { type CriticResult } from "./agents/criticAgent";
import type { AgentControllerOutput } from "./agent";
import { getMemory, saveMemory } from "./memory/memory";
import type { ExecutionOutput } from "./executor";

export type MultiAgentLoopIteration = {
  iteration: number;
  plan: AgentControllerOutput;
  execution: ExecutionOutput;
  critic: CriticResult;
};

export type MultiAgentLoopOutput = {
  goal: string;
  completed: boolean;
  decision: CriticResult["decision"];
  iterations: MultiAgentLoopIteration[];
  finalResult: ExecutionOutput | null;
};

const MAX_ITERATIONS = 3;

function buildPlannerGoal(goal: string, critic: CriticResult | null): string {
  if (!critic) {
    return goal;
  }

  return [
    `Goal: ${goal}`,
    "",
    "Actionable Critic feedback from previous iteration:",
    critic.feedback,
    "",
    "Improved plan proposed by Critic:",
    critic.improved_plan || "No improved plan provided.",
    "",
    "Suggested changes:",
    JSON.stringify(critic.suggested_changes || [], null, 2),
    "",
    "Planner must use the improved_plan and suggested_changes to produce a new JSON plan.",
  ].join("\n");
}

function createLoopErrorResult(goal: string, error: unknown): ExecutionOutput {
  const message = error instanceof Error ? error.message : "Unknown multi-agent loop error";

  return {
    goal,
    results: [
      {
        stepId: 0,
        skill: "multi_agent_loop",
        input: goal,
        output: `Error: ${message}`,
      },
    ],
  };
}

export async function runMultiAgentLoop(goal: string): Promise<MultiAgentLoopOutput> {
  const normalizedGoal = typeof goal === "string" ? goal.trim() : "";
  const iterations: MultiAgentLoopIteration[] = [];
  let finalResult: ExecutionOutput | null = null;
  let finalDecision: CriticResult["decision"] = "replan";
  let retryPlan: AgentControllerOutput | null = null;
  let actionableCritic: CriticResult | null = null;

  for (let index = 0; index < MAX_ITERATIONS; index += 1) {
    try {
      const memoryHistory = getMemory(normalizedGoal);
      const plan: AgentControllerOutput =
        retryPlan ||
        (await plannerAgent({
          goal: buildPlannerGoal(normalizedGoal, actionableCritic),
          memoryHistory,
        }));

      const execution = await executorAgent({
        plan,
        memoryHistory,
      });

      const critic = await criticAgent({
        goal: normalizedGoal,
        plan,
        result: execution,
        memoryHistory,
      });

      saveMemory({
        goal: normalizedGoal,
        plan,
        results: {
          execution: execution.results,
          criticFeedback: critic.feedback,
          criticDecision: critic.decision,
          improvedPlan: critic.improved_plan || null,
          suggestedChanges: critic.suggested_changes || [],
          rejectedPlans: critic.decision === "replan" ? [plan] : [],
        },
        timestamp: Date.now(),
      });

      iterations.push({
        iteration: index + 1,
        plan,
        execution,
        critic,
      });

      finalResult = execution;
      finalDecision = critic.decision;

      if (critic.decision === "accept") {
        return {
          goal: normalizedGoal,
          completed: true,
          decision: critic.decision,
          iterations,
          finalResult,
        };
      }

      if (critic.decision === "retry") {
        retryPlan = plan;
        actionableCritic = null;
        continue;
      }

      retryPlan = null;
      actionableCritic = critic;
    } catch (error) {
      finalResult = createLoopErrorResult(normalizedGoal, error);
      finalDecision = "replan";
      retryPlan = null;
      actionableCritic = {
        decision: "replan",
        feedback: error instanceof Error ? error.message : "Unknown multi-agent loop error",
        improved_plan: "Create a safer alternative plan that avoids the failing operation.",
        suggested_changes: ["Recover from the loop error with a simpler executable plan."],
      };
    }
  }

  return {
    goal: normalizedGoal,
    completed: false,
    decision: finalDecision,
    iterations,
    finalResult,
  };
}

export default runMultiAgentLoop;
