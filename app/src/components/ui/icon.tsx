import * as React from "react";
import {
  LayoutGrid,
  ListTodo,
  Images,
  Settings,
  Users,
  AppWindow,
  MessageCircle,
  type LucideIcon,
} from "lucide-react";

const iconMap: Record<string, LucideIcon> = {
  LayoutGrid,
  ListTodo,
  Images,
  Settings,
  Users,
  AppWindow,
  MessageCircle,
};

export function NamedIcon({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const Icon = iconMap[name];
  if (!Icon) return null;
  return <Icon className={className} aria-hidden />;
}
