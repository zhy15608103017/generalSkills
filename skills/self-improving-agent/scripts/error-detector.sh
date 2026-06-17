#!/bin/bash
# Self-Improvement Error Detector Hook
# Triggers after shell/tool use to detect command failures
# Reads common tool-output environment variables or stdin

set -e

# Check if tool output indicates an error
OUTPUT="${AGENT_TOOL_OUTPUT:-${CODEX_TOOL_OUTPUT:-${CLAUDE_TOOL_OUTPUT:-}}}"

if [ -z "$OUTPUT" ] && [ ! -t 0 ]; then
    OUTPUT="$(cat)"
fi

# Patterns indicating errors (case-insensitive matching)
ERROR_PATTERNS=(
    "error:"
    "Error:"
    "ERROR:"
    "failed"
    "FAILED"
    "command not found"
    "No such file"
    "Permission denied"
    "fatal:"
    "Exception"
    "Traceback"
    "npm ERR!"
    "ModuleNotFoundError"
    "SyntaxError"
    "TypeError"
    "exit code"
    "non-zero"
)

# Check if output contains any error pattern
contains_error=false
for pattern in "${ERROR_PATTERNS[@]}"; do
    if [[ "$OUTPUT" == *"$pattern"* ]]; then
        contains_error=true
        break
    fi
done

# Only output reminder if error detected
if [ "$contains_error" = true ]; then
    cat << 'EOF'
<error-detected>
A command error was detected. Consider logging this to .learnings/ERRORS.md if:
- The error was unexpected or non-obvious
- It required investigation to resolve
- It might recur in similar contexts
- The solution could benefit future sessions

Use the self-improvement skill format: [ERR-YYYYMMDD-XXX]
Follow local project policy before writing.
</error-detected>
EOF
fi
