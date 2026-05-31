/* sprint0 — single Icon component. The ONLY place the app touches an icon library.
 * Hard-codes the design-system defaults (16px, 1.5 stroke, currentColor); keeps SEMANTIC names so
 * swapping icon libraries later touches one file. Brand LOGOS (GitLab, Figma…) live in brand.tsx. */
import {
  Inbox, Columns3, Layers, Workflow, ShieldCheck, ShieldAlert, Users, GitMerge,
  Briefcase, BookMarked, Search, Plus, Settings, Bell, ChevronDown, ChevronRight,
  ChevronLeft, MoreHorizontal, GripVertical, X, ArrowRight, Command, Calendar,
  Filter, ArrowUpDown, List, GanttChart, Mail, Lock, Eye, LogOut, Gauge, Link2,
  Circle, Flag, Zap, Clock, Check, Share2, Boxes, AlertTriangle, type LucideIcon,
} from "lucide-react";

/** Semantic name -> Lucide component. */
const REGISTRY = {
  // nav
  inbox: Inbox,
  board: Columns3,
  projects: Layers,
  relay: Workflow,
  ratify: ShieldCheck,
  team: Users,
  merges: GitMerge,
  portfolio: Briefcase,
  passport: BookMarked,
  qa: ShieldAlert,
  codegraph: Share2,
  profiles: Boxes,
  // actions / chrome
  search: Search,
  plus: Plus,
  settings: Settings,
  bell: Bell,
  chevronDown: ChevronDown,
  chevronRight: ChevronRight,
  chevronLeft: ChevronLeft,
  more: MoreHorizontal,
  grip: GripVertical,
  close: X,
  arrowRight: ArrowRight,
  command: Command,
  calendar: Calendar,
  filter: Filter,
  sort: ArrowUpDown,
  list: List,
  timeline: GanttChart,
  mail: Mail,
  lock: Lock,
  eye: Eye,
  logout: LogOut,
  load: Gauge,
  link: Link2,
  dot: Circle,
  flag: Flag,
  bolt: Zap,
  clock: Clock,
  check: Check,
  warn: AlertTriangle,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof REGISTRY;

interface IconProps {
  name: IconName;
  /** px. Design-system default is 16. */
  size?: number;
  /** Lucide stroke width. Design-system default is 1.5. */
  stroke?: number;
  className?: string;
  style?: React.CSSProperties;
}

export function Icon({ name, size = 16, stroke = 1.5, className, style }: IconProps) {
  const Cmp = REGISTRY[name];
  if (!Cmp) {
    if (import.meta.env.DEV) console.warn(`<Icon> unknown name: "${name}"`);
    return null;
  }
  return (
    <Cmp size={size} strokeWidth={stroke} className={className} style={{ flexShrink: 0, ...style }} aria-hidden="true" />
  );
}
