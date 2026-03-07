# pi-cmux

Pi package with cmux-powered terminal integrations.

## Why

Pi works well in the terminal, but terminal-native actions like workspace notifications, editor launching, and pane orchestration are better handled by cmux. This package collects pi extensions that use the cmux API instead of baking those workflows into pi itself.

The first extension is `cmux-notify`, which sends workspace notifications when pi finishes, waits for input, or hits an error.

## Usage

Install with pi:

```bash
pi install npm:pi-cmux
```

Or with the installer:

```bash
npx pi-cmux
```

If pi is already running, use:

```text
/reload
```

### Included extensions

- `cmux-notify` - sends `cmux notify` alerts for pi completion and error states
- `cmux-split` - opens new cmux split panels and starts fresh pi sessions in the same project

### cmux-notify notifications

All notifications use:
- title: `Pi` by default
- subtitle: current run state
- body: a short summary of what pi just did

Current notification types:

- `Waiting`
  - sent when pi finishes a normal run and is waiting for input
  - typical bodies:
    - `Finished and waiting for input`
    - `Reviewed README.md`
    - `Reviewed 3 files`
    - `Searched the codebase`

- `Task Complete`
  - sent when pi finishes a longer run, or when the run changed files
  - typical bodies:
    - `Updated package.json`
    - `Updated 2 files`
    - `Finished in 42s`
    - `Updated 3 files in 1m 12s`

- `Error`
  - sent when a tool fails during the run
  - typical bodies:
    - `read failed for config.json`
    - `edit failed for README.md`
    - `bash command failed`

Notification bodies are summarized from the run itself:
- changed files from `edit` and `write`
- reviewed files from `read`
- searches from `grep` and `find`
- shell activity from `bash`
- first tool failure, if any

### cmux split commands

- `/cmux-v`
  - opens a new split to the right
  - starts a fresh `pi` session in the same `cwd`

- `/cmux-h`
  - opens a new split below
  - starts a fresh `pi` session in the same `cwd`

Both commands also accept optional initial prompt text. Example:

```text
/cmux-v Review the auth flow in this repo
```

That launches the new split and starts:

```bash
pi 'Review the auth flow in this repo'
```

in the same project directory.

### Environment variables

- `PI_CMUX_NOTIFY_THRESHOLD_MS` - duration threshold before a run is labeled `Task Complete` instead of `Waiting` (default: `15000`)
- `PI_CMUX_NOTIFY_DEBOUNCE_MS` - minimum delay between duplicate notifications (default: `3000`)
- `PI_CMUX_NOTIFY_TITLE` - notification title override (default: `Pi`)

cmux uses the current `CMUX_WORKSPACE_ID` / `CMUX_SURFACE_ID` automatically, or you can provide those in your environment yourself.

## Publish

```bash
cd ~/pi-cmux
NODE_AUTH_TOKEN=YOUR_TOKEN npm publish
```
