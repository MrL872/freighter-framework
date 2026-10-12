# Local LLM

Chat agent local-model settings: whether a local, OpenAI-compatible model (LM
Studio, Ollama, ...) is turned on, and the base URL, API key and model id it
uses. The backend reads and writes `settings.json` here, through the Settings
dialog's MCP gateway section. Nothing else reads this folder, and the browser
never gets the key back.

When `settings.json` does not exist yet, or a field in it is blank, the
backend falls back to that field's own environment variable
(`LLM_BASE_URL`/`LLM_API_KEY`/`LLM_MODEL`), so a deployment that already sets
those in `.env` keeps working without anyone opening Settings.

`settings.json` can hold a secret (the API key). It is ignored by git, and the
backend restricts it to the owner where the file system allows that.
