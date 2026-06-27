import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { assertSandboxPathAllowed, normalizeSandboxPath } from "./pathGuard";
import type { SandboxConfig, SandboxExecutionResult, SandboxOperation } from "./types";

export type SandboxReadResult = SandboxExecutionResult & {
  content?: string;
};

export type SandboxListResult = SandboxExecutionResult & {
  entries?: string[];
};

export function createDefaultSandboxConfig(rootDir: string): SandboxConfig {
  return {
    rootDir,
    allowWrites: true,
    allowDeletes: false,
    blockedFileNames: [".env", ".env.local", ".env.production", ".env.development"],
    blockedExtensions: [],
  };
}

function createSuccessResult(
  operation: SandboxOperation,
  targetPath: string,
  normalizedPath: string,
  message: string,
): SandboxExecutionResult {
  return {
    mode: "sandbox",
    success: true,
    operation,
    targetPath,
    normalizedPath,
    message,
    blockedReasons: [],
  };
}

function createBlockedResult(
  config: SandboxConfig,
  operation: SandboxOperation,
  targetPath: string,
  error: unknown,
): SandboxExecutionResult {
  const message = error instanceof Error ? error.message : String(error);

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

export async function sandboxReadFile(config: SandboxConfig, targetPath: string): Promise<SandboxReadResult> {
  try {
    const normalizedPath = assertSandboxPathAllowed(config.rootDir, targetPath, config);
    const content = await readFile(normalizedPath, "utf8");

    return {
      ...createSuccessResult("read", targetPath, normalizedPath, "Sandbox read completed"),
      content,
    };
  } catch (error) {
    return createBlockedResult(config, "read", targetPath, error);
  }
}

export async function sandboxWriteFile(
  config: SandboxConfig,
  targetPath: string,
  content: string,
): Promise<SandboxExecutionResult> {
  try {
    if (!config.allowWrites) {
      throw new Error("Sandbox writes are disabled");
    }

    const normalizedPath = assertSandboxPathAllowed(config.rootDir, targetPath, config);

    await mkdir(dirname(normalizedPath), { recursive: true });
    await writeFile(normalizedPath, content, "utf8");

    return createSuccessResult("write", targetPath, normalizedPath, "Sandbox write completed");
  } catch (error) {
    return createBlockedResult(config, "write", targetPath, error);
  }
}

export async function sandboxListDir(config: SandboxConfig, targetPath: string): Promise<SandboxListResult> {
  try {
    const normalizedPath = assertSandboxPathAllowed(config.rootDir, targetPath, config);
    const entries = await readdir(normalizedPath);

    return {
      ...createSuccessResult("list", targetPath, normalizedPath, "Sandbox list completed"),
      entries,
    };
  } catch (error) {
    return createBlockedResult(config, "list", targetPath, error);
  }
}

export async function sandboxDeleteFile(config: SandboxConfig, targetPath: string): Promise<SandboxExecutionResult> {
  try {
    if (!config.allowDeletes) {
      throw new Error("Sandbox deletes are disabled");
    }

    const normalizedPath = assertSandboxPathAllowed(config.rootDir, targetPath, config);

    await rm(normalizedPath, { force: false });

    return createSuccessResult("delete", targetPath, normalizedPath, "Sandbox delete completed");
  } catch (error) {
    return createBlockedResult(config, "delete", targetPath, error);
  }
}
