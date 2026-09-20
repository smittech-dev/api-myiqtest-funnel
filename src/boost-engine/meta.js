/**
 * Boost My IQ metadata — safe to import from UI code.
 * Nothing here can be used to work out an answer; the generators and the
 * scoring live in index.js, which only the backend (or the mock) may load.
 */

export const QUESTIONS_PER_LEVEL = 20;
export const PASS_MARK = 16; // "more than 15 out of 20"

export const LEVELS = [
  { level: 1, name: 'Easy' },
  { level: 2, name: 'Medium' },
  { level: 3, name: 'Difficult' },
  { level: 4, name: 'Advanced' },
  { level: 5, name: 'Expert' },
];

export const CATEGORIES = [
  {
    key: 'memory',
    label: 'Memory',
    blurb: 'Memory and recall-based challenges',
    icon: 'memory',
    skills: ['Working memory', 'Short-term recall'],
  },
  {
    key: 'numerical',
    label: 'Numerical Reasoning',
    blurb: 'Numbers, calculations and quantitative logic',
    icon: 'numerical',
    skills: ['Mental arithmetic', 'Quantitative logic'],
  },
  {
    key: 'verbal',
    label: 'Verbal Reasoning',
    blurb: 'Words, language, comprehension and verbal logic',
    icon: 'verbal',
    skills: ['Vocabulary', 'Verbal logic'],
  },
  {
    key: 'pattern',
    label: 'Pattern Recognition',
    blurb: 'Sequences, patterns, shapes and visual reasoning',
    icon: 'pattern',
    skills: ['Inductive reasoning', 'Visual reasoning'],
  },
  {
    key: 'personality',
    label: 'Personality',
    blurb: 'Personality-related questions and assessments',
    icon: 'personality',
    skills: ['Self-insight'],
    unscored: true,
  },
  {
    key: 'attention',
    label: 'Attention & Focus',
    blurb: 'Concentration, observation and attention challenges',
    icon: 'attention',
    skills: ['Sustained attention', 'Visual scanning'],
  },
];

export const CATEGORY_BY_KEY = Object.fromEntries(CATEGORIES.map((c) => [c.key, c]));

export const TRAITS = {
  O: { label: 'Openness', high: 'curious and inventive', low: 'practical and consistent' },
  C: { label: 'Conscientiousness', high: 'organised and dependable', low: 'flexible and spontaneous' },
  E: { label: 'Extraversion', high: 'outgoing and energetic', low: 'reflective and reserved' },
  A: { label: 'Agreeableness', high: 'warm and cooperative', low: 'direct and challenging' },
  S: { label: 'Emotional stability', high: 'calm and resilient', low: 'sensitive and alert' },
};

export const LIKERT = ['Strongly disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly agree'];
