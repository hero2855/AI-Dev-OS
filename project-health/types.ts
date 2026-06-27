export type ProjectRuntime = "node" | "nextjs" | "unknown";

export type ProjectHealthStatus = "healthy" | "warning" | "blocked";

export type ProjectHealthCheckResult = {
  projectId: string;
  projectName: string;
  rootPath: string;
  exists: boolean;
  runtime: ProjectRuntime;
  packageJsonExists: boolean;
  packageManager: "pnpm" | "npm" | "yarn" | "unknown";
  scripts: {
    dev?: string;
    build?: string;
    test?: string;
    lint?: string;
    verify?: string;
  };
  lockfiles: string[];
  deploymentHints: string[];
  envExampleExists: boolean;
  envFilesWereRead: false;
  status: ProjectHealthStatus;
  warnings: string[];
  blockingIssues: string[];
  recommendedNextSteps: string[];
};
