import { assertSha256Integrity } from "./integrity";
import { validateGitHubSkillManifest, type GitHubSkillManifest } from "./manifest";
import type { SkillManifestLock } from "./manifestLoader";
import { validateSkillPolicy } from "../policy/policy";

export const PONYTAIL_REPO_URL = "https://github.com/DietrichGebert/ponytail";
export const PONYTAIL_MANIFEST_INDEX_PATH = ".ai-dev-os/skills/index.json";
export const PONYTAIL_MANIFEST_PATH = ".ai-dev-os/skills/ponytail/skill.json";
export const PONYTAIL_MANIFEST_INDEX_SHA256 = "1f23898f4515f4be79bc785becbafc1079d2e7aff84f716d6e95c8ed15581e0e";
export const PONYTAIL_MANIFEST_SHA256 = "9f78d7af4d16d63b7e61e6fa3f96259fec51c1d52d73e08bb6b07e90776ab96a";

export const PONYTAIL_SKILL_MANIFEST: GitHubSkillManifest = {
  name: "ponytail",
  version: "4.8.3",
  description:
    "Metadata-only Ponytail programming skill. Advises on simplest correct implementation, code review, refactoring, and source editing without executing Ponytail code.",
  entry: "skills/ponytail/SKILL.md",
  capabilities: ["programming_guidance", "code_refactor", "source_editing", "code_review"],
  permissions: ["file:read", "file:write:src"],
};

const pinnedIndexText = JSON.stringify({
  skills: [{ path: PONYTAIL_MANIFEST_PATH }],
});
const pinnedManifestText = JSON.stringify(PONYTAIL_SKILL_MANIFEST);

function normalizeRepoUrl(repoUrl: string): string {
  return repoUrl.trim().replace(/\/$/, "");
}

function assertPonytailRepo(repoUrl: string): void {
  if (normalizeRepoUrl(repoUrl) !== normalizeRepoUrl(PONYTAIL_REPO_URL)) {
    throw new Error("Pinned Ponytail manifest requested for unexpected repo");
  }
}

export function getPinnedPonytailManifestLock(): SkillManifestLock {
  return {
    trustedRepo: PONYTAIL_REPO_URL,
    index: {
      path: PONYTAIL_MANIFEST_INDEX_PATH,
      sha256: PONYTAIL_MANIFEST_INDEX_SHA256,
    },
    skills: [
      {
        name: PONYTAIL_SKILL_MANIFEST.name,
        version: PONYTAIL_SKILL_MANIFEST.version,
        path: PONYTAIL_MANIFEST_PATH,
        sha256: PONYTAIL_MANIFEST_SHA256,
      },
    ],
  };
}

export function getPinnedPonytailManifestTexts(): Record<string, string> {
  return {
    [PONYTAIL_MANIFEST_INDEX_PATH]: pinnedIndexText,
    [PONYTAIL_MANIFEST_PATH]: pinnedManifestText,
  };
}

export function loadPinnedPonytailSkillManifest(repoUrl: string = PONYTAIL_REPO_URL): GitHubSkillManifest {
  assertPonytailRepo(repoUrl);
  assertSha256Integrity(pinnedIndexText, PONYTAIL_MANIFEST_INDEX_SHA256, PONYTAIL_MANIFEST_INDEX_PATH);
  assertSha256Integrity(pinnedManifestText, PONYTAIL_MANIFEST_SHA256, PONYTAIL_MANIFEST_PATH);

  const manifest = validateGitHubSkillManifest(JSON.parse(pinnedManifestText));
  validateSkillPolicy(manifest);

  return manifest;
}

export function loadPinnedPonytailSkillManifestIndex(repoUrl: string = PONYTAIL_REPO_URL): GitHubSkillManifest[] {
  return [loadPinnedPonytailSkillManifest(repoUrl)];
}
