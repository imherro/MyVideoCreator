import {
  BriefcaseBusiness,
  Clock3,
  Images,
  MessageCircle,
  Settings,
  Trash2,
} from "lucide-react";

export type GlobalPanel = "projects" | "assets" | "jobs" | "trash" | "settings" | "assistant";

const items = [
  { id: "projects", label: "项目", icon: BriefcaseBusiness },
  { id: "assets", label: "资产中心", icon: Images },
  { id: "jobs", label: "任务", icon: Clock3 },
  { id: "trash", label: "回收站", icon: Trash2 },
  { id: "assistant", label: "AI助手", icon: MessageCircle },
  { id: "settings", label: "设置", icon: Settings },
] as const;

export function GlobalNav({
  active,
  taskCount,
  onChange,
}: {
  active: string | null;
  taskCount: number;
  onChange: (panel: GlobalPanel) => void;
}) {
  return (
    <nav className="rail global-nav" aria-label="全局导航">
      {items.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          className={active === id ? "active" : ""}
          title={label}
          aria-label={id === "jobs" ? `${label} ${taskCount}` : label}
          onClick={() => onChange(id)}
        >
          <Icon />
          <span>{label}</span>
          {id === "jobs" && taskCount > 0 && <b>{taskCount}</b>}
        </button>
      ))}
    </nav>
  );
}

