"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const REFRESH_INTERVAL_MS = 60_000;

/**
 * Keeps the schedule live without any user action: re-runs the server
 * component's queries (router.refresh() diff-patches the page in place, so
 * client state and searchParams filters survive) every minute while the tab
 * is visible, and immediately when the tab regains visibility or focus.
 * Renders nothing.
 */
export default function AutoRefresh() {
  const router = useRouter();

  useEffect(() => {
    function refreshIfIdle() {
      if (document.visibilityState !== "visible") return;
      // Don't yank a form control out from under the admin mid-interaction
      // (e.g. an open AssignSelect dropdown) — skip this tick, the next one
      // will catch up.
      const el = document.activeElement;
      if (
        el instanceof HTMLSelectElement ||
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement
      ) {
        return;
      }
      router.refresh();
    }

    function onVisible() {
      if (document.visibilityState === "visible") router.refresh();
    }

    const id = setInterval(refreshIfIdle, REFRESH_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [router]);

  return null;
}
