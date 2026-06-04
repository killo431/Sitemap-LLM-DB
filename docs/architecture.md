# Architecture

## Repo Layout
- Extension runtime: `background.js`, `content.js`, `popup.js`
- UI assets: `popup.html`, `popup.css`, `content.css`
- Extension manifest: `manifest.json`
- Workspace rules and agent docs: `.cursor/`
- Supporting docs: `docs/`

## Agent Orchestration Flow
1. Planner sequences work.
2. Researcher gathers official references.
3. Coder implements scoped changes.
4. Reviewer verifies correctness, security, and maintainability.
5. Debugger isolates and resolves failures.

## Subagent Roles
- Planner: sequencing and risk analysis
- Researcher: source-backed setup guidance
- Coder: minimal, architecture-safe implementation
- Reviewer: quality, security, and test/docs validation
- Debugger: smallest verified fix
- Setup Engineer: tooling and startup configuration
- Integration Specialist: vendor setup + rollback readiness
- MCP Engineer: MCP scaffolding and safety/auth model

## MCP Topology
- Local MCP server started from configured command and args.
- Environment variables passed via startup config.
- Tool capability and write/network access documented before use.

## Integrations
- Vendor integrations require documented auth scopes.
- Each integration requires environment variables, setup docs, and smoke tests.

## Deployment Strategy
- Validate typecheck, lint, tests, and smoke coverage before release.
- Use least-privilege tokens and secret redaction.
- Keep rollback notes for integration changes.
