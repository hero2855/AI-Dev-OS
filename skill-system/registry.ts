import type { Skill, SkillName } from "./types";

const registry = new Map<string, Skill>();

export function registerSkill(skill: Skill): Skill {
  if (!skill.name || typeof skill.execute !== "function") {
    throw new Error("Invalid skill");
  }

  registry.set(skill.name, skill);
  return skill;
}

export function registerSkills(skills: Skill[]): Skill[] {
  return skills.map((skill) => registerSkill(skill));
}

export function getSkill(name: SkillName | string): Skill | undefined {
  return registry.get(name);
}

export function listSkills(): Skill[] {
  return Array.from(registry.values());
}

export default registry;
