import { canonicalDigest, type EvalObservation, type EvalReport } from "./eval-schema.js";
import { isEvalEnabled, loadEvalPlan, type EvalPlan } from "./eval-plan.js";
import { runTwoPassExperiment } from "./eval-runner.js";
import {
    getSkillStore,
    readSkillProposal,
    readSkillTarget,
    sha256File,
    writeSkillEvaluation,
} from "./skill-store.js";
import { SKILL_SCHEMA_VERSION, skillEvaluationSchema, type SkillEvaluation } from "./skill-schema.js";

type EvaluationSummary = NonNullable<SkillEvaluation["confirmation"]>;

export type EvaluateSkillOptions = {
    projectRoot: string;
    proposalId: string;
    explorationTaskSetPath: string;
    confirmationTaskSetPath: string;
    adapterPath: string;
    outputRoot?: string;
    repetitions?: number;
    seed?: string;
    minimumImprovement?: number;
    confirm: boolean;
    signal?: AbortSignal;
};

function requireRootWorkspaces(plan: EvalPlan): void {
    if (plan.task_set.tasks.some((task) => task.workspace.path !== ".")) {
        throw new Error("Skill evaluation tasks must use the repository root as their workspace.");
    }
}

function requireDisjointPlans(exploration: EvalPlan, confirmation: EvalPlan): void {
    if (exploration.task_set.tasks.length < 2 || confirmation.task_set.tasks.length < 2) {
        throw new Error("Skill evaluation requires at least two exploration and two confirmation tasks.");
    }
    if (exploration.task_set_digest === confirmation.task_set_digest) {
        throw new Error("Exploration and confirmation task sets must be different committed documents.");
    }
    if (exploration.source.kind !== confirmation.source.kind) {
        throw new Error("Exploration and confirmation task sets must bind the same source kind.");
    }
    const explorationRevision = exploration.source.kind === "git"
        ? exploration.source.revision
        : exploration.source.package_version;
    const confirmationRevision = confirmation.source.kind === "git"
        ? confirmation.source.revision
        : confirmation.source.package_version;
    if (explorationRevision !== confirmationRevision) {
        throw new Error("Exploration and confirmation task sets must bind the same immutable source revision.");
    }
    const explorationIds = new Set(exploration.task_set.tasks.map(({ id }) => id));
    if (confirmation.task_set.tasks.some(({ id }) => explorationIds.has(id))) {
        throw new Error("Exploration and confirmation task IDs must not overlap.");
    }
    const taskDefinitionDigest = ({ id: _id, ...task }: EvalPlan["task_set"]["tasks"][number]): string => canonicalDigest(task);
    const explorationDefinitions = new Set(exploration.task_set.tasks.map(taskDefinitionDigest));
    if (confirmation.task_set.tasks.some((task) => explorationDefinitions.has(taskDefinitionDigest(task)))) {
        throw new Error("Exploration and confirmation task definitions must not overlap.");
    }
}

function observationKey(observation: EvalObservation): string {
    return `${observation.task_id}\0${observation.repetition}\0${observation.pass}`;
}

export function summarizeSkillReport(report: EvalReport): EvaluationSummary {
    if (report.status !== "final" || report.experiment_kind !== "skill_candidate") {
        throw new Error("Skill evaluation requires a final skill-candidate report.");
    }
    const baseline = new Map<string, EvalObservation>();
    const treatment = new Map<string, EvalObservation>();
    for (const observation of report.observations) {
        (observation.arm === "baseline" ? baseline : treatment).set(observationKey(observation), observation);
    }
    let baselinePassed = 0;
    let candidatePassed = 0;
    let eligiblePairs = 0;
    const improvedTasks = new Set<string>();
    const regressedTasks = new Set<string>();
    let unknown = 0;
    const scheduledPairs = report.schedule.length / 2;
    for (const [key, baselineObservation] of baseline) {
        const candidateObservation = treatment.get(key);
        const eligible = candidateObservation !== undefined
            && baselineObservation.state === "terminal"
            && candidateObservation.state === "terminal"
            && baselineObservation.capability_status === "valid"
            && candidateObservation.capability_status === "valid"
            && baselineObservation.pass_state !== "unknown"
            && candidateObservation.pass_state !== "unknown";
        if (!eligible || !candidateObservation) continue;
        eligiblePairs += 1;
        const baselinePass = baselineObservation.pass_state === "passed";
        const candidatePass = candidateObservation.pass_state === "passed";
        if (baselinePass) baselinePassed += 1;
        if (candidatePass) candidatePassed += 1;
        if (!baselinePass && candidatePass) improvedTasks.add(baselineObservation.task_id);
        if (baselinePass && !candidatePass) regressedTasks.add(baselineObservation.task_id);
    }
    unknown = Math.max(0, scheduledPairs - eligiblePairs);
    return {
        task_set_digest: report.task_set_digest,
        report_digest: canonicalDigest(report),
        experiment_id: report.experiment_id,
        baseline_passed: baselinePassed,
        candidate_passed: candidatePassed,
        eligible_pairs: eligiblePairs,
        improvements: improvedTasks.size,
        regressions: regressedTasks.size,
        unknown,
    };
}

function gate(summary: EvaluationSummary, minimumImprovement: number, prefix: string): string[] {
    const reasons: string[] = [];
    if (summary.eligible_pairs === 0 || summary.unknown > 0) reasons.push(`${prefix}_incomplete`);
    if (summary.regressions > 0) reasons.push(`${prefix}_regression`);
    if (summary.improvements < minimumImprovement) reasons.push(`${prefix}_no_improvement`);
    return reasons;
}

export async function evaluateSkillProposal(options: EvaluateSkillOptions): Promise<SkillEvaluation> {
    if (!options.confirm) throw new Error("Skill evaluation requires --yes because it invokes the configured evaluation adapter.");
    if (!isEvalEnabled()) throw new Error("Skill evaluation is disabled. Set CAIRN_EVAL=1 to opt in.");
    const repetitions = options.repetitions ?? 2;
    const minimumImprovement = options.minimumImprovement ?? 1;
    if (!Number.isSafeInteger(repetitions) || repetitions < 1 || repetitions > 1_000) {
        throw new Error("Evaluation repetitions must be an integer from 1 through 1000.");
    }
    if (!Number.isSafeInteger(minimumImprovement) || minimumImprovement < 1 || minimumImprovement > 10_000) {
        throw new Error("Minimum improvement must be an integer from 1 through 10000.");
    }
    const store = getSkillStore(options.projectRoot);
    const proposal = readSkillProposal(store.project_root, options.proposalId);
    const target = readSkillTarget(store.project_root, proposal.target_path);
    if (target.digest !== proposal.baseline_digest) throw new Error("Skill target changed after proposal generation.");
    const arms = [
        { id: "baseline" as const, disabled_capability: null },
        { id: "treatment" as const, disabled_capability: null },
    ];
    const outputRoot = options.outputRoot ?? ".agentfs/eval/experiments";
    const seed = options.seed ?? "cairn-skill-eval-v1";
    const common = {
        adapterPath: options.adapterPath,
        outputRoot,
        repetitions,
        arms,
        experimentKind: "skill_candidate" as const,
        cwd: store.project_root,
    };
    const explorationPlan = loadEvalPlan({
        ...common,
        taskSetPath: options.explorationTaskSetPath,
        seed: `${seed}:exploration`,
    });
    const confirmationPlan = loadEvalPlan({
        ...common,
        taskSetPath: options.confirmationTaskSetPath,
        seed: `${seed}:confirmation`,
    });
    requireRootWorkspaces(explorationPlan);
    requireRootWorkspaces(confirmationPlan);
    requireDisjointPlans(explorationPlan, confirmationPlan);
    if (minimumImprovement > explorationPlan.task_set.tasks.length
        || minimumImprovement > confirmationPlan.task_set.tasks.length) {
        throw new Error("Minimum improvement cannot exceed the task count in either evaluation set.");
    }
    if (explorationPlan.adapter_config_digest !== confirmationPlan.adapter_config_digest
        || explorationPlan.resolved_programs.adapter !== confirmationPlan.resolved_programs.adapter) {
        throw new Error("Exploration and confirmation must use the same evaluation adapter.");
    }
    const evaluationAdapterProgramDigest = sha256File(explorationPlan.resolved_programs.adapter);
    const proposalDigest = canonicalDigest(proposal);
    const binding = {
        schema_version: SKILL_SCHEMA_VERSION,
        proposal_id: proposal.id,
        proposal_digest: proposalDigest,
        baseline_digest: proposal.baseline_digest,
        candidate_digest: proposal.candidate_content_digest,
        exploration_plan_digest: explorationPlan.plan_digest,
        confirmation_plan_digest: confirmationPlan.plan_digest,
        evaluation_adapter_program_digest: evaluationAdapterProgramDigest,
        repetitions,
        minimum_improvement: minimumImprovement,
    };
    const bindingDigest = canonicalDigest(binding);
    const overlay = {
        baseline: {
            relative_path: proposal.target_path,
            content: target.content,
            digest: proposal.baseline_digest,
        },
        treatment: {
            relative_path: proposal.target_path,
            content: proposal.candidate_content,
            digest: proposal.candidate_content_digest,
        },
    };
    const explorationRun = await runTwoPassExperiment({
        plan: explorationPlan,
        experiment_id: `skill-explore-${bindingDigest.slice(0, 20)}`,
        workspace_overlays: overlay,
        signal: options.signal,
    });
    const exploration = summarizeSkillReport(explorationRun.report);
    if (sha256File(explorationPlan.resolved_programs.adapter) !== evaluationAdapterProgramDigest) {
        throw new Error("Evaluation adapter executable changed during exploration.");
    }
    const explorationReasons = gate(exploration, minimumImprovement, "exploration");
    if (explorationReasons.length > 0) {
        const evaluation = skillEvaluationSchema.parse({
            schema_version: SKILL_SCHEMA_VERSION,
            id: `evaluation-${bindingDigest.slice(0, 24)}`,
            proposal_id: proposal.id,
            proposal_digest: proposalDigest,
            binding_digest: bindingDigest,
            evaluation_adapter_program_digest: evaluationAdapterProgramDigest,
            status: exploration.unknown > 0 ? "inconclusive" : "rejected",
            minimum_improvement: minimumImprovement,
            exploration,
            confirmation: null,
            reasons: explorationReasons,
            created_at: new Date().toISOString(),
        });
        writeSkillEvaluation(store.project_root, evaluation);
        return evaluation;
    }
    const confirmationRun = await runTwoPassExperiment({
        plan: confirmationPlan,
        experiment_id: `skill-confirm-${bindingDigest.slice(0, 20)}`,
        workspace_overlays: overlay,
        signal: options.signal,
    });
    if (sha256File(confirmationPlan.resolved_programs.adapter) !== evaluationAdapterProgramDigest) {
        throw new Error("Evaluation adapter executable changed during confirmation.");
    }
    const confirmation = summarizeSkillReport(confirmationRun.report);
    const confirmationReasons = gate(confirmation, minimumImprovement, "confirmation");
    const status = confirmationReasons.length === 0
        ? "eligible"
        : confirmation.unknown > 0 ? "inconclusive" : "rejected";
    const evaluation = skillEvaluationSchema.parse({
        schema_version: SKILL_SCHEMA_VERSION,
        id: `evaluation-${bindingDigest.slice(0, 24)}`,
        proposal_id: proposal.id,
        proposal_digest: proposalDigest,
        binding_digest: bindingDigest,
        evaluation_adapter_program_digest: evaluationAdapterProgramDigest,
        status,
        minimum_improvement: minimumImprovement,
        exploration,
        confirmation,
        reasons: confirmationReasons,
        created_at: new Date().toISOString(),
    });
    writeSkillEvaluation(store.project_root, evaluation);
    return evaluation;
}
