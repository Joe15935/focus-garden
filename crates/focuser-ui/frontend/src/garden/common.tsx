import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Sprout, ShieldCheck } from "lucide-react";
import { type GardenConfig, useGarden, useGardenAction, errorText } from "./api";

export function GardenTheme() {
  const query = useGarden();
  const theme = query.data?.config.theme ?? "system";
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () =>
      document.documentElement.classList.toggle(
        "dark",
        theme === "dark" || (theme === "system" && media.matches),
      );
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  return null;
}
export function GardenError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="garden-error">
      {errorText(error)}
    </p>
  );
}
export function GardenLoading() {
  return (
    <div className="garden-loading" role="status">
      <Sprout size={24} /> 正在打开你的花园…
    </div>
  );
}
export function Onboarding() {
  const [open, setOpen] = useState(
    () => localStorage.getItem("focus-garden-onboarding") !== "done",
  );
  if (!open) return null;
  return (
    <section className="garden-welcome" aria-label="首次使用">
      <ShieldCheck size={24} />
      <div>
        <h2>欢迎来到专注花园</h2>
        <p>
          先选要屏蔽的应用和网站，再为一件事留出时间。完成专注，植物就会成长；提前结束也不会失去以前的成果。
        </p>
        <p>
          网页识别需要辅助功能权限，网页拦截另需浏览器自动化权限。你的任务、统计和花园只保存在这台
          Mac。
        </p>
        <div className="garden-inline-actions">
          <Link to="/settings" className="garden-link">
            查看权限与本地数据
          </Link>
          <button
            className="garden-button small"
            type="button"
            onClick={() => {
              localStorage.setItem("focus-garden-onboarding", "done");
              setOpen(false);
            }}
          >
            开始使用
          </button>
        </div>
      </div>
    </section>
  );
}
export function GoalSettings({ config }: { config: GardenConfig }) {
  const action = useGardenAction();
  const [value, setValue] = useState({
    daily_goal_minutes: config.daily_goal_minutes,
    weekly_goal_minutes: config.weekly_goal_minutes,
    streak_minutes: config.streak_minutes,
  });
  return (
    <form
      className="garden-goals-form"
      onSubmit={(e) => {
        e.preventDefault();
        action.mutate({ cmd: "update_config", args: { ...config, ...value } });
      }}
    >
      <label>
        每日目标（分钟）
        <input
          type="number"
          min="1"
          max="1440"
          value={value.daily_goal_minutes}
          onChange={(e) => setValue({ ...value, daily_goal_minutes: Number(e.target.value) })}
        />
      </label>
      <label>
        每周目标（分钟）
        <input
          type="number"
          min="1"
          max="10080"
          value={value.weekly_goal_minutes}
          onChange={(e) => setValue({ ...value, weekly_goal_minutes: Number(e.target.value) })}
        />
      </label>
      <label>
        连续天数门槛（分钟/天）
        <input
          type="number"
          min="1"
          max="1440"
          value={value.streak_minutes}
          onChange={(e) => setValue({ ...value, streak_minutes: Number(e.target.value) })}
        />
      </label>
      <button className="garden-button" disabled={action.isPending} type="submit">
        保存目标
      </button>
      <GardenError error={action.error} />
    </form>
  );
}
