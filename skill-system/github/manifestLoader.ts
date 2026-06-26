import { validateGitHubSkillManifest, type GitHubSkillManifest } from "./manifest";
import { isTrustedRepo } from "./trustedRepos";

export async function loadGitHubSkillManifest(repoUrl: string): Promise<GitHubSkillManifest> {
  if (!isTrustedRepo(repoUrl)) {
    throw new Error("Untrusted GitHub skill repo");
  }

  return validateGitHubSkillManifest({
    name: "trusted-github-manifest-skill",
    version: "0.1.0",
    description: "Mock trusted GitHub skill manifest loaded safely in V4.4.1.",
    entry: "skills/trusted-github-manifest-skill.ts",
    capabilities: ["manifest_loading", "placeholder_execution"],
    permissions: [],
  });
}

export default loadGitHubSkillManifest;
