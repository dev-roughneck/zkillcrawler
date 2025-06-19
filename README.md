# zKillcrawler Discord Bot

A Discord bot for zKillboard notifications with advanced attacker and victim filtering and SQLite persistence.

## Features

- Slash commands to add, edit, list, and remove killmail feeds per channel
- Filter by region, system, shiptype, alliance, corp, character (victim or attacker, multi-value/negation supported)
- SQLite-backed feed storage and persistent Eve Universe API cache
- Supports multi-instance scaling if sharing the same SQLite DB

## Deployment

### Local

1. Clone the repo
2. `npm install`
3. Add your `DISCORD_TOKEN` to a `.env` file
4. `npm start`

### Render or Docker

- Use the provided `Dockerfile`
- Mount the `/app/data` directory as persistent storage

## Commands

- `/addfeed` - Add a new feed (admin only)
- `/editfeed` - Edit a feed (admin only)
- `/listfeed` - List feeds
- `/stopfeed` - Remove a feed (admin only)

## Development

- Add new command files to `src/commands/`
- Add new modules as needed
