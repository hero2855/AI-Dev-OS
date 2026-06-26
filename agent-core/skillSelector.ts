import type { SkillName } from "../skill-system";

export type SkillSelection = {
  skill: SkillName;
  confidence: number;
  reasoning: string;
};

function includesAny(value: string, terms: string[]): boolean {
  return terms.some((term) => value.includes(term));
}

export function selectSkill(goal: string): SkillSelection {
  const normalizedGoal = typeof goal === "string" ? goal.toLowerCase() : "";

  if (
    (normalizedGoal.includes("analyze") && normalizedGoal.includes("resume")) ||
    includesAny(normalizedGoal, ["resume analysis", "analyze resume", "简历分析", "分析简历"])
  ) {
    return {
      skill: "resume_analyzer",
      confidence: 0.95,
      reasoning: "The goal asks for resume analysis.",
    };
  }

  if (includesAny(normalizedGoal, ["search", "find", "look up"])) {
    return {
      skill: "browser_tool",
      confidence: 0.9,
      reasoning: "The goal asks to search, find, or look up information.",
    };
  }

  if (includesAny(normalizedGoal, ["code", "edit file"])) {
    return {
      skill: "code_editor",
      confidence: 0.9,
      reasoning: "The goal involves code or editing files.",
    };
  }

  if (normalizedGoal.trim() === "resume") {
    return {
      skill: "resume_analyzer",
      confidence: 0.7,
      reasoning: "The goal only mentions resume, so resume_analyzer is safer than content_writer.",
    };
  }

  if (includesAny(normalizedGoal, ["write", "improve"])) {
    return {
      skill: "content_writer",
      confidence: 0.85,
      reasoning: "The goal asks to write, improve, or work with resume text.",
    };
  }

  return {
    skill: "content_writer",
    confidence: 0.6,
    reasoning: "No specific tool intent was detected, so content_writer is the default skill.",
  };
}

export default selectSkill;
