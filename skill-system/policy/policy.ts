import type { GitHubSkillManifest } from "../github/manifest";
import { assertCapabilitiesAllowedByPermissions } from "./capabilityGuard";
import { assertKnownPermissions } from "./permissions";

export function validateSkillPolicy(manifest: GitHubSkillManifest): void {
  assertKnownPermissions(manifest.permissions);
  assertCapabilitiesAllowedByPermissions(manifest.capabilities, manifest.permissions);

  if (manifest.permissions.includes("shell:execute")) {
    throw new Error("Permission shell:execute is disabled in V4.4.4");
  }

  if (manifest.permissions.includes("browser:write")) {
    throw new Error("Permission browser:write is disabled in V4.4.4");
  }
}
