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

- Goal data lives in browser localStorage (`src/lib/goals.ts`); progress, streaks and deadlines are computed locally — AI is called only via `src/lib/ai.functions.ts` for goal suggestions, plans and check-in interpretation, to keep AI costs low.
