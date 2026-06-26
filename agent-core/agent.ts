import type { MemoryEntry } from "./memory/memory";
import type { SkillName } from "../skill-system";
import selectSkill from "./skillSelector";

export type AgentInput = {
  goal: string;
  memoryHistory: MemoryEntry[];
};

export type AgentTaskInput = {
  task: string;
};

export type AgentControllerInput = AgentInput | AgentTaskInput;

export type AgentSkill = SkillName;

export type AgentStep = {
  id: number;
  action: string;
  skill: AgentSkill;
  input?: any;
  reasoning?: string;
};

export type AgentControllerOutput = {
  goal: string;
  steps: AgentStep[];
  raw: string;
};

const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";
const DEFAULT_MODEL = "deepseek-chat";

const ALLOWED_SKILLS: AgentSkill[] = [
  "code_editor",
  "resume_analyzer",
  "content_writer",
  "browser_tool",
];

const SYSTEM_PROMPT = [
  "You are an agent with memory. You MUST avoid repeating past actions listed in memoryHistory.",
  "You are a task planner.",
  "Your job is to break the user's goal into an executable AI Dev OS plan.",
  "",
  "Before generating a plan, you must:",
  "- Check memoryHistory.",
  "- Do NOT repeat actions already done in memory.",
  "- Avoid duplicate step.action values.",
  "- Prefer work that moves unfinished parts of the goal forward.",
  "",
  "You must output JSON only. Do not output Markdown. Do not output explanations.",
  "",
  "The JSON format must be:",
  "{",
  '  "goal": "string",',
  '  "steps": [',
  "    {",
  '      "id": 1,',
  '      "action": "execute",',
  '      "skill": "code_editor | resume_analyzer | content_writer | browser_tool",',
  '      "input": "the original goal or specific skill input",',
  '      "reasoning": "why this skill was selected"',
  "    }",
  "  ]",
  "}",
  "",
  "skill must be one of:",
  "- code_editor",
  "- resume_analyzer",
  "- content_writer",
  "- browser_tool",
  "",
  "Planner MUST use the selected skill from the skill selection context.",
  'Planner MUST output steps in this shape: {"action":"execute","skill":selectedSkill.skill,"input":goal,"reasoning":selectedSkill.reasoning}.',
].join("\n");

function isAgentInput(input: AgentControllerInput): input is AgentInput {
  return Boolean(input && "goal" in input);
}

function isAllowedSkill(skill: unknown): skill is AgentSkill {
  return typeof skill === "string" && ALLOWED_SKILLS.includes(skill as AgentSkill);
}

function stripCodeFence(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

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

function extractCompletedActions(memoryHistory: MemoryEntry[]): Set<string> {
  const actions = new Set<string>();

  for (const entry of memoryHistory) {
    const planSteps = Array.isArray(entry?.plan?.steps) ? entry.plan.steps : [];
    const resultItems = Array.isArray(entry?.results)
      ? entry.results
      : Array.isArray(entry?.results?.execution)
        ? entry.results.execution
        : [];

    for (const step of planSteps) {
      if (typeof step?.action === "string" && step.action.trim()) {
        actions.add(normalizeStepKey(step.action, step.skill, step.input));
      }
    }

    for (const result of resultItems) {
      if (typeof result?.input === "string" && result.input.trim()) {
        actions.add(normalizeStepKey(result.input, result.skill, result.input));
      }
    }
  }

  return actions;
}

function buildMemoryAwareTask(goal: string, memoryHistory: MemoryEntry[]): string {
  const selectedSkill = selectSkill(goal);

  return [
    `Goal: ${goal}`,
    "",
    "selectedSkill:",
    JSON.stringify(selectedSkill, null, 2),
    "",
    "memoryHistory:",
    JSON.stringify(memoryHistory, null, 2),
    "",
    "Decision rules:",
    "- Inspect memoryHistory before planning.",
    "- Do NOT repeat any previous step.action or result.input found in memoryHistory.",
    "- Generate only steps that are still useful for unfinished parts of the goal.",
    "- Use selectedSkill.skill as the skill.",
    "- Use the original goal as input unless a more specific skill input is required.",
  ].join("\n");
}

function normalizeInput(input: AgentControllerInput): {
  goal: string;
  task: string;
  memoryHistory: MemoryEntry[];
} {
  if (isAgentInput(input)) {
    const goal = typeof input.goal === "string" ? input.goal.trim() : "";
    const memoryHistory = Array.isArray(input.memoryHistory) ? input.memoryHistory : [];

    return {
      goal,
      task: buildMemoryAwareTask(goal, memoryHistory),
      memoryHistory,
    };
  }

  const task = typeof input?.task === "string" ? input.task.trim() : "";

  return {
    goal: task,
    task,
    memoryHistory: [],
  };
}

export function extractJsonSafely(value: string): string | null {
  const text = stripCodeFence(value);
  const start = text.indexOf("{");

  if (start === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === "\"") {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === "{") {
      depth += 1;
    }

    if (char === "}") {
      depth -= 1;

      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return null;
}

function normalizePlan(
  value: unknown,
  raw: string,
  fallbackGoal = "",
  memoryHistory: MemoryEntry[] = [],
): AgentControllerOutput {
  if (!value || typeof value !== "object") {
    return createErrorFallback(fallbackGoal, raw);
  }

  const plan = value as {
    goal?: unknown;
    steps?: unknown;
  };

  const goal =
    typeof plan.goal === "string" && plan.goal.trim()
      ? plan.goal.trim()
      : fallbackGoal || "Plan task";

  const completedActions = extractCompletedActions(memoryHistory);
  const plannedActions = new Set<string>();
  const selectedSkill = selectSkill(fallbackGoal || goal);

  const steps = Array.isArray(plan.steps)
    ? plan.steps
        .map((step, index): AgentStep | null => {
          if (!step || typeof step !== "object") {
            return null;
          }

          const item = step as {
            id?: unknown;
            action?: unknown;
            skill?: unknown;
            input?: unknown;
            reasoning?: unknown;
          };

          const action = "execute";
          const stepInput = item.input !== undefined ? item.input : fallbackGoal || goal;
          const reasoning =
            typeof item.reasoning === "string" && item.reasoning.trim()
              ? item.reasoning.trim()
              : selectedSkill.reasoning;

          if (typeof item.action !== "string" || !item.action.trim()) {
            return null;
          }

          if (!isAllowedSkill(selectedSkill.skill)) {
            return null;
          }

          const actionKey = normalizeStepKey(action, selectedSkill.skill, stepInput);

          if (completedActions.has(actionKey) || plannedActions.has(actionKey)) {
            return null;
          }

          plannedActions.add(actionKey);

          return {
            id: typeof item.id === "number" && Number.isFinite(item.id) ? item.id : index + 1,
            action,
            skill: selectedSkill.skill,
            input: stepInput,
            reasoning,
          };
        })
        .filter((step): step is AgentStep => step !== null)
        .map((step, index) => ({
          ...step,
          id: index + 1,
        }))
    : [];

  return {
    goal,
    steps,
    raw,
  };
}

export function parseAgentPlan(
  raw: string,
  fallbackGoal = "",
  memoryHistory: MemoryEntry[] = [],
): AgentControllerOutput {
  try {
    const jsonText = extractJsonSafely(raw);

    if (!jsonText) {
      return createErrorFallback(fallbackGoal, raw);
    }

    return normalizePlan(JSON.parse(jsonText), raw, fallbackGoal, memoryHistory);
  } catch {
    return createErrorFallback(fallbackGoal, raw);
  }
}

export function createErrorFallback(goal = "", raw = ""): AgentControllerOutput {
  const selectedSkill = selectSkill(goal);

  return {
    goal: goal || "Unable to create plan",
    steps: [
      {
        id: 1,
        action: "execute",
        skill: selectedSkill.skill,
        input: goal,
        reasoning: selectedSkill.reasoning,
      },
    ],
    raw,
  };
}

export async function agentController(input: AgentControllerInput): Promise<AgentControllerOutput> {
  const { goal, task, memoryHistory } = normalizeInput(input);

  if (!goal) {
    return createErrorFallback("", "Missing goal");
  }

  try {
    const apiKey = process.env.DEEPSEEK_API_KEY;

    if (!apiKey) {
      return createErrorFallback(goal, "Missing DEEPSEEK_API_KEY");
    }

    const response = await fetch(DEEPSEEK_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL || DEFAULT_MODEL,
        response_format: {
          type: "json_object",
        },
        messages: [
          {
            role: "system",
            content: SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: task,
          },
        ],
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      return createErrorFallback(goal, errorText || `DeepSeek API error: ${response.status}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
    };

    const raw = data.choices?.[0]?.message?.content || "";
    return parseAgentPlan(raw, goal, memoryHistory);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown agent controller error";
    return createErrorFallback(goal, message);
  }
}

export default agentController;
