export type GitHubPushFailureKind =
  | "dns_failure"
  | "port_443_connection_failure"
  | "connection_reset"
  | "authentication_failure"
  | "permission_denied"
  | "non_fast_forward"
  | "remote_rejected"
  | "unknown_failure";

export type GitHubPushVerificationStatus = "success" | "failed";

export type GitHubPushVerificationInput = {
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  repeatedFailure?: boolean;
};

export type GitHubPushVerificationResult = {
  status: GitHubPushVerificationStatus;
  failureKind?: GitHubPushFailureKind;
  shouldRetry: boolean;
  isNetworkIssue: boolean;
  isAuthIssue: boolean;
  isRepoStateIssue: boolean;
  safeToUseTemporaryCurlResolve: boolean;
  shouldStop: boolean;
  recommendedNextStep: string;
  matchedText?: string;
};
