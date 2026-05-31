/* sprint0 — brand LOGOS only (GitLab, GitHub, Figma…). Lucide is for UI glyphs and does NOT ship
 * company logos; Simple Icons does. Keep the two concerns separate so "an icon" and "a company's
 * logo" never get confused at the call site. Simple Icons are mono silhouettes — `tone="mono"`
 * follows currentColor (our chrome); `tone="brand"` uses the company's official color. */
import {
  SiGitlab, SiGoogle, SiGithub, SiSlack, SiLinear, SiFigma, SiJira,
  type IconType,
} from "@icons-pack/react-simple-icons";

const REGISTRY = {
  gitlab: SiGitlab,
  google: SiGoogle,
  github: SiGithub,
  slack: SiSlack,
  linear: SiLinear,
  figma: SiFigma,
  jira: SiJira,
} satisfies Record<string, IconType>;

export type BrandName = keyof typeof REGISTRY;

interface BrandProps {
  name: BrandName;
  size?: number;
  tone?: "mono" | "brand";
  className?: string;
  style?: React.CSSProperties;
  title?: string;
}

export function Brand({ name, size = 16, tone = "mono", className, style, title }: BrandProps) {
  const Cmp = REGISTRY[name];
  if (!Cmp) {
    if (import.meta.env.DEV) console.warn(`<Brand> unknown name: "${name}"`);
    return null;
  }
  return (
    <Cmp
      size={size}
      title={title ?? name}
      color={tone === "brand" ? "default" : "currentColor"}
      className={className}
      style={{ flexShrink: 0, ...style }}
    />
  );
}
