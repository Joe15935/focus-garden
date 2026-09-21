import { Hourglass, Plus, RotateCcw, Trash2, TriangleAlert } from "lucide-react";
import { type FormEvent, useState } from "react";
import type { AllowanceStatus } from "@/bindings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, PageHeader } from "@/components/ui/card";
import { InlineError, QueryState } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { NumberField } from "@/components/ui/number-field";
import { Page } from "@/components/ui/page";
import { Progress } from "@/components/ui/progress";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { TargetIcon } from "@/components/ui/target-icon";
import { Tooltip } from "@/components/ui/tooltip";
import {
  useAllowances,
  useCreateAllowance,
  useDeleteAllowance,
  useResetAllowanceToday,
  useUpdateAllowance,
} from "@/lib/commands";
import { formatDuration } from "@/lib/duration";
import { useInstalledApps } from "@/garden/api";
import { useMacHealth } from "@/garden/health";
import { m } from "@/paraglide/messages.js";

const KINDS = [{ value: "Domain" }, { value: "AppExecutable" }] as const;

/** Built during render so the labels follow the current language. */
function kindOptions() {
  return [
    { value: "Domain" as const, label: m.allowances_kind_website() },
    { value: "AppExecutable" as const, label: m.allowances_kind_application() },
  ];
}

export function Allowances() {
  const allowances = useAllowances();
  const create = useCreateAllowance();
  const apps = useInstalledApps();
  const health = useMacHealth();
  const hasWebsiteAllowance = (allowances.data ?? []).some(
    (a) => a.allowance.target.kind === "Domain",
  );
  const [kind, setKind] = useState<(typeof KINDS)[number]["value"]>("Domain");
  const [value, setValue] = useState("");
  const [minutes, setMinutes] = useState(30);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const target = value.trim();
    if (!target) return;

    create.mutate(
      { target: { kind, value: target }, dailyLimitSecs: minutes * 60, strictMode: true },
      { onSuccess: () => setValue("") },
    );
  }

  return (
    <Page>
      <PageHeader title={m.allowances_title()} description={m.allowances_description()} />

      {hasWebsiteAllowance && health.data?.accessibility_granted === false && (
        <Card className="mb-6 border-warning/40" padding="md">
          <p className="flex items-center gap-2 font-medium text-sm text-warning">
            <TriangleAlert aria-hidden className="size-4" />
            网页计时需要辅助功能权限
          </p>
          <p className="mt-1 text-muted-foreground text-sm">
            请在设置中允许辅助功能和浏览器自动化。网站额度只计算当前前台网页的使用时间，不需要浏览器扩展。
          </p>
        </Card>
      )}

      <Card className="mb-6" padding="lg">
        <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
          <Labelled label={m.allowances_field_type()}>
            <Select value={kind} onValueChange={setKind} options={kindOptions()} size="sm" />
          </Labelled>

          {kind === "AppExecutable" && (
            <Labelled label="已安装应用">
              <select
                aria-label="选择额度应用"
                className="rounded-md border border-border bg-surface px-3 py-2 text-sm"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              >
                <option value="">请选择应用</option>
                {apps.data
                  ?.filter((app) => !app.protected)
                  .map((app) => (
                    <option key={app.bundle_id + app.path} value={app.executable}>
                      {app.name}
                    </option>
                  ))}
              </select>
            </Labelled>
          )}
          <Labelled
            label={
              kind === "Domain" ? m.allowances_field_domain() : m.allowances_field_executable()
            }
            htmlFor="allowance-target"
          >
            <Input
              id="allowance-target"
              size="sm"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={kind === "Domain" ? "youtube.com" : "应用可执行名称"}
              className="w-56"
            />
          </Labelled>

          <Labelled label={m.allowances_field_daily_limit()} htmlFor="allowance-minutes">
            <NumberField
              id="allowance-minutes"
              value={minutes}
              onCommit={setMinutes}
              min={1}
              max={1440}
              suffix="min"
            />
          </Labelled>

          <Button type="submit" icon={<Plus />} disabled={!value.trim() || create.isPending}>
            {create.isPending ? m.allowances_adding() : m.allowances_add()}
          </Button>
        </form>
        <p className="mt-3 text-muted-foreground text-xs">
          每日额度只计算正在前台使用的应用或网页；后台打开、休眠时间不计入。
        </p>
        <InlineError error={create.error ?? apps.error} />
      </Card>

      <QueryState
        isPending={allowances.isPending}
        error={allowances.error}
        onRetry={() => allowances.refetch()}
        isRetrying={allowances.isFetching}
      >
        {allowances.data?.length === 0 ? (
          <EmptyState
            icon={<Hourglass />}
            title={m.allowances_empty_title()}
            description={m.allowances_empty_description()}
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {allowances.data?.map((status) => (
              <AllowanceRow key={status.allowance.id} status={status} />
            ))}
          </ul>
        )}
      </QueryState>
    </Page>
  );
}

function AllowanceRow({ status }: { status: AllowanceStatus }) {
  const update = useUpdateAllowance();
  const reset = useResetAllowanceToday();
  const remove = useDeleteAllowance();

  const { allowance: a, used_today_secs: used, remaining_secs: left, exhausted } = status;
  const ratio = a.daily_limit_secs > 0 ? used / a.daily_limit_secs : 0;

  // Only the field being edited changes; the rest is sent back as-is.
  const save = (
    patch: Partial<{ dailyLimitSecs: number; strictMode: boolean; enabled: boolean }>,
  ) =>
    update.mutate({
      id: a.id,
      dailyLimitSecs: a.daily_limit_secs,
      strictMode: true,
      enabled: a.enabled,
      ...patch,
    });

  return (
    <li>
      <Card>
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <TargetIcon value={a.target.value} className="size-9" />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="truncate font-medium text-foreground text-sm">{a.target.value}</p>
                {exhausted && <Badge tone="destructive">{m.allowances_badge_spent()}</Badge>}
                {!a.enabled && <Badge tone="neutral">{m.allowances_badge_paused()}</Badge>}
              </div>
              <p className="mt-0.5 text-faint-foreground text-xs">
                {m.allowances_counted_focused()}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <NumberField
              value={Math.round(a.daily_limit_secs / 60)}
              onCommit={(m) => save({ dailyLimitSecs: m * 60 })}
              min={1}
              max={1440}
              suffix="min"
              aria-describedby={`allowance-${a.id}-usage`}
            />
            <Switch
              checked={a.enabled}
              onCheckedChange={(enabled) => save({ enabled })}
              aria-label={m.allowances_enable({ target: a.target.value })}
            />
            <Tooltip content={m.allowances_reset_tooltip()}>
              <Button
                variant="ghost"
                size="icon"
                aria-label={m.allowances_reset_for({ target: a.target.value })}
                onClick={() => reset.mutate(a.id)}
              >
                <RotateCcw />
              </Button>
            </Tooltip>
            <Button
              variant="ghost"
              tone="destructive"
              size="icon"
              aria-label={m.allowances_delete_for({ target: a.target.value })}
              onClick={() => remove.mutate(a.id)}
            >
              <Trash2 />
            </Button>
          </div>
        </div>

        <Progress
          className="mt-3"
          value={ratio}
          tone={exhausted ? "destructive" : ratio > 0.75 ? "warning" : "success"}
          label={m.allowances_usage_for({ target: a.target.value })}
        />
        <p id={`allowance-${a.id}-usage`} className="mt-1.5 text-faint-foreground text-xs">
          {exhausted
            ? m.allowances_used_all({ limit: formatDuration(a.daily_limit_secs) })
            : m.allowances_used_left({ used: formatDuration(used), left: formatDuration(left) })}
        </p>

        <InlineError error={update.error ?? reset.error ?? remove.error} />
      </Card>
    </li>
  );
}

function Labelled({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-muted-foreground text-xs">
        {label}
      </label>
      {children}
    </div>
  );
}
