export type SandboxOperation = "read" | "write" | "list" | "delete";

export type SandboxExecutionMode = "sandbox";

export type SandboxExecutionResult = {
  mode: "sandbox";
  success: boolean;
  operation: SandboxOperation;
  targetPath: string;
  normalizedPath: string;
  message: string;
  blockedReasons: string[];
};

export type SandboxConfig = {
  rootDir: string;
  allowWrites: boolean;
  allowDeletes: boolean;
  blockedFileNames: string[];
  blockedExtensions: string[];
};
