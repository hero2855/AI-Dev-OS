import type {
  GitHubPushFailureKind,
  GitHubPushVerificationInput,
  GitHubPushVerificationResult,
} from "./types";

type FailureRule = {
  kind: GitHubPushFailureKind;
  patterns: RegExp[];
};

const failureRules: FailureRule[] = [
  {
    kind: "dns_failure",
    patterns: [/could not resolve host:\s*github\.com/i, /name or service not known/i, /temporary failure in name resolution/i],
  },
  {
    kind: "port_443_connection_failure",
    patterns: [/failed to connect to github\.com port 443/i, /could not connect to server/i, /unable to access .*github\.com.*port 443/i],
  },
  {
    kind: "connection_reset",
    patterns: [/recv failure:\s*connection was reset/i, /connection reset by peer/i, /connection was reset/i],
  },
  {
    kind: "authentication_failure",
    patterns: [/authentication failed/i, /invalid username or password/i, /could not read username/i, /repository not found/i],
  },
  {
    kind: "permission_denied",
    patterns: [/permission denied/i, /write access to repository not granted/i, /could not read from remote repository/i],
  },
  {
    kind: "non_fast_forward",
    patterns: [/non-fast-forward/i, /fetch first/i, /updates were rejected because the remote contains work/i],
  },
  {
    kind: "remote_rejected",
    patterns: [/remote rejected/i, /\[remote rejected\]/i, /pre-receive hook declined/i, /protected branch hook declined/i],
  },
];

const successPatterns = [
  /everything up-to-date/i,
  /to github\.com[:/]/i,
  /\bnew branch\b/i,
  /\bnew tag\b/i,
  /\b\d+\.\.[a-f0-9]+\b/i,
];

export function classifyGitHubPushVerification(
  input: GitHubPushVerificationInput,
): GitHubPushVerificationResult {
  const combinedOutput = [input.stdout, input.stderr].filter(Boolean).join("\n");
  const normalizedOutput = combinedOutput.trim();
  const exitCode = input.exitCode ?? 0;

  if (exitCode === 0 && isSuccessfulPushOutput(normalizedOutput)) {
    return {
      status: "success",
      shouldRetry: false,
      isNetworkIssue: false,
      isAuthIssue: false,
      isRepoStateIssue: false,
      safeToUseTemporaryCurlResolve: false,
      shouldStop: false,
      recommendedNextStep: "Push verification succeeded. Continue with normal release recording.",
    };
  }

  for (const rule of failureRules) {
    const matchedText = findMatchedText(normalizedOutput, rule.patterns);

    if (matchedText) {
      return createFailureResult(rule.kind, matchedText, Boolean(input.repeatedFailure));
    }
  }

  return createFailureResult("unknown_failure", normalizedOutput || "No git output captured.", true);
}

function isSuccessfulPushOutput(output: string): boolean {
  if (output.length === 0) {
    return true;
  }

  return successPatterns.some((pattern) => pattern.test(output));
}

function findMatchedText(output: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = output.match(pattern);

    if (match?.[0]) {
      return match[0];
    }
  }

  return undefined;
}

function createFailureResult(
  failureKind: GitHubPushFailureKind,
  matchedText: string,
  repeatedFailure: boolean,
): GitHubPushVerificationResult {
  const isNetworkIssue = ["dns_failure", "port_443_connection_failure", "connection_reset"].includes(failureKind);
  const isAuthIssue = ["authentication_failure", "permission_denied"].includes(failureKind);
  const isRepoStateIssue = ["non_fast_forward", "remote_rejected"].includes(failureKind);
  const shouldRetry = isNetworkIssue && !repeatedFailure;

  return {
    status: "failed",
    failureKind,
    shouldRetry,
    isNetworkIssue,
    isAuthIssue,
    isRepoStateIssue,
    safeToUseTemporaryCurlResolve: failureKind === "dns_failure" || failureKind === "port_443_connection_failure",
    shouldStop: !shouldRetry,
    recommendedNextStep: recommendedNextStepFor(failureKind, repeatedFailure),
    matchedText,
  };
}

function recommendedNextStepFor(failureKind: GitHubPushFailureKind, repeatedFailure: boolean): string {
  if (repeatedFailure && ["dns_failure", "port_443_connection_failure", "connection_reset"].includes(failureKind)) {
    return "Stop after repeated network failure, report the GitHub connectivity issue, and avoid treating it as a code failure.";
  }

  switch (failureKind) {
    case "dns_failure":
      return "Retry once after checking local DNS/network availability. A temporary curl --resolve probe can be considered outside tests without changing hosts.";
    case "port_443_connection_failure":
      return "Retry once after confirming GitHub HTTPS connectivity. Do not change repo config or hosts.";
    case "connection_reset":
      return "Retry once because the remote connection was reset. If it repeats, stop and report a network issue.";
    case "authentication_failure":
      return "Stop and refresh credentials or token permissions before trying another push.";
    case "permission_denied":
      return "Stop and confirm repository access, branch protection, and token scopes.";
    case "non_fast_forward":
      return "Stop and inspect remote history before pushing. Do not force push from this helper.";
    case "remote_rejected":
      return "Stop and inspect the remote rejection reason, permissions, and branch or tag protection.";
    case "unknown_failure":
      return "Stop and report the raw git output for human review.";
  }
}
