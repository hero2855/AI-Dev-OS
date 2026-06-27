export type SkillPermission =
  | "network:github"
  | "file:read"
  | "file:write:docs"
  | "file:write:src"
  | "shell:read-only"
  | "shell:execute"
  | "browser:read"
  | "browser:write";

export const allowedSkillPermissions: SkillPermission[] = [
  "network:github",
  "file:read",
  "file:write:docs",
  "file:write:src",
  "shell:read-only",
  "shell:execute",
  "browser:read",
  "browser:write",
];

const allowedSkillPermissionSet = new Set<string>(allowedSkillPermissions);

export function isKnownPermission(permission: string): permission is SkillPermission {
  return allowedSkillPermissionSet.has(permission);
}

export function assertKnownPermissions(permissions: string[]): void {
  for (const permission of permissions) {
    if (!isKnownPermission(permission)) {
      throw new Error(`Unknown skill permission: ${permission}`);
    }
  }
}
