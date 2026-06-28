import type { WorkspaceProject } from "../workspace";
import type { WorkflowApprovalDecision, WorkflowApprovalRecord, WorkflowApprovalStatus } from "./types";

export type CreateWorkflowApprovalRecordInput = {
  goal: string;
  project?: WorkspaceProject;
  riskLevel?: string;
  requiresApproval: boolean;
  plannedReads: string[];
  plannedWrites: string[];
  permissions: string[];
  capabilities: string[];
  blockedReasons: string[];
  requestedBy?: string;
  requestedAt?: string;
  decision?: WorkflowApprovalDecision;
};

const defaultRequestedAt = "1970-01-01T00:00:00.000Z";

function stableHash(value: string): string {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash.toString(16).padStart(8, "0");
}

function determineApprovalStatus(input: CreateWorkflowApprovalRecordInput): WorkflowApprovalStatus {
  if (input.blockedReasons.length > 0) {
    return input.decision?.status === "rejected" ? "rejected" : "blocked";
  }

  if (!input.requiresApproval) {
    return "not_required";
  }

  if (input.decision?.status === "approved") {
    return "approved";
  }

  if (input.decision?.status === "rejected") {
    return "rejected";
  }

  return "pending";
}

function buildApprovalSummary(status: WorkflowApprovalStatus): string {
  if (status === "approved") {
    return "Workflow approval recorded as approved. Approved plan remains dry-run only until execution is explicitly invoked.";
  }

  if (status === "rejected") {
    return "Workflow approval was rejected. Real execution must not proceed.";
  }

  if (status === "blocked") {
    return "Workflow is blocked by policy or safety guard. Real execution must not proceed.";
  }

  if (status === "not_required") {
    return "Workflow does not require approval for the current dry-run plan.";
  }

  return "Workflow approval is pending. Real execution must not proceed.";
}

export function createWorkflowApprovalRecord(input: CreateWorkflowApprovalRecordInput): WorkflowApprovalRecord {
  const status = determineApprovalStatus(input);
  const requestedAt = input.requestedAt || defaultRequestedAt;
  const identity = [
    input.goal,
    input.project?.id || "no-project",
    input.riskLevel || "unknown-risk",
    status,
    requestedAt,
  ].join("|");

  return {
    approvalId: `approval-${stableHash(identity)}`,
    status,
    approvedBy: status === "approved" ? input.decision?.decidedBy : undefined,
    requestedBy: input.requestedBy,
    requestedAt,
    decidedAt: status === "approved" || status === "rejected" ? input.decision?.decidedAt || requestedAt : undefined,
    goal: input.goal,
    projectId: input.project?.id,
    projectType: input.project?.type,
    riskLevel: input.riskLevel,
    requiresApproval: input.requiresApproval,
    approvedPlannedReads: [...input.plannedReads],
    approvedPlannedWrites: [...input.plannedWrites],
    approvedPermissions: [...input.permissions],
    approvedCapabilities: [...input.capabilities],
    blockedReasons: [...input.blockedReasons],
    approvalSummary: buildApprovalSummary(status),
  };
}
