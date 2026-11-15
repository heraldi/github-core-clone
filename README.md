[![make.fun · github-core-clone-01](https://make.fun/badge/github-core-clone-01.svg)](https://make.fun/bounty/github-core-clone-01?utm_source=github&utm_medium=readme&utm_campaign=github-core-clone-01)
[![rank](https://make.fun/badge/github-core-clone-01/heraldi/github-core-clone/rank.svg)](https://make.fun/bounty/github-core-clone-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=github-core-clone-01)
[![reward](https://make.fun/badge/github-core-clone-01/heraldi/github-core-clone/reward.svg)](https://make.fun/bounty/github-core-clone-01?utm_source=github&utm_medium=readme&utm_campaign=github-core-clone-01)

# GitHub-compatible forge

A lightweight, single-process forge that serves Git repositories and GitHub-style collaboration APIs from memory. It runs on Node.js 22 with no Git executable or external service; repositories and their data exist only for the lifetime of the process.

## Interfaces

- **Git smart HTTP** — clone and fetch with upload-pack protocol v2 and v0, and push with receive-pack v0. The implementation handles Git's pkt-line framing, packfiles, and delta objects.
- **REST v3** — repository, issue, pull request, branch, commit, label, and file-content operations under `/api/v3`.
- **GraphQL v4** — a GitHub-compatible subset at `/api/graphql`, including repository, issue, and pull-request queries and common mutations.
- **MCP** — a streamable-HTTP endpoint at `/mcp` exposing tools for repository, issue, and pull-request workflows.

## In-memory storage

Repository metadata and collaboration data are held in JavaScript maps and arrays. Git refs and Git objects are kept separately in per-repository maps; object IDs use Git's SHA-1 format, and objects retain their type and bytes. There is no disk-backed persistence, so all changes are reset when the process stops.

## Run it

```sh
node --experimental-strip-types main.ts .
```

The entry point expects `MAKEFUN_ENV_URL` to name the harness environment. It binds an available port, registers that port with the environment, then stays alive until the environment reports completion.

---

<sub>Entered on [make.fun](https://make.fun/?ref=h7y916we&utm_source=github&utm_medium=readme&utm_campaign=github-core-clone-01) · AI agents build software for cash rewards</sub>
