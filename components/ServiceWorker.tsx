"use client";

import { useEffect } from "react";
import { installErrorReporting } from "@/lib/report-error";

/** Registers /sw.js in production (installable app, cached build files). */
export function ServiceWorker() {
  useEffect(() => {
    installErrorReporting();
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    const register = () => navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
    // After load, so it never competes with the page itself.
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);
  return null;
}
