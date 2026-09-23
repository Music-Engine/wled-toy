# Changelog

## Unreleased

### Graph

- Nodes declare their bodies as `pixel` and `frame`, replacing `exec` and `run`. A frame body reads its state from `info.state` instead of a separate argument, and both bodies see what `resolve` returned as `resolved` on their second argument.

## v1.0.0-rc3

### Docs

- AGENTS.md: layout, rules and repo-specific nuance for coding agents.

### Builds

- Workflows reference GitHub's own actions (checkout, setup-node) by major tag. Third-party actions stay pinned to a commit.
- Dependabot bumps the pinned actions weekly. rust-toolchain is pinned to its v1 tag so it is tracked too.
