import { Award, LockKeyhole, Check } from "lucide-react";
import { useState } from "react";
import { GardenScene, Plant } from "@/garden/art";
import { GardenError, GardenLoading } from "@/garden/common";
import { cosmetics, duration, useGarden, useGardenAction, type GardenConfig } from "@/garden/api";

export function Garden() {
  const garden = useGarden();
  const action = useGardenAction();
  const [tab, setTab] = useState<"plants" | "achievements">("plants");
  if (garden.isPending) return <GardenLoading />;
  if (!garden.data)
    return (
      <div className="garden-page">
        <GardenError error={garden.error} />
      </div>
    );
  const data = garden.data;
  const completed = data.sessions.filter(
    (s) => (s.status === "completed" || s.status === "break") && s.elapsed_secs >= 60,
  );
  return (
    <div className="garden-page">
      <header className="garden-page-header">
        <div>
          <p className="garden-date">每一次投入，都有回响</p>
          <h1>属于你的花园</h1>
        </div>
        <div className="garden-level-badge">
          <Award size={20} /> 等级 {data.level} · {data.total_xp} 点经验
        </div>
      </header>
      <div className="garden-collection-hero">
        <GardenScene seconds={data.total_seconds} config={data.config} plants={completed.length} />
        <div>
          <h2>已经积累 {duration(data.total_seconds)}</h2>
          <p>从一颗种子开始，认真度过的时间会留在这里。</p>
          <p>25 分钟发芽，50 分钟长出新枝，90 分钟成熟。提前结束不会拿走已有植物。</p>
          <progress aria-label="当前等级经验" value={data.level_xp} max={data.level_next_xp || 1} />
          <span className="garden-muted">
            再积累 {Math.max(0, data.level_next_xp - data.level_xp)} 点经验，迎接下一级。
          </span>
        </div>
      </div>
      <div className="garden-segmented">
        <button
          type="button"
          className={tab === "plants" ? "selected" : ""}
          onClick={() => setTab("plants")}
        >
          植物与装扮
        </button>
        <button
          type="button"
          className={tab === "achievements" ? "selected" : ""}
          onClick={() => setTab("achievements")}
        >
          成长成就 · {data.achievements.filter((a) => a.unlocked).length}/{data.achievements.length}
        </button>
      </div>
      {tab === "plants" ? (
        <>
          <section className="garden-customize">
            <h2>给花园一点自己的颜色</h2>
            {(["plant", "pot", "background"] as const).map((kind) => (
              <fieldset key={kind}>
                <legend>{kind === "plant" ? "植物" : kind === "pot" ? "花盆" : "背景"}</legend>
                <div className="garden-cosmetic-options">
                  {cosmetics[kind].map((option) => {
                    const locked = data.level < option.level;
                    const selected = data.config[kind] === option.value;
                    return (
                      <button
                        type="button"
                        key={option.value}
                        disabled={locked || action.isPending}
                        aria-pressed={selected}
                        className={selected ? "selected" : ""}
                        onClick={() =>
                          action.mutate({
                            cmd: "update_config",
                            args: { ...data.config, [kind]: option.value } satisfies GardenConfig,
                          })
                        }
                      >
                        {kind === "background" ? (
                          <span
                            className={`garden-background-swatch garden-scene-${option.value}`}
                          />
                        ) : (
                          <Plant
                            preview
                            minutes={90}
                            variant={kind === "plant" ? option.value : data.config.plant}
                            pot={kind === "pot" ? option.value : data.config.pot}
                          />
                        )}
                        <span>{option.label}</span>
                        <small>
                          {locked ? (
                            <>
                              <LockKeyhole size={12} /> 等级 {option.level} 解锁
                            </>
                          ) : selected ? (
                            <>
                              <Check size={12} /> 正在使用
                            </>
                          ) : (
                            "已解锁"
                          )}
                        </small>
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            ))}
            <GardenError error={action.error} />
          </section>
          <section className="garden-plants">
            <h2>专注留下的植物</h2>
            {completed.length === 0 ? (
              <p className="garden-empty">
                完成第一段至少 1 分钟的真实专注，这里就会留下它的成长记录。
              </p>
            ) : (
              <div className="garden-plant-shelf">
                {[...completed]
                  .sort((a, b) => b.started_at.localeCompare(a.started_at))
                  .slice(0, 24)
                  .map((s) => (
                    <article key={s.id}>
                      <Plant
                        minutes={s.elapsed_secs / 60}
                        variant={data.config.plant}
                        pot={data.config.pot}
                      />
                      <strong>{s.task}</strong>
                      <span>
                        {s.local_date} · {duration(s.elapsed_secs)}
                      </span>
                    </article>
                  ))}
              </div>
            )}
          </section>
        </>
      ) : (
        <section className="garden-achievements">
          <p className="garden-muted">每一项成就都来自真实记录。没有付费解锁，也不用和别人比较。</p>
          <div className="garden-achievement-list">
            {data.achievements.map((a) => (
              <article key={a.id} className={a.unlocked ? "unlocked" : ""}>
                <span className="garden-achievement-icon">
                  {a.unlocked ? <Award size={23} /> : <LockKeyhole size={20} />}
                </span>
                <div>
                  <h3>{a.title}</h3>
                  <p>{a.description}</p>
                </div>
                <span>{a.unlocked ? "已达成" : "慢慢来"}</span>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
