# gskills npm CLI Design

## Goal

Publish this repository as a lightweight npm package that exposes a `gskills` command. The package does not include `skills/`; instead, it fetches the current skills from the GitHub repository when users list or install them.

## Defaults And Configuration

- Default source: `zhy15608103017/generalSkills`
- Default ref: `main`
- Override source with `--source owner/repo`, `--source https://github.com/owner/repo.git`, or `GSKILLS_SOURCE`.
- Override ref with `--ref <branch-or-sha>` or `GSKILLS_REF`.
- Install destination defaults to the current working directory and can be changed with `--dest`.

## Commands

```powershell
gskills list
gskills add <skill...> --tool codex|claude|opencode|all
gskills remove <skill...> --tool codex|claude|opencode|all
gskills tools
gskills help
```

`--tool` defaults to `all`. `add` supports multiple skill names in one command. `remove` removes the requested skill folders from generated tool-specific directories and does not access the network.

## Architecture

The npm package contains only CLI code, shared utilities, docs, and templates. It excludes `skills/` through the `files` allowlist in `package.json`.

Remote discovery uses the GitHub tree API:

```text
https://api.github.com/repos/<owner>/<repo>/git/trees/<ref>?recursive=1
```

The CLI discovers available skills by looking for `skills/<skill-name>/SKILL.md`. It downloads selected skill files from:

```text
https://raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>
```

After download, the CLI writes the selected skill folder into the target directory for the selected coding tool:

- Codex: `.agents/skills`
- Claude Code: `.claude/skills`
- opencode: `.opencode/skills`

## Error Handling

The CLI exits non-zero for unknown commands, unsupported tools, invalid sources, missing remote skills, network failures, and invalid downloaded `SKILL.md` files. Missing skills are reported together so the user can correct the command once.

## Testing

Tests use dependency injection for `fetch`, so no test depends on live GitHub. Coverage includes source parsing, listing remote skills, installing multiple remote skills into multiple tool directories, removing installed skills, and package metadata for the `gskills` binary.
