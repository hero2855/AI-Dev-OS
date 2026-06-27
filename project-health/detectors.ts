import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ProjectHealthCheckResult, ProjectRuntime } from "./types";

type PackageJsonLike = {
  scripts?: Record<string, unknown>;
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
};

function isPackageJsonLike(value: unknown): value is PackageJsonLike {
  return typeof value === "object" && value !== null;
}

export function fileExists(path: string): boolean {
  return existsSync(path);
}

export function readJsonFileSafe(path: string): unknown | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

export function detectPackageManager(rootPath: string): "pnpm" | "npm" | "yarn" | "unknown" {
  if (fileExists(join(rootPath, "pnpm-lock.yaml"))) {
    return "pnpm";
  }

  if (fileExists(join(rootPath, "package-lock.json"))) {
    return "npm";
  }

  if (fileExists(join(rootPath, "yarn.lock"))) {
    return "yarn";
  }

  return "unknown";
}

export function detectRuntime(rootPath: string, packageJson?: unknown): ProjectRuntime {
  if (!fileExists(join(rootPath, "package.json"))) {
    return "unknown";
  }

  if (!isPackageJsonLike(packageJson)) {
    return "node";
  }

  const dependencies = packageJson.dependencies || {};
  const devDependencies = packageJson.devDependencies || {};

  if ("next" in dependencies || "next" in devDependencies) {
    return "nextjs";
  }

  return "node";
}

export function detectScripts(packageJson?: unknown): ProjectHealthCheckResult["scripts"] {
  if (!isPackageJsonLike(packageJson) || typeof packageJson.scripts !== "object" || packageJson.scripts === null) {
    return {};
  }

  const scripts: ProjectHealthCheckResult["scripts"] = {};

  for (const key of ["dev", "build", "test", "lint", "verify"] as const) {
    const value = packageJson.scripts[key];

    if (typeof value === "string") {
      scripts[key] = value;
    }
  }

  return scripts;
}

export function detectLockfiles(rootPath: string): string[] {
  return ["pnpm-lock.yaml", "package-lock.json", "yarn.lock"].filter((name) => fileExists(join(rootPath, name)));
}

export function detectDeploymentHints(rootPath: string, packageJson?: unknown): string[] {
  const hints: string[] = [];
  const scripts = detectScripts(packageJson);

  if (fileExists(join(rootPath, "vercel.json"))) {
    hints.push("vercel");
  }

  if (fileExists(join(rootPath, "next.config.js")) || fileExists(join(rootPath, "next.config.ts"))) {
    hints.push("nextjs-config");
  }

  if (scripts.build) {
    hints.push("build-script");
  }

  return hints;
}

export function detectEnvExample(rootPath: string): boolean {
  return fileExists(join(rootPath, ".env.example"));
}
