import { useEffect, useRef, useState } from "react";
import { useAccount } from "@/components/auth-provider";
import { supabase } from "@/integrations/supabase/client";
import { emptyWorkspace, STORAGE_KEY, WORKSPACE_KEY, type Workspace } from "@/lib/goals";
import { mergeGuestGoals, migrateWorkspace } from "@/lib/goal-schemas";

export function useWorkspace() {
  const { user, ready } = useAccount();
  const identity = user?.id ?? "guest";
  const [workspace, setWorkspace] = useState<Workspace>(emptyWorkspace);
  const [owner, setOwner] = useState<string | null>(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [guestAvailable, setGuestAvailable] = useState(false);
  const revision = useRef(0);
  const epoch = useRef(0);
  const saved = useRef("");
  const latest = useRef(workspace);
  latest.current = workspace;
  useEffect(() => {
    if (!ready) return;
    const generation = ++epoch.current;
    setOwner(null); setError(""); setStatus("loading");
    async function load() {
      try {
        let next: Workspace;
        if (user) {
          const { data, error } = await supabase.from("goal_workspaces").select("data, revision").eq("user_id", user.id).maybeSingle();
          if (error) throw error;
          next = data ? migrateWorkspace(data.data) : emptyWorkspace();
          revision.current = data?.revision ?? -1;
          setGuestAvailable(Boolean(localStorage.getItem(WORKSPACE_KEY) || localStorage.getItem(STORAGE_KEY)));
        } else {
          const raw = localStorage.getItem(WORKSPACE_KEY) ?? localStorage.getItem(STORAGE_KEY);
          next = migrateWorkspace(raw ? JSON.parse(raw) : null);
        }
        if (epoch.current !== generation) return;
        saved.current = JSON.stringify(next);
        setWorkspace(next); setOwner(identity); setStatus(user ? "saved online" : "saved in browser");
      } catch (e) {
        if (epoch.current === generation) { setError(e instanceof Error ? e.message : "Could not load saved goals."); setStatus("load failed"); }
      }
    }
    void load();
    return () => { ++epoch.current; };
  }, [identity, ready, retry]);

  useEffect(() => {
    if (owner !== identity || !ready) return;
    const generation = epoch.current;
    let stopped = false;
    async function saveLoop() {
      while (!stopped && epoch.current === generation) {
        const payload = latest.current;
        const serialized = JSON.stringify(payload);
        if (saved.current !== serialized) {
          try {
            setStatus("saving");
            if (!user) localStorage.setItem(WORKSPACE_KEY, serialized);
            else if (revision.current === -1) {
              const { error } = await supabase.from("goal_workspaces").insert({ user_id: user.id, data: JSON.parse(serialized), revision: 0 });
              if (error) throw error;
              revision.current = 0;
            } else {
              const nextRevision = revision.current + 1;
              const { data, error } = await supabase.from("goal_workspaces").update({ data: JSON.parse(serialized), revision: nextRevision, updated_at: new Date().toISOString() }).eq("user_id", user.id).eq("revision", revision.current).select("revision").maybeSingle();
              if (error) throw error;
              if (!data) throw new Error("Another tab or device changed your goals. Export your current copy, then reload before editing.");
              revision.current = nextRevision;
            }
            if (stopped || epoch.current !== generation) return;
            saved.current = serialized; setError(""); setStatus(user ? "saved online" : "saved in browser");
          } catch (e) {
            if (epoch.current === generation) { setError(e instanceof Error ? e.message : "Could not save goals."); setStatus("not saved"); }
            return;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    }
    void saveLoop();
    return () => { stopped = true; };
  }, [owner, identity, ready, user]);

  const importGuest = () => {
    try {
      const raw = localStorage.getItem(WORKSPACE_KEY) ?? localStorage.getItem(STORAGE_KEY);
      const guest = migrateWorkspace(raw ? JSON.parse(raw) : null);
      setWorkspace((current) => mergeGuestGoals(current, guest));
      setGuestAvailable(false);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not import browser goals."); }
  };
  return { workspace: owner === identity ? workspace : emptyWorkspace(), setWorkspace, loaded: owner === identity, status, error, guestAvailable, importGuest, reload: () => setRetry((n) => n + 1) };
}