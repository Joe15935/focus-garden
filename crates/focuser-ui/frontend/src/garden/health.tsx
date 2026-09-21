import { invoke } from "@tauri-apps/api/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, ShieldAlert } from "lucide-react";
import { Link } from "react-router-dom";
import { GardenError } from "./common";
export interface MacHealth {
  platform: string;
  accessibility_granted: boolean;
  rules_active: boolean;
  monitoring: boolean;
  website_blocking_available: boolean;
  front_browser: string | null;
  front_url_available: boolean;
  front_app: {
    pid: number;
    name: string;
    bundle_id: string;
    regular_app: boolean;
    protected: boolean;
    protection_reason: string | null;
  } | null;
  matched_rule: string | null;
  automation: { browser: string; bundle_id: string; status: string }[];
  last_error: string | null;
  blocked_apps: number;
  blocked_websites: number;
}
export function useMacHealth() {
  return useQuery({
    queryKey: ["mac-health"],
    queryFn: () => invoke<MacHealth>("mac_health"),
    refetchInterval: 3000,
  });
}
export function HealthBanner() {
  const health = useMacHealth();
  if (health.isPending) return null;
  if (health.error)
    return (
      <div className="garden-health-banner">
        <ShieldAlert size={17} />
        <span>暂时无法确认屏蔽服务状态。</span>
        <Link to="/settings">查看设置</Link>
      </div>
    );
  const data = health.data;
  if (
    !data ||
    (data.accessibility_granted && (!data.rules_active || data.monitoring) && !data.last_error)
  )
    return null;
  return (
    <div className="garden-health-banner">
      <ShieldAlert size={17} />
      <span>
        {!data.accessibility_granted
          ? "网页识别需要辅助功能权限，当前网站限制尚未生效。"
          : (data.last_error ?? "屏蔽服务尚未开始监测。")}
      </span>
      <Link to="/settings">检查权限</Link>
    </div>
  );
}
export function PermissionPanel() {
  const health = useMacHealth();
  const qc = useQueryClient();
  const permission = useMutation({
    mutationFn: (browser: string) => invoke("request_browser_permission", { browser }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["mac-health"] }),
  });
  const data = health.data;
  return (
    <section className="garden-settings-section">
      <h2>应用与网站限制权限</h2>
      <p className="garden-muted">
        辅助功能用于识别当前应用和网页。浏览器自动化仅在命中规则时切换到本地拦截页，不会关闭你的浏览器。是否允许由
        macOS 确认。
      </p>
      <div className="garden-permission-row">
        <div>
          <strong>辅助功能</strong>
          <p>
            {data?.accessibility_granted
              ? "已允许读取前台应用和网页"
              : "尚未获得权限，网页识别和网站限制不可用"}
          </p>
        </div>
        <button
          type="button"
          className="garden-button secondary small"
          disabled={permission.isPending}
          onClick={() => permission.mutate("accessibility")}
        >
          打开权限设置
        </button>
      </div>
      {data?.automation.map((browser) => (
        <div className="garden-permission-row" key={browser.bundle_id}>
          <div>
            <strong>{browser.browser}</strong>
            <p>
              {browser.status === "granted" || browser.status === "authorized"
                ? "已获得自动化权限"
                : browser.status === "denied"
                  ? "权限被拒绝，请在系统设置中开启"
                  : "尚未确认自动化权限"}
            </p>
          </div>
          <button
            type="button"
            className="garden-button secondary small"
            disabled={permission.isPending}
            onClick={() => permission.mutate(browser.bundle_id)}
          >
            检查并授权
          </button>
        </div>
      ))}
      <p className="garden-permission-status">
        {data?.monitoring ? <ShieldCheck size={16} /> : <ShieldAlert size={16} />}
        {data?.monitoring
          ? "前台监测运行中"
          : !data?.rules_active
            ? "当前没有活动规则，服务待命中"
            : "前台监测未就绪"}{" "}
        · {data?.website_blocking_available ? "已有浏览器的网站限制就绪" : "浏览器网站限制尚未就绪"}
      </p>
      <details className="garden-monitor-details">
        <summary>当前监测信息</summary>
        <p className="garden-muted">
          当前应用：
          {data?.front_app?.name ??
            (data?.rules_active ? "尚未读取到前台应用" : "没有活动规则，等待开始")}
        </p>
        {data?.front_app && (
          <p className="garden-muted">
            {data.front_app.protected
              ? `保护原因：${data.front_app.protection_reason ?? "此应用保留用于安全操作和恢复"}`
              : "该应用可由应用规则限制。"}
          </p>
        )}
        {data?.front_app && (
          <p className="garden-muted">
            {data.matched_rule ? `匹配规则：${data.matched_rule}` : "本次检查未匹配限制规则。"}
          </p>
        )}
      </details>
      <GardenError error={permission.error ?? health.error ?? data?.last_error} />
    </section>
  );
}
