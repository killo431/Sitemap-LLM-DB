# Cursor Workspace

## Rules
Rules are defined under `.cursor/rules/` for coding standards, TypeScript safety, testing requirements, secret handling, and MCP safety.

## Subagents
Subagent templates are in `.cursor/subagents/` and cover planning, research, coding, review, debugging, setup, integration, and MCP engineering.

## Hooks
Hook templates are in `.cursor/hooks/` for before-commit, before-MCP execution, and after-code-generation checks.

## Commands
Command templates are in `.cursor/commands/` for project bootstrap, validation, integration setup, and MCP server setup.

## How to Use Cursor in This Repo
1. Select a subagent role based on task type.
2. Apply rule files before implementation.
3. Run hooks and validation commands before merging.
4. Keep setup and architecture docs current when workflows change.
