import { basename, isAbsolute, relative, resolve } from "node:path";
import type { ChangeSetPreview, CreateChangeSetPreviewInput, PlannedChangePreview } from "./types";

const sensitiveEnvNames = new Set([".env", ".env.local", ".env.production", ".env.development"]);

export function createChangeSetPreview(input: CreateChangeSetPreviewInput): ChangeSetPreview {
  const plannedChanges = input.plannedChanges.map((change) => previewPlannedChange(input, change));
  const plannedReads = [...(input.plannedReads ?? [])];
  const plannedWrites = plannedChanges.flatMap((change) =>
    change.operation === "rename" && change.targetPath ? [change.path, change.targetPath] : [change.path],
  );
  const blockedReasons = collectBlockedReasons(input, plannedChanges);
  const requiresApproval =
    blockedReasons.length > 0 ||
    input.project.protected ||
    plannedChanges.some((change) => change.requiresApproval);
  const riskLevel = determineRiskLevel(input, plannedChanges, blockedReasons);
  const status = blockedReasons.length > 0 ? "blocked" : requiresApproval ? "pending_approval" : "preview_ready";

  return {
    changeSetId: createDeterministicChangeSetId(input, plannedChanges),
    goal: input.goal,
    projectId: input.project.id,
    projectType: input.project.type,
    riskLevel,
    requiresApproval,
    status,
    plannedChanges,
    plannedReads,
    plannedWrites,
    blockedReasons,
    approvalRecordId: input.approvalRecordId,
    summary: summarizePreview(status, plannedChanges.length, plannedWrites.length, blockedReasons),
  };
}

function previewPlannedChange(
  input: CreateChangeSetPreviewInput,
  change: CreateChangeSetPreviewInput["plannedChanges"][number],
): PlannedChangePreview {
  const normalizedPath = normalizePreviewPath(input.project.rootPath, change.path);
  const targetNormalizedPath = change.targetPath ? normalizePreviewPath(input.project.rootPath, change.targetPath) : undefined;
  const isPathEscape = pathEscapesRoot(input.project.rootPath, normalizedPath) ||
    Boolean(targetNormalizedPath && pathEscapesRoot(input.project.rootPath, targetNormalizedPath));
  const isEnvFile = isSensitiveEnvFile(normalizedPath) || Boolean(targetNormalizedPath && isSensitiveEnvFile(targetNormalizedPath));
  const requiresApproval = input.project.protected || change.operation === "delete" || change.operation === "rename";

  return {
    operation: change.operation,
    path: change.path,
    normalizedPath,
    targetPath: change.targetPath,
    targetNormalizedPath,
    targetProjectId: input.project.id,
    isProtectedPath: input.project.protected,
    isEnvFile,
    isPathEscape,
    requiresApproval,
    changeSummary: change.changeSummary,
  };
}

function normalizePreviewPath(rootPath: string, relativeOrAbsolutePath: string): string {
  return isAbsolute(relativeOrAbsolutePath) ? resolve(relativeOrAbsolutePath) : resolve(rootPath, relativeOrAbsolutePath);
}

function pathEscapesRoot(rootPath: string, normalizedPath: string): boolean {
  const relativePath = relative(resolve(rootPath), normalizedPath);

  return relativePath.startsWith("..") || isAbsolute(relativePath);
}

function isSensitiveEnvFile(normalizedPath: string): boolean {
  const fileName = basename(normalizedPath).toLowerCase();

  return sensitiveEnvNames.has(fileName) || (fileName.startsWith(".env.") && fileName.endsWith(".local"));
}

function collectBlockedReasons(input: CreateChangeSetPreviewInput, plannedChanges: PlannedChangePreview[]): string[] {
  const reasons = new Set<string>();

  for (const change of plannedChanges) {
    if (change.isPathEscape) {
      reasons.add("ChangeSet path escape blocked");
    }

    if (change.isEnvFile) {
      reasons.add("ChangeSet sensitive env file write blocked");
    }

    if (change.operation === "delete" && input.allowDeletes !== true) {
      reasons.add("ChangeSet delete operation blocked by default");
    }
  }

  return [...reasons];
}

function determineRiskLevel(
  input: CreateChangeSetPreviewInput,
  plannedChanges: PlannedChangePreview[],
  blockedReasons: string[],
): ChangeSetPreview["riskLevel"] {
  if (blockedReasons.length > 0) {
    return "blocked";
  }

  if (input.project.protected || plannedChanges.some((change) => change.operation === "delete")) {
    return "high";
  }

  if (plannedChanges.some((change) => change.operation === "rename" || change.operation === "update")) {
    return "medium";
  }

  return "low";
}

function summarizePreview(
  status: ChangeSetPreview["status"],
  changeCount: number,
  writeCount: number,
  blockedReasons: string[],
): string {
  if (status === "blocked") {
    return `ChangeSet preview blocked for ${changeCount} planned change(s): ${blockedReasons.join("; ")}. No files were modified.`;
  }

  if (status === "pending_approval") {
    return `ChangeSet preview requires approval for ${changeCount} planned change(s) and ${writeCount} planned write path(s). No files were modified.`;
  }

  return `ChangeSet preview ready for ${changeCount} planned change(s) and ${writeCount} planned write path(s). No files were modified.`;
}

function createDeterministicChangeSetId(
  input: CreateChangeSetPreviewInput,
  plannedChanges: PlannedChangePreview[],
): string {
  const text = JSON.stringify({
    goal: input.goal,
    projectId: input.project.id,
    plannedChanges: plannedChanges.map((change) => ({
      operation: change.operation,
      path: change.path,
      targetPath: change.targetPath,
      changeSummary: change.changeSummary,
    })),
    plannedReads: input.plannedReads ?? [],
  });

  let hash = 0;

  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }

  return `changeset-${hash.toString(16).padStart(8, "0")}`;
}
