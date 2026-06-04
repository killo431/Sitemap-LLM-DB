# Setup

## Prerequisites
- Chrome browser
- Node.js (for local checks)

## Install
1. Clone the repository.
2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Load unpacked extension from this repository.

## Env Vars
- Use `.env.example` placeholders only.
- Document required scopes for each integration token.

## Run Locally
1. Load extension in Chrome.
2. Open a target site.
3. Run crawler from popup.

## Validate
1. Run typecheck (if configured).
2. Run lint (if configured).
3. Run tests (if configured).
4. Run smoke tests for integrations.

## Common Issues
- Extension not loaded: reload unpacked extension.
- Missing env vars: add placeholders and verify names.
- Integration errors: verify auth scopes and startup config.
