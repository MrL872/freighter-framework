# Telegram

Telegram bot settings: the bot token and the list of chats. The backend reads and
writes `settings.json` here, through the Settings dialog. Nothing else reads this
folder, and the browser never gets the token.

`settings.json` holds a secret. It is ignored by git, and the backend restricts it to
the owner where the file system allows that.
