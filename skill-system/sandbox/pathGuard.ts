import { basename, extname, isAbsolute, relative, resolve } from "node:path";
import type { SandboxConfig } from "./types";

export function normalizeSandboxPath(rootDir: string, targetPath: string): string {
  return resolve(rootDir, targetPath);
}

export function assertPathInsideRoot(rootDir: string, targetPath: string): void {
  const normalizedRoot = resolve(rootDir);
  const normalizedTarget = normalizeSandboxPath(normalizedRoot, targetPath);
  const relativePath = relative(normalizedRoot, normalizedTarget);

  if (relativePath === "") {
    return;
  }

  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error("Sandbox path escape blocked");
  }
}

export function assertNotBlockedFile(targetPath: string, config: SandboxConfig): void {
  const fileName = basename(targetPath).toLowerCase();
  const blockedFileNames = new Set(config.blockedFileNames.map((name) => name.toLowerCase()));

  if (blockedFileNames.has(fileName)) {
    throw new Error("Blocked sensitive file access");
  }

  const extension = extname(targetPath).toLowerCase();
  const blockedExtensions = new Set(config.blockedExtensions.map((item) => item.toLowerCase()));

  if (extension && blockedExtensions.has(extension)) {
    throw new Error(`Blocked file extension: ${extension}`);
  }
}

export function assertSandboxPathAllowed(rootDir: string, targetPath: string, config: SandboxConfig): string {
  const normalizedPath = normalizeSandboxPath(rootDir, targetPath);

  assertPathInsideRoot(rootDir, targetPath);
  assertNotBlockedFile(normalizedPath, config);

  return normalizedPath;
}
