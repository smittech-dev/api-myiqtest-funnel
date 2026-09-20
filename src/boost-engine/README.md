# boost-engine — copied from the frontend, not written here

These files are a **verbatim copy** of `boost.myiq-test.com/src/data/boost/`,
with one mechanical change: relative imports are extension-qualified
(`'./util'` → `'./util.js'`) because this package is `"type": "module"` on
Node's `NodeNext` resolution, which does not guess extensions. Nothing else
differs, and `npm run check:boost` fails the build if anything else ever does.

## Why the copy lives here

`index.js` holds the answer key. `buildLevel()` generates a level's twenty
questions from a seed and `scoreAttempt()` marks them, so both the correct
answers and the explanations are in this directory. If these files shipped in
the browser bundle, any member could read the correct answer to every question
out of devtools, and scores, the leaderboard and the estimated IQ would stop
meaning anything.

So the generators run here, in Node, and the client is sent `toClient(q)` output
only — prompt, stimulus, options, render hint. Never `answer`, `explain`,
`trait`, `key`, or the seed that would let a client regenerate all of them.

The frontend keeps `meta.js` (categories, level names, pass mark) because the UI
needs those labels and nothing in it can be used to work out an answer. That file
is duplicated on purpose: it is the one part of this directory that is safe on
both sides.

## Editing

Edit the frontend copy first, then re-copy here and re-run the check:

```bash
cp ../boost.myiq-test.com/src/data/boost/*.js src/boost-engine/
#   then re-add the .js import extensions, or the check will tell you to
npm run check:boost
```

The check compares every file against its frontend original with the extension
difference normalised away, so a generator tweaked on one side and forgotten on
the other is caught before it reaches a member's quiz.
