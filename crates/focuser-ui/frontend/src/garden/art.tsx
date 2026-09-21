import type { GardenConfig } from "./api";

/** Original scalable plant artwork. Growth is driven by credited session seconds. */
export function Plant({
  minutes,
  variant = "sprout",
  pot = "clay",
  className = "",
  preview = false,
}: {
  minutes: number;
  variant?: string;
  pot?: string;
  className?: string;
  preview?: boolean;
}) {
  const stage = minutes >= 90 ? 3 : minutes >= 50 ? 2 : minutes >= 25 ? 1 : 0;
  const earth = pot === "ceramic" ? "#d7dcd0" : pot === "stone" ? "#7a8b7d" : "#b78363";
  return (
    <svg
      viewBox="0 0 160 190"
      className={`garden-plant ${className}`}
      role="img"
      aria-label={
        preview
          ? "装扮预览"
          : `${stage === 0 ? "种子" : stage === 1 ? "发芽" : stage === 2 ? "生长" : "成熟"}，已专注 ${Math.floor(minutes)} 分钟`
      }
    >
      <ellipse cx="80" cy="179" rx="40" ry="7" fill="currentColor" opacity=".07" />
      <g className="garden-pot-group">
        <path d="M49 134h62l-9 37q-22 11-44 0z" fill={earth} />
        <rect x="44" y="130" width="72" height="13" rx="5" fill={earth} />
        <path d="M55 145l4 19" stroke="#fff" strokeWidth="3" opacity=".17" strokeLinecap="round" />
      </g>
      {stage === 0 ? (
        <g className="garden-plant-stage-0">
          <ellipse cx="80" cy="130" rx="10" ry="4" fill="#65543d" />
          <path d="M80 129v-15" stroke="#647a43" strokeWidth="3" strokeLinecap="round" />
          <path d="M80 119q-18-2-13-12q14-3 13 12" fill="#75964e" className="garden-sway-leaf" />
        </g>
      ) : (
        <g className="garden-plant-growth">
          <path
            d={`M80 133Q75 100 82 ${stage === 3 ? 43 : stage === 2 ? 61 : 85}`}
            fill="none"
            stroke="#57794c"
            strokeWidth="4"
            strokeLinecap="round"
            className="garden-sway-stem"
          />
          <path d="M79 107Q43 112 43 79Q75 77 79 107" fill="#769655" className="garden-sway-leaf left" />
          <path d="M81 93Q119 100 123 67Q93 59 81 93" fill="#8bac65" className="garden-sway-leaf right" />
          {stage >= 2 && (
            <g className="garden-stage-2-leaves">
              <path d="M79 82Q42 81 47 49Q78 50 79 82" fill="#5e854e" className="garden-sway-leaf left" />
              <path d="M80 72Q110 73 110 43Q87 41 80 72" fill="#8fac64" className="garden-sway-leaf right" />
            </g>
          )}
          {stage === 3 &&
            (variant === "tree" ? (
              <g className="garden-crown-tree">
                <circle cx="65" cy="38" r="24" fill="#6b9056" />
                <circle cx="92" cy="33" r="27" fill="#85a65e" />
                <circle cx="81" cy="19" r="20" fill="#96b66b" />
              </g>
            ) : variant === "fern" ? (
              <g className="garden-crown-fern">
                <path
                  d="M80 57Q38 56 39 32Q63 32 80 57M80 46Q113 46 117 24Q94 23 80 46"
                  fill="#71945b"
                />
                <path d="M80 47Q62 23 80 13Q96 27 80 47" fill="#9caf6d" />
              </g>
            ) : (
              <g className="garden-crown-bloom">
                <path d="M81 58Q62 34 81 20Q98 36 81 58" fill="#93af6a" />
                <circle cx="80" cy="28" r="7" fill="#e2bf77" />
              </g>
            ))}
        </g>
      )}
    </svg>
  );
}

export function GardenScene({
  seconds,
  config,
  plants = 0,
}: {
  seconds: number;
  config: GardenConfig;
  plants?: number;
}) {
  return (
    <div className={`garden-scene garden-scene-${config.background}`}>
      <div className="garden-sun" aria-hidden="true" />
      <span className="garden-ambient-mote mote-1" aria-hidden="true" />
      <span className="garden-ambient-mote mote-2" aria-hidden="true" />
      <span className="garden-ambient-mote mote-3" aria-hidden="true" />
      <svg
        className="garden-hills"
        viewBox="0 0 600 280"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path d="M0 175Q130 108 255 180T600 150V280H0Z" fill="currentColor" opacity=".10" />
        <path d="M0 220Q200 145 375 212T600 190V280H0Z" fill="currentColor" opacity=".13" />
      </svg>
      <Plant
        minutes={seconds / 60}
        variant={config.plant}
        pot={config.pot}
        className="garden-main-plant"
      />
      {plants > 0 && (
        <Plant
          minutes={seconds / 60}
          variant={config.plant}
          pot={config.pot}
          className="garden-side-plant"
        />
      )}
      <span className="garden-scene-caption">
        {seconds < 60
          ? "留一段时间，让一颗种子开始。"
          : seconds < 1500
            ? "每一分钟，都在慢慢生长。"
            : seconds < 3000
              ? "一株嫩芽，记得你的投入。"
              : seconds < 5400
                ? "今天的努力，有了新枝叶。"
                : "把认真生活的日子，种成花园。"}
      </span>
    </div>
  );
}
