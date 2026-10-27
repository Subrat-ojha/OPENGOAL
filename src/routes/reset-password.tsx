import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
export const Route = createFileRoute("/reset-password")({ head: () => ({ meta: [{ title: "OpenGoals — Reset password" }, { name: "description", content: "Choose a new password for your OpenGoals account." }, { property: "og:title", content: "OpenGoals — Reset password" }, { property: "og:description", content: "Securely recover your OpenGoals account." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }), component: ResetPassword });
function ResetPassword() {
  const [recovery, setRecovery] = useState(false); const [password, setPassword] = useState(""); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { const valid = new URLSearchParams(window.location.hash.slice(1)).get("type") === "recovery"; if (valid) sessionStorage.setItem("opengoals.recovery", "yes"); setRecovery(valid || sessionStorage.getItem("opengoals.recovery") === "yes"); }, []);
  async function submit() {
    setBusy(true);
    try { const { error } = await supabase.auth.updateUser({ password }); if (error) throw error; sessionStorage.removeItem("opengoals.recovery"); setRecovery(false); setMessage("Password updated. You can return to your workspace."); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Could not update password."); } finally { setBusy(false); }
  }
  return <main className="mx-auto max-w-sm px-6 py-16"><h1 className="text-xl font-bold text-primary">Set a new password</h1>{recovery ? <form className="mt-6 space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}><label>New password<input type="password" autoComplete="new-password" minLength={8} required aria-label="New password" className="mt-2 w-full border border-input bg-panel p-3" value={password} onChange={(e) => setPassword(e.target.value)} /></label><Button disabled={busy}>Update password</Button></form> : <p className="mt-6 text-muted-foreground">{message || "Open the password reset link from your email to continue."}</p>}{recovery && message && <p role="status" className="mt-4">{message}</p>}<Link to="/auth" className="mt-6 block text-primary">Back to sign in</Link><Link to="/" className="mt-4 block text-primary">Workspace</Link></main>;
}