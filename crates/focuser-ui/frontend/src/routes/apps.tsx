import { AppWindow, Check, Search, Trash2 } from "lucide-react";
import { useState } from "react";
import { ListPicker, resolveSelected } from "@/components/list-picker";
import {
  useAddAppRule,
  useBlockLists,
  useRemoveAppRule,
  useSetting,
  useSetSetting,
} from "@/lib/commands";
import { useInstalledApps } from "@/garden/api";
import { GardenError } from "@/garden/common";
import { describeApp } from "@/lib/match-types";

export function Apps() {
  const lists = useBlockLists();
  const apps = useInstalledApps();
  const [selectedRaw, setSelected] = useState("");
  const [search, setSearch] = useState("");
  const add = useAddAppRule();
  const remove = useRemoveAppRule();
  const selected = resolveSelected(lists.data ?? [], selectedRaw);
  const list = lists.data?.find((l) => l.id === selected);
  const mode = useSetting(`garden_app_mode:${selected}`, "blacklist");
  const save = useSetSetting();
  const all = (apps.data ?? []).filter(
    (app) => !(app as typeof app & { protected?: boolean }).protected,
  );
  const visible = all.filter((app) =>
    `${app.name} ${app.bundle_id}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="garden-page">
      <header className="garden-page-header">
        <div>
          <p className="garden-date">给分心留出边界</p>
          <h1>应用限制</h1>
        </div>
        <ListPicker lists={lists.data ?? []} value={selected} onChange={setSelected} />
      </header>
      {!list ? (
        <p className="garden-empty">请先在「屏蔽列表」建立一个列表，再选择应用。</p>
      ) : (
        <>
          <div className="garden-app-mode">
            <div>
              <strong>「{list.name}」中的应用</strong>
              <p>列表名称就是分类，例如娱乐、社交、视频或游戏。系统恢复工具始终保留。</p>
            </div>
            <select
              aria-label="应用限制方式"
              value={mode.data ?? "blacklist"}
              disabled={save.isPending}
              onChange={(e) =>
                save.mutate({ key: `garden_app_mode:${selected}`, value: e.target.value })
              }
            >
              <option value="blacklist">屏蔽这些应用</option>
              <option value="whitelist">只允许这些应用</option>
            </select>
          </div>
          <div className="garden-app-search">
            <Search size={18} />
            <input
              aria-label="搜索已安装应用"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索已安装的应用"
            />
            <button type="button" onClick={() => apps.refetch()} disabled={apps.isFetching}>
              {apps.isFetching ? "正在读取…" : "刷新"}
            </button>
          </div>
          {apps.isPending ? (
            <p className="garden-muted">正在读取本机应用…</p>
          ) : (
            <div className="garden-app-grid">
              {visible.map((app) => {
                const rule = list.applications.find(
                  (rule) =>
                    "BundleId" in rule.match_type && rule.match_type.BundleId === app.bundle_id,
                );
                return (
                  <button
                    type="button"
                    key={app.bundle_id + app.path}
                    className={rule ? "selected" : ""}
                    aria-pressed={Boolean(rule)}
                    disabled={add.isPending || remove.isPending}
                    onClick={() =>
                      rule
                        ? remove.mutate({ listId: list.id, ruleId: rule.id })
                        : add.mutate({ listId: list.id, rule: { BundleId: app.bundle_id } })
                    }
                  >
                    {app.icon ? (
                      <img src={app.icon} alt="" />
                    ) : (
                      <span className="garden-app-placeholder">
                        <AppWindow size={23} />
                      </span>
                    )}
                    <span>
                      <strong>{app.name}</strong>
                      <small>
                        {rule
                          ? "已加入当前列表"
                          : mode.data === "whitelist"
                            ? "点击加入允许访问"
                            : "点击加入屏蔽"}
                      </small>
                    </span>
                    {rule && <Check size={17} />}
                  </button>
                );
              })}
            </div>
          )}
          {!apps.isPending && visible.length === 0 && (
            <p className="garden-empty">没有找到对应应用，请换个名称或刷新。</p>
          )}
          {list.applications.length > 0 && (
            <section className="garden-current-apps">
              <h2>已选择 {list.applications.length} 项</h2>
              {list.applications.map((rule) => {
                const info = describeApp(rule.match_type);
                const name = all.find((app) => app.bundle_id === info.value)?.name ?? info.value;
                return (
                  <div key={rule.id}>
                    <span>
                      {name}
                      <small>{info.label}</small>
                    </span>
                    <button
                      type="button"
                      aria-label={`移除 ${name}`}
                      onClick={() => remove.mutate({ listId: list.id, ruleId: rule.id })}
                      disabled={remove.isPending}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                );
              })}
            </section>
          )}
        </>
      )}
      <GardenError
        error={lists.error ?? apps.error ?? add.error ?? remove.error ?? save.error ?? mode.error}
      />
    </div>
  );
}
