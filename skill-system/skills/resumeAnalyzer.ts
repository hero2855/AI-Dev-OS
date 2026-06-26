import type { Skill } from "../types";

const resumeAnalyzerSkill: Skill = {
  name: "resume_analyzer",
  description: "Mock resume analyzer for reviewing resume content.",
  execute: async (input: any): Promise<string> => {
    const resumeText = typeof input === "string" ? input : JSON.stringify(input);
    return `Mock resume analysis result for: ${resumeText}`;
  },
};

export default resumeAnalyzerSkill;
