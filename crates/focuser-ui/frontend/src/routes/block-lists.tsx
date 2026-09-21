import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Plus, Trash2 } from "lucide-react";
import type { BlockList } from "@/bindings";
import {
  useBlockLists,
  useCreateBlockList,
  useDeleteBlockList,
  useToggleBlockList,
} from "@/lib/commands";
import { Switch } from "@/components/ui/switch";
import { GardenError } from "@/garden/common";
import { useGarden } from "@/garden/api";

export function BlockLists() {
  const lists = useBlockLists();
  const create = useCreateBlockList();
  const [name, setName] = useState("");
  const garden = useGarden();
  const locked = garden.data?.active?.status === "work" && garden.data.active.strict !== "gentle";
  function submit(e: FormEvent) {
    e.preventDefault();
    if (name.trim()) create.mutate(name.trim(), { onSuccess: () => setName("") });
  }
  return (
    <div className="garden-page">
      <header className="garden-page-header">
        <div>
          <p className="garden-date">按生活场景整理分心来源</p>
          <h1>屏蔽列表</h1>
        </div>
      </header>
      <p className="garden-muted">
        可以建立娱乐、社交、视频、游戏等分类。关闭的列表仍可在首页被选为一次专注的限制范围；开启后按自己的每周计划生效。
      </p>
      <form className="garden-list-create" onSubmit={submit}>
        <input
          aria-label="新列表名称"
          placeholder="给列表起个名字，例如娱乐"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
        />
        <button
          className="garden-button"
          type="submit"
          disabled={locked || !name.trim() || create.isPending}
        >
          <Plus size={16} /> 新建列表
        </button>
      </form>
      {lists.data?.map((list) => (
        <ListRow key={list.id} list={list} locked={Boolean(locked)} />
      ))}
      {!lists.isPending && lists.data?.length === 0 && (
        <p className="garden-empty">从一张小小的列表开始。以后随时可以调整。</p>
      )}
      <GardenError error={lists.error ?? create.error} />
    </div>
  );
}
function ListRow({ list, locked }: { list: BlockList; locked: boolean }) {
  const toggle = useToggleBlockList();
  const remove = useDeleteBlockList();
  const [confirm, setConfirm] = useState(false);
  return (
    <article className="garden-list-row" data-testid="block-list-row">
      <div className="garden-list-summary">
        <div>
          <h2>{list.name}</h2>
          <p>
            {list.applications.length} 个应用 · {list.websites.length} 个网站 ·{" "}
            {list.exceptions.length} 项例外{list.schedule ? " · 已设置计划" : ""}
          </p>
        </div>
        <Switch
          aria-label={`开启 ${list.name}`}
          checked={list.enabled}
          disabled={locked || toggle.isPending}
          onCheckedChange={(enabled) => toggle.mutate({ id: list.id, enabled })}
        />
        <button
          type="button"
          className="garden-icon-button"
          aria-label={`删除 ${list.name}`}
          disabled={locked}
          onClick={() => setConfirm(!confirm)}
        >
          <Trash2 size={17} />
        </button>
      </div>
      <div className="garden-inline-actions">
        <Link className="garden-link" to="/apps">
          选择应用
        </Link>
        <Link className="garden-link" to="/websites">
          编辑网站
        </Link>
        <Link className="garden-link" to="/schedule">
          每周计划
        </Link>
        <Link className="garden-link" to="/">
          用它开始专注
        </Link>
      </div>
      {confirm && (
        <div className="garden-delete-confirm">
          <span>删除「{list.name}」及其中规则？已有专注记录会保留。</span>
          <button
            className="garden-button secondary small"
            type="button"
            onClick={() => setConfirm(false)}
          >
            保留
          </button>
          <button
            className="garden-button small"
            type="button"
            disabled={locked || remove.isPending}
            onClick={() => remove.mutate(list.id)}
          >
            确认删除
          </button>
        </div>
      )}
      <GardenError error={toggle.error ?? remove.error} />
    </article>
  );
}
