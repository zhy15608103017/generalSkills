## Code Generation

- Inspect nearby files before editing and follow the existing project style, naming, layering, and dependency placement.
- Prefer simple native or project-local implementations. Do not add new dependencies, frameworks, or abstractions unless clearly justified by existing project precedent.
- Preserve existing public function signatures, return shapes, and behavior unless explicitly requested.
- Handle null/undefined, empty data, invalid input, external failures, and expected business errors with clear messages.
- Keep pure data transformations separate from IO, requests, database access, and external clients.
- For CSS, follow the existing styling system. Prefer CSS Modules or project stylesheet conventions before inline styles, and extract reusable colors and visual values into variables or theme tokens.
- Add concise Chinese comments for public APIs, complex logic, and magic numbers.
- Run relevant tests, lint, typecheck, or validation commands after changes.

