export type Skill = {
  name: string;
  description: string;
  execute: (input: any) => Promise<any>;
};

export type SkillName =
  | "code_editor"
  | "browser_tool"
  | "resume_analyzer"
  | "content_writer";
