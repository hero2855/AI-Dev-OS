export const TRUSTED_GITHUB_SKILL_REPOS = [
  "https://github.com/hero2855/AI-Dev-OS-skills",
  "https://github.com/DietrichGebert/ponytail",
];

function normalizeRepoUrl(repoUrl: string): string {
  return repoUrl.trim().replace(/\/$/, "");
}

export function isTrustedRepo(repoUrl: string): boolean {
  const normalizedRepoUrl = normalizeRepoUrl(repoUrl);

  return TRUSTED_GITHUB_SKILL_REPOS.some(
    (trustedRepo) => normalizeRepoUrl(trustedRepo) === normalizedRepoUrl,
  );
}
