# Changelog

## [Unreleased]

### Added

- Initial release with the `cmux-notify` extension for cmux-backed pi notifications.
- Added `cmux-v` and `cmux-h` commands to open new cmux splits and start fresh pi sessions in the same working directory.
- Added `/z` and `/zh` via `cmux-zoxide` to open a new split from a zoxide match and start pi in that directory.
- Added `cmux-review` with `/review-v` and `/review-h`, plus bundled `code-review` skill and `/review` / `/review-diff` prompt templates for focused review workflows, including GitHub pull request review via `gh` when given a PR URL.

### Changed

- Documented the current cmux notification types and removed the debug/test step from the README.
- Added shorter command names for cmux workflows: `/cmv`, `/cmh`, `/cmz`, `/cmzh`, `/cmrv`, and `/cmrh`, while keeping the previous command names as aliases for now.
- Made `/cmrv` and `/cmrh` default to reviewing the current git diff when run without arguments.

### Fixed

- Adjusted `cmux-notify` so the notification only shows `Error` when the run itself ends in an error or abort, instead of surfacing handled intermediate tool failures as final errors.
- Updated `npx pi-cmux` installs to copy bundled `skills/` and `prompts/` in addition to `extensions/`, so installer-based installs include the review workflows documented in the package.

### Removed

- Removed the `cmux-notify-test` command from `cmux-notify`.
