import { choice } from './util.js';

/**
 * Verbal reasoning. Hand-written banks, tiered by vocabulary difficulty. Each
 * level draws 20 questions from roughly fifty items, so retries rarely repeat.
 */

const SYN = {
  1: [['big', 'large'], ['happy', 'glad'], ['fast', 'quick'], ['begin', 'start'], ['finish', 'end'], ['shut', 'close'], ['clever', 'smart'], ['angry', 'cross'], ['simple', 'easy'], ['wealthy', 'rich'], ['gift', 'present'], ['story', 'tale'], ['shout', 'yell'], ['near', 'nearby'], ['choose', 'pick'], ['sleepy', 'tired']],
  2: [['brave', 'courageous'], ['ancient', 'old'], ['allow', 'permit'], ['reply', 'answer'], ['purchase', 'buy'], ['damp', 'moist'], ['error', 'mistake'], ['enormous', 'huge'], ['repair', 'fix'], ['conceal', 'hide'], ['loyal', 'faithful'], ['rapid', 'swift'], ['weary', 'exhausted'], ['gather', 'collect'], ['vanish', 'disappear'], ['fragile', 'delicate']],
  3: [['abundant', 'plentiful'], ['candid', 'frank'], ['diligent', 'hardworking'], ['eloquent', 'articulate'], ['frugal', 'thrifty'], ['hostile', 'unfriendly'], ['imminent', 'impending'], ['lucid', 'clear'], ['meticulous', 'thorough'], ['obscure', 'unclear'], ['prudent', 'sensible'], ['reluctant', 'unwilling'], ['serene', 'tranquil'], ['tedious', 'boring'], ['vivid', 'bright'], ['zealous', 'enthusiastic']],
  4: [['ambiguous', 'equivocal'], ['benign', 'harmless'], ['cogent', 'convincing'], ['deleterious', 'harmful'], ['ephemeral', 'fleeting'], ['fastidious', 'fussy'], ['garrulous', 'talkative'], ['insipid', 'bland'], ['lethargic', 'sluggish'], ['mitigate', 'lessen'], ['ostentatious', 'showy'], ['pragmatic', 'practical'], ['reticent', 'reserved'], ['spurious', 'false'], ['tenacious', 'persistent'], ['ubiquitous', 'everywhere']],
  5: [['obsequious', 'servile'], ['perfidious', 'treacherous'], ['pusillanimous', 'cowardly'], ['recalcitrant', 'defiant'], ['sagacious', 'wise'], ['sycophant', 'flatterer'], ['truculent', 'aggressive'], ['vituperative', 'abusive'], ['laconic', 'terse'], ['magnanimous', 'generous'], ['nefarious', 'wicked'], ['obdurate', 'stubborn'], ['parsimonious', 'stingy'], ['quixotic', 'idealistic'], ['inchoate', 'undeveloped'], ['esoteric', 'obscure']],
};

const ANT = {
  1: [['hot', 'cold'], ['early', 'late'], ['full', 'empty'], ['open', 'closed'], ['win', 'lose'], ['light', 'dark'], ['old', 'new'], ['push', 'pull'], ['day', 'night'], ['wet', 'dry'], ['first', 'last'], ['above', 'below']],
  2: [['generous', 'selfish'], ['accept', 'refuse'], ['arrive', 'depart'], ['ancient', 'modern'], ['brave', 'cowardly'], ['expand', 'shrink'], ['humble', 'proud'], ['include', 'exclude'], ['maximum', 'minimum'], ['rough', 'smooth'], ['strict', 'lenient'], ['victory', 'defeat']],
  3: [['abundant', 'scarce'], ['benevolent', 'malevolent'], ['candid', 'evasive'], ['conceal', 'reveal'], ['diligent', 'lazy'], ['frugal', 'extravagant'], ['hostile', 'friendly'], ['optimist', 'pessimist'], ['praise', 'criticise'], ['temporary', 'permanent'], ['transparent', 'opaque'], ['vague', 'precise']],
  4: [['ephemeral', 'enduring'], ['garrulous', 'taciturn'], ['lethargic', 'energetic'], ['mitigate', 'aggravate'], ['ostentatious', 'modest'], ['reticent', 'forthcoming'], ['benign', 'malignant'], ['verbose', 'concise'], ['novice', 'veteran'], ['affluent', 'impoverished'], ['zenith', 'nadir'], ['tenacious', 'yielding']],
  5: [['laconic', 'loquacious'], ['magnanimous', 'petty'], ['parsimonious', 'lavish'], ['sagacious', 'foolish'], ['obsequious', 'domineering'], ['truculent', 'conciliatory'], ['esoteric', 'accessible'], ['perfidious', 'loyal'], ['recalcitrant', 'compliant'], ['ebullient', 'subdued'], ['prolix', 'succinct'], ['venerate', 'despise']],
};

const ANALOGY = {
  1: [
    ['puppy : dog :: kitten : ?', 'cat', ['cow', 'lion', 'mouse']],
    ['hand : glove :: foot : ?', 'sock', ['hat', 'ring', 'belt']],
    ['bird : nest :: bee : ?', 'hive', ['web', 'den', 'cave']],
    ['hot : cold :: tall : ?', 'short', ['big', 'wide', 'high']],
    ['eye : see :: ear : ?', 'hear', ['smell', 'talk', 'touch']],
    ['cow : milk :: hen : ?', 'egg', ['feather', 'farm', 'chick']],
  ],
  2: [
    ['author : book :: composer : ?', 'symphony', ['painting', 'statue', 'poem']],
    ['thermometer : temperature :: scale : ?', 'weight', ['length', 'speed', 'time']],
    ['fish : school :: wolf : ?', 'pack', ['herd', 'flock', 'swarm']],
    ['pen : write :: knife : ?', 'cut', ['cook', 'eat', 'sharpen']],
    ['petal : flower :: page : ?', 'book', ['word', 'tree', 'paper']],
    ['water : thirst :: food : ?', 'hunger', ['taste', 'meal', 'plate']],
  ],
  3: [
    ['novice : expert :: apprentice : ?', 'master', ['student', 'worker', 'teacher']],
    ['drought : rain :: famine : ?', 'food', ['water', 'crop', 'hunger']],
    ['carpenter : saw :: surgeon : ?', 'scalpel', ['hospital', 'patient', 'nurse']],
    ['archipelago : islands :: constellation : ?', 'stars', ['planets', 'sky', 'galaxy']],
    ['fin : fish :: wing : ?', 'bird', ['feather', 'sky', 'flight']],
    ['miser : money :: glutton : ?', 'food', ['wealth', 'greed', 'sleep']],
  ],
  4: [
    ['symptom : diagnosis :: clue : ?', 'deduction', ['crime', 'detective', 'evidence']],
    ['insipid : flavour :: monotonous : ?', 'variety', ['sound', 'voice', 'boredom']],
    ['prologue : play :: preface : ?', 'book', ['ending', 'author', 'chapter']],
    ['cartographer : maps :: lexicographer : ?', 'dictionaries', ['letters', 'languages', 'novels']],
    ['hive : bees :: warren : ?', 'rabbits', ['foxes', 'birds', 'mice']],
    ['anaesthetic : pain :: antidote : ?', 'poison', ['cure', 'illness', 'doctor']],
  ],
  5: [
    ['numismatist : coins :: philatelist : ?', 'stamps', ['maps', 'books', 'butterflies']],
    ['sycophant : flattery :: braggart : ?', 'boasting', ['lying', 'courage', 'humility']],
    ['analgesic : pain :: antipyretic : ?', 'fever', ['infection', 'cough', 'swelling']],
    ['penury : wealth :: ignorance : ?', 'knowledge', ['poverty', 'bliss', 'stupidity']],
    ['ichthyology : fish :: ornithology : ?', 'birds', ['insects', 'reptiles', 'rocks']],
    ['ossify : bone :: petrify : ?', 'stone', ['wood', 'fear', 'fossil']],
  ],
};

const ODD = {
  1: [
    [['apple', 'banana', 'carrot', 'grape'], 'carrot', 'The others are fruits.'],
    [['red', 'blue', 'green', 'circle'], 'circle', 'The others are colours.'],
    [['dog', 'cat', 'rose', 'horse'], 'rose', 'The others are animals.'],
    [['chair', 'table', 'sofa', 'spoon'], 'spoon', 'The others are furniture.'],
    [['Monday', 'Friday', 'March', 'Sunday'], 'March', 'The others are days of the week.'],
    [['piano', 'guitar', 'drum', 'brush'], 'brush', 'The others are instruments.'],
  ],
  2: [
    [['copper', 'silver', 'iron', 'marble'], 'marble', 'The others are metals.'],
    [['violin', 'cello', 'flute', 'harp'], 'flute', 'The others have strings.'],
    [['Mars', 'Venus', 'Moon', 'Jupiter'], 'Moon', 'The others are planets.'],
    [['square', 'triangle', 'cube', 'circle'], 'cube', 'The others are flat shapes.'],
    [['whisper', 'murmur', 'mumble', 'shout'], 'shout', 'The others are quiet.'],
    [['eagle', 'penguin', 'sparrow', 'hawk'], 'penguin', 'The others can fly.'],
  ],
  3: [
    [['sonnet', 'haiku', 'limerick', 'novel'], 'novel', 'The others are forms of poem.'],
    [['cheetah', 'leopard', 'jaguar', 'hyena'], 'hyena', 'The others are big cats.'],
    [['Nile', 'Amazon', 'Sahara', 'Danube'], 'Sahara', 'The others are rivers.'],
    [['ruthless', 'callous', 'compassionate', 'cruel'], 'compassionate', 'The others mean unkind.'],
    [['inch', 'metre', 'litre', 'mile'], 'litre', 'The others measure length.'],
    [['oxygen', 'nitrogen', 'water', 'helium'], 'water', 'The others are elements.'],
  ],
  4: [
    [['ephemeral', 'transient', 'fleeting', 'perennial'], 'perennial', 'The others mean short-lived.'],
    [['cumulus', 'stratus', 'cirrus', 'magma'], 'magma', 'The others are clouds.'],
    [['Mercury', 'Neptune', 'Pluto', 'Saturn'], 'Pluto', 'The others are full planets.'],
    [['sonata', 'concerto', 'symphony', 'sculpture'], 'sculpture', 'The others are musical forms.'],
    [['meticulous', 'scrupulous', 'careless', 'thorough'], 'careless', 'The others mean careful.'],
    [['hexagon', 'octagon', 'pentagon', 'sphere'], 'sphere', 'The others are polygons.'],
  ],
  5: [
    [['laconic', 'terse', 'succinct', 'verbose'], 'verbose', 'The others mean brief.'],
    [['Mozart', 'Beethoven', 'Bach', 'Rembrandt'], 'Rembrandt', 'The others are composers.'],
    [['tibia', 'femur', 'ulna', 'aorta'], 'aorta', 'The others are bones.'],
    [['igneous', 'sedimentary', 'metamorphic', 'tectonic'], 'tectonic', 'The others are rock types.'],
    [['pusillanimous', 'craven', 'timorous', 'intrepid'], 'intrepid', 'The others mean cowardly.'],
    [['sine', 'cosine', 'tangent', 'integer'], 'integer', 'The others are trigonometric functions.'],
  ],
};

const ANAGRAM = {
  1: ['bird', 'cake', 'frog', 'milk', 'rain', 'ship', 'tree', 'wolf', 'lamp', 'moon', 'sand', 'desk'],
  2: ['plant', 'storm', 'grape', 'chair', 'beach', 'cloud', 'tiger', 'dream', 'brick', 'flame', 'horse', 'piano'],
  3: ['garden', 'planet', 'silver', 'frozen', 'castle', 'monkey', 'orange', 'bridge', 'winter', 'pencil', 'rocket', 'candle'],
  4: ['library', 'diamond', 'captain', 'harvest', 'blanket', 'chicken', 'kitchen', 'pumpkin', 'whisper', 'journey', 'penguin', 'crystal'],
  5: ['elephant', 'mountain', 'treasure', 'calendar', 'dinosaur', 'festival', 'hospital', 'platform', 'keyboard', 'triangle', 'umbrella', 'vacation'],
};

function scramble(r, word) {
  let s;
  do s = r.shuffle([...word]).join('');
  while (s === word);
  return s.toUpperCase();
}

/** Same letters rearranged slightly — reads almost right, isn't the word. */
function nearMisses(r, word, n) {
  const out = new Set();
  const tries = [];
  for (let i = 0; i < word.length - 1; i++) {
    const c = [...word];
    [c[i], c[i + 1]] = [c[i + 1], c[i]];
    tries.push(c.join(''));
  }
  for (let i = 0; i < word.length - 2; i++) {
    const c = [...word];
    [c[i], c[i + 2]] = [c[i + 2], c[i]];
    tries.push(c.join(''));
  }
  for (const t of r.shuffle(tries)) {
    if (t !== word) out.add(t);
    if (out.size === n) break;
  }
  return [...out];
}

const T = {
  synonym(r, level) {
    const [word, syn] = r.pick(SYN[level]);
    const trap = ANT[level].find(([w]) => w === word)?.[1];
    return choice(r, {
      prompt: `Which word is closest in meaning to “${word}”?`,
      answer: syn,
      distractors: [trap, ...r.sample(SYN[level].filter(([w]) => w !== word).map(([, s]) => s), 4)],
      explain: `“${word}” and “${syn}” mean nearly the same thing.`,
    });
  },

  antonym(r, level) {
    const [word, ant] = r.pick(ANT[level]);
    const trap = SYN[level].find(([w]) => w === word)?.[1];
    return choice(r, {
      prompt: `Which word is most nearly opposite in meaning to “${word}”?`,
      answer: ant,
      distractors: [trap, ...r.sample(ANT[level].filter(([w]) => w !== word).map(([, a]) => a), 4)],
      explain: `“${ant}” is the opposite of “${word}”.`,
    });
  },

  analogy(r, level) {
    const [q, a, wrong] = r.pick(ANALOGY[level]);
    return choice(r, {
      prompt: 'Complete the analogy.',
      stimulus: { kind: 'seq', items: [q] },
      answer: a,
      distractors: wrong,
      explain: `${q.replace('?', a)}.`,
    });
  },

  odd(r, level) {
    const [items, odd, why] = r.pick(ODD[level]);
    return choice(r, {
      prompt: `Which word does not belong: ${items.join(', ')}?`,
      answer: odd,
      distractors: items.filter((w) => w !== odd),
      explain: `${odd} — ${why}`,
    });
  },

  anagram(r, level) {
    const word = r.pick(ANAGRAM[level]);
    const others = ANAGRAM[level].filter((w) => w !== word);
    return choice(r, {
      prompt: 'Unscramble these letters. Which real word do they spell?',
      stimulus: { kind: 'seq', items: [scramble(r, word)] },
      answer: word,
      distractors: [...nearMisses(r, word, 2), ...r.sample(others, 3)],
      explain: `The letters spell “${word}”.`,
    });
  },
};

const WEIGHTS = ['synonym', 'synonym', 'synonym', 'antonym', 'antonym', 'analogy', 'odd', 'anagram', 'anagram'];

export function verbal(r, level) {
  return T[r.pick(WEIGHTS)](r, level);
}
