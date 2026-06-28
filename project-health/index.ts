export type { ProjectHealthCheckResult, ProjectHealthStatus, ProjectRuntime } from "./types";
export {
  detectDeploymentHints,
  detectEnvExample,
  detectLockfiles,
  detectPackageManager,
  detectRuntime,
  detectScripts,
  fileExists,
  readJsonFileSafe,
} from "./detectors";
export { runProjectHealthCheck } from "./healthCheck";
export { analyzeTypeScriptHealth } from "./typescriptHealth";
export type {
  TypeScriptHealthDiagnostic,
  TypeScriptHealthInput,
  TypeScriptHealthIssue,
  TypeScriptHealthIssueKind,
  TypeScriptHealthStatus,
} from "./typescriptHealth";
