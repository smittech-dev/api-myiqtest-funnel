# boost-demo — the catalogue, copied from the frontend

`catalog.js` is a **verbatim copy** of `boost.myiq-test.com/src/data/catalog.js`:
the twenty-five brain games, their categories, score modes and star thresholds.
`npm run check:boost` fails the build if the two ever drift.

Unlike `src/boost-engine`, nothing in here is secret. The frontend imports this
same file directly — `Games.jsx` and `GamePlay.jsx` render titles, blurbs and
star thresholds straight from their own copy — so the reason for the copy is not
confidentiality.

The server needs it for three things the client must not be trusted with:

- **Validating a slug**, so `POST /games/:slug/score` cannot invent a game.
- **`scoreMode` and `lowerIsBetter`**, which decide what counts as a personal
  best. Number Chase is scored in seconds; a client allowed to declare its own
  best would "improve" by getting slower.
- **Ranking points per run**, so a level cleared and a point scored are worth
  comparable amounts across categories.

See `src/services/boost-demo.service.ts` for what is done with it, and why the
leaderboard and game progress are deliberately demo data rather than records.
