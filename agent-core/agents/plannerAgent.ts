import agentController, { type AgentControllerOutput } from "../agent";
import type { MemoryEntry } from "../memory/memory";

export type PlannerAgentInput = {
  goal: string;
  memoryHistory: MemoryEntry[];
};

export async function plannerAgent(input: PlannerAgentInput): Promise<AgentControllerOutput> {
  const goal = typeof input.goal === "string" ? input.goal.trim() : "";
  const memoryHistory = Array.isArray(input.memoryHistory) ? input.memoryHistory : [];

  return agentController({
    goal,
    memoryHistory,
  });
}

export default plannerAgent;
