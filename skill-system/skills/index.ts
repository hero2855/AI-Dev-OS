import type { Skill } from "../types";
import browserToolSkill from "./browserTool";
import contentWriterSkill from "./contentWriter";
import resumeAnalyzerSkill from "./resumeAnalyzer";

export const defaultSkills: Skill[] = [
  browserToolSkill,
  contentWriterSkill,
  resumeAnalyzerSkill,
];

export {
  browserToolSkill,
  contentWriterSkill,
  resumeAnalyzerSkill,
};
