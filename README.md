# step-flow

A Claude Code mod that keeps a side pane of the steps Claude finished, so you can see what happened while you were away.

- Each finished step is one row. Failed steps are red and show the cause, each attempt with its reason, and the fix.
- Click a step to open its detail view.
- Ask questions about the work from the input at the bottom of the pane. Answers come from the session transcript and the step log, and the session's context is not changed.
- Six layouts: run `/flow-theme` to pick one.
- The pane follows your `language` setting (Korean or English).

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install step-flow --marketplace joshyeom/step-flow
```

Answer `y` to add the marketplace, then choose a scope.

From a shell:

```
claude plugin install step-flow --marketplace joshyeom/step-flow
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `joshyeom/step-flow`, then Add plugin.

The pane docks beside the chat in the fullscreen terminal layout.

## Commands

- `/flow`: open the pane
- `/flow-theme`: pick a layout (or `/flow-theme 1` to `/flow-theme 7`)
- `/flow-clear`: clear the recorded steps

## Cost

Each question in the pane sends up to the last 120,000 characters of the session transcript to the `sonnet` model.
