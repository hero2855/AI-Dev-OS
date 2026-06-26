export type GitHubSkillManifest = {
  name: string;
  version: string;
  description: string;
  entry: string;
  capabilities: string[];
  permissions: string[];
};

export function validateGitHubSkillManifest(value: unknown): GitHubSkillManifest {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid GitHub skill manifest");
  }

  const manifest = value as GitHubSkillManifest;

  if (typeof manifest.name !== "string" || !manifest.name.trim()) {
    throw new Error("Invalid GitHub skill manifest: name is required");
  }

  if (typeof manifest.version !== "string" || !manifest.version.trim()) {
    throw new Error("Invalid GitHub skill manifest: version is required");
  }

  if (typeof manifest.description !== "string" || !manifest.description.trim()) {
    throw new Error("Invalid GitHub skill manifest: description is required");
  }

  if (typeof manifest.entry !== "string") {
    throw new Error("Invalid GitHub skill manifest: entry must be a string");
  }

  if (!Array.isArray(manifest.capabilities)) {
    throw new Error("Invalid GitHub skill manifest: capabilities must be an array");
  }

  if (!Array.isArray(manifest.permissions)) {
    throw new Error("Invalid GitHub skill manifest: permissions must be an array");
  }

  return {
    name: manifest.name.trim(),
    version: manifest.version.trim(),
    description: manifest.description.trim(),
    entry: manifest.entry,
    capabilities: manifest.capabilities.map((capability) => String(capability)),
    permissions: manifest.permissions.map((permission) => String(permission)),
  };
}
