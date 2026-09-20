/**
 * Personality. Big Five statements answered on a five-point scale. There are
 * no right answers, so a level is "passed" by answering all twenty; each
 * level contributes four statements per trait, getting more nuanced as the
 * levels go up. `+` statements score directly, `-` statements are reversed.
 */

import { LIKERT } from './meta.js';

// [trait, key, statement] — four per trait, per level
const BANK = {
  1: [
    ['O', '+', 'I enjoy trying new foods.'], ['O', '-', 'I like to stick to what I know.'], ['O', '+', 'I enjoy art and music.'], ['O', '+', 'I have a vivid imagination.'],
    ['C', '+', 'I keep my things tidy.'], ['C', '-', 'I often forget where I put things.'], ['C', '+', 'I finish the tasks I start.'], ['C', '+', 'I plan my day ahead.'],
    ['E', '+', 'I enjoy meeting new people.'], ['E', '-', 'I prefer to spend time alone.'], ['E', '+', 'I talk a lot in groups.'], ['E', '+', 'I feel energised at parties.'],
    ['A', '+', 'I am kind to others.'], ['A', '-', 'I get into arguments often.'], ['A', '+', 'I like helping people.'], ['A', '+', 'I trust people easily.'],
    ['S', '+', 'I stay calm under pressure.'], ['S', '-', 'I worry a lot.'], ['S', '+', 'I rarely feel low.'], ['S', '-', 'I get upset easily.'],
  ],
  2: [
    ['O', '+', 'I am curious about how things work.'], ['O', '-', 'I find abstract ideas uninteresting.'], ['O', '+', 'I like visiting places I have never been.'], ['O', '-', 'I prefer routine to variety.'],
    ['C', '+', 'I pay attention to details.'], ['C', '-', 'I leave chores until the last minute.'], ['C', '+', 'I like to follow a schedule.'], ['C', '-', 'I often make careless mistakes.'],
    ['E', '+', 'I start conversations easily.'], ['E', '-', 'I stay in the background at social events.'], ['E', '+', 'I like being the centre of attention.'], ['E', '-', 'I find large groups tiring.'],
    ['A', '+', "I take other people's feelings into account."], ['A', '-', 'I can be critical of others.'], ['A', '+', 'I forgive people quickly.'], ['A', '-', 'I put my own needs first.'],
    ['S', '+', 'I recover quickly from setbacks.'], ['S', '-', 'I often feel nervous.'], ['S', '+', 'I handle criticism well.'], ['S', '-', 'My mood changes often.'],
  ],
  3: [
    ['O', '+', 'I enjoy thinking about philosophical questions.'], ['O', '-', 'I rarely notice the beauty around me.'], ['O', '+', 'I seek out opinions that differ from mine.'], ['O', '-', 'I avoid unfamiliar situations when I can.'],
    ['C', '+', 'I set goals and work steadily toward them.'], ['C', '-', 'I get distracted from my work easily.'], ['C', '+', 'I prepare thoroughly before important events.'], ['C', '-', 'I act first and think later.'],
    ['E', '+', 'I speak up readily in meetings.'], ['E', '-', 'I need quiet time to recharge after socialising.'], ['E', '+', 'I make friends quickly.'], ['E', '-', 'I keep my thoughts to myself.'],
    ['A', '+', "I try to see things from other people's point of view."], ['A', '-', 'I enjoy winning an argument more than finding agreement.'], ['A', '+', 'I go out of my way to make others comfortable.'], ['A', '-', "I am suspicious of people's motives."],
    ['S', '+', 'I stay relaxed when plans change suddenly.'], ['S', '-', 'I dwell on my mistakes.'], ['S', '+', 'I feel secure in who I am.'], ['S', '-', 'Small problems can ruin my day.'],
  ],
  4: [
    ['O', '+', 'I am drawn to complex, unconventional ideas.'], ['O', '-', 'I trust tradition more than experimentation.'], ['O', '+', 'I lose track of time exploring a new subject.'], ['O', '-', 'I find poetry hard to connect with.'],
    ['C', '+', 'I keep going on long tasks even when they become dull.'], ['C', '-', 'I make promises I later struggle to keep.'], ['C', '+', 'I break big goals into small, trackable steps.'], ['C', '-', 'I often start projects I never finish.'],
    ['E', '+', 'I enjoy taking the lead in group activities.'], ['E', '-', 'I would rather listen than talk.'], ['E', '+', 'I seek out lively, busy environments.'], ['E', '-', 'I feel uneasy introducing myself to strangers.'],
    ['A', '+', 'I compromise readily to keep the peace.'], ['A', '-', "I find it hard to sympathise with others' problems."], ['A', '+', 'I give credit to others generously.'], ['A', '-', 'I hold grudges for a long time.'],
    ['S', '+', 'I keep a clear head in emergencies.'], ['S', '-', 'I feel overwhelmed by my responsibilities.'], ['S', '+', 'I can put worries aside to focus.'], ['S', '-', 'I often feel irritated for no clear reason.'],
  ],
  5: [
    ['O', '+', 'I enjoy revising my views when the evidence changes.'], ['O', '-', 'Ambiguity makes me uncomfortable rather than curious.'], ['O', '+', 'I am comfortable holding two conflicting ideas at once.'], ['O', '-', 'I see little value in questioning how things are usually done.'],
    ['C', '+', 'I hold myself to high standards even when no one is checking.'], ['C', '-', 'I rely on last-minute effort rather than steady progress.'], ['C', '+', 'I weigh long-term consequences over short-term rewards.'], ['C', '-', 'I find it hard to resist immediate temptations.'],
    ['E', '+', 'I think best when talking ideas through with others.'], ['E', '-', 'I prefer depth with a few people to breadth with many.'], ['E', '+', 'I look for chances to perform or present.'], ['E', '-', 'Long stretches of social contact leave me drained.'],
    ['A', '+', 'I stay patient with people who frustrate me.'], ['A', '-', 'I use others when it serves my goals.'], ['A', '+', 'I assume good intentions until shown otherwise.'], ['A', '-', "I am quick to point out others' mistakes."],
    ['S', '+', 'Uncertainty rarely keeps me up at night.'], ['S', '-', 'I replay difficult conversations long after they end.'], ['S', '+', 'I can feel strong emotions without being ruled by them.'], ['S', '-', 'I tend to expect things to go wrong.'],
  ],
};

/** Personality levels are a fixed set of 20 statements in shuffled order. */
export function personalitySet(r, level) {
  return r.shuffle(BANK[level]).map(([trait, key, text]) => ({
    type: 'likert',
    prompt: text,
    options: LIKERT,
    trait,
    key,
  }));
}

/** answers: value 0–4 per question. Returns 0–100 per trait. */
export function scoreTraits(questions, answers) {
  const sums = {};
  const counts = {};
  questions.forEach((q) => {
    const v = answers[q.id];
    if (v == null) return;
    const scored = q.key === '+' ? v : 4 - v;
    sums[q.trait] = (sums[q.trait] || 0) + scored;
    counts[q.trait] = (counts[q.trait] || 0) + 1;
  });
  return Object.fromEntries(
    ['O', 'C', 'E', 'A', 'S']
      .filter((t) => counts[t])
      .map((t) => [t, Math.round((sums[t] / (counts[t] * 4)) * 100)]),
  );
}
