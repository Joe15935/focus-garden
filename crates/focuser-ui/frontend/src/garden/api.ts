import { invoke } from "@tauri-apps/api/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type Strictness = "gentle" | "focus" | "deep";
export type Outcome = "pending" | "completed" | "partial" | "unfinished";
export interface GardenConfig {
  daily_goal_minutes: number;
  weekly_goal_minutes: number;
  streak_minutes: number;
  theme: "system" | "light" | "dark";
  plant: string;
  pot: string;
  background: string;
}
export interface Session {
  id: string;
  list_id: string;
  task: string;
  category: string;
  started_at: string;
  ended_at?: string | null;
  local_date: string;
  planned_secs: number;
  elapsed_secs: number;
  break_secs: number;
  break_remaining_secs: number;
  strict: Strictness;
  status: "work" | "break" | "completed" | "interrupted";
  reason?: string | null;
  outcome: Outcome;
  exit_requested_at?: string | null;
  exit_remaining_secs: number;
  xp: number;
}
export interface GardenDay {
  date: string;
  seconds: number;
  sessions: number;
  tasks: string[];
}
export interface Achievement {
  id: string;
  title: string;
  description: string;
  unlocked: boolean;
}
export interface Snapshot {
  config: GardenConfig;
  active: Session | null;
  sessions: Session[];
  total_seconds: number;
  total_xp: number;
  level: number;
  level_xp: number;
  level_next_xp: number;
  current_streak: number;
  longest_streak: number;
  achievements: Achievement[];
  days: GardenDay[];
  app_blocks: number;
  website_blocks: number;
  completed_sessions: number;
  interrupted_sessions: number;
}
export interface InstalledApp {
  name: string;
  bundle_id: string;
  path: string;
  executable: string;
  icon?: string | null;
  protected?: boolean;
}
export const GARDEN_KEY = ["garden-snapshot"] as const;
export async function gardenCommand<T = unknown>(cmd: string, args?: unknown): Promise<T> {
  try {
    return await invoke<T>("garden_command", {
      command: { cmd, ...(args === undefined ? {} : { args }) },
    });
  } catch (error) {
    throw new Error(errorText(error));
  }
}
export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error)
    return String(error.message);
  return String(error ?? "操作未完成，请重试。");
}
export function useGarden() {
  return useQuery({
    queryKey: GARDEN_KEY,
    queryFn: () => gardenCommand<Snapshot>("snapshot"),
    refetchInterval: (query) => (query.state.data?.active ? 1000 : 5000),
  });
}
export function useGardenAction() {
  const query = useQueryClient();
  return useMutation({
    mutationFn: ({ cmd, args }: { cmd: string; args?: unknown }) => gardenCommand(cmd, args),
    onSuccess: () => query.invalidateQueries({ queryKey: GARDEN_KEY }),
  });
}
export function useInstalledApps() {
  return useQuery({
    queryKey: ["installed-apps"],
    queryFn: () => invoke<InstalledApp[]>("installed_apps"),
    staleTime: 60_000,
    refetchInterval: false,
  });
}
export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function duration(seconds: number): string {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分` : `${minutes} 分钟`;
}
export function countdown(seconds: number): string {
  const value = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}
export const strictLabels: Record<Strictness, string> = {
  gentle: "温和",
  focus: "专注",
  deep: "深度专注",
};
export const outcomeLabels: Record<Outcome, string> = {
  pending: "待回顾",
  completed: "完成",
  partial: "部分完成",
  unfinished: "未完成",
};
export const cosmetics = {
  plant: [
    { value: "sprout", label: "嫩芽", level: 1 },
    { value: "fern", label: "蕨叶", level: 3 },
    { value: "tree", label: "小树", level: 6 },
  ],
  pot: [
    { value: "clay", label: "陶土", level: 1 },
    { value: "ceramic", label: "白瓷", level: 3 },
    { value: "stone", label: "青石", level: 6 },
  ],
  background: [
    { value: "meadow", label: "晴日草地", level: 1 },
    { value: "dusk", label: "落日余晖", level: 3 },
    { value: "mist", label: "山间薄雾", level: 6 },
  ],
} as const;
