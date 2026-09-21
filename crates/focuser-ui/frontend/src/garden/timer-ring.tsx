import { motion } from "motion/react";
import { countdown } from "./api";

interface TimerRingProps {
  totalSecs: number;
  elapsedSecs: number;
  remainingSecs: number;
  isBreak?: boolean;
  task: string;
  category: string;
  className?: string;
}

export function TimerRing({
  totalSecs,
  elapsedSecs,
  remainingSecs,
  isBreak = false,
  task,
  category,
  className = "",
}: TimerRingProps) {
  const safeTotal = Math.max(1, totalSecs);
  const progress = Math.min(1, Math.max(0, elapsedSecs / safeTotal));
  const radius = 108;
  const strokeWidth = 10;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - progress);

  // Growth stage hint based on actual seconds
  const stageHint = isBreak
    ? "深呼吸，让思绪舒展片刻"
    : elapsedSecs >= 5400
      ? "已达成熟 · 每一分钟都是丰收"
      : elapsedSecs >= 3000
        ? "繁茂生长 · 沉浸心流之中"
        : elapsedSecs >= 1500
          ? "破土发芽 · 专注渐入佳境"
          : "种下意向 · 静心开始";

  return (
    <div
      className={`garden-radial-timer ${isBreak ? "is-break" : ""} ${className}`}
      role="timer"
      aria-label={isBreak ? "休息剩余时间" : "专注剩余时间"}
    >
      <div className="garden-radial-glow-backdrop" aria-hidden="true" />

      <svg
        className="garden-radial-svg"
        viewBox="0 0 260 260"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="gardenWorkGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--primary, #587647)" />
            <stop offset="100%" stopColor="#8fac64" />
          </linearGradient>
          <linearGradient id="gardenBreakGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#526f88" />
            <stop offset="100%" stopColor="#78a4a8" />
          </linearGradient>
        </defs>

        {/* Background track */}
        <circle
          cx="130"
          cy="130"
          r={radius}
          className="garden-radial-track"
          strokeWidth={strokeWidth}
          fill="none"
        />

        {/* Animated Progress Ring */}
        <motion.circle
          cx="130"
          cy="130"
          r={radius}
          className="garden-radial-progress"
          strokeWidth={strokeWidth}
          stroke={isBreak ? "url(#gardenBreakGrad)" : "url(#gardenWorkGrad)"}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          transform="rotate(-90 130 130)"
        />
      </svg>

      {/* Center content */}
      <div className="garden-radial-center">
        <span className="garden-radial-badge">
          {isBreak ? "正在休息" : category}
        </span>

        <strong className="garden-radial-countdown">
          {countdown(remainingSecs)}
        </strong>

        <p className="garden-radial-task" title={task}>
          {task}
        </p>

        <span className="garden-radial-hint">
          {stageHint}
        </span>
      </div>
    </div>
  );
}
