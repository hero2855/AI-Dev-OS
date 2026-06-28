import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateGitHubSkillManifest, type GitHubSkillManifest } from "./manifest";
import { assertSha256Integrity } from "./integrity";
import { isTrustedRepo } from "./trustedRepos";
import { validateSkillPolicy } from "../policy/policy";

const DEFAULT_BRANCH = "main";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const lockPath = join(__dirname, "skill-manifest-lock.json");

export type SkillManifestLockEntry = {
  name: string;
  version: string;
  path: string;
  sha256: string;
};

export type SkillManifestLock = {
  trustedRepo: string;
  index: {
    path: string;
    sha256: string;
  };
  skills: SkillManifestLockEntry[];
};

function normalizeRepoUrl(repoUrl: string): string {
  return repoUrl.trim().replace(/\/$/, "");
}

function loadSkillManifestLock(): SkillManifestLock {
  try {
    return JSON.parse(readFileSync(lockPath, "utf8")) as SkillManifestLock;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load skill manifest lock: ${message}`);
  }
}

function getRawBaseUrl(repoUrl: string): string {
  const normalizedRepoUrl = normalizeRepoUrl(repoUrl);
  const match = normalizedRepoUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)$/);

  if (!match) {
    throw new Error("Invalid GitHub repo URL");
  }

  const [, owner, repo] = match;
  return `https://raw.githubusercontent.com/${owner}/${repo}/${DEFAULT_BRANCH}`;
}

function joinRawUrl(baseUrl: string, path: string): string {
  const safePath = path.replace(/^\/+/, "");
  return `${baseUrl}/${safePath}`;
}

async function fetchText(url: string, label: string): Promise<string> {
  let response: Response;

  try {
    response = await fetch(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to fetch ${label}: ${message}`);
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch ${label}: HTTP ${response.status}`);
  }

  return response.text();
}

export type SkillManifestTextFetcher = (url: string, label: string) => Promise<string>;

export type LoadGitHubSkillManifestIndexOptions = {
  fetchText?: SkillManifestTextFetcher;
  lock?: SkillManifestLock;
};

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON in ${label}: ${message}`);
  }
}

function extractManifestPaths(indexJson: unknown): string[] {
  if (Array.isArray(indexJson)) {
    return indexJson.map((item) => {
      if (typeof item === "string") {
        return item;
      }

      if (item && typeof item === "object" && typeof (item as { path?: unknown }).path === "string") {
        return (item as { path: string }).path;
      }

      throw new Error("Invalid manifest index: each item must be a path string or object with path");
    });
  }

  if (indexJson && typeof indexJson === "object") {
    const value = indexJson as {
      skills?: unknown;
      manifests?: unknown;
    };
    const list = Array.isArray(value.skills)
      ? value.skills
      : Array.isArray(value.manifests)
        ? value.manifests
        : null;

    if (!list) {
      throw new Error("Invalid manifest index: expected skills or manifests array");
    }

    return extractManifestPaths(list);
  }

  throw new Error("Invalid manifest index: expected array or object");
}

function getLockedSkill(lock: SkillManifestLock, manifestPath: string): SkillManifestLockEntry {
  const lockedSkill = lock.skills.find((skill) => skill.path === manifestPath);

  if (!lockedSkill) {
    throw new Error(`Manifest path is not locked: ${manifestPath}`);
  }

  return lockedSkill;
}

export function assertManifestMatchesLock(
  manifest: GitHubSkillManifest,
  lockedSkill: SkillManifestLockEntry,
): void {
  if (manifest.name !== lockedSkill.name) {
    throw new Error(`Skill name mismatch for ${lockedSkill.path}`);
  }

  if (manifest.version !== lockedSkill.version) {
    throw new Error(`Version mismatch for ${lockedSkill.name}`);
  }
}

export function getSkillManifestLock(): SkillManifestLock {
  return loadSkillManifestLock();
}

export async function loadGitHubSkillManifest(repoUrl: string): Promise<GitHubSkillManifest> {
  const manifests = await loadGitHubSkillManifestIndex(repoUrl);
  const [firstManifest] = manifests;

  if (!firstManifest) {
    throw new Error("No GitHub skill manifests found");
  }

  return firstManifest;
}

export async function loadGitHubSkillManifestIndex(
  repoUrl: string,
  options: LoadGitHubSkillManifestIndexOptions = {},
): Promise<GitHubSkillManifest[]> {
  if (!isTrustedRepo(repoUrl)) {
    throw new Error("Untrusted GitHub skill repo");
  }

  const lock = options.lock || loadSkillManifestLock();
  const textFetcher = options.fetchText || fetchText;

  if (normalizeRepoUrl(repoUrl) !== normalizeRepoUrl(lock.trustedRepo)) {
    throw new Error("Trusted repo does not match skill manifest lock");
  }

  const rawBaseUrl = getRawBaseUrl(repoUrl);
  const indexUrl = joinRawUrl(rawBaseUrl, lock.index.path);
  const indexText = await textFetcher(indexUrl, "GitHub skill manifest index");

  assertSha256Integrity(indexText, lock.index.sha256, lock.index.path);

  const indexJson = parseJson(indexText, "GitHub skill manifest index");
  const manifestPaths = extractManifestPaths(indexJson);

  if (manifestPaths.length === 0) {
    throw new Error("Invalid manifest index: no manifest paths found");
  }

  const manifests: GitHubSkillManifest[] = [];

  for (const manifestPath of manifestPaths) {
    const lockedSkill = getLockedSkill(lock, manifestPath);
    const manifestUrl = joinRawUrl(rawBaseUrl, manifestPath);
    const manifestText = await textFetcher(manifestUrl, `GitHub skill manifest ${manifestPath}`);

    assertSha256Integrity(manifestText, lockedSkill.sha256, manifestPath);

    try {
      const manifest = validateGitHubSkillManifest(parseJson(manifestText, `GitHub skill manifest ${manifestPath}`));
      assertManifestMatchesLock(manifest, lockedSkill);
      validateSkillPolicy(manifest);
      manifests.push(manifest);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid GitHub skill manifest ${manifestPath}: ${message}`);
    }
  }

  return manifests;
}

export default loadGitHubSkillManifest;
