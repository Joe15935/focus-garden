import {
  AppWindow,
  BarChart3,
  CalendarClock,
  Globe,
  Hourglass,
  Leaf,
  ListChecks,
  Settings,
  Sprout,
} from "lucide-react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { GardenTheme } from "@/garden/common";
import { HealthBanner } from "@/garden/health";
import { countdown, useGarden } from "@/garden/api";
import { useApplySavedLanguage } from "@/lib/language";
import { isTauri } from "@/lib/transport";

const NAV = [
  { to: "/", label: "今天", icon: Sprout },
  { to: "/garden", label: "我的花园", icon: Leaf },
  { to: "/statistics", label: "专注足迹", icon: BarChart3 },
  { to: "/block-lists", label: "屏蔽列表", icon: ListChecks },
  { to: "/apps", label: "应用限制", icon: AppWindow },
  { to: "/websites", label: "网站限制", icon: Globe },
  { to: "/schedule", label: "每周计划", icon: CalendarClock },
  { to: "/allowances", label: "每日额度", icon: Hourglass },
  { to: "/settings", label: "设置", icon: Settings },
];
export function AppLayout() {
  useApplySavedLanguage();
  const garden = useGarden();
  const navigate = useNavigate();
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    const stops: (() => void)[] = [];
    const keep = (stop: () => void) => {
      if (disposed) stop();
      else stops.push(stop);
    };
    listen<{ kind: string; target: string; message: string; confirmed: boolean }>(
      "garden-blocked",
      ({ payload }) => {
        if (payload.kind === "app" && payload.confirmed)
          toast(payload.message || `已屏蔽 ${payload.target}`);
      },
    ).then(keep);
    listen<string>("garden-exit-requested", ({ payload }) => {
      toast(payload || "请通过安全出口结束本次专注。");
      navigate("/");
    }).then(keep);
    listen<string>("garden-phase-changed", ({ payload }) => {
      if (payload === "break") toast.success("这一段专注完成了，休息一下。成果已经保存。");
      if (payload === "idle") toast("当前安排已结束，可以回到花园查看记录。");
    }).then(keep);
    listen<string>("garden-error", ({ payload }) =>
      toast.error(payload || "操作未完成，请查看当前状态后重试。"),
    ).then(keep);
    return () => {
      disposed = true;
      stops.forEach((stop) => stop());
    };
  }, [navigate]);
  const active = garden.data?.active;
  return (
    <div className="garden-app-shell">
      <GardenTheme />
      <nav className="garden-sidebar" aria-label="主要导航">
        <NavLink to="/" className="garden-brand">
          <span>
            <Sprout size={24} />
          </span>
          <strong>
            专注花园<small>一点一点，慢慢生长</small>
          </strong>
        </NavLink>
        <div className="garden-nav-links">
          {NAV.map(({ to, label, icon: Icon }, index) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `${isActive ? "active" : ""} ${index === 3 ? "garden-nav-divider" : ""}`
              }
            >
              <Icon size={18} />
              <span>{label}</span>
            </NavLink>
          ))}
        </div>
        <div className="garden-sidebar-bottom">
          {active ? (
            <NavLink to="/" className="garden-session-pill">
              <span>{active.status === "break" ? "正在休息" : "正在专注"}</span>
              <strong>
                {countdown(
                  active.status === "break"
                    ? ((active as typeof active & { break_remaining_secs?: number })
                        .break_remaining_secs ?? active.break_secs)
                    : active.planned_secs - active.elapsed_secs,
                )}
              </strong>
              <small>{active.task}</small>
            </NavLink>
          ) : (
            <p>
              <Leaf size={14} /> 所有成长，留在本机
            </p>
          )}
        </div>
      </nav>
      <main className="garden-main">
        <HealthBanner />
        {active?.strict !== "gentle" && active?.status === "work" && (
          <div className="garden-locked-note">
            本次专注期间，限制规则和设置暂时锁定。提前结束请回到「今天」。
          </div>
        )}
        <Outlet />
      </main>
    </div>
  );
}
