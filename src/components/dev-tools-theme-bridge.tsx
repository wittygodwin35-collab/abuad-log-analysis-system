"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";

const DEVTOOLS_CONFIG_ENDPOINT = "/__nextjs_devtools_config";
const DEVTOOLS_PORTAL_TAG = "nextjs-portal";
const THEME_VALUES = new Set(["light", "dark", "system"]);

function getRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function getThemeFromBody(body: BodyInit | null | undefined): string | null {
  if (typeof body !== "string") return null;

  try {
    const payload = JSON.parse(body) as { theme?: unknown };
    return typeof payload.theme === "string" && THEME_VALUES.has(payload.theme)
      ? payload.theme
      : null;
  } catch {
    return null;
  }
}

function getThemeFromPortal(element: Element): "light" | "dark" | null {
  if (element.tagName.toLowerCase() !== DEVTOOLS_PORTAL_TAG) return null;
  if (element.classList.contains("dark")) return "dark";
  if (element.classList.contains("light")) return "light";
  return null;
}

export function DevToolsThemeBridge() {
  const { setTheme } = useTheme();

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;

    const originalFetch = window.fetch.bind(window);

    window.fetch = async (input, init) => {
      const response = await originalFetch(input, init);
      const requestUrl = getRequestUrl(input);
      const theme = requestUrl.includes(DEVTOOLS_CONFIG_ENDPOINT)
        ? getThemeFromBody(init?.body)
        : null;

      if (response.ok && theme) {
        setTheme(theme);
      }

      return response;
    };

    const syncPortalTheme = (element: Element) => {
      const theme = getThemeFromPortal(element);
      if (theme) setTheme(theme);
    };

    document.querySelectorAll(DEVTOOLS_PORTAL_TAG).forEach(syncPortalTheme);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "attributes" && mutation.target instanceof Element) {
          syncPortalTheme(mutation.target);
        }

        for (const node of mutation.addedNodes) {
          if (!(node instanceof Element)) continue;
          syncPortalTheme(node);
          node.querySelectorAll(DEVTOOLS_PORTAL_TAG).forEach(syncPortalTheme);
        }
      }
    });

    observer.observe(document.body, {
      attributeFilter: ["class"],
      attributes: true,
      childList: true,
      subtree: true,
    });

    return () => {
      observer.disconnect();
      window.fetch = originalFetch;
    };
  }, [setTheme]);

  return null;
}
