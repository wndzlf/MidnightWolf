# One Night Werewolf Web MVP

Minimal real-time web implementation for friends.

## Features

- Room create/join with 5-char code
- Host-controlled start
- Server-authoritative role assignment and actions
- Night order with actions:
  - Werewolf
  - Seer
  - Robber
  - Troublemaker
  - Drunk
  - Insomniac (auto check)
- Day discussion timer (3 minutes)
- Vote + reveal + winner check

## Run

1. Install dependencies:

```bash
npm install
```

2. Start server:

```bash
npm run dev
```

3. Open browser:

- http://localhost:3000

## Notes

- Supports 3-10 players in one room.
- Deck is generated as `players + 3 center cards`.
- Game state machine:
  - `lobby -> night -> day -> vote -> reveal`
