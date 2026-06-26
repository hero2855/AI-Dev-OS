import type { Skill } from "../types";

const contentWriterSkill: Skill = {
  name: "content_writer",
  description: "Mock content writer for rewriting or drafting text.",
  execute: async (input: any): Promise<string> => {
    const text = typeof input === "string" ? input : JSON.stringify(input);
    return `Rewritten text: ${text}`;
  },
};

export default contentWriterSkill;
