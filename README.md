# Son Çay

**Son Çay** ("the last tea") is an online multiplayer elimination game for 3 to 15 players, each on their own device. A roulette
holds live and blank chambers in a hidden order; players take turns shooting, and use tools that
reveal, protect or deceive. The last player alive wins. There are two modes: **Classic** (tools are
dealt at random) and **Custom** (Classic plus private information, coins and a shop, and
predictions for eliminated players). Session points add up across the matches played in a room.

The game is in Turkish. It is still in development. Served from this machine (localhost) it runs
against the local Firebase emulators; served from any other host (GitHub Pages) it uses the real
Firebase project of the game (`src/ui/firebase.js`).

**Tech stack:** plain JavaScript ES modules with no build step and no runtime dependencies; a pure,
deterministic rules engine; Firebase Realtime Database with security rules, tested on the local
Firebase Emulator Suite; a plain HTML/CSS/JS interface (`index.html`, `src/ui/`).

## Run locally

You need Node.js 24.12 or newer, the Firebase CLI (`npm install -g firebase-tools`) and Java 21 or
newer (for the database emulator). Locally everything runs against the emulators of the demo
project `demo-mosul-roulette`; the tests never use the real Firebase project.

```sh
npm install
npm run emulators   # first terminal: Auth and Realtime Database emulators
npm run dev         # second terminal: static server on http://localhost:8080
```

Then open `http://localhost:8080/` in several browser tabs: each tab is its own player. Developer
pages: `http://localhost:8080/dev/rooms.html` (room and match test page) and
`http://localhost:8080/dev/` (a hot-seat page for the rules engine alone).

## Tests

```sh
npm test            # rules engine and pure room-layer tests (no emulator needed)
npm run test:rules  # security rules and room layer on the emulators (starts and stops them)
```

The security rules are generated from `tools/rules/` with `npm run rules:build`; never edit
`database.rules.json` by hand (a test checks that it matches the generator).
