import type { SkillRuntimeAuditSummary } from "../skill-runtime";
import type { SkillRuntimeMode } from "../skill-runtime";
import type { DryRunRiskLevel } from "../skill-system/execution-plan";
import { decideAutopilotApprovalPolicy } from "../autopilot-approval";
import { createContentFollowUpPlan } from "../content-follow-up";
import { createPlatformPublisherPlan } from "../platform-publisher";
import { createReplyMonitorPlan } from "../reply-monitor";
import { createScheduledWorkflowPlan } from "../scheduled-workflow";
import { createSchedulerBridgePlan } from "../scheduler-bridge";
import { createUnattendedWorkflowRunnerPlan } from "../unattended-runner";
import type {
  ControlledDemoContentIdea,
  ControlledDemoStage,
  ControlledEndToEndDemoPlatform,
  ControlledEndToEndDemoRequest,
  ControlledEndToEndDemoResult,
} from "./types";

const supportedPlatforms = new Set<ControlledEndToEndDemoPlatform>([
  "xiaohongshu",
  "douyin",
  "wechat_public_account",
  "generic_web_platform",
]);

const blockedRealActions = [
  "create_real_scheduled_task",
  "run_real_scheduler",
  "run_workflow_now",
  "open_or_control_real_browser",
  "control_real_computer",
  "perform_network_operation",
  "publish_or_post_live",
  "comment_or_reply_live",
  "send_message",
  "upload_media",
  "login",
  "click",
  "type",
  "submit",
  "pay",
  "delete",
];

const riskRank: Record<DryRunRiskLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
  blocked: 4,
};

export function createControlledEndToEndDemo(
  request: ControlledEndToEndDemoRequest = {},
): ControlledEndToEndDemoResult {
  const platform = request.platform ?? "xiaohongshu";
  const contentNiche = request.contentNiche ?? "AI resume optimization / Resume-AI";
  const mode = request.mode ?? "mock";
  const workflowName = request.workflowName ?? "v5-controlled-resume-ai-demo";
  const suggestedPublishTime = request.suggestedPublishTime ?? "2026-07-01T10:00:00.000+08:00";
  const recurrence =
    request.recurrence ??
    ({
      type: "one-time" as const,
      runAt: suggestedPublishTime,
      timezone: "Asia/Shanghai",
    });
  const contentIdea = createContentIdea(platform, contentNiche, suggestedPublishTime);

  const publishPlan = createPlatformPublisherPlan({
    platform,
    goal: `Plan a controlled demo publish package for ${contentNiche}.`,
    post: {
      title: contentIdea.title,
      body: contentIdea.shortPostBody,
      tags: contentIdea.tags,
      scheduledAt: suggestedPublishTime,
    },
  });
  const scheduledWorkflowPlan = createScheduledWorkflowPlan({
    workflowName,
    goal: `Controlled end-to-end demo for ${contentNiche} on ${platform}.`,
    mode: mode === "local" ? "local" : "mock",
    schedule: recurrence,
    steps: [
      {
        id: "demo-content-create",
        type: "content:create",
        description: "Generate one deterministic demo content idea locally.",
      },
      {
        id: "demo-publish-plan",
        type: "content:publish",
        description: "Plan the platform publish package only.",
        publisherPlan: {
          planId: publishPlan.planId,
          platform: publishPlan.platform,
          plannedOnly: true,
        },
      },
      {
        id: "demo-reply-monitor-plan",
        type: "content:reply",
        description: "Plan reply monitoring and reply drafting only.",
      },
    ],
  });
  const schedulerPlan = createSchedulerBridgePlan({
    schedulerType: request.schedulerType ?? "local_runner",
    triggerTime: suggestedPublishTime,
    recurrence,
    targetWorkflow: {
      workflowName,
      goal: `Bridge controlled demo workflow for ${contentNiche}.`,
      plannedOnly: true,
      scheduledWorkflowPlan: {
        workflowId: scheduledWorkflowPlan.workflowId,
        workflowName: scheduledWorkflowPlan.workflowName,
        plannedOnly: true,
      },
    },
    dryRunCommand: "ai-dev-os controlled-demo dry-run --platform xiaohongshu --niche resume-ai",
    createRealTask: request.createRealTask,
    runWorkflowNow: request.runWorkflowNow,
    environmentRequirements: ["local mock runtime", "no product-app writes", "no real platform credentials"],
    safetyNotes: request.notes,
  });
  const replyMonitorPlan = createReplyMonitorPlan({
    platform,
    goal: `Plan reply monitoring for the controlled ${contentNiche} demo.`,
    monitorWindow: {
      startsAt: suggestedPublishTime,
      timezone: "Asia/Shanghai",
    },
  });
  const followUpContentPlan = createContentFollowUpPlan({
    platform,
    goal: `Plan follow-up content ideas for ${contentNiche}.`,
    signals: [
      {
        category: "questions",
        summary: "Mock/local readers ask how to improve resumes without exaggerating experience.",
      },
      {
        category: "common_pain_points",
        summary: "Mock/local readers struggle to translate project work into measurable bullet points.",
      },
    ],
    replyMonitorPlan: {
      planId: replyMonitorPlan.planId,
      platform: replyMonitorPlan.platform,
      plannedOnly: true,
    },
  });
  const unattendedRunnerPlan = createUnattendedWorkflowRunnerPlan({
    platform,
    goal: `Plan unattended controlled demo workflow for ${contentNiche}.`,
    workflowName,
    schedule: recurrence,
    post: {
      title: contentIdea.title,
      body: contentIdea.shortPostBody,
      tags: contentIdea.tags,
      scheduledAt: suggestedPublishTime,
    },
    signals: [
      {
        category: "questions",
        summary: "Mock/local comments ask for resume optimization tips.",
      },
    ],
    notes: request.notes,
    schedulerBridge: {
      schedulerType: request.schedulerType ?? "local_runner",
      triggerTime: suggestedPublishTime,
      dryRunCommand: "ai-dev-os controlled-demo dry-run --platform xiaohongshu --niche resume-ai",
      createRealTask: request.createRealTask,
      runWorkflowNow: request.runWorkflowNow,
      environmentRequirements: ["local mock runtime", "no product-app writes", "no real platform credentials"],
      safetyNotes: request.notes,
    },
  });
  const approvalPolicyDecisions = [
    decideAutopilotApprovalPolicy({
      action: "content:create",
      description: "Generate deterministic local demo content only.",
      riskLevel: "low",
      context: { plannedOnly: true },
    }),
    decideAutopilotApprovalPolicy({
      action: "content:publish",
      description: "Plan Xiaohongshu publish flow only; no live post.",
      riskLevel: publishPlan.riskLevel,
      context: { plannedOnly: true },
    }),
    schedulerPlan.approvalPolicyDecision,
    decideAutopilotApprovalPolicy({
      action: "content:reply",
      description: "Plan reply monitoring and reply drafts only.",
      riskLevel: replyMonitorPlan.riskLevel,
      context: { plannedOnly: true },
    }),
    decideAutopilotApprovalPolicy({
      action: "content:create",
      description: "Plan follow-up content ideas from mock/local reply categories.",
      riskLevel: followUpContentPlan.riskLevel,
      context: { plannedOnly: true },
    }),
  ];
  const platformBlockedReasons = supportedPlatforms.has(platform as ControlledEndToEndDemoPlatform)
    ? []
    : [`Unsupported platform: ${platform}`];
  const blockedReasons = mergeUnique([
    ...platformBlockedReasons,
    ...publishPlan.blockedReasons.map((reason) => `publishPlan: ${reason}`),
    ...schedulerPlan.blockedReasons.map((reason) => `schedulerPlan: ${reason}`),
    ...scheduledWorkflowPlan.blockedReasons.map((reason) => `scheduledWorkflowPlan: ${reason}`),
    ...replyMonitorPlan.blockedReasons.map((reason) => `replyMonitorPlan: ${reason}`),
    ...followUpContentPlan.blockedReasons.map((reason) => `followUpContentPlan: ${reason}`),
    ...unattendedRunnerPlan.blockedReasons.map((reason) => `unattendedRunnerPlan: ${reason}`),
    ...approvalPolicyDecisions.flatMap((decision) =>
      decision.blockedReasons.map((reason) => `approvalPolicy:${decision.action}: ${reason}`),
    ),
  ]);
  const stages = createStages({
    contentIdea,
    publishPlan,
    schedulerPlan,
    scheduledWorkflowPlan,
    replyMonitorPlan,
    followUpContentPlan,
    unattendedRunnerPlan,
    approvalPolicyDecisions,
    blockedReasons,
  });
  const riskLevel = stages.reduce<DryRunRiskLevel>(
    (current, stage) => maxRisk(current, stage.riskLevel),
    blockedReasons.length > 0 ? "blocked" : "low",
  );
  const requiresApproval =
    blockedReasons.length > 0 ||
    stages.some((stage) => stage.requiresApproval) ||
    approvalPolicyDecisions.some((decision) => decision.requiresApproval || decision.policyDecision === "blocked");

  return {
    demoId: createDeterministicDemoId({
      platform,
      contentNiche,
      mode,
      workflowName,
      suggestedPublishTime,
      schedulerType: request.schedulerType ?? "local_runner",
      recurrence,
      createRealTask: request.createRealTask,
      runWorkflowNow: request.runWorkflowNow,
    }),
    mode,
    plannedOnly: true,
    targetPlatform: platform,
    contentNiche,
    contentIdea,
    title: contentIdea.title,
    contentAngle: contentIdea.angle,
    shortPostBody: contentIdea.shortPostBody,
    bodyOutline: contentIdea.bodyOutline,
    tags: contentIdea.tags,
    suggestedPublishTime,
    publishPlan,
    schedulerPlan,
    scheduledWorkflowPlan,
    replyMonitorPlan,
    followUpContentPlan,
    unattendedRunnerPlan,
    approvalPolicyDecisions,
    stages,
    riskLevel,
    requiresApproval,
    blockedReasons,
    blockedRealActions,
    riskSummary: summarizeRisk(riskLevel, requiresApproval, blockedReasons),
    finalWorkflowSummary: summarizeFinalWorkflow(platform, contentIdea, stages),
    summary: summarizeDemo(platform, contentIdea, stages, blockedReasons),
    auditSummary: createAuditSummary(mode),
  };
}

function createContentIdea(
  platform: string,
  contentNiche: string,
  suggestedPublishTime: string,
): ControlledDemoContentIdea {
  return {
    id: "demo-content-idea-1",
    title: "3步把AI项目经历写成更有说服力的简历亮点",
    angle: `${contentNiche} practical checklist for turning project work into measurable resume evidence.`,
    bodyOutline: [
      "Hook: Most AI project resumes sound generic because they describe tools instead of impact.",
      "Step 1: Identify the task, model/tooling, and business or user outcome.",
      "Step 2: Convert responsibilities into measurable resume bullets with scope, action, and result.",
      "Step 3: Use Resume-AI as a local planning assistant to compare stronger bullet variants before applying.",
      "CTA: Save this checklist and test one project bullet before your next application.",
    ],
    shortPostBody:
      "AI项目经历别只写“用了大模型”。先写清任务和场景，再补上动作、指标和结果。把每条经历改成“我解决了什么问题、用了什么方法、带来什么变化”，简历会更像证据，而不是工具清单。",
    tags: ["ResumeAI", "AI简历优化", "求职简历", "项目经历", "AI工具"],
    targetPlatform: platform,
    suggestedPublishTime,
  };
}

function createStages(input: {
  contentIdea: ControlledDemoContentIdea;
  publishPlan: ReturnType<typeof createPlatformPublisherPlan>;
  schedulerPlan: ReturnType<typeof createSchedulerBridgePlan>;
  scheduledWorkflowPlan: ReturnType<typeof createScheduledWorkflowPlan>;
  replyMonitorPlan: ReturnType<typeof createReplyMonitorPlan>;
  followUpContentPlan: ReturnType<typeof createContentFollowUpPlan>;
  unattendedRunnerPlan: ReturnType<typeof createUnattendedWorkflowRunnerPlan>;
  approvalPolicyDecisions: ReturnType<typeof decideAutopilotApprovalPolicy>[];
  blockedReasons: string[];
}): ControlledDemoStage[] {
  return [
    createStage("demo-stage-1", "content_idea", "low", false, [], `Generated deterministic idea: ${input.contentIdea.title}`),
    createStage("demo-stage-2", "content_package", "low", false, [], "Generated deterministic title, angle, outline, body, tags, platform, and publish time."),
    createStage(
      "demo-stage-3",
      "platform_publish_plan",
      input.publishPlan.riskLevel,
      input.publishPlan.requiresApproval,
      input.publishPlan.blockedReasons,
      input.publishPlan.summary,
    ),
    createStage(
      "demo-stage-4",
      "scheduler_bridge_plan",
      input.schedulerPlan.riskLevel,
      input.schedulerPlan.requiresApproval,
      input.schedulerPlan.blockedReasons,
      input.schedulerPlan.summary,
    ),
    createStage(
      "demo-stage-5",
      "reply_monitor_plan",
      input.replyMonitorPlan.riskLevel,
      input.replyMonitorPlan.requiresApproval,
      input.replyMonitorPlan.blockedReasons,
      input.replyMonitorPlan.summary,
    ),
    createStage(
      "demo-stage-6",
      "follow_up_content_plan",
      input.followUpContentPlan.riskLevel,
      input.followUpContentPlan.requiresApproval,
      input.followUpContentPlan.blockedReasons,
      input.followUpContentPlan.summary,
    ),
    createStage(
      "demo-stage-7",
      "unattended_runner_plan",
      input.unattendedRunnerPlan.riskLevel,
      input.unattendedRunnerPlan.requiresApproval,
      input.unattendedRunnerPlan.blockedReasons,
      input.unattendedRunnerPlan.summary,
    ),
    createStage(
      "demo-stage-8",
      "autopilot_approval_decisions",
      input.approvalPolicyDecisions.reduce<DryRunRiskLevel>(
        (current, decision) => maxRisk(current, decision.riskLevel),
        "low",
      ),
      input.approvalPolicyDecisions.some((decision) => decision.requiresApproval || decision.policyDecision === "blocked"),
      input.approvalPolicyDecisions.flatMap((decision) => decision.blockedReasons),
      `Generated ${input.approvalPolicyDecisions.length} autopilot approval decision(s) as planned-only metadata.`,
    ),
    createStage(
      "demo-stage-9",
      "final_demo_report",
      input.blockedReasons.length > 0 ? "blocked" : "high",
      true,
      input.blockedReasons,
      "Generated final end-to-end demo report. Real-world execution remains disabled.",
    ),
  ];
}

function createStage(
  id: string,
  name: ControlledDemoStage["name"],
  riskLevel: DryRunRiskLevel,
  requiresApproval: boolean,
  blockedReasons: string[],
  summary: string,
): ControlledDemoStage {
  const status = blockedReasons.length > 0 ? "blocked" : requiresApproval ? "requires_approval" : "planned";

  return {
    id,
    name,
    status,
    plannedOnly: true,
    riskLevel: blockedReasons.length > 0 ? "blocked" : riskLevel,
    requiresApproval: blockedReasons.length > 0 || requiresApproval,
    blockedReasons,
    summary,
  };
}

function summarizeRisk(
  riskLevel: DryRunRiskLevel,
  requiresApproval: boolean,
  blockedReasons: string[],
): string {
  const approvalText = requiresApproval
    ? "Approval is required before any future real-world execution."
    : "No approval is required for the current low-risk content planning metadata.";
  const blockedText = blockedReasons.length > 0 ? ` Blocked reasons: ${blockedReasons.join("; ")}.` : "";

  return `Controlled demo aggregate risk is ${riskLevel}. ${approvalText} Real-world actions remain blocked or approval-gated.${blockedText}`;
}

function summarizeFinalWorkflow(
  platform: string,
  contentIdea: ControlledDemoContentIdea,
  stages: ControlledDemoStage[],
): string {
  return `V5.0 controlled end-to-end demo planned ${stages.length} stage(s) for ${platform}: one Resume-AI content idea, publish plan, scheduler bridge plan, reply monitor plan, follow-up content plan, unattended runner plan, autopilot approval decisions, and final report for "${contentIdea.title}".`;
}

function summarizeDemo(
  platform: string,
  contentIdea: ControlledDemoContentIdea,
  stages: ControlledDemoStage[],
  blockedReasons: string[],
): string {
  const blockedText = blockedReasons.length > 0 ? ` Blocked reasons: ${blockedReasons.join("; ")}.` : "";

  return `V5.0 First Controlled End-to-End Demo created a deterministic planned-only Resume-AI content operations demo for ${platform} with ${stages.length} stage(s). Demo title: ${contentIdea.title}. No real scheduler, browser, computer, network, publish, reply, comment, send, upload, login, click, type, submit, pay, delete, or product-app modification occurred.${blockedText}`;
}

function createAuditSummary(mode: ControlledEndToEndDemoResult["mode"]): ControlledEndToEndDemoResult["auditSummary"] {
  const auditMode: SkillRuntimeMode = mode === "local" ? "local" : "mock";
  const base: SkillRuntimeAuditSummary = {
    realNetworkOperation: false,
    realBrowserOperation: false,
    realComputerOperation: false,
    realShellOperation: false,
    realPublishOperation: false,
    mode: auditMode,
  };

  return {
    ...base,
    realTimerOperation: false,
    realSchedulerOperation: false,
    realWorkflowExecution: false,
    realReplyOperation: false,
    realCommentReadOperation: false,
    productAppModified: false,
    aiDevOsSkillsModified: false,
  };
}

function mergeUnique(values: string[]): string[] {
  return [...new Set(values)];
}

function maxRisk(current: DryRunRiskLevel, next: DryRunRiskLevel): DryRunRiskLevel {
  return riskRank[next] > riskRank[current] ? next : current;
}

function createDeterministicDemoId(input: unknown): string {
  const text = JSON.stringify(input);
  let hash = 0;

  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }

  return `controlled-demo-v1-${hash.toString(16).padStart(8, "0")}`;
}
