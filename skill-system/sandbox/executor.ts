import {
  sandboxDeleteFile,
  sandboxListDir,
  sandboxReadFile,
  sandboxWriteFile,
  type SandboxListResult,
  type SandboxReadResult,
} from "./fileSandbox";
import { normalizeSandboxPath } from "./pathGuard";
import type { SandboxConfig, SandboxExecutionResult, SandboxOperation } from "./types";

export type ExecuteSandboxOperationResult = SandboxExecutionResult | SandboxReadResult | SandboxListResult;

export async function executeSandboxOperation(
  config: SandboxConfig,
  operation: SandboxOperation,
  targetPath: string,
  content = "",
): Promise<ExecuteSandboxOperationResult> {
  switch (operation) {
    case "read":
      return sandboxReadFile(config, targetPath);
    case "write":
      return sandboxWriteFile(config, targetPath, content);
    case "list":
      return sandboxListDir(config, targetPath);
    case "delete":
      return sandboxDeleteFile(config, targetPath);
    default: {
      const message = `Unsupported sandbox operation: ${String(operation)}`;

      return {
        mode: "sandbox",
        success: false,
        operation,
        targetPath,
        normalizedPath: normalizeSandboxPath(config.rootDir, targetPath),
        message,
        blockedReasons: [message],
      };
    }
  }
}
