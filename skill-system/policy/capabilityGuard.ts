import type { SkillPermission } from "./permissions";

const capabilityPermissionMap: Record<string, SkillPermission[]> = {
  github_search: ["network:github"],
  repo_discovery: ["network:github"],
  readme_generation: ["file:read", "file:write:docs"],
  docs_generation: ["file:read", "file:write:docs"],
  programming_guidance: ["file:read"],
  code_review: ["file:read"],
  code_refactor: ["file:read", "file:write:src"],
  source_editing: ["file:read", "file:write:src"],
  browser_read: ["browser:read"],
  browser_write: ["browser:write"],
  shell_read: ["shell:read-only"],
  shell_execute: ["shell:execute"],
};

export function requiredPermissionsForCapability(capability: string): SkillPermission[] {
  const requiredPermissions = capabilityPermissionMap[capability];

  if (!requiredPermissions) {
    throw new Error(`Unknown skill capability: ${capability}`);
  }

  return requiredPermissions;
}

export function assertCapabilitiesAllowedByPermissions(capabilities: string[], permissions: string[]): void {
  const permissionSet = new Set(permissions);

  for (const capability of capabilities) {
    for (const permission of requiredPermissionsForCapability(capability)) {
      if (!permissionSet.has(permission)) {
        throw new Error(`Capability ${capability} requires permission ${permission}`);
      }
    }
  }
}
