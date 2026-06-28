export type TypeScriptHealthStatus = "pass" | "blocked" | "fail";

export type TypeScriptHealthIssueKind =
  | "missing_typescript"
  | "missing_node_types"
  | "strict_type_error"
  | "unknown_typecheck_error";

export type TypeScriptHealthInput = {
  hasTypeScriptDependency: boolean;
  hasNodeTypesDependency: boolean;
  hasTypecheckScript: boolean;
  exitCode: number | null;
  output: string;
};

export type TypeScriptHealthIssue = {
  kind: TypeScriptHealthIssueKind;
  message: string;
};

export type TypeScriptHealthDiagnostic = {
  status: TypeScriptHealthStatus;
  canRunLocalTypecheck: boolean;
  missingDependencies: string[];
  issues: TypeScriptHealthIssue[];
  recommendedNextStep: string;
};

const nodeTypePatterns = [
  /Cannot find module 'node:[^']+'/,
  /Cannot find name 'process'/,
  /Do you need to install type definitions for node\?/,
];

const strictTypePatterns = [
  /implicitly has type 'any'/,
  /is not assignable to parameter of type/,
  /This comparison appears to be unintentional/,
];

export function analyzeTypeScriptHealth(input: TypeScriptHealthInput): TypeScriptHealthDiagnostic {
  const missingDependencies = [
    input.hasTypeScriptDependency ? "" : "typescript",
    input.hasNodeTypesDependency ? "" : "@types/node",
  ].filter(Boolean);

  const issues = detectTypeScriptHealthIssues(input, missingDependencies);
  const canRunLocalTypecheck = input.hasTypeScriptDependency && input.hasTypecheckScript;

  if (!input.hasTypeScriptDependency) {
    return {
      status: "blocked",
      canRunLocalTypecheck: false,
      missingDependencies,
      issues,
      recommendedNextStep: "Add the local TypeScript dependency before running typecheck. Do not install during a no-install health pass.",
    };
  }

  if (input.exitCode === 0 && issues.length === 0) {
    return {
      status: "pass",
      canRunLocalTypecheck,
      missingDependencies,
      issues,
      recommendedNextStep: "TypeScript health passed with local dependencies.",
    };
  }

  if (missingDependencies.includes("@types/node") || issues.some((issue) => issue.kind === "missing_node_types")) {
    return {
      status: "blocked",
      canRunLocalTypecheck,
      missingDependencies,
      issues,
      recommendedNextStep:
        "Install @types/node in a separately approved dependency step, then rerun npm run typecheck and fix any remaining strict TypeScript errors.",
    };
  }

  return {
    status: "fail",
    canRunLocalTypecheck,
    missingDependencies,
    issues,
    recommendedNextStep: "Fix the reported TypeScript errors and rerun npm run typecheck.",
  };
}

function detectTypeScriptHealthIssues(
  input: TypeScriptHealthInput,
  missingDependencies: string[],
): TypeScriptHealthIssue[] {
  const issues: TypeScriptHealthIssue[] = [];

  if (missingDependencies.includes("typescript")) {
    issues.push({
      kind: "missing_typescript",
      message: "Local TypeScript dependency is missing.",
    });
  }

  if (missingDependencies.includes("@types/node") || nodeTypePatterns.some((pattern) => pattern.test(input.output))) {
    issues.push({
      kind: "missing_node_types",
      message: "Node runtime type declarations are missing, so node:* modules and process cannot be typed.",
    });
  }

  if (strictTypePatterns.some((pattern) => pattern.test(input.output))) {
    issues.push({
      kind: "strict_type_error",
      message: "Strict TypeScript errors are present in local source or verification files.",
    });
  }

  if (input.exitCode !== 0 && input.output.trim().length > 0 && issues.length === 0) {
    issues.push({
      kind: "unknown_typecheck_error",
      message: "TypeScript failed with an unclassified local error.",
    });
  }

  return issues;
}
