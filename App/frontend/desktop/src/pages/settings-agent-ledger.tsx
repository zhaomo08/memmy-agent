/** Settings section for the agent rule and skill ledgers. */
import type { AgentRuleStatusDto, SkillFinding, SkillStatusDto } from "@memmy/local-api-contracts";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { AgentLedgerClient } from "../api/agent-ledger-client.js";
import { useTranslation } from "../i18n/use-translation.js";
import type { MessageKey } from "../i18n/messages.js";

type Translate = ReturnType<typeof useTranslation>["t"];
type Busy = "refresh" | "apply" | "freeze" | "reconcile" | null;
type Feedback = { tone: "success" | "error"; message: string } | null;

const SKILL_STATES = ["linked", "absent", "local", "foreign", "broken"] as const;

export interface AgentLedgerPanelProps {
  client: AgentLedgerClient;
}

/**
 * Reports both ledgers and offers the three actions that change them. Reading happens on
 * mount; nothing writes until a button is pressed, and the one button that rearranges the
 * user's agent directories states its plan before it will run.
 */
export function AgentLedgerPanel(props: AgentLedgerPanelProps) {
  const { t } = useTranslation();
  const [rules, setRules] = useState<AgentRuleStatusDto | null>(null);
  const [skills, setSkills] = useState<SkillStatusDto | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [confirmingReconcile, setConfirmingReconcile] = useState(false);

  const refresh = useCallback(async () => {
    setBusy("refresh");
    try {
      const [ruleStatus, skillStatus] = await Promise.all([
        props.client.getRuleStatus(),
        props.client.getSkillStatus()
      ]);
      setRules(ruleStatus);
      setSkills(skillStatus);
      setFeedback(null);
    } catch (error) {
      setFeedback({ tone: "error", message: t("settings.agentLedger.loadFailed", { message: messageOf(error) }) });
    } finally {
      setBusy(null);
    }
  }, [props.client, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = useCallback(
    async (kind: Exclude<Busy, null>, action: () => Promise<string>) => {
      setBusy(kind);
      setConfirmingReconcile(false);
      try {
        setFeedback({ tone: "success", message: await action() });
      } catch (error) {
        setFeedback({ tone: "error", message: t("settings.agentLedger.loadFailed", { message: messageOf(error) }) });
      } finally {
        setBusy(null);
        await refresh();
      }
    },
    [refresh, t]
  );

  const applyRules = useCallback(
    () =>
      run("apply", async () => {
        const result = await props.client.applyRules();
        return t("settings.agentLedger.applied", { written: result.written.length, removed: result.removed.length });
      }),
    [props.client, run, t]
  );

  const freeze = useCallback(
    () =>
      run("freeze", async () => {
        const result = await props.client.freezeSkills();
        return t("settings.agentLedger.frozen", { count: result.declarations });
      }),
    [props.client, run, t]
  );

  const reconcile = useCallback(
    () =>
      run("reconcile", async () => {
        const result = await props.client.reconcileSkills();
        return t("settings.agentLedger.reconciled", {
          mounted: result.mounted.length,
          unmounted: result.unmounted.length,
          skipped: result.skipped.length
        });
      }),
    [props.client, run, t]
  );

  const plan = skills ? planFor(skills.findings) : { mount: 0, unmount: 0, skip: 0 };

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <Head title={t("settings.agentLedger.rules")} description={t("settings.agentLedger.rulesDesc")} />
        {rules && <PathLine label={t("settings.agentLedger.rulesDirectory")} value={rules.rulesDirectory} />}
        {rules && rules.entries.length === 0 && <Hint text={t("settings.agentLedger.rulesEmpty")} />}
        {rules && rules.entries.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {rules.entries.map((entry) => (
              <Chip
                key={`${entry.ruleId}:${entry.targetId}`}
                tone={entry.state === "in_sync" ? "calm" : "warn"}
                label={`${entry.ruleId} · ${entry.targetDisplayName}`}
                value={t(`settings.agentLedger.ruleState.${entry.state}` as MessageKey)}
              />
            ))}
          </div>
        )}
        <Actions>
          <Button onClick={applyRules} busy={busy === "apply"} disabled={busy !== null || !rules?.entries.length}>
            {t("settings.agentLedger.apply")}
          </Button>
        </Actions>
      </section>

      <div className="h-px bg-border-stone/30" />

      <section className="space-y-2">
        <Head title={t("settings.agentLedger.skills")} description={t("settings.agentLedger.skillsDesc")} />
        {skills && (
          <>
            <PathLine label={t("settings.agentLedger.library")} value={skills.libraryPath} />
            <PathLine label={t("settings.agentLedger.manifest")} value={skills.manifestPath} />
            {skills.manifestMissing && <Hint text={t("settings.agentLedger.manifestMissing")} />}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {SKILL_STATES.map((state) => {
                const count = skills.observations.filter((entry) => entry.state === state).length;
                return count === 0 ? null : (
                  <Chip
                    key={state}
                    tone={state === "linked" || state === "absent" || state === "local" ? "calm" : "warn"}
                    label={t(`settings.agentLedger.state.${state}` as MessageKey)}
                    value={String(count)}
                  />
                );
              })}
            </div>
            {skills.managedNames.length > 0 && (
              <Hint text={t("settings.agentLedger.managed", { names: skills.managedNames.join(", ") })} />
            )}
            {skills.unavailableTargetIds.length > 0 && (
              <Hint text={t("settings.agentLedger.unavailable", { targets: skills.unavailableTargetIds.join(", ") })} />
            )}
            <FindingList findings={skills.findings} t={t} />
          </>
        )}
        <Actions>
          <Button onClick={freeze} busy={busy === "freeze"} disabled={busy !== null}>
            {t("settings.agentLedger.freeze")}
          </Button>
          {plan.mount + plan.unmount > 0 && (
            <Button
              onClick={confirmingReconcile ? reconcile : () => setConfirmingReconcile(true)}
              busy={busy === "reconcile"}
              disabled={busy !== null}
              emphasis={confirmingReconcile}
            >
              {confirmingReconcile ? t("settings.agentLedger.reconcileConfirm") : t("settings.agentLedger.reconcile")}
            </Button>
          )}
          <Button onClick={refresh} busy={busy === "refresh"} disabled={busy !== null}>
            <RefreshCw size={12} />
            {t("settings.agentLedger.refresh")}
          </Button>
        </Actions>
        {confirmingReconcile && (
          <Hint text={t("settings.agentLedger.reconcilePlan", { mount: plan.mount, unmount: plan.unmount, skip: plan.skip })} />
        )}
      </section>

      {feedback && (
        <div
          className={`flex items-center gap-2 text-xs ${feedback.tone === "success" ? "text-status-success" : "text-status-error"}`}
        >
          {feedback.tone === "success" ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
          <span className="min-w-0 break-all">{feedback.message}</span>
        </div>
      )}
    </div>
  );
}

/** Splits findings into what reconcile will do and what it will leave alone. */
export function planFor(findings: readonly SkillFinding[]): { mount: number; unmount: number; skip: number } {
  return {
    mount: findings.filter((finding) => finding.kind === "not_mounted").length,
    unmount: findings.filter((finding) => finding.kind === "unexpected").length,
    skip: findings.filter((finding) => finding.kind === "blocked" || finding.kind === "undeclared").length
  };
}

function FindingList(props: { findings: readonly SkillFinding[]; t: Translate }) {
  if (props.findings.length === 0) {
    return (
      <div className="flex items-center gap-2 pt-1 text-xs text-status-success">
        <CheckCircle2 size={13} />
        {props.t("settings.agentLedger.inSync")}
      </div>
    );
  }

  return (
    <ul className="space-y-1 pt-1">
      {props.findings.map((finding) => (
        <li key={`${finding.kind}:${finding.name}:${finding.targetId ?? ""}`} className="flex items-start gap-2 text-xs">
          <span className="mt-px shrink-0 rounded-btn bg-canvas-oat/60 px-1.5 py-0.5 text-text-ink/70">
            {props.t(`settings.agentLedger.finding.${finding.kind}` as MessageKey)}
          </span>
          <span className="min-w-0 break-all text-text-ink/70">
            <span className="font-medium text-text-ink">{finding.name}</span>
            {finding.targetDisplayName ? ` · ${finding.targetDisplayName}` : ""} — {finding.detail}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Head(props: { title: string; description: string }) {
  return (
    <div>
      <div className="text-xs font-medium text-text-ink">{props.title}</div>
      <div className="text-xs text-text-ink/50">{props.description}</div>
    </div>
  );
}

function PathLine(props: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2 text-xs">
      <span className="text-text-ink/50">{props.label}</span>
      <span className="min-w-0 break-all font-mono text-text-ink/70">{props.value}</span>
    </div>
  );
}

function Hint(props: { text: string }) {
  return <div className="text-xs text-text-ink/50">{props.text}</div>;
}

function Chip(props: { tone: "calm" | "warn"; label: string; value: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-btn border px-2 py-0.5 text-xs ${
        props.tone === "warn" ? "border-status-error/40 text-status-error" : "border-border-stone/40 text-text-ink/70"
      }`}
    >
      {props.label}
      <span className="font-medium">{props.value}</span>
    </span>
  );
}

function Actions(props: { children: ReactNode }) {
  return <div className="flex flex-wrap justify-start gap-2 pt-2">{props.children}</div>;
}

function Button(props: {
  onClick: () => void;
  busy: boolean;
  disabled: boolean;
  emphasis?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      className={`flex cursor-pointer items-center gap-1.5 rounded-btn border px-4 py-2 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        props.emphasis
          ? "border-status-error/50 text-status-error hover:bg-status-error/10"
          : "border-border-stone/40 text-text-ink/70 hover:bg-canvas-oat/60"
      }`}
    >
      {props.busy ? <Loader2 size={12} className="animate-spin" /> : null}
      {props.children}
    </button>
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
