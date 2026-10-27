import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { useAccount } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import "@lovable.dev/cloud-auth-js/styles.css";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "OpenGoals — Sign in" }, { name: "description", content: "Save your OpenGoals plans and check-in history across devices." }, { property: "og:title", content: "OpenGoals — Sign in" }, { property: "og:description", content: "Sign in to keep your goals and history together." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: AuthPage,
});
function AuthPage() {
  const { user } = useAccount();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "signup" | "forgot">("login");
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  useEffect(() => { if (user) void navigate({ to: "/", replace: true }); }, [user, navigate]);
  async function submit() {
    setBusy(true); setMessage("");
    try {
      if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` });
        if (error) throw error;
        setMessage("Check your email for a password reset link.");
      } else if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
        if (error) throw error;
        if (!data.session) setMessage("Check your email to confirm your account, then sign in.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (e) { setMessage(e instanceof Error ? e.message : "Sign-in failed. Try again."); }
    finally { setBusy(false); }
  }
  async function social(provider: "google" | "lovable") {
    setBusy(true); setMessage("");
    try { const result = await lovable.auth.signInWithOAuth(provider, { redirect_uri: window.location.origin }); if (result.error) setMessage(result.error.message); }
    catch { setMessage("Could not sign in. Please try again."); }
    finally { setBusy(false); }
  }
  return <main className="min-h-dvh bg-background px-6 py-12"><div className="mx-auto max-w-sm">
    <Link to="/" className="text-primary">opengoals / workspace</Link>
    <h1 className="mt-10 text-xl font-bold">{mode === "signup" ? "Create your account" : mode === "forgot" ? "Reset your password" : "Sign in to OpenGoals"}</h1>
    <p className="mt-3 text-muted-foreground">Your goals, day plans and check-in history, saved together.</p>
    <form className="mt-8 space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <label className="block">Email<input className="mt-2 w-full border border-input bg-panel px-3 py-2" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      {mode !== "forgot" && <label className="block">Password<input className="mt-2 w-full border border-input bg-panel px-3 py-2" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} /></label>}
      <Button className="w-full" disabled={busy}>{mode === "signup" ? "Create account" : mode === "forgot" ? "Send reset link" : "Sign in"}</Button>
    </form>
    {message && <p role="status" className="mt-4 break-words text-primary">{message}</p>}
    {mode !== "forgot" && <div className="mt-6 space-y-3"><Button variant="outline" className="w-full" disabled={busy} onClick={() => void social("google")}>Continue with Google</Button><Button className="lovable-auth-button w-full" disabled={busy} onClick={() => void social("lovable")}>Continue with Lovable</Button></div>}
    <div className="mt-5 flex flex-wrap gap-3"><Button variant="link" onClick={() => { setMode(mode === "signup" ? "login" : "signup"); setMessage(""); }}>{mode === "signup" ? "Already have an account?" : "Create an account"}</Button><Button variant="link" onClick={() => { setMode(mode === "forgot" ? "login" : "forgot"); setMessage(""); }}>{mode === "forgot" ? "Back to sign in" : "Forgot password?"}</Button></div>
  </div></main>;
}