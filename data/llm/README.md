# LLM

Chat agent cloud-model settings: whether the cloud (Anthropic) model is turned on,
and the API key it uses. The backend reads and writes `settings.json` here, through
the Settings dialog's MCP gateway section. Nothing else reads this folder, and the
browser never gets the key back.

When `settings.json` does not exist yet, or has no key saved, the backend falls back
to the `ANTHROPIC_API_KEY` environment variable, so a deployment that sets that
variable in `.env` keeps working without anyone opening Settings.

`settings.json` holds a secret. It is ignored by git, and the backend restricts it to
the owner where the file system allows that.
