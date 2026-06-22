---
name: generate-maintainable-code
description: Use when generating, modifying, refactoring, or reviewing code in an existing repository and the agent must follow local style, keep implementations simple, preserve compatibility, handle boundaries, organize CSS, and run validation.
---

# Generate Maintainable Code

## Core Principle

Read the project first, then write the smallest clear change that fits the existing codebase. Prefer local conventions over generic best practices when they conflict.

## Workflow

1. Inspect nearby files, imports, tests, package scripts, and existing helpers before editing.
2. If the user's proposed implementation is likely incorrect, unsafe, overcomplicated, or inconsistent with the codebase, state the concern, recommend a maintainable alternative, and ask whether to proceed with the original approach before implementing it.
3. Decide where new code belongs by following the repository's current layout for utilities, API clients, services, constants, enums, and types.
4. Match naming style from the current file first, then the current module, then the repository's dominant style.
5. Choose the simplest implementation using language features, standard libraries, and existing project utilities.
6. For complex, non-domain-specific problems, evaluate mature community libraries before building from scratch.
7. If a new dependency may be warranted, recommend one primary option and two alternatives, summarize tradeoffs such as maintenance cost, ecosystem maturity, bundle size, type support, and compatibility with the current repository, and ask the user to confirm before adding it.
8. Write code in a readable order: validate inputs, prepare data, run core logic, handle logging or telemetry, then return.
9. Separate pure data transformation from IO, network requests, database work, file access, and global state mutation.
10. Preserve existing public signatures, return shapes, error codes, and behavior unless the user explicitly requests a breaking change.
11. Add or update focused tests for behavior, edge cases, expected business errors, and external dependency failures.
12. Run the relevant validation commands from the project, such as tests, lint, typecheck, or repository-specific scripts.

## Placement Rules

- Put shared utility logic where the project already keeps helpers, commonly `utils`, `lib`, or an existing domain helper folder.
- Put request or API logic in the existing request layer, commonly `services`, `api`, `client`, or a domain service folder.
- Put reusable constants, enums, and types in the existing constants or types location. Do not create a new category if the project already has one.
- Keep edits scoped to files required by the request. Avoid unrelated formatting, renames, directory moves, or opportunistic refactors.

## Simplicity Rules

- Do not add new dependencies, frameworks, middleware, or design patterns for hypothetical flexibility.
- Do not introduce a third-party library when existing project utilities, platform features, or a small local implementation are sufficient.
- Reuse project helpers before creating new abstractions.
- Split a function when nesting exceeds 3 levels, cyclomatic complexity is high, or a reader cannot understand the flow quickly.
- Extract subfunctions only when they make the main flow clearer or isolate meaningful reusable behavior.

## Robustness Rules

- Explicitly handle `null`, `undefined`, empty strings, empty collections, invalid enum values, missing fields, and oversized text when relevant.
- Give expected business errors human-readable messages, such as resource not found, permission denied, validation failed, or state conflict.
- Do not expose raw database, RPC, HTTP, or system stack traces to users or upper-level callers.
- Use the project's existing timeout, retry, logging, and error mapping patterns for external calls.
- Do not create external clients such as database, cache, search, or RPC clients inside business functions. Receive them from parameters, context, or the existing service layer.

## CSS And Theme Rules

- Follow the project's existing styling system first, such as CSS Modules, SCSS/Less Modules, Tailwind, styled-components, or global styles.
- If there is no clear precedent, prefer CSS Modules or a separate stylesheet before inline styles.
- Use inline styles only for dynamic computed values, tiny one-off cases, or places where the project already uses them.
- Extract reusable colors, spacing, font sizes, shadows, radii, and similar visual values into CSS variables, theme tokens, or existing style constants.
- Search for existing tokens before introducing new colors. Do not hardcode the same color repeatedly across components.
- Match the project's style naming convention, such as camelCase, kebab-case, or BEM.

## Comments

- Add concise Chinese comments for public APIs, complex internal functions, business rules, and magic numbers.
- Explain purpose, parameters, return shape, and non-obvious business constraints.
- Do not comment obvious assignments or simple language syntax.

## Verification Checklist

Before reporting completion:

- Existing style, naming, and placement were inspected and followed.
- No unnecessary dependency, framework, abstraction, or broad refactor was introduced.
- Any new dependency was justified, compared against alternatives, and confirmed by the user before adoption.
- Public compatibility was preserved or the requested breaking change was called out.
- Boundary cases and expected business errors are handled.
- CSS uses the project styling system, with reusable visual values extracted when appropriate.
- Relevant tests or validation commands were run, or any reason they could not run is stated clearly.
