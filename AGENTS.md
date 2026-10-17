# Code Review Rules

- Flag changes that can lose or duplicate tracking data, break atomic SQLite corrections, or extend crash recovery beyond the latest durable checkpoint. Failed persistence must preserve the previous application state and allow retry.
- Check time accounting against actual elapsed milliseconds, local calendar boundaries and DST. Idle classification must cover the entire unresolved interval, and application startup must remain untracked.
- Flag regressions in the Electron security boundary: renderer sandboxing, context isolation, validated IPC and blocked runtime network access. The installed app must continue to work offline.
