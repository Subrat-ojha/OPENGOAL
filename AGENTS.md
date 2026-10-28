<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Store accepted goals in a versioned workspace with stable goal IDs; all task, history and AI updates are scoped to the selected ID to prevent cross-goal contamination.
- Guest workspaces use browser storage; signed-in workspaces use owner-scoped Cloud rows with revision-checked writes to avoid cross-account leaks and silent multi-device overwrites. Browser imports are explicit.
- Keep progress, streaks and deadlines local and AI-free; use `src/lib/ai.functions.ts` only for suggestions, planning and check-in interpretation to limit AI costs.
- Validate AI responses and persisted workspaces with shared schemas before mutating state so malformed plans never erase existing tasks.
- Use the root account provider for identity transitions; public workspace actions use RLS-scoped browser access, and private server functions must independently verify authentication.
- Weekly review reads the shared validated workspace and derives metrics locally; goal-ID deep links never fall back to another goal when the requested ID is missing.
