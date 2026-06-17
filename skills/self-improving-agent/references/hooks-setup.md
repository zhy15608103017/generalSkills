# Hook Setup Guide

Configure automatic self-improvement triggers for AI coding agents.

## Overview

Hooks enable proactive learning capture by injecting reminders at key moments:
- **UserPromptSubmit**: Reminder after each prompt to evaluate learnings
- **PostToolUse (Bash)**: Error detection when commands fail

Hooks should remind only. When an entry is worth keeping, write it explicitly
with `node scripts/log-entry.mjs ...` or by manually following
`references/entry-formats.md`.

## Claude Code Setup

### Option 1: Project-Level Configuration

Create `.claude/settings.json` in your project root. Adjust script paths to the actual skill location.

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "bash ./.agents/skills/self-improving-agent/scripts/activator.sh"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "bash ./.agents/skills/self-improving-agent/scripts/error-detector.sh"
          }
        ]
      }
    ]
  }
}
```

### Option 2: User-Level Configuration

Add to `~/.claude/settings.json` for global activation. Use an absolute path for reliability.

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "bash /absolute/path/to/self-improving-agent/scripts/activator.sh"
          }
        ]
      }
    ]
  }
}
```

### Minimal Setup (Activator Only)

For lower overhead, use only the UserPromptSubmit hook:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "bash ./.agents/skills/self-improving-agent/scripts/activator.sh"
          }
        ]
      }
    ]
  }
}
```

## Codex Setup

If your Codex environment supports hooks, create `.codex/settings.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "bash ./.agents/skills/self-improving-agent/scripts/activator.sh"
          }
        ]
      }
    ]
  }
}
```

For Codex environments without hooks, call the logging helper directly from the
skill directory or use an absolute script path:

```bash
node ./.agents/skills/self-improving-agent/scripts/log-entry.mjs learning --summary "..." --details "..." --action "..." --category insight
```

## GitHub Copilot Setup

Copilot doesn't support hooks directly. Instead, add guidance to `.github/copilot-instructions.md`:

```markdown
## Self-Improvement

After completing tasks that involved:
- Debugging non-obvious issues
- Discovering workarounds
- Learning project-specific patterns
- Resolving unexpected errors

Consider logging the learning to `.learnings/` using the format from the self-improvement skill.

For high-value learnings that would benefit other sessions, consider skill extraction.
```

## Verification

### Test Activator Hook

1. Enable the hook configuration
2. Start a new agent session
3. Send any prompt
4. Verify you see `<self-improvement-reminder>` in the context

### Test Error Detector Hook

1. Enable PostToolUse hook for Bash
2. Run a command that fails: `ls /nonexistent/path`
3. Verify you see `<error-detected>` reminder

### Dry Run Extract Script

```bash
bash ./.agents/skills/self-improving-agent/scripts/extract-skill.sh test-skill --dry-run
```

Expected output shows the skill scaffold that would be created.

## Troubleshooting

### Hook Not Triggering

1. **Verify Bash is available**: hook examples call shell scripts with `bash` so executable bits are not required.
2. **Verify path**: Use absolute paths or paths relative to project root
3. **Check settings location**: Project vs user-level settings
4. **Restart session**: Hooks are loaded at session start

### Permission Denied

Use `bash path/to/script.sh` in hook commands and manual examples instead of invoking
`.sh` files directly. Direct invocation requires executable bits on Unix-like systems.

### Script Not Found

If using relative paths, ensure you're in the correct directory or use absolute paths:

```json
{
  "command": "bash /absolute/path/to/self-improving-agent/scripts/activator.sh"
}
```

### Too Much Overhead

If the activator feels intrusive:

1. **Use minimal setup**: Only UserPromptSubmit, skip PostToolUse
2. **Add matcher filter**: Only trigger for certain prompts:

```json
{
  "matcher": "fix|debug|error|issue",
  "hooks": [...]
}
```

## Hook Output Budget

The activator is designed to be lightweight:
- **Target**: ~50-100 tokens per activation
- **Content**: Structured reminder, not verbose instructions
- **Format**: XML tags for easy parsing

If you need to reduce overhead further, you can edit `activator.sh` to output less text.

## Security Considerations

- Hook scripts run with the same permissions as the hosting agent
- Scripts only output text; they don't modify files or run commands
- Error detector reads `AGENT_TOOL_OUTPUT`, `CODEX_TOOL_OUTPUT`, `CLAUDE_TOOL_OUTPUT`, or stdin
- All scripts are opt-in (you must configure them explicitly)

## Disabling Hooks

To temporarily disable without removing configuration:

1. **Comment out in settings**:
```json
{
  "hooks": {
    // "UserPromptSubmit": [...]
  }
}
```

2. **Or delete the settings file**: Hooks won't run without configuration
