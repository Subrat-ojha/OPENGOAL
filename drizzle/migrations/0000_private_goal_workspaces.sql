CREATE TABLE public.goal_workspaces (
 user_id uuid PRIMARY KEY,
 data jsonb NOT NULL DEFAULT '{"version":2,"goals":[],"activeGoalId":null}'::jsonb,
 revision integer NOT NULL DEFAULT 0,
 updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.goal_workspaces TO authenticated;
GRANT ALL ON public.goal_workspaces TO service_role;
ALTER TABLE public.goal_workspaces ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read own workspace" ON public.goal_workspaces FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Create own workspace" ON public.goal_workspaces FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Update own workspace" ON public.goal_workspaces FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
