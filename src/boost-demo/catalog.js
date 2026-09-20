/**
 * Brain-game catalogue — five games in each Boost My IQ skill category.
 *
 * scoreMode
 *   points — score accumulates; combos multiply it
 *   level  — score is the highest level cleared
 *   time   — score is seconds taken (lower is better)
 * duration  seconds on the clock (null = untimed)
 * lives     mistakes allowed before the game ends (null = unlimited)
 * stars     score needed for 1, 2 and 3 stars
 */

export const GAME_CATEGORIES = {
  memory: 'Memory',
  numerical: 'Numerical Reasoning',
  verbal: 'Verbal Reasoning',
  pattern: 'Pattern Recognition',
  attention: 'Attention & Focus',
};

export const GAME_CATEGORY_ORDER = Object.keys(GAME_CATEGORIES);

const g = (o) => {
  const x = { scoreMode: 'points', duration: 60, lives: null, difficulty: 2, lowerIsBetter: false, ...o };
  return {
    ...x,
    unit: x.scoreMode === 'level' ? 'level' : x.scoreMode === 'time' ? 'sec' : 'pts',
    minutes: x.duration
      ? x.duration < 60
        ? `${x.duration} sec`
        : `${x.duration / 60} min`
      : x.scoreMode === 'time'
        ? 'Under 1 min'
        : 'Until you miss',
  };
};

export const GAMES = [
  /* ── Memory ─────────────────────────────────────────────────────────── */
  g({
    slug: 'memory-matrix',
    title: 'Memory Matrix',
    cat: 'memory',
    tagline: 'Remember the glowing tiles',
    blurb: 'Tiles light up for a moment. Tap every one of them once the grid goes dark.',
    about: 'Holds positions in working memory. The grid and the pattern both grow as you climb.',
    how: ['Watch which tiles light up.', 'Tap all of them once the grid goes dark.', 'A wrong tap costs a life — you have three.'],
    scoreMode: 'level',
    duration: null,
    lives: 3,
    stars: [3, 6, 9],
  }),
  g({
    slug: 'card-pairs',
    title: 'Card Pairs',
    cat: 'memory',
    tagline: 'Flip, remember, match',
    blurb: 'Flip two cards at a time and find every matching pair before the clock runs out.',
    about: 'The classic concentration game. Clear a board and a bigger one deals in.',
    how: ['Tap two cards to flip them.', 'Matching pairs stay face up.', 'Clear the board fast for a time bonus.'],
    duration: 90,
    difficulty: 1,
    stars: [200, 400, 650],
  }),
  g({
    slug: 'simon-says',
    title: 'Echo Pads',
    cat: 'memory',
    tagline: 'Repeat the light-and-sound sequence',
    blurb: 'Four pads play a tune. Play it back — then it grows by one note.',
    about: 'Sequence memory with sound as well as colour. It speeds up as it gets longer.',
    how: ['Watch and listen to the sequence.', 'Tap the pads in the same order.', 'Two mistakes and the game is over.'],
    scoreMode: 'level',
    duration: null,
    lives: 2,
    stars: [4, 7, 10],
  }),
  g({
    slug: 'whats-changed',
    title: 'What Changed?',
    cat: 'memory',
    tagline: 'Spot the one thing that’s different',
    blurb: 'Study the scene. When it comes back, one object has changed — find it.',
    about: 'Change detection trains visual short-term memory. More objects appear as you go.',
    how: ['Memorise the shapes and colours.', 'The scene hides, then returns with one change.', 'Tap the object that changed.'],
    duration: null,
    lives: 3,
    stars: [100, 250, 450],
  }),
  g({
    slug: 'flash-digits',
    title: 'Flash Digits',
    cat: 'memory',
    tagline: 'Numbers flash — type them back',
    blurb: 'Digits flash one after another. Type the whole number back from memory.',
    about: 'Digit span, the classic working-memory measure. From level 5 some rounds must be typed backwards.',
    how: ['Watch the digits appear one at a time.', 'Type them back on the keypad.', 'Each level adds a digit. Two mistakes end the game.'],
    scoreMode: 'level',
    duration: null,
    lives: 2,
    stars: [3, 5, 7],
  }),

  /* ── Numerical Reasoning ─────────────────────────────────────────────── */
  g({
    slug: 'speed-math',
    title: 'Speed Math',
    cat: 'numerical',
    tagline: 'Sixty seconds of quick sums',
    blurb: 'Answer as many sums as you can. Streaks multiply your score.',
    about: 'Builds calculation fluency. Problems get harder as your streak grows.',
    how: ['Pick the answer to each sum.', 'Correct answers in a row build a combo.', 'A wrong answer resets the combo.'],
    difficulty: 1,
    stars: [200, 450, 750],
  }),
  g({
    slug: 'target-sum',
    title: 'Target Sum',
    cat: 'numerical',
    tagline: 'Add tiles to hit the target',
    blurb: 'Tap number tiles that add up exactly to the target. Use more tiles for more points.',
    about: 'Mental addition and planning. Targets climb as your score does.',
    how: ['Tap tiles to add them up.', 'Hit the target exactly to score.', 'Go over and the selection resets.'],
    stars: [150, 350, 600],
  }),
  g({
    slug: 'bigger-one',
    title: 'Which Is Bigger?',
    cat: 'numerical',
    tagline: 'Two sums — tap the larger',
    blurb: 'Two expressions appear. Tap the one with the bigger value, fast.',
    about: 'Number sense under time pressure. The sums get closer and trickier.',
    how: ['Work out both sides.', 'Tap the side with the larger value.', 'Keep a streak going for a multiplier.'],
    duration: 45,
    difficulty: 1,
    stars: [150, 350, 600],
  }),
  g({
    slug: 'math-rain',
    title: 'Math Rain',
    cat: 'numerical',
    tagline: 'Solve the drops before they land',
    blurb: 'Sums fall from the sky. Type an answer to pop the drop before it hits the ground.',
    about: 'Arcade-style arithmetic. The rain gets faster and heavier the longer you last.',
    how: ['Type the answer to any falling sum.', 'A correct answer pops that drop instantly.', 'Three drops reaching the ground ends the game.'],
    duration: null,
    lives: 3,
    difficulty: 3,
    stars: [150, 400, 700],
  }),
  g({
    slug: 'missing-operator',
    title: 'Missing Sign',
    cat: 'numerical',
    tagline: 'Find the +, −, × or ÷',
    blurb: 'An equation is missing its signs. Pick the ones that make it true.',
    about: 'Reasoning backwards from the result. Later rounds hide two signs at once.',
    how: ['Read the equation.', 'Choose the sign (or pair of signs) that makes it true.', 'Multiplication and division come first.'],
    stars: [150, 350, 600],
  }),

  /* ── Verbal Reasoning ────────────────────────────────────────────────── */
  g({
    slug: 'word-scramble',
    title: 'Word Scramble',
    cat: 'verbal',
    tagline: 'Unjumble the letters',
    blurb: 'Tap the scrambled letters in the right order to spell the word.',
    about: 'Anagram solving. Words get longer as your score climbs.',
    how: ['Tap letters to spell the word.', 'Tap a placed letter to take it back.', 'Stuck? Skip — it only resets your combo.'],
    duration: 90,
    difficulty: 1,
    stars: [150, 400, 700],
  }),
  g({
    slug: 'synonym-snap',
    title: 'Synonym Snap',
    cat: 'verbal',
    tagline: 'Same meaning? Snap it!',
    blurb: 'A word appears with two choices. Snap the one that means the same.',
    about: 'Rapid vocabulary recall. The words get harder the longer your streak.',
    how: ['Read the word at the top.', 'Tap the choice closest in meaning.', 'Speed and streaks both count.'],
    stars: [150, 350, 600],
  }),
  g({
    slug: 'word-builder',
    title: 'Word Builder',
    cat: 'verbal',
    tagline: 'How many words can you make?',
    blurb: 'Make words from a wheel of letters and fill in every blank.',
    about: 'Word retrieval and letter manipulation. Find every word to unlock the next wheel.',
    how: ['Tap letters to build a word, then press Enter.', 'Each letter can be used once per word.', 'Fill every blank for a board bonus.'],
    duration: 120,
    difficulty: 2,
    stars: [150, 350, 600],
  }),
  g({
    slug: 'spell-check',
    title: 'Spell Check',
    cat: 'verbal',
    tagline: 'Pick the correct spelling',
    blurb: 'Three spellings, one right. These are the words people get wrong most.',
    about: 'Orthographic memory for commonly misspelled English words.',
    how: ['Look at the three spellings.', 'Tap the correct one.', 'Streaks multiply your score.'],
    difficulty: 1,
    stars: [150, 350, 600],
  }),
  g({
    slug: 'odd-word-out',
    title: 'Odd Word Out',
    cat: 'verbal',
    tagline: 'Which word doesn’t belong?',
    blurb: 'Three words share a category. Tap the one that doesn’t fit.',
    about: 'Semantic categorisation at speed.',
    how: ['Find the group three words belong to.', 'Tap the word from a different group.', 'Keep your streak alive.'],
    difficulty: 1,
    stars: [150, 350, 600],
  }),

  /* ── Pattern Recognition ─────────────────────────────────────────────── */
  g({
    slug: 'shape-rotation',
    title: 'Shape Rotation',
    cat: 'pattern',
    tagline: 'Same shape, or its mirror?',
    blurb: 'Turn the shape in your head. Is it the same shape, or a mirror image?',
    about: 'Mental rotation, a core spatial-reasoning skill.',
    how: ['Compare the two shapes.', 'Same if a rotation matches them; Mirror if it needs a flip.', 'Fast answers keep the combo going.'],
    stars: [150, 350, 600],
  }),
  g({
    slug: 'sequence-surge',
    title: 'Sequence Surge',
    cat: 'pattern',
    tagline: 'What comes next?',
    blurb: 'Crack the rule behind each sequence and pick what comes next.',
    about: 'Inductive reasoning with numbers and letters. Rules get sneakier as you go.',
    how: ['Spot the rule in the sequence.', 'Pick the next item.', 'Harder rules unlock with your streak.'],
    difficulty: 2,
    stars: [120, 300, 500],
  }),
  g({
    slug: 'matrix-match',
    title: 'Matrix Match',
    cat: 'pattern',
    tagline: 'Complete the 3×3 grid',
    blurb: 'Every row and column follows a rule. Find the tile that completes the grid.',
    about: 'Matrix reasoning, the heart of most IQ tests.',
    how: ['Look along the rows and down the columns.', 'Work out what changes and what stays.', 'Pick the missing tile.'],
    difficulty: 3,
    stars: [120, 300, 500],
  }),
  g({
    slug: 'mirror-grid',
    title: 'Mirror Grid',
    cat: 'pattern',
    tagline: 'Draw the reflection',
    blurb: 'Recreate the pattern as it would look in a mirror.',
    about: 'Visual transformation and spatial precision. Grids grow as you progress.',
    how: ['Study the pattern on the left.', 'Tap tiles on the right to draw its mirror image.', 'Press Check. Three wrong grids end the game.'],
    duration: null,
    lives: 3,
    difficulty: 2,
    stars: [100, 250, 450],
  }),
  g({
    slug: 'bead-pattern',
    title: 'Bead Pattern',
    cat: 'pattern',
    tagline: 'Continue the necklace',
    blurb: 'Beads repeat in a pattern. Pick the colour of the next bead.',
    about: 'Repeating-unit detection. The repeating unit gets longer and harder to see.',
    how: ['Find the repeating group of beads.', 'Pick the next colour.', 'Longer patterns score more.'],
    difficulty: 1,
    stars: [150, 350, 600],
  }),

  /* ── Attention & Focus ───────────────────────────────────────────────── */
  g({
    slug: 'color-stroop',
    title: 'Colour Clash',
    cat: 'attention',
    tagline: 'Name the ink, not the word',
    blurb: 'The word says one colour, the ink shows another. Answer the ink.',
    about: 'The Stroop task: it trains you to override the urge to read.',
    how: ['Look at the colour the word is printed in.', 'Tap that colour — ignore what the word says.', 'Three mistakes end the game.'],
    lives: 3,
    stars: [150, 400, 700],
  }),
  g({
    slug: 'number-chase',
    title: 'Number Chase',
    cat: 'attention',
    tagline: 'Tap 1 to 25, fast',
    blurb: 'Find and tap every number in order as quickly as you can.',
    about: 'A Schulte table: visual search and sustained attention.',
    how: ['Tap 1, then 2, then 3… up to 25.', 'A wrong tap adds 2 seconds.', 'Your time is your score — lower is better.'],
    scoreMode: 'time',
    duration: null,
    lowerIsBetter: true,
    difficulty: 1,
    stars: [60, 40, 28],
  }),
  g({
    slug: 'spot-the-odd',
    title: 'Spot the Odd',
    cat: 'attention',
    tagline: 'One tile is a different shade',
    blurb: 'Every tile looks the same — except one. Find it before the colours get too close.',
    about: 'Fine visual discrimination. The grid grows and the difference shrinks.',
    how: ['Scan the grid.', 'Tap the tile with a slightly different shade.', 'Each find makes the next one harder.'],
    stars: [150, 350, 600],
  }),
  g({
    slug: 'pop-targets',
    title: 'Pop Targets',
    cat: 'attention',
    tagline: 'Hit coral, never navy',
    blurb: 'Targets pop up. Tap the coral ones, leave the navy ones alone.',
    about: 'Go/no-go reaction: quick responses plus the discipline to hold back.',
    how: ['Tap coral targets before they vanish.', 'Never tap a navy target — it costs a life.', 'It speeds up as you score.'],
    duration: 45,
    lives: 3,
    difficulty: 2,
    stars: [150, 350, 600],
  }),
  g({
    slug: 'flanker-arrows',
    title: 'Arrow Focus',
    cat: 'attention',
    tagline: 'Which way does the middle arrow point?',
    blurb: 'A row of arrows appears. Only the middle one matters.',
    about: 'The flanker task: filtering out distractions right beside what you need.',
    how: ['Look only at the centre arrow.', 'Tap ← or → (or use your arrow keys).', 'Speed and streaks both count.'],
    duration: 45,
    difficulty: 2,
    stars: [150, 400, 700],
  }),
];

export const GAMES_BY_SLUG = Object.fromEntries(GAMES.map((x) => [x.slug, x]));

/** 0–3 stars for a score. */
export function starsFor(game, score) {
  if (score == null) return 0;
  const [a, b, c] = game.stars;
  if (game.lowerIsBetter) return score <= c ? 3 : score <= b ? 2 : score <= a ? 1 : 0;
  return score >= c ? 3 : score >= b ? 2 : score >= a ? 1 : 0;
}

/** One game a day gets the spotlight, rotating through the catalogue. */
export function featuredGame(date = new Date()) {
  const day = Math.floor(date.getTime() / 864e5);
  return GAMES[day % GAMES.length];
}

/** Today's featured game plus one game from each of the next categories — a varied daily set. */
export function dailyPicks(n = 4, date = new Date()) {
  const day = Math.floor(date.getTime() / 864e5);
  const first = featuredGame(date);
  const start = GAME_CATEGORY_ORDER.indexOf(first.cat);
  const picks = [first];
  for (let i = 1; picks.length < n && i < GAME_CATEGORY_ORDER.length; i++) {
    const cat = GAME_CATEGORY_ORDER[(start + i) % GAME_CATEGORY_ORDER.length];
    const pool = GAMES.filter((g) => g.cat === cat);
    picks.push(pool[(day + i) % pool.length]);
  }
  return picks;
}
