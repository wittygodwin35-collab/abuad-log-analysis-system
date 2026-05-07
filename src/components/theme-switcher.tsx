"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Monitor, Moon, Palette, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const THEME_OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

interface ThemeSwitcherProps {
  className?: string;
}

export function ThemeSwitcher({ className }: ThemeSwitcherProps) {
  const { resolvedTheme, setTheme, theme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const activeTheme = mounted ? theme || "system" : "system";
  const activeLabel = mounted
    ? THEME_OPTIONS.find((option) => option.value === activeTheme)?.label || "System"
    : "Theme";

  const TriggerIcon = useMemo(() => {
    if (!mounted) return Palette;
    if (activeTheme === "system") return Monitor;
    return resolvedTheme === "dark" ? Moon : Sun;
  }, [activeTheme, mounted, resolvedTheme]);

  return (
    <div className={cn("fixed bottom-4 right-4 z-[60] sm:bottom-6 sm:right-6", className)}>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-11 rounded-md border-border bg-background/80 text-foreground shadow-lg shadow-black/10 backdrop-blur-xl transition-all hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
                aria-label={`Change theme. Current theme: ${activeLabel}`}
              >
                <TriggerIcon className="size-4" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="left">Change theme</TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          align="end"
          side="top"
          className="w-44 border-border bg-popover/95 backdrop-blur-xl"
        >
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup value={activeTheme} onValueChange={setTheme}>
            {THEME_OPTIONS.map((option) => {
              const Icon = option.icon;
              const isActive = activeTheme === option.value;

              return (
                <DropdownMenuRadioItem key={option.value} value={option.value}>
                  <Icon className="size-4" />
                  <span>{option.label}</span>
                  {isActive && <Check className="ml-auto size-3.5 text-primary" />}
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
