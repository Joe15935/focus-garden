import { useState } from "react";
import { useAutostart } from "@/lib/autostart";
import { Switch } from "@/components/ui/switch";
import { useGarden, useGardenAction } from "@/garden/api";
import { GardenError, GardenLoading, GoalSettings } from "@/garden/common";
import { PermissionPanel } from "@/garden/health";
import { ExportActions } from "@/garden/export";

export function Settings() {
  const garden = useGarden();
  const action = useGardenAction();
  const autostart = useAutostart();
  const [notice, setNotice] = useState("");
  if (garden.isPending) return <GardenLoading />;
  const config = garden.data?.config;
  return (
    <div className="garden-page garden-settings">
      <header className="garden-page-header">
        <div>
          <p className="garden-date">让专注适合自己的生活</p>
          <h1>设置</h1>
        </div>
      </header>
      <PermissionPanel />
      <section className="garden-settings-section">
        <h2>日常习惯</h2>
        <div className="garden-permission-row">
          <div>
            <strong>登录时启动</strong>
            <p>打开 Mac 后，在菜单栏陪你开始一天。</p>
          </div>
          <Switch
            aria-label="登录时启动"
            checked={autostart.value}
            onCheckedChange={autostart.set}
            disabled={!autostart.supported || autostart.isPending || autostart.isSaving}
          />
        </div>
        <GardenError error={autostart.error} />
        {config && <GoalSettings config={config} />}
      </section>
      <section className="garden-settings-section">
        <h2>外观与语言</h2>
        {config && (
          <div className="garden-permission-row">
            <div>
              <strong>颜色模式</strong>
              <p>所有页面跟随同一种外观。</p>
            </div>
            <select
              aria-label="颜色模式"
              value={config.theme}
              onChange={(e) =>
                action.mutate({ cmd: "update_config", args: { ...config, theme: e.target.value } })
              }
            >
              <option value="system">跟随系统</option>
              <option value="light">浅色</option>
              <option value="dark">深色</option>
            </select>
          </div>
        )}
        <div className="garden-permission-row">
          <div>
            <strong>界面语言</strong>
            <p>简体中文</p>
          </div>
          <span className="garden-muted">中文优先</span>
        </div>
        <GardenError error={action.error} />
      </section>
      <section className="garden-settings-section">
        <h2>只属于你的本地数据</h2>
        <p>
          无需账号、订阅或云服务。专注记录、屏蔽规则、目标和花园保存在本机应用数据目录。JSON
          用于本地归档，CSV 用于查看和分析。完整恢复请先退出应用，再备份整个数据目录。
        </p>
        <ExportActions />
        <p className="garden-muted">
          应用异常退出或 Mac
          休眠期间不赠送专注时长。重新打开后，未完成会话按中断恢复，已获得的成果仍在。
        </p>
      </section>
      <section className="garden-settings-section">
        <h2>安全出口</h2>
        <p>
          温和模式可以立即结束；专注模式等待 30 秒并填写原因；深度专注等待 5
          分钟并输入确认文字。每次提前结束都会如实记录。
        </p>
        <p className="garden-muted">
          本应用不修改系统 hosts、代理、SIP 或 FileVault。限制只在本应用运行时生效。遇到故障，可通过
          macOS 强制退出停止本应用。
        </p>
        <button
          type="button"
          className="garden-button secondary small"
          onClick={() => {
            localStorage.removeItem("focus-garden-onboarding");
            setNotice("已恢复首次引导，回到首页即可查看。");
          }}
        >
          再次显示首次引导
        </button>
        {notice && <p role="status">{notice}</p>}
      </section>
      <p className="garden-muted">专注花园 0.1.0 · 基于 Focuser 0.7.3（MIT），第三方许可随应用提供。</p>
      <GardenError error={garden.error} />
    </div>
  );
}
