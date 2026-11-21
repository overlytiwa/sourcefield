import { useEffect, useRef, useState } from "react";
import type { CodeMap } from "../../shared/types";
import type { ChangeReport } from "../../shared/workbench";
import { userMessage } from "../../shared/errors";

/** Poll only the cheap Git fingerprint; rebuild the report only when it changes. */
export function useAutoChanges(
  map: CodeMap,
  base: string,
  active: boolean,
  refresh: () => Promise<boolean>,
) {
  const [changes, setChanges] = useState<ChangeReport | null>(null);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!active) return;
    let cancelled = false,
      running = false,
      queued = false,
      version = 0;
    let lastKey: string | undefined, failedRefreshKey: string | undefined;
    let timer: ReturnType<typeof setTimeout>;
    setChanges(null);
    setError("");
    setChecking(true);

    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void check(), 500);
    };
    async function check() {
      if (cancelled || document.visibilityState === "hidden") return;
      if (running) {
        queued = true;
        return;
      }
      running = true;
      const started = version;
      try {
        const status = await window.sourcefield!.workbench("changes-status", {
          base,
        });
        if (cancelled || started !== version) return;
        if (status.key === failedRefreshKey) return;
        const changed = lastKey !== undefined && status.key !== lastKey;
        if (!status.stale && status.key === lastKey) return;
        setChanges(null);
        setError("");
        setChecking(true);
        if (status.stale || changed) {
          // A fresh graph is needed before mapping changed declarations and impact.
          if (!(await refreshRef.current()) && !cancelled) {
            failedRefreshKey = status.key;
            setError(
              "Changes couldn’t be updated. Try refreshing the project again.",
            );
          }
          return; // Receiving the refreshed map starts a new check.
        }
        lastKey = status.key;
        const result = await window.sourcefield!.workbench("changes", { base });
        if (!cancelled && started === version) setChanges(result);
      } catch (cause) {
        if (cancelled || started !== version) return;
        const code = (cause as { code?: string }).code;
        if (
          code === "SOURCE_CHANGED" ||
          code === "SCAN_BUSY" ||
          /^(?:Source files (?:have changed|changed during)|The project is updating)/.test(
            userMessage(cause),
          )
        ) {
          lastKey = undefined;
          queued = true;
        } else {
          setChanges(null);
          setError(
            userMessage(
              cause,
              "Changes couldn’t be checked. Try again shortly.",
            ),
          );
        }
      } finally {
        running = false;
        if (!cancelled) {
          setChecking(false);
          if (queued || started !== version) {
            queued = false;
            schedule();
          }
        }
      }
    }
    const stopWatching = window.sourcefield?.onDirty((value) => {
      if (!value.paths.length) return;
      version++;
      setChanges(null);
      setChecking(true);
      schedule();
    });
    const resume = () => {
      if (document.visibilityState !== "hidden") schedule();
    };
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    const poll = setInterval(() => void check(), 5000);
    schedule();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearInterval(poll);
      stopWatching?.();
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [map, base, active, attempt]);

  return {
    changes,
    error,
    checking,
    checkNow: () => setAttempt((value) => value + 1),
  };
}
