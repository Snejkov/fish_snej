# Project Rules

These rules apply to the SnejFishing repository and all sessions working on it.

## Repository And Branch

- Repository: https://github.com/Snejkov/fish_snej
- Primary local project folder: C:\Snejfish
- Work directly on the existing primary branch, currently main.
- Never create additional branches, temporary branches, or separate worktrees.
- Check the current branch before editing or publishing. If it is not main, stop and resolve the situation with the owner without discarding changes.
- Preserve other sessions' and the owner's changes. Never use destructive resets, force pushes, or overwrite concurrent work.

## Session Coordination

- Before editing and before publishing, check for other active sessions working on this repository or the same local folder.
- The owner authorizes coordination messages to those project sessions. Do not contact unrelated sessions.
- If another project session is active, read its current scope and agree on affected files, ownership, and publication order before making changes.
- Wait for agreement before editing overlapping files. Recheck the files and branch head after another session publishes.
- If coordination tools are unavailable or a session does not respond, report the limitation and avoid conflicting edits. Never claim coordination happened without confirmation.

## Changes And Publication

- Implement and keep the actual project files updated in C:\Snejfish, not only in GitHub or another checkout.
- Run focused tests and verify user-facing changes before publishing. Report checks that could not be run.
- Implement and test changes locally first, then provide a working local preview link for the owner's review before publication.
- Wait for the owner's explicit acceptance of that local preview before committing and pushing the change to GitHub or deploying it to the VPS. Passing automated tests alone is not acceptance.
- After acceptance, commit the completed, verified change with a clear English description of what changed and why, push it to main, and deploy only the accepted version.
- Until acceptance, keep the work in the primary local folder and leave GitHub and the live VPS version unchanged. Never delete or rewrite history to undo a version already published before this rule changed.
- Include only the current task's changes in its commit. Do not publish another session's unfinished work without agreement.
- Fetch or inspect the latest remote head before publishing. Integrate concurrent changes without overwriting them; if there is a conflict, coordinate first.
- Keep the local files and GitHub main synchronized, and verify the published commit. If either local updating or publication fails, explicitly report what was and was not saved.
- Explain changes in the task summary and commit message. Add concise source comments only where the implementation needs explanation.
- Never commit credentials, access tokens, personal saves, temporary test output, or unrelated files.

## Project Constraints

- Keep source files, UI text, code comments, and repository documentation English-only and ASCII-only.
- Keep the game browser-only with local vendor dependencies: no Node runtime, build step, or CDN dependency for the application.
- Follow the existing project structure and keep changes scoped to the owner's request.
