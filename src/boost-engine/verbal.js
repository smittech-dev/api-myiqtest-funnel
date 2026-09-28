import { bi, choice, rng } from './util.js';

/**
 * Verbal reasoning. Hand-written banks, tiered by vocabulary difficulty. Each
 * level draws 20 questions from roughly fifty items, so retries rarely repeat.
 *
 * Every bank has a Japanese twin of exactly the same shape, entry for entry.
 * The twins are not translations — "big/large" does not survive the trip — but
 * native items of the same kind and a matching difficulty: 類義語 and 対義語
 * from everyday words at level 1 up to 漢検-grade 熟語 at level 5, analogies,
 * 仲間外れ, and kana anagrams. The draws are always made on the English bank
 * and the Japanese is read from the same position, so both languages get the
 * same question with the answer in the same place.
 *
 * Where an English headword appears in both the synonym and the antonym bank
 * of a level (brave → courageous / cowardly), its opposite is used as a trap
 * option. The Japanese banks share headwords at exactly those positions
 * (勇敢 → 勇ましい / 臆病), so the trap is a real one in both languages.
 * `npm run check:boost` holds all of this in place.
 */

const SYN = {
  1: [['big', 'large'], ['happy', 'glad'], ['fast', 'quick'], ['begin', 'start'], ['finish', 'end'], ['shut', 'close'], ['clever', 'smart'], ['angry', 'cross'], ['simple', 'easy'], ['wealthy', 'rich'], ['gift', 'present'], ['story', 'tale'], ['shout', 'yell'], ['near', 'nearby'], ['choose', 'pick'], ['sleepy', 'tired']],
  2: [['brave', 'courageous'], ['ancient', 'old'], ['allow', 'permit'], ['reply', 'answer'], ['purchase', 'buy'], ['damp', 'moist'], ['error', 'mistake'], ['enormous', 'huge'], ['repair', 'fix'], ['conceal', 'hide'], ['loyal', 'faithful'], ['rapid', 'swift'], ['weary', 'exhausted'], ['gather', 'collect'], ['vanish', 'disappear'], ['fragile', 'delicate']],
  3: [['abundant', 'plentiful'], ['candid', 'frank'], ['diligent', 'hardworking'], ['eloquent', 'articulate'], ['frugal', 'thrifty'], ['hostile', 'unfriendly'], ['imminent', 'impending'], ['lucid', 'clear'], ['meticulous', 'thorough'], ['obscure', 'unclear'], ['prudent', 'sensible'], ['reluctant', 'unwilling'], ['serene', 'tranquil'], ['tedious', 'boring'], ['vivid', 'bright'], ['zealous', 'enthusiastic']],
  4: [['ambiguous', 'equivocal'], ['benign', 'harmless'], ['cogent', 'convincing'], ['deleterious', 'harmful'], ['ephemeral', 'fleeting'], ['fastidious', 'fussy'], ['garrulous', 'talkative'], ['insipid', 'bland'], ['lethargic', 'sluggish'], ['mitigate', 'lessen'], ['ostentatious', 'showy'], ['pragmatic', 'practical'], ['reticent', 'reserved'], ['spurious', 'false'], ['tenacious', 'persistent'], ['ubiquitous', 'everywhere']],
  5: [['obsequious', 'servile'], ['perfidious', 'treacherous'], ['pusillanimous', 'cowardly'], ['recalcitrant', 'defiant'], ['sagacious', 'wise'], ['sycophant', 'flatterer'], ['truculent', 'aggressive'], ['vituperative', 'abusive'], ['laconic', 'terse'], ['magnanimous', 'generous'], ['nefarious', 'wicked'], ['obdurate', 'stubborn'], ['parsimonious', 'stingy'], ['quixotic', 'idealistic'], ['inchoate', 'undeveloped'], ['esoteric', 'obscure']],
};

const SYN_JA = {
  1: [['美しい', 'きれいな'], ['うれしい', '喜ばしい'], ['速い', 'すばやい'], ['始める', '開始する'], ['終える', '済ませる'], ['閉じる', '閉める'], ['かしこい', '利口な'], ['怒る', '腹を立てる'], ['簡単な', 'たやすい'], ['裕福な', '金持ちの'], ['贈り物', 'プレゼント'], ['物語', 'お話'], ['叫ぶ', 'わめく'], ['近所', '付近'], ['選ぶ', '選択する'], ['疲れる', 'くたびれる']],
  2: [['勇敢', '勇ましい'], ['古風', '昔ながら'], ['許可', '許し'], ['返事', '返答'], ['購入', '買い入れ'], ['準備', '用意'], ['誤り', '間違い'], ['永遠', '永久'], ['修理', '修繕'], ['欠点', '短所'], ['方法', '手段'], ['意外', '案外'], ['特徴', '特色'], ['役目', '任務'], ['消滅', '消失'], ['用心', '注意']],
  3: [['豊富', '潤沢'], ['慎重', '用心深い'], ['勤勉', 'まじめ'], ['雄弁', '能弁'], ['倹約', '節約'], ['敵対', '反目'], ['切迫', '緊迫'], ['明快', '明瞭'], ['綿密', '緻密'], ['曖昧', '漠然'], ['賢明', '利口'], ['渋々', 'いやいや'], ['平穏', '安穏'], ['退屈', '単調'], ['著名', '有名'], ['熱中', '没頭']],
  4: [['玉虫色', 'どっちつかず'], ['温厚', '温和'], ['了解', '承知'], ['弊害', '害悪'], ['刹那的', '一時的'], ['几帳面', '律儀'], ['饒舌', '多弁'], ['平凡', '月並み'], ['緩慢', '鈍重'], ['緩和', '軽減'], ['華美', '派手'], ['実利的', '現実的'], ['控えめ', '遠慮がち'], ['虚偽', '偽り'], ['執拗', 'しつこい'], ['懸命', '必死']],
  5: [['慇懃', '丁重'], ['背信', '裏切り'], ['看過', '黙認'], ['反抗', '抵抗'], ['聡明', '英明'], ['杞憂', '取り越し苦労'], ['好戦的', '攻撃的'], ['瑕疵', '欠陥'], ['訥弁', '口下手'], ['寛大', '寛容'], ['払拭', '一掃'], ['狷介', '偏屈'], ['吝嗇', 'けち'], ['逡巡', 'ためらい'], ['嚆矢', '先駆け'], ['難解', '晦渋']],
};

const ANT = {
  1: [['hot', 'cold'], ['early', 'late'], ['full', 'empty'], ['open', 'closed'], ['win', 'lose'], ['light', 'dark'], ['old', 'new'], ['push', 'pull'], ['day', 'night'], ['wet', 'dry'], ['first', 'last'], ['above', 'below']],
  2: [['generous', 'selfish'], ['accept', 'refuse'], ['arrive', 'depart'], ['ancient', 'modern'], ['brave', 'cowardly'], ['expand', 'shrink'], ['humble', 'proud'], ['include', 'exclude'], ['maximum', 'minimum'], ['rough', 'smooth'], ['strict', 'lenient'], ['victory', 'defeat']],
  3: [['abundant', 'scarce'], ['benevolent', 'malevolent'], ['candid', 'evasive'], ['conceal', 'reveal'], ['diligent', 'lazy'], ['frugal', 'extravagant'], ['hostile', 'friendly'], ['optimist', 'pessimist'], ['praise', 'criticise'], ['temporary', 'permanent'], ['transparent', 'opaque'], ['vague', 'precise']],
  4: [['ephemeral', 'enduring'], ['garrulous', 'taciturn'], ['lethargic', 'energetic'], ['mitigate', 'aggravate'], ['ostentatious', 'modest'], ['reticent', 'forthcoming'], ['benign', 'malignant'], ['verbose', 'concise'], ['novice', 'veteran'], ['affluent', 'impoverished'], ['zenith', 'nadir'], ['tenacious', 'yielding']],
  5: [['laconic', 'loquacious'], ['magnanimous', 'petty'], ['parsimonious', 'lavish'], ['sagacious', 'foolish'], ['obsequious', 'domineering'], ['truculent', 'conciliatory'], ['esoteric', 'accessible'], ['perfidious', 'loyal'], ['recalcitrant', 'compliant'], ['ebullient', 'subdued'], ['prolix', 'succinct'], ['venerate', 'despise']],
};

const ANT_JA = {
  1: [['暑い', '寒い'], ['早い', '遅い'], ['多い', '少ない'], ['入る', '出る'], ['勝つ', '負ける'], ['明るい', '暗い'], ['古い', '新しい'], ['押す', '引く'], ['昼', '夜'], ['濡れる', '乾く'], ['最初', '最後'], ['上', '下']],
  2: [['利益', '損失'], ['承諾', '拒否'], ['出発', '到着'], ['古風', '現代的'], ['勇敢', '臆病'], ['拡大', '縮小'], ['謙虚', '傲慢'], ['加入', '脱退'], ['最大', '最小'], ['複雑', '単純'], ['厳格', '寛容'], ['勝利', '敗北']],
  3: [['豊富', '欠乏'], ['善意', '悪意'], ['慎重', '軽率'], ['隠蔽', '暴露'], ['勤勉', '怠惰'], ['倹約', '浪費'], ['敵対', '友好'], ['楽観', '悲観'], ['称賛', '非難'], ['一時的', '恒久的'], ['具体', '抽象'], ['分析', '総合']],
  4: [['刹那的', '永続的'], ['饒舌', '寡黙'], ['緩慢', '迅速'], ['緩和', '緊張'], ['華美', '質素'], ['控えめ', '出しゃばり'], ['温厚', '粗暴'], ['冗長', '簡潔'], ['素人', '玄人'], ['富裕', '貧困'], ['絶頂', 'どん底'], ['執拗', '淡泊']],
  5: [['訥弁', '能弁'], ['寛大', '狭量'], ['吝嗇', '鷹揚'], ['聡明', '暗愚'], ['慇懃', '無礼'], ['好戦的', '融和的'], ['難解', '平易'], ['背信', '忠誠'], ['反抗', '服従'], ['意気軒昂', '意気消沈'], ['冗漫', '簡明'], ['崇敬', '侮蔑']],
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

// Kanji give the game away when the answer sits inside the clue (解熱剤 → 熱),
// so the Japanese analogies avoid pairs whose answer is written in the question.
const ANALOGY_JA = {
  1: [
    ['子犬 : 犬 = 子猫 : ?', '猫', ['牛', 'ライオン', 'ねずみ']],
    ['手 : 手袋 = 足 : ?', '靴下', ['帽子', '指輪', 'ベルト']],
    ['鳥 : 空 = 魚 : ?', '海', ['森', '砂漠', '雲']],
    ['熱い : 冷たい = 高い : ?', '低い', ['大きい', '広い', '長い']],
    ['目 : 見る = 耳 : ?', '聞く', ['かぐ', '話す', 'さわる']],
    ['牛 : 牛乳 = ニワトリ : ?', '卵', ['羽', '農場', 'ひよこ']],
  ],
  2: [
    ['作家 : 小説 = 作曲家 : ?', '交響曲', ['絵画', '彫刻', '詩']],
    ['温度計 : 温度 = はかり : ?', '重さ', ['長さ', '速さ', '時間']],
    ['医者 : 病院 = 教師 : ?', '学校', ['会社', '図書館', '駅']],
    ['ペン : 書く = ナイフ : ?', '切る', ['焼く', '食べる', '研ぐ']],
    ['花びら : 花 = ページ : ?', '本', ['文字', '木', '紙']],
    ['水 : のどの渇き = 食べ物 : ?', '空腹', ['味', '食事', '皿']],
  ],
  3: [
    ['初心者 : 熟練者 = 見習い : ?', '師匠', ['生徒', '労働者', '教師']],
    ['干ばつ : 雨 = 飢饉 : ?', '食料', ['水', '作物', '空腹']],
    ['大工 : のこぎり = 外科医 : ?', 'メス', ['病院', '患者', '看護師']],
    ['群島 : 島 = 星座 : ?', '星', ['惑星', '空', '銀河']],
    ['ひれ : 魚 = 翼 : ?', '鳥', ['羽根', '空', '飛行']],
    ['守銭奴 : お金 = 大食漢 : ?', '食べ物', ['財産', '欲', '睡眠']],
  ],
  4: [
    ['症状 : 診断 = 手がかり : ?', '推理', ['犯罪', '探偵', '証拠']],
    ['味気ない : 風味 = 単調 : ?', '変化', ['音', '声', '退屈']],
    ['序幕 : 芝居 = 序文 : ?', '書物', ['結末', '著者', '章']],
    ['編集者 : 雑誌 = 監督 : ?', '映画', ['俳優', '脚本', '観客']],
    ['巣箱 : ミツバチ = 厩舎 : ?', '馬', ['牛', '羊', '豚']],
    ['ワクチン : 感染 = 堤防 : ?', '洪水', ['干ばつ', '地震', '渋滞']],
  ],
  5: [
    ['貨幣学 : 硬貨 = 郵趣 : ?', '切手', ['地図', '本', '蝶']],
    ['追従者 : お世辞 = ほら吹き : ?', '自慢', ['うそ', '勇気', '謙遜']],
    ['鎮痛剤 : 痛み = 抗生物質 : ?', '細菌', ['ウイルス', 'がん', '花粉']],
    ['窮乏 : 富 = 蒙昧 : ?', '知恵', ['貧困', '至福', '愚かさ']],
    ['天文学 : 天体 = 地質学 : ?', '岩石', ['気象', '生物', '海流']],
    ['師走 : 12月 = 弥生 : ?', '3月', ['2月', '4月', '5月']],
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

// The odd word sits at the same position as in the English entry.
const ODD_JA = {
  1: [
    [['りんご', 'バナナ', 'にんじん', 'ぶどう'], 'にんじん', 'ほかは果物です。'],
    [['赤', '青', '緑', '丸'], '丸', 'ほかは色です。'],
    [['犬', '猫', 'バラ', '馬'], 'バラ', 'ほかは動物です。'],
    [['いす', 'テーブル', 'ソファ', 'スプーン'], 'スプーン', 'ほかは家具です。'],
    [['月曜日', '金曜日', '三月', '日曜日'], '三月', 'ほかは曜日です。'],
    [['ピアノ', 'ギター', '太鼓', 'ほうき'], 'ほうき', 'ほかは楽器です。'],
  ],
  2: [
    [['銅', '銀', '鉄', '大理石'], '大理石', 'ほかは金属です。'],
    [['バイオリン', 'チェロ', 'フルート', 'ハープ'], 'フルート', 'ほかは弦楽器です。'],
    [['火星', '金星', '月', '木星'], '月', 'ほかは惑星です。'],
    [['正方形', '三角形', '立方体', '円'], '立方体', 'ほかは平面図形です。'],
    [['ささやく', 'つぶやく', 'ぼそぼそ話す', '叫ぶ'], '叫ぶ', 'ほかは小さな声で話すことです。'],
    [['ワシ', 'ペンギン', 'スズメ', 'タカ'], 'ペンギン', 'ほかは空を飛べます。'],
  ],
  3: [
    [['俳句', '短歌', '川柳', '小説'], '小説', 'ほかは詩歌の形式です。'],
    [['チーター', 'ヒョウ', 'ジャガー', 'ハイエナ'], 'ハイエナ', 'ほかはネコ科の大型動物です。'],
    [['ナイル', 'アマゾン', 'サハラ', 'ドナウ'], 'サハラ', 'ほかは川の名前です。'],
    [['冷酷', '薄情', '慈悲深い', '残忍'], '慈悲深い', 'ほかは「思いやりがない」という意味です。'],
    [['インチ', 'メートル', 'リットル', 'マイル'], 'リットル', 'ほかは長さの単位です。'],
    [['酸素', '窒素', '水', 'ヘリウム'], '水', 'ほかは元素です。'],
  ],
  4: [
    [['刹那的', '一時的', '束の間', '恒久的'], '恒久的', 'ほかは「短い間だけ」という意味です。'],
    [['積雲', '層雲', '巻雲', '溶岩'], '溶岩', 'ほかは雲の種類です。'],
    [['水星', '海王星', '冥王星', '土星'], '冥王星', 'ほかは太陽系の惑星です（冥王星は準惑星）。'],
    [['ソナタ', '協奏曲', '交響曲', '彫刻'], '彫刻', 'ほかは音楽の形式です。'],
    [['綿密', '周到', '杜撰', '入念'], '杜撰', 'ほかは「注意深い」という意味です。'],
    [['六角形', '八角形', '五角形', '球'], '球', 'ほかは多角形です。'],
  ],
  5: [
    [['簡潔', '簡明', '端的', '冗長'], '冗長', 'ほかは「短く要点をついた」という意味です。'],
    [['モーツァルト', 'ベートーヴェン', 'バッハ', 'レンブラント'], 'レンブラント', 'ほかは作曲家です。'],
    [['夏目漱石', '芥川龍之介', '太宰治', '葛飾北斎'], '葛飾北斎', 'ほかは小説家です。'],
    [['能', '狂言', '歌舞伎', '浮世絵'], '浮世絵', 'ほかは日本の伝統的な舞台芸術です。'],
    [['臆病', '小心', '弱気', '豪胆'], '豪胆', 'ほかは「気が小さい」という意味です。'],
    [['正弦', '余弦', '正接', '整数'], '整数', 'ほかは三角関数です。'],
  ],
};

const ANAGRAM = {
  1: ['bird', 'cake', 'frog', 'milk', 'rain', 'ship', 'tree', 'wolf', 'lamp', 'moon', 'sand', 'desk'],
  2: ['plant', 'storm', 'grape', 'chair', 'beach', 'cloud', 'tiger', 'dream', 'brick', 'flame', 'horse', 'piano'],
  3: ['garden', 'planet', 'silver', 'frozen', 'castle', 'monkey', 'orange', 'bridge', 'winter', 'pencil', 'rocket', 'candle'],
  4: ['library', 'diamond', 'captain', 'harvest', 'blanket', 'chicken', 'kitchen', 'pumpkin', 'whisper', 'journey', 'penguin', 'crystal'],
  5: ['elephant', 'mountain', 'treasure', 'calendar', 'dinosaur', 'festival', 'hospital', 'platform', 'keyboard', 'triangle', 'umbrella', 'vacation'],
};

// Kana words, three to seven characters by level. Each was checked for a
// rearrangement that spells another common word (りんご → ごりん, きつね →
// ねつき), and those were left out. No small kana or long-vowel marks: a lone
// ょ or ー cannot sit anywhere in a scramble and still look like a letter.
const ANAGRAM_JA = {
  1: ['さくら', 'ぶどう', 'つくえ', 'たまご', 'かえる', 'うさぎ', 'すずめ', 'いちご', 'めがね', 'コアラ', 'てがみ', 'くじら'],
  2: ['ひまわり', 'ふうせん', 'えんぴつ', 'かみなり', 'おにぎり', 'てぶくろ', 'はなたば', 'すなはま', 'あさがお', 'とびばこ', 'みずうみ', 'しおかぜ'],
  3: ['かたつむり', 'ゆきだるま', 'こいのぼり', 'ぬいぐるみ', 'ひなまつり', 'たからもの', 'せんぷうき', 'すべりだい', 'かざぐるま', 'わすれもの', 'ながれぼし', 'さくらんぼ'],
  4: ['てんとうむし', 'ほうれんそう', 'とうもろこし', 'せんたくもの', 'すいぞくかん', 'まほうつかい', 'しんかんせん', 'ひこうきぐも', 'うんどうかい', 'かみなりぐも', 'ゆうやけぞら', 'かいすいよく'],
  5: ['てるてるぼうず', 'むぎわらぼうし', 'たなばたまつり', 'はなびたいかい', 'みずたまもよう', 'いちごだいふく', 'せみのぬけがら', 'プラネタリウム', 'おべんとうばこ', 'さつまいもほり', 'えだまめごはん', 'たけのこごはん'],
};

export const VERBAL_BANKS = { SYN, SYN_JA, ANT, ANT_JA, ANALOGY, ANALOGY_JA, ODD, ODD_JA, ANAGRAM, ANAGRAM_JA };

/** Positions rather than entries, so the Japanese can be read off the same draw. */
const positions = (arr) => arr.map((_, i) => i);

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
    const bank = SYN[level];
    const i = r.pick(positions(bank));
    const [word, syn] = bank[i];
    const [wordJa, synJa] = SYN_JA[level][i];
    const t = ANT[level].findIndex(([w]) => w === word);
    const trap = t < 0 ? undefined : bi(ANT[level][t][1], ANT_JA[level][t][1]);
    const others = positions(bank).filter((k) => bank[k][0] !== word);
    return choice(r, {
      prompt: bi(`Which word is closest in meaning to “${word}”?`, `「${wordJa}」に最も意味が近い言葉はどれですか？`),
      answer: bi(syn, synJa),
      distractors: [trap, ...r.sample(others, 4).map((k) => bi(bank[k][1], SYN_JA[level][k][1]))],
      explain: bi(`“${word}” and “${syn}” mean nearly the same thing.`, `「${wordJa}」と「${synJa}」はほぼ同じ意味です。`),
    });
  },

  antonym(r, level) {
    const bank = ANT[level];
    const i = r.pick(positions(bank));
    const [word, ant] = bank[i];
    const [wordJa, antJa] = ANT_JA[level][i];
    const t = SYN[level].findIndex(([w]) => w === word);
    const trap = t < 0 ? undefined : bi(SYN[level][t][1], SYN_JA[level][t][1]);
    const others = positions(bank).filter((k) => bank[k][0] !== word);
    return choice(r, {
      prompt: bi(
        `Which word is most nearly opposite in meaning to “${word}”?`,
        `「${wordJa}」と反対の意味に最も近い言葉はどれですか？`,
      ),
      answer: bi(ant, antJa),
      distractors: [trap, ...r.sample(others, 4).map((k) => bi(bank[k][1], ANT_JA[level][k][1]))],
      explain: bi(`“${ant}” is the opposite of “${word}”.`, `「${antJa}」は「${wordJa}」の反対の意味です。`),
    });
  },

  analogy(r, level) {
    const bank = ANALOGY[level];
    const i = r.pick(positions(bank));
    const [q, a, wrong] = bank[i];
    const [qJa, aJa, wrongJa] = ANALOGY_JA[level][i];
    return choice(r, {
      prompt: bi('Complete the analogy.', '同じ関係になるように、「?」に入る言葉を選んでください。'),
      stimulus: { kind: 'seq', items: [bi(q, qJa)] },
      answer: bi(a, aJa),
      distractors: wrong.map((w, k) => bi(w, wrongJa[k])),
      explain: bi(`${q.replace('?', a)}.`, qJa.replace('?', aJa)),
    });
  },

  odd(r, level) {
    const bank = ODD[level];
    const i = r.pick(positions(bank));
    const [items, odd, why] = bank[i];
    const [itemsJa, oddJa, whyJa] = ODD_JA[level][i];
    const both = items.map((w, k) => bi(w, itemsJa[k]));
    const at = items.indexOf(odd);
    return choice(r, {
      prompt: bi(
        `Which word does not belong: ${items.join(', ')}?`,
        `仲間外れの言葉はどれですか？（${itemsJa.join('、')}）`,
      ),
      answer: both[at],
      distractors: both.filter((_, k) => k !== at),
      explain: bi(`${odd} — ${why}`, `「${oddJa}」― ${whyJa}`),
    });
  },

  anagram(r, level) {
    const bank = ANAGRAM[level];
    const i = r.pick(positions(bank));
    const word = bank[i];
    const wordJa = ANAGRAM_JA[level][i];
    const others = positions(bank).filter((k) => bank[k] !== word);
    // Same draws, in the same order, as before this was bilingual.
    const shown = scramble(r, word);
    const near = nearMisses(r, word, 2);
    const picked = r.sample(others, 3);
    // The Japanese word has its own letters to shuffle. Those draws come from a
    // stream seeded by the question itself, so the shared one is untouched.
    const jr = rng(`ja:${shown}:${wordJa}`);
    let shownJa;
    do shownJa = jr.shuffle([...wordJa]).join('');
    while (shownJa === wordJa);
    const nearJa = nearMisses(jr, wordJa, near.length);
    return choice(r, {
      prompt: bi('Unscramble these letters. Which real word do they spell?', '文字を並べ替えてできる言葉はどれですか？'),
      stimulus: { kind: 'seq', items: [bi(shown, shownJa)] },
      answer: bi(word, wordJa),
      distractors: [
        ...near.map((w, k) => bi(w, nearJa[k])),
        ...picked.map((k) => bi(bank[k], ANAGRAM_JA[level][k])),
      ],
      explain: bi(`The letters spell “${word}”.`, `並べ替えると「${wordJa}」になります。`),
    });
  },
};

const WEIGHTS = ['synonym', 'synonym', 'synonym', 'antonym', 'antonym', 'analogy', 'odd', 'anagram', 'anagram'];

export function verbal(r, level) {
  return T[r.pick(WEIGHTS)](r, level);
}
