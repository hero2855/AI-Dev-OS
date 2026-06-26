import { validateGitHubSkillManifest, type GitHubSkillManifest } from "./manifest";
import { isTrustedRepo } from "./trustedRepos";

const DEFAULT_BRANCH = "main";
const MANIFEST_INDEX_PATH = "skills/index.json";

function normalizeRepoUrl(repoUrl: string): string {
  return repoUrl.trim().replace(/\/$/, "");
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

async function fetchJson(url: string, label: string): Promise<unknown> {
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

  try {
    return await response.json();
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

export async function loadGitHubSkillManifest(repoUrl: string): Promise<GitHubSkillManifest> {
  const manifests = await loadGitHubSkillManifestIndex(repoUrl);
  const [firstManifest] = manifests;

  if (!firstManifest) {
    throw new Error("No GitHub skill manifests found");
  }

  return firstManifest;
}

export async function loadGitHubSkillManifestIndex(repoUrl: string): Promise<GitHubSkillManifest[]> {
  if (!isTrustedRepo(repoUrl)) {
    throw new Error("Untrusted GitHub skill repo");
  }

  const rawBaseUrl = getRawBaseUrl(repoUrl);
  const indexUrl = joinRawUrl(rawBaseUrl, MANIFEST_INDEX_PATH);
  const indexJson = await fetchJson(indexUrl, "GitHub skill manifest index");
  const manifestPaths = extractManifestPaths(indexJson);

  if (manifestPaths.length === 0) {
    throw new Error("Invalid manifest index: no manifest paths found");
  }

  const manifests: GitHubSkillManifest[] = [];

  for (const manifestPath of manifestPaths) {
    const manifestUrl = joinRawUrl(rawBaseUrl, manifestPath);
    const manifestJson = await fetchJson(manifestUrl, `GitHub skill manifest ${manifestPath}`);

    try {
      manifests.push(validateGitHubSkillManifest(manifestJson));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid GitHub skill manifest ${manifestPath}: ${message}`);
    }
  }

  return manifests;
}

export default loadGitHubSkillManifest;
