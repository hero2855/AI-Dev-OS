export type Skill = {
  name: string;
  description: string;
  execute: (input: any) => Promise<string>;
};

export type SkillName =
  | "code_editor"
  | "resume_analyzer"
  | "content_writer"
  | "browser_tool";
