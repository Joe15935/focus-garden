import { motion } from "motion/react";
import { Feather, Shield, Lock } from "lucide-react";
import type { Strictness } from "./api";

interface StrictnessSelectorProps {
  value: Strictness;
  onChange: (value: Strictness) => void;
  disabled?: boolean;
}

const MODES = [
  {
    id: "gentle" as Strictness,
    name: "温和自律",
    sub: "随时可提前结束",
    icon: Feather,
    desc: "轻松无压力，适合轻量阅读或易受打扰时",
  },
  {
    id: "focus" as Strictness,
    name: "标准专注",
    sub: "等待 30 秒冷静期",
    icon: Shield,
    desc: "写下退出原因，帮助守住番茄钟节奏",
  },
  {
    id: "deep" as Strictness,
    name: "深度沉浸",
    sub: "等待 5 分钟冷静期",
    icon: Lock,
    desc: "需输入确认文字，彻底隔绝冲动分心",
  },
];

export function StrictnessSelector({
  value,
  onChange,
  disabled = false,
}: StrictnessSelectorProps) {
  return (
    <fieldset className="garden-strictness-cards" aria-label="专注强度选择">
      <legend className="sr-only">专注强度</legend>
      <div className="garden-strict-grid">
        {MODES.map((mode) => {
          const active = value === mode.id;
          const Icon = mode.icon;
          return (
            <button
              type="button"
              key={mode.id}
              disabled={disabled}
              onClick={() => onChange(mode.id)}
              className={`garden-strict-card ${active ? "active" : ""}`}
              aria-pressed={active}
            >
              {active && (
                <motion.div
                  layoutId="active-strict-card-border"
                  className="garden-strict-card-glow"
                  transition={{ type: "spring", stiffness: 450, damping: 35 }}
                />
              )}
              <div className="garden-strict-card-inner">
                <div className="garden-strict-card-header">
                  <div className="garden-strict-icon-wrap">
                    <Icon size={18} />
                  </div>
                  <div className="garden-strict-titles">
                    <strong>{mode.name}</strong>
                    <small>{mode.sub}</small>
                  </div>
                </div>
                <p className="garden-strict-desc">{mode.desc}</p>
              </div>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
