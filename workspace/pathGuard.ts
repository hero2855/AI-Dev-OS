import { basename, isAbsolute, relative, resolve } from "node:path";
import type { WorkspaceProject } from "./types";

const blockedSensitiveFileNames = new Set([".env", ".env.local", ".env.production", ".env.development"]);

export function normalizeProjectPath(project: WorkspaceProject, relativeOrAbsolutePath: string): string {
  if (isAbsolute(relativeOrAbsolutePath)) {
    return resolve(relativeOrAbsolutePath);
  }

  return resolve(project.rootPath, relativeOrAbsolutePath);
}

export function assertPathInsideProject(project: WorkspaceProject, targetPath: string): void {
  const normalizedRoot = resolve(project.rootPath);
  const normalizedTarget = normalizeProjectPath(project, targetPath);
  const relativePath = relative(normalizedRoot, normalizedTarget);

  if (relativePath === "") {
    return;
  }

  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error("Workspace path escape blocked");
  }
}

export function assertNotSensitiveProjectPath(targetPath: string): void {
  const fileName = basename(targetPath).toLowerCase();

  if (blockedSensitiveFileNames.has(fileName)) {
    throw new Error("Workspace sensitive file access blocked");
  }
}

export function assertWorkspacePathAllowed(project: WorkspaceProject, targetPath: string): string {
  const normalizedPath = normalizeProjectPath(project, targetPath);

  assertPathInsideProject(project, normalizedPath);
  assertNotSensitiveProjectPath(normalizedPath);

  return normalizedPath;
}
