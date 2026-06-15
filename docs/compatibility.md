# Tool Compatibility

This repository uses `skills/` as the canonical source and installs copies into project-local directories expected by common coding tools.

When used through npm, `gskills` fetches `skills/` from `zhy15608103017/generalSkills@main` by default. Override the source with `--source owner/repo` or `GSKILLS_SOURCE`; override the ref with `--ref` or `GSKILLS_REF`.

Run `gskills aicodings` to list supported AI coding targets. If `gskills add <skill>` runs in an interactive terminal without `--aicoding`, it opens a selection list. In non-interactive environments, it uses `default`, which writes to `.agents/skills`.

## Supported Targets

| Target | Directory |
| --- | --- |
| `default` | `.agents/skills` |
| `codex` | `.agents/skills` |
| `claude` / `claude-code` | `.claude/skills` |
| `cursor` | `.cursor/skills` |
| `trae` | `.trae/skills` |
| `windsurf` / `cascade` | `.windsurf/skills` |
| `gemini` / `gemini-cli` | `.gemini/skills` |
| `opencode` | `.opencode/skills` |

## Codex

Use `.agents/skills` in the target project for Codex-style project skills. Run:

```powershell
npx general-skills add my-skill --aicoding codex
```

For local repository development:

```powershell
npm run install-skills -- --aicoding codex --dest D:\path\to\project
```

## Claude Code

Use `.claude/skills` in the target project for Claude Code project skills. Run:

```powershell
npx general-skills add my-skill --aicoding claude
```

## Cursor

Use `.cursor/skills` in the target project for Cursor project skills. Run:

```powershell
npx general-skills add my-skill --aicoding cursor
```

## Trae

Use `.trae/skills` in the target project for Trae project skills. Run:

```powershell
npx general-skills add my-skill --aicoding trae
```

For local repository development:

```powershell
npm run install-skills -- --aicoding trae --dest D:\path\to\project
```

## opencode

Use `.opencode/skills` in the target project for opencode project skills. Run:

```powershell
npx general-skills add my-skill --aicoding opencode
```

## Windsurf

Use `.windsurf/skills` in the target project for Windsurf/Cascade project skills. Run:

```powershell
npx general-skills add my-skill --aicoding windsurf
```

## Gemini CLI

Use `.gemini/skills` in the target project for Gemini CLI project skills. Run:

```powershell
npx general-skills add my-skill --aicoding gemini
```

For local repository development:

```powershell
npm run install-skills -- --aicoding gemini --dest D:\path\to\project
```

## Multi-Tool Install

Use `--aicoding all` when a project is used by multiple coding tools:

```powershell
npx general-skills add my-skill --aicoding all
```

For local repository development:

```powershell
npm run install-skills -- --aicoding all --dest D:\path\to\project
```

The install command replaces generated copies of each selected skill, while leaving unrelated target project files alone.
