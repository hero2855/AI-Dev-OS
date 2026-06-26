import type { Skill } from "../types";

const browserToolSkill: Skill = {
  name: "browser_tool",
  description: "Mock browser/search tool for gathering information.",
  execute: async (input: any): Promise<string> => {
    const query = typeof input === "string" ? input : JSON.stringify(input);
    return `Mock search result for: ${query}`;
  },
};

export default browserToolSkill;
