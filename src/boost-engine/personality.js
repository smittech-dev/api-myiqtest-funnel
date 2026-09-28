/**
 * Personality. Big Five statements answered on a five-point scale. There are
 * no right answers, so a level is "passed" by answering all twenty; each
 * level contributes four statements per trait, getting more nuanced as the
 * levels go up. `+` statements score directly, `-` statements are reversed.
 */

import { LIKERT, LIKERT_JA } from './meta.js';

// [trait, key, statement, 日本語] — four per trait, per level. The Japanese is
// written in the plain form Japanese inventories use, and keyed the same way:
// a `-` statement is still the reverse-scored one.
const BANK = {
  1: [
    ['O', '+', 'I enjoy trying new foods.', '新しい食べ物を試すのが好きだ。'],
    ['O', '-', 'I like to stick to what I know.', '慣れ親しんだものから離れたくない。'],
    ['O', '+', 'I enjoy art and music.', '芸術や音楽を楽しむ。'],
    ['O', '+', 'I have a vivid imagination.', '想像力が豊かなほうだ。'],
    ['C', '+', 'I keep my things tidy.', '持ち物をきちんと整理している。'],
    ['C', '-', 'I often forget where I put things.', '物をどこに置いたか、よく忘れる。'],
    ['C', '+', 'I finish the tasks I start.', '始めたことは最後までやり遂げる。'],
    ['C', '+', 'I plan my day ahead.', '一日の予定を前もって立てる。'],
    ['E', '+', 'I enjoy meeting new people.', '新しい人に会うのが楽しい。'],
    ['E', '-', 'I prefer to spend time alone.', '一人で過ごすほうが好きだ。'],
    ['E', '+', 'I talk a lot in groups.', '大勢でいるとよく話すほうだ。'],
    ['E', '+', 'I feel energised at parties.', 'パーティーに出ると元気が湧いてくる。'],
    ['A', '+', 'I am kind to others.', '人に親切にしている。'],
    ['A', '-', 'I get into arguments often.', '人と言い争いになることが多い。'],
    ['A', '+', 'I like helping people.', '人の役に立つのが好きだ。'],
    ['A', '+', 'I trust people easily.', 'すぐに人を信用するほうだ。'],
    ['S', '+', 'I stay calm under pressure.', 'プレッシャーの中でも落ち着いていられる。'],
    ['S', '-', 'I worry a lot.', '心配事が多い。'],
    ['S', '+', 'I rarely feel low.', '気分が落ち込むことはめったにない。'],
    ['S', '-', 'I get upset easily.', 'すぐに動揺してしまう。'],
  ],
  2: [
    ['O', '+', 'I am curious about how things work.', '物事の仕組みに興味がある。'],
    ['O', '-', 'I find abstract ideas uninteresting.', '抽象的な考えには興味がわかない。'],
    ['O', '+', 'I like visiting places I have never been.', '行ったことのない場所を訪れるのが好きだ。'],
    ['O', '-', 'I prefer routine to variety.', '変化よりも決まった習慣のほうが好きだ。'],
    ['C', '+', 'I pay attention to details.', '細かい点にまで気を配る。'],
    ['C', '-', 'I leave chores until the last minute.', '用事をぎりぎりまで先延ばしにする。'],
    ['C', '+', 'I like to follow a schedule.', 'スケジュールどおりに進めるのが好きだ。'],
    ['C', '-', 'I often make careless mistakes.', 'うっかりミスをすることが多い。'],
    ['E', '+', 'I start conversations easily.', '自分から気軽に話しかけられる。'],
    ['E', '-', 'I stay in the background at social events.', '人の集まりでは目立たないようにしている。'],
    ['E', '+', 'I like being the centre of attention.', '注目の的になるのが好きだ。'],
    ['E', '-', 'I find large groups tiring.', '大人数の集まりは疲れる。'],
    ['A', '+', "I take other people's feelings into account.", '人の気持ちを考えて行動する。'],
    ['A', '-', 'I can be critical of others.', '人に対して批判的になることがある。'],
    ['A', '+', 'I forgive people quickly.', '人をすぐに許せる。'],
    ['A', '-', 'I put my own needs first.', '自分の都合を優先してしまう。'],
    ['S', '+', 'I recover quickly from setbacks.', 'つまずいても、すぐに立ち直れる。'],
    ['S', '-', 'I often feel nervous.', '緊張することがよくある。'],
    ['S', '+', 'I handle criticism well.', '批判をうまく受け止められる。'],
    ['S', '-', 'My mood changes often.', '気分がよく変わる。'],
  ],
  3: [
    ['O', '+', 'I enjoy thinking about philosophical questions.', '哲学的な問いについて考えるのが好きだ。'],
    ['O', '-', 'I rarely notice the beauty around me.', '身の回りの美しさに気づくことはあまりない。'],
    ['O', '+', 'I seek out opinions that differ from mine.', '自分とは異なる意見に、あえて耳を傾ける。'],
    ['O', '-', 'I avoid unfamiliar situations when I can.', 'なじみのない状況は、できるだけ避ける。'],
    ['C', '+', 'I set goals and work steadily toward them.', '目標を立て、それに向けてこつこつ取り組む。'],
    ['C', '-', 'I get distracted from my work easily.', '作業中に気が散りやすい。'],
    ['C', '+', 'I prepare thoroughly before important events.', '大事な場面の前には入念に準備する。'],
    ['C', '-', 'I act first and think later.', '考えるより先に行動してしまう。'],
    ['E', '+', 'I speak up readily in meetings.', '会議では進んで発言する。'],
    ['E', '-', 'I need quiet time to recharge after socialising.', '人と過ごしたあとは、一人の時間で回復する必要がある。'],
    ['E', '+', 'I make friends quickly.', 'すぐに友達ができる。'],
    ['E', '-', 'I keep my thoughts to myself.', '自分の考えは胸にしまっておくほうだ。'],
    ['A', '+', "I try to see things from other people's point of view.", '相手の立場に立って物事を見ようとする。'],
    ['A', '-', 'I enjoy winning an argument more than finding agreement.', '合意点を探すより、議論で勝つほうが楽しい。'],
    ['A', '+', 'I go out of my way to make others comfortable.', '周りの人が心地よく過ごせるよう、手間を惜しまない。'],
    ['A', '-', "I am suspicious of people's motives.", '人の動機を疑ってしまう。'],
    ['S', '+', 'I stay relaxed when plans change suddenly.', '予定が急に変わっても、落ち着いていられる。'],
    ['S', '-', 'I dwell on my mistakes.', '自分の失敗をいつまでも引きずる。'],
    ['S', '+', 'I feel secure in who I am.', 'ありのままの自分に自信を持っている。'],
    ['S', '-', 'Small problems can ruin my day.', 'ささいな問題で一日が台無しになることがある。'],
  ],
  4: [
    ['O', '+', 'I am drawn to complex, unconventional ideas.', '複雑で型破りなアイデアに惹かれる。'],
    ['O', '-', 'I trust tradition more than experimentation.', '新しい試みよりも伝統を信頼する。'],
    ['O', '+', 'I lose track of time exploring a new subject.', '新しい分野を探究していると、時間を忘れてしまう。'],
    ['O', '-', 'I find poetry hard to connect with.', '詩にはなかなか共感できない。'],
    ['C', '+', 'I keep going on long tasks even when they become dull.', '長い作業が退屈になっても、やり続けられる。'],
    ['C', '-', 'I make promises I later struggle to keep.', 'あとで守るのに苦労する約束をしてしまう。'],
    ['C', '+', 'I break big goals into small, trackable steps.', '大きな目標は、進み具合を確かめられる小さな段階に分ける。'],
    ['C', '-', 'I often start projects I never finish.', '始めたものの、終わらせずに投げ出すことが多い。'],
    ['E', '+', 'I enjoy taking the lead in group activities.', 'グループ活動でリーダー役を務めるのが楽しい。'],
    ['E', '-', 'I would rather listen than talk.', '話すより聞くほうが好きだ。'],
    ['E', '+', 'I seek out lively, busy environments.', 'にぎやかで活気のある場所を好んで選ぶ。'],
    ['E', '-', 'I feel uneasy introducing myself to strangers.', '知らない人に自己紹介するのは落ち着かない。'],
    ['A', '+', 'I compromise readily to keep the peace.', '場を丸く収めるためなら、すすんで歩み寄る。'],
    ['A', '-', "I find it hard to sympathise with others' problems.", '他人の悩みに共感するのは難しいと感じる。'],
    ['A', '+', 'I give credit to others generously.', '手柄は惜しみなく人に譲る。'],
    ['A', '-', 'I hold grudges for a long time.', '恨みをいつまでも忘れない。'],
    ['S', '+', 'I keep a clear head in emergencies.', '緊急時にも冷静さを保てる。'],
    ['S', '-', 'I feel overwhelmed by my responsibilities.', '自分の責任の重さに押しつぶされそうになる。'],
    ['S', '+', 'I can put worries aside to focus.', '心配事をいったん脇に置いて集中できる。'],
    ['S', '-', 'I often feel irritated for no clear reason.', 'はっきりした理由もなくイライラすることが多い。'],
  ],
  5: [
    ['O', '+', 'I enjoy revising my views when the evidence changes.', '根拠が変われば、自分の考えを見直すことを楽しめる。'],
    ['O', '-', 'Ambiguity makes me uncomfortable rather than curious.', 'あいまいな状況には、好奇心よりも居心地の悪さを覚える。'],
    ['O', '+', 'I am comfortable holding two conflicting ideas at once.', '相反する2つの考えを同時に抱えていても平気だ。'],
    ['O', '-', 'I see little value in questioning how things are usually done.', '物事の従来のやり方を疑うことに、あまり価値を感じない。'],
    ['C', '+', 'I hold myself to high standards even when no one is checking.', '誰も見ていなくても、自分に高い基準を課す。'],
    ['C', '-', 'I rely on last-minute effort rather than steady progress.', 'こつこつ進めるより、直前の追い込みに頼りがちだ。'],
    ['C', '+', 'I weigh long-term consequences over short-term rewards.', '目先の見返りより、長期的な結果を重視する。'],
    ['C', '-', 'I find it hard to resist immediate temptations.', '目の前の誘惑に抗うのは難しい。'],
    ['E', '+', 'I think best when talking ideas through with others.', '人と話し合いながら考えると、いちばん頭がはたらく。'],
    ['E', '-', 'I prefer depth with a few people to breadth with many.', '大勢と広く付き合うより、少数の人と深く付き合いたい。'],
    ['E', '+', 'I look for chances to perform or present.', '人前で披露したり発表したりする機会を探す。'],
    ['E', '-', 'Long stretches of social contact leave me drained.', '長時間人と接していると、ぐったりしてしまう。'],
    ['A', '+', 'I stay patient with people who frustrate me.', '苛立たせる相手にも、辛抱強く接する。'],
    ['A', '-', 'I use others when it serves my goals.', '自分の目的のためなら、人を利用することもある。'],
    ['A', '+', 'I assume good intentions until shown otherwise.', 'そうでないと分かるまでは、相手の善意を前提にする。'],
    ['A', '-', "I am quick to point out others' mistakes.", '人の間違いをすぐに指摘してしまう。'],
    ['S', '+', 'Uncertainty rarely keeps me up at night.', '先行きの不安で眠れなくなることはめったにない。'],
    ['S', '-', 'I replay difficult conversations long after they end.', 'つらい会話を、終わったあともずっと頭の中で繰り返す。'],
    ['S', '+', 'I can feel strong emotions without being ruled by them.', '強い感情を抱いても、それに振り回されずにいられる。'],
    ['S', '-', 'I tend to expect things to go wrong.', '物事はうまくいかないだろうと考えがちだ。'],
  ],
};

/** Personality levels are a fixed set of 20 statements in shuffled order. */
export function personalitySet(r, level) {
  return r.shuffle(BANK[level]).map(([trait, key, text, ja]) => ({
    type: 'likert',
    prompt: text,
    options: LIKERT,
    trait,
    key,
    l10n: { ja: { prompt: ja, options: LIKERT_JA } },
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
