# AIAgentBot

AIAgentBot is a browser automation backend using Puppeteer and provider-based scripts.

## Quick start

- Install dependencies: `npm install`
- Start server: `npm start`
- Set `API_KEY` or `BOT_API_KEY` for authenticated endpoints.

## API documentation

See `ENDPOINTS_GUIDE.md` for full API documentation, including:

- profile management (`/profiles`)
- automation execution (`/run`, `/browser/*`, `/execute-js`)
- JS mode profiles and provider script execution

## JS mode notes

Profiles saved with:

- `workflowMode: "js"`
- `scriptSource: "provider"`

will execute a provider command script (for example, `deepseek` + `prompt`).

Profiles saved with:

- `workflowMode: "js"`
- `scriptSource: "custom"`

will execute the custom JavaScript stored in `script`.

## Browser usage

The app can run Puppeteer in headless mode automatically when no X display is available. Use `PUPPETEER_HEADLESS=false` to force UI mode when an X server is present.
