# Changelog

## Unreleased

### Graph

- Nodes declare their bodies as `pixel` and `frame`, replacing `exec` and `run`. A frame body reads its state from `info.state` instead of a separate argument, and both bodies see what `resolve` returned as `resolved` on their second argument.
- `resolve` returns `{ streams, data, requires, issues }` instead of registering resources and reporting issues itself; the bodies see its `data` as `resolved`.
- OSC In asks for its UDP port as a resource. Of several OSC In nodes on different ports the first port is opened, as before, and each of the others now reports an issue.
- A graph with more than one Output node uses the first one and reports an issue on each of the others, which are left out of the compiled graph. Before, the first Output's wire settings applied while the last one's color won.
- A stored value that does not fit its socket is a compile error on its node, naming the socket and the value. Before, the default was used and an issue reported; the linter still reports such values when a graph is opened.

## v1.0.0-rc3

### Docs

- AGENTS.md: layout, rules and repo-specific nuance for coding agents.

### Builds

- Workflows reference GitHub's own actions (checkout, setup-node) by major tag. Third-party actions stay pinned to a commit.
- Dependabot bumps the pinned actions weekly. rust-toolchain is pinned to its v1 tag so it is tracked too.
