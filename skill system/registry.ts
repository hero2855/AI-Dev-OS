import type { Skill, SkillName } from "./types";

const registry = new Map<string, Skill>();

function normalizeInput(input: any): string {
  if (typeof input === "string") {
    return input;
  }

  if (input === null || input === undefined) {
    return "";
  }

  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}

export function registerSkill(skill: Skill): void {
  if (!skill.name || typeof skill.execute !== "function") {
    throw new Error("Invalid skill");
  }

  registry.set(skill.name, skill);
}

export async function executeSkill(name: SkillName | string, input: any): Promise<string> {
  const skill = registry.get(name);

  if (!skill) {
    return `Skill not found: ${name}`;
  }

  try {
    return await skill.execute(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown skill execution error";
    return `Skill execution failed: ${message}`;
  }
}

registerSkill({
  name: "code_editor",
  description: "Handles code editing tasks and returns a mock code modification result.",
  execute: async (input: any): Promise<string> => {
    const task = normalizeInput(input);
    return `Mock code edit completed for task: ${task}`;
  },
});

registerSkill({
  name: "resume_analyzer",
  description: "Analyzes resume text and returns a mock resume review.",
  execute: async (input: any): Promise<string> => {
    const resumeText = normalizeInput(input);
    return `Mock resume analysis completed. Key result: the resume was reviewed for clarity, skills, and experience. Input length: ${resumeText.length}`;
  },
});

registerSkill({
  name: "content_writer",
  description: "Handles writing tasks and returns mock generated content.",
  execute: async (input: any): Promise<string> => {
    const task = normalizeInput(input);
    return `Mock content generated for writing task: ${task}`;
  },
});

registerSkill({
  name: "browser_tool",
  description: "Handles search tasks and returns mock browser search results.",
  execute: async (input: any): Promise<string> => {
    const query = normalizeInput(input);
    return `Mock search results for: ${query}`;
  },
});

export default registry;
