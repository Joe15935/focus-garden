import { motion } from "motion/react";
import { Minus, Plus } from "lucide-react";

interface DurationPickerProps {
  workMinutes: number;
  onWorkChange: (mins: number) => void;
  breakMinutes: number;
  onBreakChange: (mins: number) => void;
  disabled?: boolean;
}

const PRESETS = [
  { mins: 15, label: "15 分钟 · 快速起步" },
  { mins: 25, label: "25 分钟 · 经典番茄" },
  { mins: 45, label: "45 分钟 · 深度攻坚" },
  { mins: 60, label: "60 分钟 · 沉浸心流" },
];

const BREAK_PRESETS = [
  { mins: 0, label: "无休息" },
  { mins: 5, label: "5 分钟" },
  { mins: 10, label: "10 分钟" },
  { mins: 15, label: "15 分钟" },
];

export function DurationPicker({
  workMinutes,
  onWorkChange,
  breakMinutes,
  onBreakChange,
  disabled = false,
}: DurationPickerProps) {
  const clampWork = (val: number) => Math.min(240, Math.max(5, val));
  const clampBreak = (val: number) => Math.min(60, Math.max(0, val));

  return (
    <div className="garden-duration-picker-wrap">
      {/* Work Duration Header & Stepper */}
      <div className="garden-duration-section">
        <div className="garden-duration-header">
          <label htmlFor="garden-work-slider" className="garden-duration-title">
            专注时长
          </label>
          <div className="garden-duration-stepper">
            <button
              type="button"
              className="garden-stepper-btn"
              onClick={() => onWorkChange(clampWork(workMinutes - 5))}
              disabled={disabled || workMinutes <= 5}
              aria-label="减少 5 分钟"
            >
              <Minus size={14} />
            </button>
            <span className="garden-duration-val">
              <strong>{workMinutes}</strong>
              <small>分钟</small>
            </span>
            <button
              type="button"
              className="garden-stepper-btn"
              onClick={() => onWorkChange(clampWork(workMinutes + 5))}
              disabled={disabled || workMinutes >= 240}
              aria-label="增加 5 分钟"
            >
              <Plus size={14} />
            </button>
          </div>
        </div>

        {/* Quick Presets Pills */}
        <div className="garden-preset-pills" role="group" aria-label="专注时长预设">
          {PRESETS.map(({ mins, label }) => {
            const active = workMinutes === mins;
            return (
              <button
                type="button"
                key={mins}
                disabled={disabled}
                onClick={() => onWorkChange(mins)}
                className={`garden-preset-pill ${active ? "active" : ""}`}
              >
                {active && (
                  <motion.div
                    layoutId="active-work-preset"
                    className="garden-preset-pill-bg"
                    transition={{ type: "spring", stiffness: 450, damping: 32 }}
                  />
                )}
                <span className="garden-preset-label">{label}</span>
              </button>
            );
          })}
        </div>

        {/* Tactile Range Slider */}
        <div className="garden-range-slider-wrap">
          <input
            id="garden-work-slider"
            type="range"
            min="5"
            max="120"
            step="5"
            value={workMinutes}
            onChange={(e) => onWorkChange(Number(e.target.value))}
            disabled={disabled}
            className="garden-range-slider"
            aria-label="专注时长滑块"
          />
          <div className="garden-slider-scale">
            <span>5 分钟</span>
            <span>25 分钟</span>
            <span>60 分钟</span>
            <span>120 分钟</span>
          </div>
        </div>
      </div>

      {/* Break Duration Section */}
      <div className="garden-duration-section garden-break-section">
        <div className="garden-duration-header">
          <span className="garden-duration-title">休息时长</span>
          <span className="garden-duration-val small">
            <strong>{breakMinutes}</strong>
            <small>分钟</small>
          </span>
        </div>

        <div className="garden-preset-pills mini" role="group" aria-label="休息时长选择">
          {BREAK_PRESETS.map(({ mins, label }) => {
            const active = breakMinutes === mins;
            return (
              <button
                type="button"
                key={mins}
                disabled={disabled}
                onClick={() => onBreakChange(clampBreak(mins))}
                className={`garden-preset-pill mini ${active ? "active" : ""}`}
              >
                {active && (
                  <motion.div
                    layoutId="active-break-preset"
                    className="garden-preset-pill-bg"
                    transition={{ type: "spring", stiffness: 450, damping: 32 }}
                  />
                )}
                <span className="garden-preset-label">{label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
