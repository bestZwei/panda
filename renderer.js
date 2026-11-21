const { ipcRenderer } = require('electron');

window.addEventListener('error', (event) => {
  console.error('RENDERER ERROR:', event.message, event.filename, event.lineno);
});
window.addEventListener('unhandledrejection', (event) => {
  console.error('RENDERER REJECTION:', event.reason && event.reason.message || event.reason);
});

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const petRoot = $('petRoot');
const pet = $('pet');
const bubble = $('bubble');
const fxLayer = $('fxLayer');
const menu = $('menu');
const panel = $('panel');
const wall = $('wall');
const chat = $('chat');
const about = $('about');
const growth = $('growth');
const toastEl = $('toast');

const STORAGE_KEY = 'pandaIncensePetState';
const ACHIEVEMENTS = [
  { id: 'firstClick', name: '初次上香', desc: '第一次触摸熊猫' },
  { id: 'doubleClick', name: '双击成灾', desc: '双击熊猫放出熊猫头' },
  { id: 'mutant', name: '变异熊猫', desc: '连点 10 次触发变异' },
  { id: 'feedAll', name: '三牲供奉', desc: '竹子、香、梗图各喂一次' },
  { id: 'fortune10', name: '十签成精', desc: '累计求签 10 次' },
  { id: 'rpsWin', name: '赢过熊猫', desc: '猜拳赢一次' },
  { id: 'swarm', name: '熊猫暴雨', desc: '触发熊猫暴雨彩蛋' },
  { id: 'fakeShutdown', name: '差点关机', desc: '触发系统关机彩蛋' },
  { id: 'blueScreen', name: '蓝屏受害者', desc: '触发蓝屏彩蛋' },
  { id: 'angerMe', name: '惹毛熊猫', desc: '故意惹熊猫生气' },
  { id: 'dailyStreak3', name: '三日香客', desc: '连续签到 3 天' },
  { id: 'dailyFortune', name: '每日一签', desc: '领取今日签' },
  { id: 'fortuneCollector', name: '签文收藏家', desc: '收藏全部签文' },
  { id: 'rpsBest3', name: '三局两胜', desc: '赢下一整局猜拳' },
  { id: 'themeSwitch', name: '换新装', desc: '切换一次熊猫主题' },
  { id: 'screenshot', name: '留此存照', desc: '保存一张熊猫明信片' },
  { id: 'firstChat', name: '开口说话', desc: '第一次和熊猫对话' },
  { id: 'bondFriend', name: '成为好友', desc: '亲密度达到 100' },
  { id: 'bondSouls', name: '心有灵犀', desc: '亲密度达到 300' },
  { id: 'tickles', name: '怕痒的熊猫', desc: '连续戳肚子 7 次' },
  { id: 'decision', name: '抉择时刻', desc: '让熊猫帮你做一次决定' },
  { id: 'level5', name: '初具道行', desc: '宠物等级达到 5 级' },
  { id: 'level10', name: '香火化身', desc: '宠物等级达到 10 级' }
];
const ACHIEVEMENT_MAP = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));

const FORTUNES = [
  { level: '上上签', text: '今晚不加班，香火灵验！' },
  { level: '上签', text: '摸鱼不会被老板发现。' },
  { level: '中签', text: '咖啡会刚好赶上没卖完。' },
  { level: '小吉', text: '三炷香保你 Wi-Fi 满格。' },
  { level: '安慰签', text: '香火有价，快乐无价。' }
];

// Pet progression. `exp` is cumulative; level is derived from these thresholds.
// Perks are real effects checked by the interaction code, not just labels.
const LEVELS = [
  { exp: 0, title: '香火学徒', perk: '基础互动全解锁' },
  { exp: 30, title: '闻香小童', perk: '投喂经验 +1' },
  { exp: 80, title: '拜年专员', perk: '主动搭话更频繁' },
  { exp: 150, title: '护香童子', perk: '签到额外香火 +2' },
  { exp: 240, title: '符咒实习生', perk: '决策经验 +2' },
  { exp: 360, title: '香火判官', perk: '求签经验 +2' },
  { exp: 520, title: '熊猫大仙', perk: '升级时回复更多心情' },
  { exp: 720, title: '赛博道长', perk: '聊天经验 +1' },
  { exp: 980, title: '香火护法', perk: '签到经验 +3' },
  { exp: 1300, title: '熊猫烧香本体', perk: '终极称号与专属光环' }
];

function levelFromExp(exp) {
  let level = 1;
  LEVELS.forEach((item, index) => {
    if (exp >= item.exp) level = index + 1;
  });
  return level;
}

function expProgress() {
  const current = LEVELS[state.level - 1] || LEVELS[0];
  const next = LEVELS[state.level] || null;
  if (!next) return { done: 1, need: 1, percent: 100, nextExp: current.exp };
  const span = next.exp - current.exp;
  const done = Math.max(0, Math.min(span, state.exp - current.exp));
  return { done, need: span, percent: Math.round(done / span * 100), nextExp: next.exp };
}

const DEFAULTS = {
  incense: 80,
  mood: 80,
  exp: 0,
  level: 1,
  lastSeen: Date.now(),
  achievements: {},
  stats: {
    clicks: 0,
    feeds: { bamboo: 0, incense: 0, meme: 0 },
    fortunes: 0,
    rpsWins: 0,
    rpsMatches: 0,
    checkinStreak: 0,
    checkinLast: '',
    headPats: 0,
    tickles: 0,
    chats: 0,
    decisions: 0
  },
  bond: 0,
  chat: { name: '', topic: '', history: [] },
  daily: { date: '', fortuneId: -1 },
  collection: [],
  settings: {
    scale: 1,
    opacity: 1,
    alwaysTop: true,
    passThrough: false,
    soundOn: true,
    soundFx: true,
    soundMusic: true,
    soundEgg: true,
    startup: false,
    prank: true,
    theme: 'classic',
    attention: true
  }
};

const clamp = (n, min = 0, max = 100) => Math.max(min, Math.min(max, n));
const copyDefaults = () => JSON.parse(JSON.stringify(DEFAULTS));
const safeNum = (value, fallback, min, max) => {
  const n = Number(value);
  return Number.isFinite(n) ? clamp(n, min, max) : fallback;
};
const safeBool = (value, fallback) => typeof value === 'boolean' ? value : fallback;

function autoRemove(el, ms = 3200) {
  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    el.remove();
  };
  el.addEventListener('animationend', remove);
  setTimeout(remove, ms);
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return copyDefaults();
    const parsed = JSON.parse(raw);
    const base = copyDefaults();
    const parsedStats = parsed.stats || {};
    const parsedDaily = parsed.daily || {};
    const parsedChat = parsed.chat || {};
    const result = {
      ...base,
      ...parsed,
      settings: { ...base.settings, ...(parsed.settings || {}) },
      // Only the 23 known achievement ids count, and only a literal true
      // unlocks one. A dirty save with strings/arrays used to inflate the
      // achievement counter without the wall showing those badges.
      achievements: Object.fromEntries(ACHIEVEMENTS.map((a) => [
        a.id,
        parsed.achievements && typeof parsed.achievements === 'object'
          ? parsed.achievements[a.id] === true
          : false
      ])),
      stats: {
        ...base.stats,
        ...parsedStats,
        feeds: { ...base.stats.feeds, ...(parsedStats.feeds || {}) }
      },
      chat: {
        ...base.chat,
        ...parsedChat,
        // A dirty save used to be able to put null / strings in history.
        // openChat() reads turn.me, so sanitize the shape here as well.
        history: Array.isArray(parsedChat.history)
          ? parsedChat.history
            .filter((turn) => turn && typeof turn === 'object' && !Array.isArray(turn))
            .map((turn) => ({
              me: typeof turn.me === 'string' ? turn.me.slice(0, 60) : '',
              panda: typeof turn.panda === 'string' ? turn.panda.slice(0, 200) : ''
            }))
            .filter((turn) => turn.me || turn.panda)
            .slice(-20)
          : []
      },
      daily: { ...base.daily, ...parsedDaily },
      // Old saves had no collection; keep any array of fortune ids.
      collection: Array.isArray(parsed.collection) ? [...new Set(parsed.collection)].slice(0, FORTUNES.length) : []
    };
    const s = result.settings;
    result.settings = {
      scale: safeNum(s.scale, 1, .7, 1.4),
      opacity: safeNum(s.opacity, 1, .4, 1),
      alwaysTop: safeBool(s.alwaysTop, true),
      passThrough: safeBool(s.passThrough, false),
      soundOn: safeBool(s.soundOn, true),
      soundFx: safeBool(s.soundFx, true),
      soundMusic: safeBool(s.soundMusic, true),
      soundEgg: safeBool(s.soundEgg, true),
      startup: safeBool(s.startup, false),
      prank: safeBool(s.prank, true),
      theme: ['classic', 'spring', 'cyber'].includes(s.theme) ? s.theme : 'classic',
      attention: safeBool(s.attention, true)
    };
    result.bond = safeNum(result.bond, 0, 0, 1000);
    result.stats.headPats = safeNum(result.stats.headPats, 0, 0, 1e9);
    result.stats.tickles = safeNum(result.stats.tickles, 0, 0, 1e9);
    result.stats.chats = safeNum(result.stats.chats, 0, 0, 1e9);
    result.stats.decisions = safeNum(result.stats.decisions, 0, 0, 1e9);
    result.chat.name = typeof result.chat.name === 'string' ? result.chat.name.slice(0, 20) : '';
    result.chat.topic = typeof result.chat.topic === 'string' ? result.chat.topic.slice(0, 40) : '';
    result.incense = safeNum(result.incense, 80, 0, 100);
    result.mood = safeNum(result.mood, 80, 0, 100);
    result.exp = safeNum(result.exp, 0, 0, 1e9);
    result.level = levelFromExp(result.exp);
    const clicks = safeNum(result.stats.clicks, 0, 0, 1e9);
    const fortunes = safeNum(result.stats.fortunes, 0, 0, 1e9);
    const rpsWins = safeNum(result.stats.rpsWins, 0, 0, 1e9);
    const rpsMatches = safeNum(result.stats.rpsMatches, 0, 0, 1e9);
    const checkinStreak = safeNum(result.stats.checkinStreak, 0, 0, 1e9);
    result.stats.clicks = clicks;
    result.stats.fortunes = fortunes;
    result.stats.rpsWins = rpsWins;
    result.stats.rpsMatches = rpsMatches;
    result.stats.checkinStreak = checkinStreak;
    result.stats.checkinLast = typeof result.stats.checkinLast === 'string' ? result.stats.checkinLast : '';
    result.daily.date = typeof result.daily.date === 'string' ? result.daily.date : '';
    result.daily.fortuneId = Number.isInteger(result.daily.fortuneId)
      ? Math.max(-1, Math.min(FORTUNES.length - 1, result.daily.fortuneId)) : -1;
    result.collection = result.collection.filter((n) => Number.isInteger(n) && n >= 0 && n < FORTUNES.length);
    ['bamboo', 'incense', 'meme'].forEach((k) => {
      result.stats.feeds[k] = safeNum(result.stats.feeds[k], 0, 0, 1e9);
    });
    const minutes = Math.max(0, (Date.now() - safeNum(result.lastSeen, Date.now(), 0, 1e15)) / 60000);
    result.incense = clamp(result.incense - Math.floor(minutes / 2));
    result.mood = clamp(result.mood - Math.floor(minutes / 3));
    return result;
  } catch (err) {
    return copyDefaults();
  }
}

let state = loadState();
let wasUnhappy = state.mood < 30;
let wasLowIncense = state.incense <= 0;
let bubbleTimer = null;
let toastTimer = null;
let clickTimer = null;
let clickCount = 0;
let idleTimer = null;
let idleFxTimer = null;
let audioCtx = null;
let danceTimer = null;
let mutantTimer = null;
let levelUpTimer = null;
let updateInfo = null;

function saveState() {
  state.lastSeen = Date.now();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    // Storage can be unavailable (full / blocked). The pet keeps working
    // in-memory instead of throwing on every interaction.
  }
}

function renderState() {
  $('incenseVal').textContent = Math.round(state.incense);
  $('moodVal').textContent = Math.round(state.mood);
  $('achievementVal').textContent = Object.keys(state.achievements).length;
  $('bondVal').textContent = Math.round(state.bond);
  $('chatVal').textContent = state.stats.chats;
  $('checkinVal').textContent = state.stats.checkinStreak;
  $('meterIncense').style.width = `${Math.round(state.incense)}%`;
  $('meterMood').style.width = `${Math.round(state.mood)}%`;
  $('meterIncenseVal').textContent = Math.round(state.incense);
  $('meterMoodVal').textContent = Math.round(state.mood);
  const progress = expProgress();
  $('meterExp').style.width = `${progress.percent}%`;
  $('meterExpVal').textContent = `Lv.${state.level}`;
  $('levelVal').textContent = state.level;
  $('expVal').textContent = state.exp;
  if (growth.classList.contains('show')) renderGrowth();
  stage.classList.toggle('low-incense', state.incense <= 0);
  $('rescue').classList.toggle('show', state.incense < 20);
  if ((state.incense <= 0) !== wasLowIncense) {
    wasLowIncense = state.incense <= 0;
    if (wasLowIncense) {
      toast('香火耗尽，快给熊猫添香！', 3000);
      beep(160, .2, 'sawtooth', .03);
    } else {
      toast('香火续上了', 1800);
      spawnSparkles();
    }
  }
  const unhappy = state.mood < 30;
  stage.classList.toggle('unhappy', unhappy);
  if (unhappy !== wasUnhappy) {
    wasUnhappy = unhappy;
    if (unhappy) {
      toast('熊猫不高兴了，小心它恶搞你', 3200);
      beep(200, .2, 'sawtooth', .03);
    } else {
      toast('熊猫消气了', 2200);
      beep(760, .1, 'sine', .035);
      spawnSparkles();
    }
  }
}

function unlock(id, name) {
  if (state.achievements[id]) return;
  state.achievements[id] = true;
  saveState();
  renderState();
  toast(`成就解锁：${name}`, 2600);
  const badge = document.createElement('div');
  badge.className = 'badge-fx';
  badge.textContent = `成就 · ${name}`;
  pet.appendChild(badge);
  autoRemove(badge, 3200);
  beep(980, .12, 'triangle', .05);
  setTimeout(() => beep(1320, .14, 'triangle', .05), 130);
}

function addExp(amount, reason) {
  const gain = Math.round(Number(amount));
  if (!Number.isFinite(gain) || gain <= 0) return;
  const before = state.level;
  state.exp = Math.min(1e9, state.exp + gain);
  state.level = levelFromExp(state.exp);
  if (state.level > before) {
    onLevelUp(before, state.level);
    return;
  }
  saveState();
  renderState();
}

function spawnLevelUpFx(level) {
  const el = document.createElement('div');
  el.className = 'levelup-fx';
  el.textContent = `LEVEL UP · Lv.${level}`;
  fxLayer.appendChild(el);
  autoRemove(el, 2200);
}

function onLevelUp(from, to) {
  const info = LEVELS[to - 1] || LEVELS[LEVELS.length - 1];
  const moodBonus = to >= 7 ? 18 : 12;
  state.incense = clamp(state.incense + 12);
  state.mood = clamp(state.mood + moodBonus);
  if (to >= 5) unlock('level5', '初具道行');
  if (to >= 10) unlock('level10', '香火化身');
  saveState();
  renderState();
  if (growth.classList.contains('show')) renderGrowth();
  toast(`升级！Lv.${to} ${info.title}`, 3200);
  say(`我升级啦！现在是${info.title}！`, 3000);
  spawnSparkles();
  spawnHearts();
  spawnLevelUpFx(to);
  clearTimeout(levelUpTimer);
  stage.classList.remove('levelup');
  void stage.offsetWidth;
  stage.classList.add('levelup');
  levelUpTimer = setTimeout(() => stage.classList.remove('levelup'), 1900);
  beep(660, .12, 'triangle', .05, 'fx');
  setTimeout(() => beep(880, .12, 'triangle', .05, 'fx'), 120);
  setTimeout(() => beep(1180, .18, 'triangle', .05, 'fx'), 240);
}

function say(text, duration = 1800) {
  bubble.textContent = text;
  bubble.classList.add('show');
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => bubble.classList.remove('show'), duration);
}

function toast(text, duration = 1800) {
  toastEl.textContent = text;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), duration);
}

// channel: fx = taps/feeds, music = dance melody, egg = prank stingers.
// All three can be muted independently; soundOn is the global master.
function beep(freq, duration = 0.09, type = 'sine', volume = 0.05, channel = 'fx') {
  const s = state.settings;
  if (!s.soundOn) return;
  if (channel === 'music' && !s.soundMusic) return;
  if (channel === 'egg' && !s.soundEgg) return;
  if (channel === 'fx' && !s.soundFx) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  } catch (err) {
    /* sound is optional */
  }
}

const soundClick = () => beep(620, 0.06, 'sine', 0.04);
function soundFeed() {
  beep(820, 0.1, 'triangle', 0.05);
  setTimeout(() => beep(1040, 0.08, 'triangle', 0.04), 90);
}
function soundEgg() {
  beep(320, 0.12, 'square', 0.035, 'egg');
  setTimeout(() => beep(180, 0.18, 'square', 0.03, 'egg'), 120);
}

const PRANK_LINES = [
  '检测到摸鱼行为',
  '你的鼠标被我承包了',
  '此图标已被我盯上',
  '老板来了！——骗你的',
  '香火不足，速速上贡'
];

const AMBIENT_BEHAVIORS = [
  { cls: 'ambient-stretch', line: '伸个懒腰～', dur: 1200 },
  { cls: 'ambient-shake', line: '摇摇头，清醒一下', dur: 900 },
  { cls: 'ambient-hop', line: '原地蹦一下！', dur: 800 },
  { cls: 'ambient-bow', line: '给你拜个年～', dur: 1400 },
  { cls: 'ambient-sniff', line: '嗯，香火很甜', dur: 1100 },
  { cls: 'ambient-yawn', line: '哈——欠～，有点困', dur: 1600 },
  { cls: 'ambient-stretch', line: '活动一下筋骨', dur: 1200 },
  { cls: 'ambient-bow', line: '三炷香保佑你', dur: 1400 }
];

const UNHAPPY_LINES = [
  '哼，心情差，别惹我',
  '香火都不够，还敢摸我？',
  '给你添点堵，别怪我',
  '再不哄我，我就放大招了',
  '不高兴，撒点小脾气'
];

function spawnSparkles() {
  ['✦', '·', '✦', '·'].forEach((mark, i) => {
    const el = document.createElement('div');
    el.className = 'spark-fx';
    el.textContent = mark;
    el.style.left = `${38 + Math.random() * 24}%`;
    el.style.top = `${18 + Math.random() * 12}%`;
    el.style.setProperty('--px', `${Math.round(Math.random() * 30 - 15)}px`);
    el.style.animationDelay = `${i * 0.12}s`;
    fxLayer.appendChild(el);
    autoRemove(el);
  });
}

function grumpPrank() {
  const line = UNHAPPY_LINES[Math.floor(Math.random() * UNHAPPY_LINES.length)];
  const kind = Math.random();
  say(line, 2400);
  beep(180, .18, 'sawtooth', .03);

  if (kind < .18) {
    ipcRenderer.send('show-bluescreen');
    setTimeout(() => spawnPrankText('心情差，给你来点蓝的'), 300);
  } else if (kind < .42) {
    spawnHeads(10);
    spawnPrankText(line);
  } else if (kind < .68) {
    state.incense = clamp(state.incense - 2);
    saveState();
    renderState();
    spawnPrankText('拿你的香撒气，香火 -2');
  } else {
    spawnPrankText(line);
    setTimeout(() => spawnPrankText('哄我一下就消气'), 500);
  }
}

function runAmbient() {
  if (dragging || panel.classList.contains('show') || wall.classList.contains('show') || about.classList.contains('show') || growth.classList.contains('show')) return;
  if (stage.classList.contains('sleeping') || stage.classList.contains('dancing') || stage.classList.contains('mutant')) return;

  // While chatting, a familiar panda occasionally speaks up on its own. Keep
  // this in the chat log instead of moving the bubble over the conversation.
  if (chat.classList.contains('show')) {
    if (state.mood >= 35 && state.bond >= 50 && Math.random() < (state.level >= 3 ? .45 : .35)) {
      const line = bondTalkLine();
      appendChat('panda', line);
      state.chat.history.push({ me: '', panda: line });
      if (state.chat.history.length > 20) state.chat.history.shift();
      saveState();
    }
    return;
  }

  // Pranks must respect the setting. When disabled, an unhappy panda just
  // mopes through the normal gentle idle animations instead.
  if (state.mood < 30 && state.settings.prank) {
    grumpPrank();
    return;
  }
  // Higher bond makes the panda more likely to greet you instead of only
  // doing generic idle animations.
  const talkChance = Math.min(.55, .12 + state.bond / 900 + (state.level >= 3 ? .08 : 0));
  if (state.mood >= 35 && state.bond >= 20 && Math.random() < talkChance) {
    say(bondTalkLine(), 2200);
    if (state.bond >= 100) spawnSparkles();
    return;
  }
  const behavior = AMBIENT_BEHAVIORS[Math.floor(Math.random() * AMBIENT_BEHAVIORS.length)];
  pet.classList.add(behavior.cls);
  if (behavior.cls === 'ambient-yawn') stage.classList.add('yawning');
  say(behavior.line, behavior.dur);
  if (behavior.cls === 'ambient-sniff' || behavior.cls === 'ambient-bow') spawnSparkles();
  if (behavior.cls === 'ambient-hop') beep(660, .08, 'sine', .025);
  if (behavior.cls === 'ambient-bow') setTimeout(() => beep(520, .09, 'triangle', .022), 120);
  setTimeout(() => {
    pet.classList.remove(behavior.cls);
    stage.classList.remove('yawning');
  }, behavior.dur + 60);
}

function scheduleAmbient() {
  const delay = 12000 + Math.random() * 12000;
  setTimeout(() => {
    runAmbient();
    scheduleAmbient();
  }, delay);
}

function playMelody() {
  if (!state.settings.soundOn) return;
  [523, 659, 784, 659, 523, 392].forEach((freq, i) => {
    setTimeout(() => beep(freq, .14, 'triangle', .045, 'music'), i * 130);
  });
}

function spawnPrankText(text) {
  const el = document.createElement('div');
  el.className = 'prank-text';
  el.textContent = text;
  el.style.top = `${45 + Math.random() * 18}%`;
  el.style.left = `${42 + Math.random() * 16}%`;
  fxLayer.appendChild(el);
  autoRemove(el);
}

function spawnFoodFx(kind, event) {
  const labels = { bamboo: '竹', incense: '香', meme: '梗' };
  const el = document.createElement('div');
  el.className = `food-fx ${kind}`;
  el.textContent = labels[kind] || '食';
  const offset = event && typeof event.clientX === 'number'
    ? Math.round(event.clientX - window.innerWidth / 2)
    : Math.round(Math.random() * 80 - 40);
  el.style.setProperty('--sx', `${offset}px`);
  fxLayer.appendChild(el);
  autoRemove(el);
}

function spawnNotes() {
  ['♪', '♫', '♬', '♪', '♫'].forEach((note, i) => {
    const el = document.createElement('div');
    el.className = 'note-fx';
    el.textContent = note;
    el.style.left = `${30 + Math.random() * 45}%`;
    el.style.top = `${40 + Math.random() * 35}%`;
    el.style.setProperty('--nx', `${Math.round(Math.random() * 60 - 30)}px`);
    el.style.setProperty('--nr', `${Math.round(Math.random() * 90 - 45)}deg`);
    el.style.animationDelay = `${i * 0.12}s`;
    fxLayer.appendChild(el);
    autoRemove(el);
  });
}

function spawnHearts() {
  ['♥', '♥', '♥'].forEach((note, i) => {
    const el = document.createElement('div');
    el.className = 'note-fx';
    el.textContent = note;
    el.style.color = '#d4537e';
    el.style.left = `${40 + Math.random() * 25}%`;
    el.style.top = `${35 + Math.random() * 20}%`;
    el.style.setProperty('--nx', `${Math.round(Math.random() * 40 - 20)}px`);
    el.style.animationDelay = `${i * 0.1}s`;
    fxLayer.appendChild(el);
    autoRemove(el);
  });
}

function dance() {
  markActive();
  clearAmbient();
  stage.classList.add('dancing');
  say('熊猫跳舞中，请勿投喂！', 3800);
  playMelody();
  spawnHeads(6);
  spawnNotes();
  clearTimeout(danceTimer);
  danceTimer = setTimeout(() => stage.classList.remove('dancing'), 3900);
  addExp(3, 'dance');
}

function takeScreenshot() {
  markActive();
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 800;
  const ctx = canvas.getContext('2d');
  if (!ctx) { toast('截图不可用'); return; }

  // Paper background.
  ctx.fillStyle = '#f7f4ec';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#d3d1c7';
  ctx.lineWidth = 6;
  ctx.strokeRect(14, 14, canvas.width - 28, canvas.height - 28);

  const img = new Image();
  img.onload = () => {
    ctx.drawImage(img, 120, 90, 400, 524);
    ctx.fillStyle = '#2c2c2a';
    ctx.font = '600 30px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('熊 猫 烧 香', canvas.width / 2, 664);
    ctx.font = '16px "Microsoft YaHei", sans-serif';
    ctx.fillStyle = '#5f5e5a';
    const streak = state.stats.checkinStreak ? ` · 连续上香 ${state.stats.checkinStreak} 天` : '';
    ctx.fillText(`香火 ${Math.round(state.incense)} · 心情 ${Math.round(state.mood)}${streak}`, canvas.width / 2, 700);
    const unlocked = ACHIEVEMENTS.filter((a) => state.achievements[a.id]).length;
    ctx.fillText(`已解锁 ${unlocked} / ${ACHIEVEMENTS.length} 项成就 · 纯视觉玩梗`, canvas.width / 2, 730);

    ipcRenderer.send('save-screenshot', canvas.toDataURL('image/png'));
  };
  img.onerror = () => toast('图片加载失败');
  img.src = 'assets/panda-classic.png';
}

ipcRenderer.on('screenshot-saved', (event, result) => {
  if (result && result.ok) {
    toast('明信片已保存', 2600);
    unlock('screenshot', '留此存照');
  } else if (result && !result.canceled) {
    toast('保存失败：' + (result.error || '未知错误'), 3000);
  }
});

// ---------- Bond / relationship ----------
const BOND_LEVELS = [
  { min: 0, name: '陌生' },
  { min: 20, name: '点头之交' },
  { min: 50, name: '熟悉' },
  { min: 100, name: '好友' },
  { min: 200, name: '亲密' },
  { min: 300, name: '心有灵犀' }
];
function bondLevel() {
  let level = BOND_LEVELS[0];
  for (const l of BOND_LEVELS) if (state.bond >= l.min) level = l;
  return level;
}
function addBond(amount) {
  const before = bondLevel().name;
  state.bond = Math.min(1000, state.bond + amount);
  const after = bondLevel().name;
  if (amount > 0) {
    if (state.bond >= 100) unlock('bondFriend', '成为好友');
    if (state.bond >= 300) unlock('bondSouls', '心有灵犀');
  }
  if (before !== after) {
    toast(`关系升级：${after}`, 2600);
    beep(880, .12, 'triangle', .04, 'fx');
    spawnSparkles();
  }
  $('bondLabel').textContent = after;
}

// Different relationship levels unlock different things the panda volunteers.
// This makes the bond number visible in daily behavior instead of being a
// hidden counter that only appears in the settings panel.
const BOND_DIALOGUE = [
  ['你是哪位？先上炷香再说。', '别靠太近，我还不熟。'],
  ['来啦？今天香火还行。', '你来了啊，站那儿别动。'],
  ['我们算熟了吧？给你讲个冷笑话？', '今天也来陪我值班吗？'],
  ['你来啦！我刚还想到你呢。', '香火分你一半，谁让我们是朋友。'],
  ['有你在，我这撮毛都精神了。', '你一来，我连蓝屏都懒得演。'],
  ['心有灵犀，你不用开口我也懂。', '我的香火，永远给你留一炷。']
];
function bondTalkLine() {
  let index = 0;
  BOND_LEVELS.forEach((level, i) => {
    if (state.bond >= level.min) index = i;
  });
  const lines = BOND_DIALOGUE[Math.min(index, BOND_DIALOGUE.length - 1)];
  const line = lines[Math.floor(Math.random() * lines.length)];
  return state.chat.name ? line.replace('你', state.chat.name) : line;
}

// ---------- Chat ----------
const CHAT_RULES = [
  { keys: ['你好', '您好', 'hi', 'hello', '嗨', '哈喽'], reply: () => `你好呀${state.chat.name ? '，' + state.chat.name : ''}！今天也来上香吗？` },
  { keys: ['叫我', '我叫', '我是'], reply: (text) => {
    const name = text.replace(/.*?(?:叫我|我叫|我是)/, '').replace(/[，。！？!~～\s].*$/, '').slice(0, 12);
    if (!name) return '嗯？你叫什么呀？';
    state.chat.name = name;
    return `记住啦，以后就叫你${name}！`;
  }, remember: true },
  { keys: ['好看', '可爱', '厉害', '棒', '帅', '漂亮', '喜欢你', '爱你'], reply: () =>
    `嘿嘿${state.chat.name ? '，' + state.chat.name : ''}，被你夸得都不好意思了～` },
  { keys: ['竹子', '吃', '饿', '东西'], reply: () => '我也想吃竹子！你手里那根能分我一半吗？' },
  { keys: ['累', '加班', '烦', '工作', '老板', '摸鱼'], reply: () => '辛苦啦，摸会儿鱼吧，三炷香保佑你～' },
  { keys: ['新年', '过年', '拜年', '春节'], reply: () => '给你拜年啦！红包拿来（开玩笑的）' },
  { keys: ['你是谁', '名字', '什么人'], reply: () => '我是熊猫烧香，2006 年就在这儿给你拜年了。' },
  { keys: ['笑话', '搞笑', '段子'], reply: () => '从前有只熊猫，它烧了三炷香……然后把病毒删了。因为它是好熊猫。' },
  { keys: ['吃吗', '要不要', '吃不吃', '来不来'], reply: () => '嗯……让我掐指一算——要！' },
  { keys: ['再见', '拜拜', '走了', '下线'], reply: () => `下次再来上香呀${state.chat.name ? '，' + state.chat.name : ''}～` },
  { keys: ['滚', '笨蛋', '讨厌', '丑'], reply: () => '哼，不理你了。（其实在偷偷看你）' },
  { keys: ['帮', '选', '决定', '怎么办'], reply: () => '这种大事……不如让我帮你掷个骰子？' },
  { keys: ['谢谢', '感谢'], reply: () => '不客气～香火灵验，有求必应！' }
];
const CHAT_IDLE = [
  '……你在想什么呢？',
  '今天的香火还挺旺的。',
  '要不要摸摸我的头？',
  '我刚刚偷偷打了个盹。'
];
const CHAT_GRUMP = [
  '别烦我，没心情聊。',
  '有话说完，香火拿来。',
  '哼，才不想理你。'
];

function appendChat(who, text) {
  const row = document.createElement('div');
  row.className = `chat-row ${who}`;
  row.textContent = text;
  $('chatLog').appendChild(row);
  $('chatLog').scrollTop = $('chatLog').scrollHeight;
  while ($('chatLog').children.length > 20) $('chatLog').firstChild.remove();
}

function sendChat() {
  const input = $('chatInput');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  appendChat('me', text);
  state.stats.chats += 1;
  addBond(2);

  const lower = text.toLowerCase();
  let reply;
  if (state.mood < 30 && state.settings.prank) {
    reply = CHAT_GRUMP[Math.floor(Math.random() * CHAT_GRUMP.length)];
    state.mood = clamp(state.mood - 1);
  } else {
    const rule = CHAT_RULES.find((r) => r.keys.some((k) => lower.includes(k)));
    if (rule) {
      reply = rule.reply(text);
      if (rule.remember) state.chat.topic = text.slice(0, 40);
    } else {
      reply = CHAT_IDLE[Math.floor(Math.random() * CHAT_IDLE.length)];
    }
    state.mood = clamp(state.mood + 1);
  }
  state.chat.history.push({ me: text.slice(0, 60), panda: reply });
  if (state.chat.history.length > 20) state.chat.history.shift();

  setTimeout(() => {
    appendChat('panda', reply);
    say(reply, 2400);
    beep(700, .07, 'sine', .03, 'fx');
  }, 420);
  unlock('firstChat', '开口说话');
  addExp(4 + (state.level >= 8 ? 1 : 0), 'chat');
  saveState();
  renderState();
}

function openChat() {
  panel.classList.remove('show');
  wall.classList.remove('show');
  about.classList.remove('show');
  growth.classList.remove('show');
  menu.classList.remove('show');
  chat.classList.add('show');
  $('bondLabel').textContent = bondLevel().name;
  if (!$('chatLog').children.length) {
    if (state.chat.history.length) {
      state.chat.history.forEach((turn) => {
        if (turn && turn.me) appendChat('me', turn.me);
        if (turn && turn.panda) appendChat('panda', turn.panda);
      });
    } else {
      appendChat('panda', `你好呀${state.chat.name ? '，' + state.chat.name : ''}！我是熊猫烧香～`);
    }
  }
  markActive();
  setTimeout(() => $('chatInput').focus(), 50);
}

// ---------- Decision assistant ----------
function doDecision() {
  markActive();
  const result = $('gameResult');
  const verdicts = [
    '选 A 吧，香火说它更灵。',
    '选 B！别问为什么，直觉。',
    '两个都选，成年人不做选择。',
    '先放一放，睡一觉再说。',
    '抛个硬币：正面选 A，反面选 B。'
  ];
  const verdict = verdicts[Math.floor(Math.random() * verdicts.length)];
  result.innerHTML = `<span class="stamp">熊猫裁决</span>${verdict}`;
  result.classList.remove('reveal');
  void result.offsetWidth;
  result.classList.add('reveal');
  say(verdict, 2800);
  spawnSparkles();
  soundFeed();
  state.stats.decisions += 1;
  addBond(3);
  addExp(6 + (state.level >= 5 ? 2 : 0), 'decision');
  unlock('decision', '抉择时刻');
  saveState();
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function renderWall() {
  const unlocked = ACHIEVEMENTS.filter((a) => state.achievements[a.id]).length;
  $('wallCount').textContent = `${unlocked} / ${ACHIEVEMENTS.length}`;
  $('wallBody').innerHTML = ACHIEVEMENTS.map((a) => {
    const got = !!state.achievements[a.id];
    return `<div class="ach ${got ? 'got' : ''}">
      <span class="ach-icon">${got ? '★' : '☆'}</span>
      <span class="ach-text"><b>${a.name}</b><small>${a.desc}</small></span>
    </div>`;
  }).join('');
  $('collectionCount').textContent = `${state.collection.length} / ${FORTUNES.length}`;
  $('collection').innerHTML = FORTUNES.map((f, i) => {
    const owned = state.collection.includes(i);
    return `<span class="fortune-chip ${owned ? 'owned' : ''}" title="${owned ? f.text : '尚未收集'}">${owned ? f.level : '？？？'}</span>`;
  }).join('');
}

function openWall() {
  renderWall();
  panel.classList.remove('show');
  menu.classList.remove('show');
  chat.classList.remove('show');
  about.classList.remove('show');
  growth.classList.remove('show');
  wall.classList.add('show');
  markActive();
}

// ---------- Version / update panel ----------
function renderUpdateLog(notes) {
  const log = $('updateLog');
  log.innerHTML = '';
  const list = Array.isArray(notes) && notes.length ? notes : ['暂无更新说明。'];
  list.forEach((note) => {
    const row = document.createElement('div');
    row.textContent = note;
    log.appendChild(row);
  });
}

function renderAppInfo(info) {
  updateInfo = info;
  $('appVersion').textContent = info.currentVersion || '--';
  $('latestVersion').textContent = info.manifestVersion || info.currentVersion || '--';
  $('updateSource').textContent = info.hasFeed ? '在线更新源' : '本地清单';
  $('updateStatus').textContent = info.hasFeed
    ? '已配置在线更新源，可检查最新版本。'
    : '未配置在线更新源，当前展示本地版本清单。';
  $('checkUpdateBtn').disabled = false;
  $('downloadUpdateBtn').disabled = !info.hasDownload;
  renderUpdateLog(info.notes);
}

function renderCheckResult(result) {
  updateInfo = Object.assign({}, updateInfo || {}, result);
  $('appVersion').textContent = result.currentVersion || (updateInfo.currentVersion || '--');
  $('latestVersion').textContent = result.latestVersion || '--';
  const source = result.source === 'remote' ? '在线更新源' : result.source === 'error' ? '检查失败' : '本地清单';
  $('updateSource').textContent = source;
  const released = result.released ? ` 发布日期：${result.released}` : '';
  $('updateStatus').textContent = `${result.message || ''}${released}`;
  $('checkUpdateBtn').disabled = false;
  $('downloadUpdateBtn').disabled = !result.downloadUrl;
  renderUpdateLog(result.notes);
}

function openAbout() {
  panel.classList.remove('show');
  wall.classList.remove('show');
  chat.classList.remove('show');
  growth.classList.remove('show');
  menu.classList.remove('show');
  about.classList.add('show');
  $('appVersion').textContent = '读取中…';
  $('updateStatus').textContent = '正在读取版本信息…';
  ipcRenderer.send('get-app-info');
  markActive();
}

function renderGrowth() {
  const info = LEVELS[state.level - 1] || LEVELS[0];
  const progress = expProgress();
  $('growthTitle').textContent = `Lv.${state.level} ${info.title}`;
  $('growthLevel').textContent = state.level;
  $('growthName').textContent = info.title;
  $('growthPerk').textContent = info.perk;
  $('growthBar').style.width = `${progress.percent}%`;
  $('growthExp').textContent = progress.nextExp === info.exp
    ? `${state.exp} 经验 · 已达满级`
    : `${state.exp} / ${progress.nextExp} 经验`;
  $('growthNext').textContent = progress.nextExp === info.exp
    ? '恭喜，熊猫已修成正果。'
    : `距下一级还需 ${progress.nextExp - state.exp} 经验`;
  $('growthRewards').innerHTML = LEVELS.map((level, index) => {
    const lv = index + 1;
    const cls = lv === state.level ? 'unlocked current' : lv < state.level ? 'unlocked' : '';
    const mark = lv === state.level ? '当前' : lv < state.level ? '已解锁' : `${level.exp} 经验`;
    return `<div class="growth-row ${cls}"><b>Lv.${lv}</b><span>${level.title} · ${level.perk}</span><small>${mark}</small></div>`;
  }).join('');
}

function openGrowth() {
  panel.classList.remove('show');
  wall.classList.remove('show');
  chat.classList.remove('show');
  about.classList.remove('show');
  menu.classList.remove('show');
  growth.classList.add('show');
  renderGrowth();
  markActive();
}

function checkUpdate() {
  $('updateStatus').textContent = '检查中…';
  $('checkUpdateBtn').disabled = true;
  ipcRenderer.send('check-update');
  // If the main process never replies, do not leave the button permanently disabled.
  setTimeout(() => { $('checkUpdateBtn').disabled = false; }, 12000);
}

function collectFortune(index) {
  if (state.collection.includes(index)) return;
  state.collection.push(index);
  if (state.collection.length >= FORTUNES.length) unlock('fortuneCollector', '签文收藏家');
}

function doDailyFortune() {
  markActive();
  const today = todayKey();
  const isNew = state.daily.date !== today;
  if (isNew) {
    // Stable for the whole day: derive the index from the date string.
    let hash = 0;
    for (let i = 0; i < today.length; i += 1) hash = (hash * 31 + today.charCodeAt(i)) >>> 0;
    state.daily = { date: today, fortuneId: hash % FORTUNES.length };
    saveState();
  }
  const fortune = FORTUNES[state.daily.fortuneId];
  const result = $('gameResult');
  result.innerHTML = `<span class="stamp">今日 ${fortune.level}</span>${fortune.text}`;
  result.classList.remove('reveal');
  void result.offsetWidth;
  result.classList.add('reveal');
  // Re-reading today's fortune is free; only the first draw of the day pays
  // out EXP, otherwise the button becomes an unlimited experience farm.
  say(isNew ? `今日签：${fortune.level}` : `今日已签过：${fortune.level}`, 2400);
  soundFeed();
  collectFortune(state.daily.fortuneId);
  unlock('dailyFortune', '每日一签');
  if (isNew) addExp(8 + (state.level >= 6 ? 2 : 0), 'daily');
  saveState();
  renderState();
}

function doCheckin() {
  markActive();
  const today = todayKey();
  if (state.stats.checkinLast === today) {
    say('今天已经上过香啦', 1800);
    beep(300, .12, 'sine', .03);
    return;
  }
  const yesterday = new Date(Date.now() - 86400000);
  const yKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
  state.stats.checkinStreak = state.stats.checkinLast === yKey ? state.stats.checkinStreak + 1 : 1;
  state.stats.checkinLast = today;
  const bonus = Math.min(20, 6 + state.stats.checkinStreak * 2 + (state.level >= 4 ? 2 : 0));
  state.incense = clamp(state.incense + bonus);
  state.mood = clamp(state.mood + 4);
  say(`上香成功！连续 ${state.stats.checkinStreak} 天，香火 +${bonus}`, 2800);
  spawnSparkles();
  soundFeed();
  if (state.stats.checkinStreak >= 3) unlock('dailyStreak3', '三日香客');
  addExp(12 + (state.level >= 9 ? 3 : 0), 'checkin');
  saveState();
  renderState();
}

function doFortune() {
  markActive();
  const index = Math.floor(Math.random() * FORTUNES.length);
  const fortune = FORTUNES[index];
  const result = $('gameResult');
  result.innerHTML = `<span class="stamp">${fortune.level}</span>${fortune.text}`;
  result.classList.remove('reveal');
  void result.offsetWidth;
  result.classList.add('reveal');
  say(`求签结果：${fortune.level}`, 2400);
  soundFeed();
  state.stats.fortunes += 1;
  collectFortune(index);
  addExp(5 + (state.level >= 6 ? 2 : 0), 'fortune');
  saveState();
  if (state.stats.fortunes >= 10) unlock('fortune10', '十签成精');
}

let rpsMatch = null;
function playRps(choice) {
  markActive();
  const choices = ['rock', 'scissors', 'paper'];
  const labels = { rock: '石头', scissors: '剪刀', paper: '布' };
  const pandaChoice = choices[Math.floor(Math.random() * choices.length)];
  const win = (choice === 'rock' && pandaChoice === 'scissors') ||
    (choice === 'scissors' && pandaChoice === 'paper') ||
    (choice === 'paper' && pandaChoice === 'rock');
  const tie = choice === pandaChoice;

  if (!rpsMatch) rpsMatch = { you: 0, panda: 0, round: 0 };
  rpsMatch.round += 1;
  if (win) rpsMatch.you += 1;
  else if (!tie) rpsMatch.panda += 1;

  const decided = rpsMatch.you >= 2 || rpsMatch.panda >= 2;
  const matchWin = decided && rpsMatch.you > rpsMatch.panda;
  const outcome = decided
    ? (matchWin ? '三局两胜，你赢了！' : '三局两胜，熊猫赢了！')
    : (tie ? '平局，不计回合' : (win ? '你赢一局' : '熊猫赢一局'));

  const resultEl = $('gameResult');
  const score = `<span class="score">你 ${rpsMatch.you} : ${rpsMatch.panda} 熊猫 · 第 ${rpsMatch.round} 局</span>`;
  resultEl.innerHTML = `${score}<br><span class="hand ${win ? 'win' : (tie ? '' : 'lose')}">你 ${labels[choice]}</span><span class="hand ${win ? 'lose' : (tie ? '' : 'win')}">我 ${labels[pandaChoice]}</span>${outcome}`;
  resultEl.classList.remove('reveal');
  void resultEl.offsetWidth;
  resultEl.classList.add('reveal');
  say(outcome, 2200);
  beep(win ? 880 : 440, .12, 'square', .04, 'fx');
  if (win) {
    state.stats.rpsWins += 1;
    unlock('rpsWin', '赢过熊猫');
    addExp(10, 'rpsWin');
  }
  if (decided) {
    state.stats.rpsMatches += 1;
    if (matchWin) unlock('rpsBest3', '三局两胜');
    addExp(4, 'rpsMatch');
    rpsMatch = null;
  }
  saveState();
}

function randomPrank() {
  const kind = Math.floor(Math.random() * 5);
  if (kind === 0) {
    ipcRenderer.send('show-swarm');
    say('熊猫暴雨来袭！', 2400);
    unlock('swarm', '熊猫暴雨');
  } else if (kind === 1) {
    ipcRenderer.send('show-shutdown');
    say('系统正在关机……', 2400);
    unlock('fakeShutdown', '差点关机');
  } else if (kind === 2) {
    ipcRenderer.send('show-bluescreen');
    say('蓝屏了！快保存文件！', 2200);
    unlock('blueScreen', '蓝屏受害者');
  } else if (kind === 3) {
    dance();
  } else {
    spawnHeads(14);
    say('感染开始！', 2200);
    soundEgg();
  }
}

function spawnHeads(count = 18) {
  for (let i = 0; i < count; i += 1) {
    const head = document.createElement('div');
    head.className = 'fly-head';
    head.style.setProperty('--x', `${Math.round(Math.random() * 200 - 100)}px`);
    head.style.setProperty('--rot', `${Math.round(Math.random() * 360 - 180)}deg`);
    head.style.setProperty('--dur', `${(1.4 + Math.random()).toFixed(2)}s`);
    head.style.animationDelay = `${(Math.random() * 0.5).toFixed(2)}s`;
    head.innerHTML = '<img src="assets/panda-classic.png" alt="">';
    fxLayer.appendChild(head);
    autoRemove(head, 4000);
  }
}

const IDLE_FX = [
  { cls: 'idle-peek', line: '……有人在看我吗？' },
  { cls: 'idle-spin', line: '转个圈圈～' },
  { cls: 'idle-shrink', line: '让我缩成一小团……' }
];

function markActive() {
  clearTimeout(idleTimer);
  clearTimeout(idleFxTimer);
  stage.classList.remove('sleeping');
  stage.classList.remove('idle-fx');
  idleTimer = setTimeout(() => stage.classList.add('sleeping'), 45000);
  scheduleIdleFx();
}

function scheduleIdleFx() {
  clearTimeout(idleFxTimer);
  const wait = 28000 + Math.random() * 22000;
  idleFxTimer = setTimeout(() => {
    const panelOpen = ['panel', 'wall', 'chat', 'about', 'growth'].some((id) => $(id).classList.contains('show'));
    if (dragging || panelOpen || stage.classList.contains('dancing') || stage.classList.contains('mutant')) {
      scheduleIdleFx();
      return;
    }
    const fx = IDLE_FX[Math.floor(Math.random() * IDLE_FX.length)];
    pet.classList.add(fx.cls);
    say(fx.line, 2200);
    setTimeout(() => pet.classList.remove(fx.cls), 2200);
    scheduleIdleFx();
  }, wait);
}

function feed(kind, event) {
  markActive();
  clearAmbient();
  spawnFoodFx(kind, event);
  const cheering = state.mood < 30;
  const moodBoost = (n) => clamp(state.mood + (cheering ? Math.round(n * 1.6) : n));
  if (kind === 'bamboo') {
    state.incense = clamp(state.incense + 2);
    state.mood = moodBoost(12);
    say(cheering ? '哼，勉强收下……竹子还行' : '好吃的竹子！');
    pet.classList.add('eating');
    setTimeout(() => pet.classList.remove('eating'), 1200);
    soundFeed();
  } else if (kind === 'incense') {
    state.incense = clamp(state.incense + 25);
    state.mood = moodBoost(3);
    say(cheering ? '算你有诚意，香火我收了' : '香火旺盛！');
    soundFeed();
  } else if (kind === 'meme') {
    state.mood = moodBoost(20);
    say(cheering ? '噗……这个梗好笑，消点气' : '梗图消化中…');
    spawnHeads(8);
    soundEgg();
  }
  if (state.stats.feeds[kind] !== undefined) state.stats.feeds[kind] += 1;
  addBond(cheering ? 8 : 4);
  const feedExp = { bamboo: 8, incense: 10, meme: 6 }[kind] || 5;
  addExp(feedExp + (state.level >= 2 ? 1 : 0), 'feed');
  saveState();
  renderState();
  const f = state.stats.feeds;
  if (f.bamboo > 0 && f.incense > 0 && f.meme > 0) unlock('feedAll', '三牲供奉');
}

function triggerMutant() {
  clearAmbient();
  stage.classList.add('mutant');
  say('我变异啦！', 2500);
  spawnHeads(12);
  soundEgg();
  toast('变异状态持续 10 秒');
  unlock('mutant', '变异熊猫');
  addExp(5, 'mutant');
  clearTimeout(mutantTimer);
  mutantTimer = setTimeout(() => stage.classList.remove('mutant'), 10000);
}

function handlePetClick(zone = 'body') {
  markActive();
  clearAmbient();
  const grumpy = state.mood < 30;
  clickCount += 1;
  clearTimeout(clickTimer);
  clickTimer = setTimeout(() => { clickCount = 0; }, 1800);
  state.stats.clicks += 1;

  if (zone === 'incense') {
    state.incense = clamp(state.incense - 3);
    state.mood = clamp(state.mood - 2);
    say('抢香？香火 -3！', 1400);
    spawnPrankText('抢香遭报应');
    beep(220, .16, 'sawtooth', .035);
  } else if (zone === 'head') {
    state.stats.headPats += 1;
    const n = state.stats.headPats;
    const headLines = n >= 7
      ? ['好了好了，头都要被你摸秃了！', '再摸我就收费了！']
      : n >= 4 ? ['嘿嘿，有点舒服……', '别摸了，脸红了（并没有）']
      : n >= 2 ? ['乖乖，再摸一下～', '这个手感，赞！']
      : ['摸摸头，乖～', 'HEAD PAT 已接收', '头顶一撮毛，摸摸更顺'];
    state.mood = clamp(state.mood + (grumpy ? 0 : 2));
    say(grumpy
      ? ['别摸了，越摸越烦', '哼，拿开你的手'][Math.floor(Math.random() * 2)]
      : headLines[Math.floor(Math.random() * headLines.length)], 1300);
    if (!grumpy) {
      spawnHearts();
      addBond(1);
    }
    addExp(grumpy ? 1 : 2, 'headPat');
    beep(grumpy ? 220 : 760, .08, grumpy ? 'sawtooth' : 'sine', .04);
  } else {
    state.stats.tickles += 1;
    const n = state.stats.tickles;
    const tickleLines = n >= 7
      ? ['哈哈哈别戳了！我投降！', '痒死啦——求饶！']
      : n >= 4 ? ['咯咯咯，好痒！', '别戳了别戳了～']
      : ['别戳肚子！', '戳一下，心情+1', '肚子不是按钮（但有效）'];
    state.mood = clamp(state.mood + (grumpy ? 0 : 1));
    say(grumpy
      ? ['没心情，别戳了', '再戳就恶搞你'][Math.floor(Math.random() * 2)]
      : tickleLines[Math.floor(Math.random() * tickleLines.length)], 1300);
    pet.classList.add('squish');
    if (n >= 4) {
      pet.classList.add('tickling');
      spawnSparkles();
      setTimeout(() => pet.classList.remove('tickling'), 900);
    }
    setTimeout(() => pet.classList.remove('squish'), 320);
    addExp(grumpy ? 1 : 2, 'tickle');
    soundClick();
    if (n >= 7) unlock('tickles', '怕痒的熊猫');
    if (grumpy && state.settings.prank && Math.random() < .35) spawnPrankText(UNHAPPY_LINES[Math.floor(Math.random() * UNHAPPY_LINES.length)]);
  }

  saveState();
  renderState();
  if (state.stats.clicks >= 1) unlock('firstClick', '初次上香');
  if (state.settings.prank && Math.random() < (grumpy ? .22 : .06)) {
    spawnPrankText(PRANK_LINES[Math.floor(Math.random() * PRANK_LINES.length)]);
  }
  if (clickCount >= 10) {
    clickCount = 0;
    triggerMutant();
  }
}

let dragging = false;
let dragMoved = false;
let dragStartScreen = null;
let activeZone = 'body';

const AMBIENT_CLASSES = [
  'ambient-stretch', 'ambient-shake', 'ambient-hop',
  'ambient-bow', 'ambient-sniff', 'ambient-yawn'
];
function clearAmbient() {
  AMBIENT_CLASSES.forEach((cls) => pet.classList.remove(cls));
  IDLE_FX.forEach((fx) => pet.classList.remove(fx.cls));
  stage.classList.remove('yawning');
}

// suppressClick: losing focus while holding the pet must not count as a tap
// (otherwise switching apps could land you one step closer to the mutant egg).
function endDrag(suppressClick = false) {
  if (!dragging) return;
  dragging = false;
  dragStartScreen = null;
  pet.classList.remove('dragging');
  stage.classList.remove('dragging');
  ipcRenderer.send('pet-drag-end');
  if (!suppressClick && !dragMoved) handlePetClick(activeZone);
}

// Capture the pointer so move/up events keep arriving after the cursor
// leaves this small window (screen edges, taskbar, another monitor).
pet.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  activeZone = event.target.closest('.hit-zone')?.dataset.zone || 'body';
  try { pet.setPointerCapture(event.pointerId); } catch (err) { /* optional */ }
});

pet.addEventListener('mousedown', (event) => {
  if (event.button !== 0) return;
  markActive();
  dragging = true;
  dragMoved = false;
  // The window follows the cursor, so clientX/clientY barely change during a
  // drag. Screen coordinates do, and are the reliable way to tell a real drag
  // from a long press that should still count as a tap.
  dragStartScreen = { x: event.screenX, y: event.screenY };
  pet.classList.add('dragging');
  stage.classList.add('dragging');
  ipcRenderer.send('pet-drag-start', { x: event.screenX, y: event.screenY });
  event.preventDefault();
});

document.addEventListener('mousemove', (event) => {
  if (!dragging || !dragStartScreen) return;
  if (Math.abs(event.screenX - dragStartScreen.x) + Math.abs(event.screenY - dragStartScreen.y) > 2) {
    dragMoved = true;
  }
  // The main process follows the real cursor; no IPC needed here.
});

// The panda subtly turns toward the cursor so it feels aware of you.
document.addEventListener('mousemove', (event) => {
  if (!state.settings.attention || dragging) return;
  const rect = stage.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height * .55;
  const dx = (event.clientX - cx) / Math.max(1, rect.width);
  const dy = (event.clientY - cy) / Math.max(1, rect.height);
  const rot = Math.max(-6, Math.min(6, dx * 12));
  const lift = Math.max(-3, Math.min(3, dy * 6));
  stage.style.setProperty('--look-x', `${rot.toFixed(2)}deg`);
  stage.style.setProperty('--look-y', `${lift.toFixed(2)}px`);
});

document.addEventListener('mouseup', () => endDrag());
document.addEventListener('pointerup', () => endDrag());
document.addEventListener('pointercancel', () => endDrag(true));
window.addEventListener('blur', () => endDrag(true));

pet.addEventListener('dblclick', (event) => {
  event.preventDefault();
  markActive();
  say('感染开始！', 2200);
  soundEgg();
  spawnHeads(24);
  unlock('doubleClick', '双击成灾');
});

stage.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  // Don't stack the context menu on top of an open panel.
  const openPanel = ['panel', 'wall', 'chat', 'about', 'growth']
    .some((id) => $(id).classList.contains('show'));
  if (openPanel) return;
  menu.classList.toggle('show');
  menu.style.right = 'auto';
  // The UI layer is no longer scaled, so use raw viewport coordinates.
  menu.style.maxHeight = `${Math.max(120, window.innerHeight - 16)}px`;
  const menuW = menu.offsetWidth;
  const menuH = menu.offsetHeight;
  const x = Math.max(4, Math.min(event.clientX, window.innerWidth - menuW - 4));
  const y = Math.max(4, Math.min(event.clientY, window.innerHeight - menuH - 4));
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
});

document.addEventListener('mousedown', (event) => {
  if (event.button === 0 && !menu.contains(event.target)) menu.classList.remove('show');
});

function handleAction(action, event) {
  switch (action) {
    case 'bamboo':
    case 'feed-bamboo': feed('bamboo', event); break;
    case 'incense':
    case 'feed-incense': feed('incense', event); break;
    case 'meme':
    case 'feed-meme': feed('meme', event); break;
    case 'mute':
      state.settings.soundOn = !state.settings.soundOn;
      updateMuteButton();
      saveState();
      toast(state.settings.soundOn ? '音效已开启' : '音效已关闭');
      break;
    case 'settings':
      wall.classList.remove('show');
      chat.classList.remove('show');
      about.classList.remove('show');
      growth.classList.remove('show');
      panel.classList.add('show');
      markActive();
      break;
    case 'close': ipcRenderer.send('quit-app'); break;
    case 'fortune': doFortune(); break;
    case 'daily': doDailyFortune(); break;
    case 'checkin': doCheckin(); break;
    case 'chat': openChat(); break;
    case 'decision': doDecision(); break;
    case 'growth': openGrowth(); break;
    case 'achievements': openWall(); break;
    case 'screenshot': takeScreenshot(); break;
    case 'dance': dance(); break;
    case 'swarm':
      ipcRenderer.send('show-swarm');
      say('熊猫暴雨来袭！', 2400);
      unlock('swarm', '熊猫暴雨');
      break;
    case 'shutdown':
      ipcRenderer.send('show-shutdown');
      say('系统正在关机……', 2400);
      unlock('fakeShutdown', '差点关机');
      break;
    case 'mischief': randomPrank(); break;
    case 'anger':
      state.mood = 20;
      saveState();
      renderState();
      say('你惹到我了！', 2200);
      beep(200, .2, 'sawtooth', .03);
      unlock('angerMe', '惹毛熊猫');
      break;
    case 'infect':
      say('桌面感染中…', 2200);
      soundEgg();
      ipcRenderer.send('show-bluescreen');
      unlock('blueScreen', '蓝屏受害者');
      break;
    case 'about': openAbout(); break;
    default: break;
  }
}

$('rescue').addEventListener('click', () => feed('incense'));

$('toolbar').addEventListener('click', (event) => {
  const action = event.target.dataset.action;
  if (action) handleAction(action, event);
});

menu.addEventListener('click', (event) => {
  const action = event.target.dataset.action;
  if (!action) return;
  menu.classList.remove('show');
  handleAction(action, event);
});

document.querySelectorAll('.food-drag').forEach((btn) => {
  btn.addEventListener('dragstart', (event) => {
    event.dataTransfer.setData('text/plain', btn.dataset.food);
    event.dataTransfer.effectAllowed = 'copy';
    say('拖到熊猫身上喂食！', 1400);
  });
});

pet.addEventListener('dragover', (event) => {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
  pet.classList.add('drop-ready');
  if (!bubble.classList.contains('show')) say('松手，我张嘴了！', 1000);
});

pet.addEventListener('dragleave', () => pet.classList.remove('drop-ready'));

pet.addEventListener('drop', (event) => {
  event.preventDefault();
  pet.classList.remove('drop-ready');
  const kind = event.dataTransfer.getData('text/plain');
  if (['bamboo', 'incense', 'meme'].includes(kind)) feed(kind, event);
});

$('fortuneBtn').addEventListener('click', doFortune);
document.querySelectorAll('.rps').forEach((btn) => {
  btn.addEventListener('click', () => playRps(btn.dataset.rps));
});

function updateThemeButtons() {
  document.querySelectorAll('.theme-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.theme === state.settings.theme);
  });
  stage.dataset.theme = state.settings.theme;
}

document.querySelectorAll('.theme-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const theme = btn.dataset.theme;
    if (state.settings.theme === theme) return;
    state.settings.theme = theme;
    updateThemeButtons();
    saveState();
    toast(`已换上${btn.textContent}主题`);
    beep(720, .1, 'triangle', .035, 'fx');
    unlock('themeSwitch', '换新装');
  });
});

function updateMuteButton() {
  document.querySelector('[data-action="mute"]').classList.toggle('muted', !state.settings.soundOn);
}

function applyUIScale(scale) {
  stage.style.setProperty('--ui-scale', scale);
  // Position the toolbar from the panda's *measured* centre, not from a
  // formula tied to window width. The two can drift apart at odd DPI
  // scales, which used to send the buttons off to the right.
  updatePandaAnchor();
}

function updatePandaAnchor() {
  // Measure the unrotated image layer, not the panda itself: attention tilt
  // and the bob animation change the panda's bounding box and would make the
  // toolbar wobble as the pointer moves.
  const r = petRoot.getBoundingClientRect();
  if (!r.width) return;
  stage.style.setProperty('--panda-cx', `${r.left + r.width / 2}px`);
}

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  let closed = false;
  if (panel.classList.contains('show')) {
    panel.classList.remove('show');
    closed = true;
  }
  if (menu.classList.contains('show')) {
    menu.classList.remove('show');
    closed = true;
  }
  if (wall.classList.contains('show')) {
    wall.classList.remove('show');
    closed = true;
  }
  if (chat.classList.contains('show')) {
    chat.classList.remove('show');
    closed = true;
  }
  if (about.classList.contains('show')) {
    about.classList.remove('show');
    closed = true;
  }
  if (growth.classList.contains('show')) {
    growth.classList.remove('show');
    closed = true;
  }
  if (closed) event.preventDefault();
});

window.addEventListener('resize', updatePandaAnchor);
requestAnimationFrame(updatePandaAnchor);
setTimeout(updatePandaAnchor, 200);

// Dragging the slider fires `input` on every pixel. Debounce the native
// resize so the window follows smoothly instead of stuttering, while the
// CSS transform above still updates instantly.
let scaleIpcTimer = null;
function sendScale(value, immediate = false) {
  clearTimeout(scaleIpcTimer);
  if (immediate) {
    ipcRenderer.send('set-scale', value);
  } else {
    scaleIpcTimer = setTimeout(() => ipcRenderer.send('set-scale', value), 45);
  }
}

function applySettings() {
  const s = state.settings;
  applyUIScale(s.scale);
  $('scale').value = s.scale;
  $('scaleVal').textContent = `${Math.round(s.scale * 100)}%`;
  $('opacity').value = s.opacity;
  $('opacityVal').textContent = `${Math.round(s.opacity * 100)}%`;
  $('alwaysTop').checked = s.alwaysTop;
  $('passThrough').checked = s.passThrough;
  $('soundOn').checked = s.soundOn;
  $('soundFx').checked = s.soundFx;
  $('soundMusic').checked = s.soundMusic;
  $('soundEgg').checked = s.soundEgg;
  $('startup').checked = s.startup;
  $('prank').checked = s.prank;
  $('attention').checked = s.attention;
  updateMuteButton();
  updateThemeButtons();
  sendScale(s.scale, true);
  ipcRenderer.send('set-opacity', s.opacity);
  ipcRenderer.send('set-always-on-top', s.alwaysTop);
  ipcRenderer.send('set-pass-through', s.passThrough);
}

$('scale').addEventListener('input', (event) => {
  const value = parseFloat(event.target.value);
  state.settings.scale = value;
  applyUIScale(value);
  $('scaleVal').textContent = `${Math.round(value * 100)}%`;
  sendScale(value);
  saveState();
});

// Flush immediately on release so no delayed resize can move the window
// while the user is dragging the pet.
$('scale').addEventListener('change', () => sendScale(state.settings.scale, true));

$('opacity').addEventListener('input', (event) => {
  const value = parseFloat(event.target.value);
  state.settings.opacity = value;
  $('opacityVal').textContent = `${Math.round(value * 100)}%`;
  ipcRenderer.send('set-opacity', value);
  saveState();
});

$('alwaysTop').addEventListener('change', (event) => {
  state.settings.alwaysTop = event.target.checked;
  ipcRenderer.send('set-always-on-top', event.target.checked);
  saveState();
});

$('passThrough').addEventListener('change', (event) => {
  state.settings.passThrough = event.target.checked;
  ipcRenderer.send('set-pass-through', event.target.checked);
  saveState();
  if (event.target.checked) say('穿透开启，Ctrl+Alt+P 恢复', 2500);
});

$('soundOn').addEventListener('change', (event) => {
  state.settings.soundOn = event.target.checked;
  updateMuteButton();
  saveState();
  if (event.target.checked) beep(660, .08, 'sine', .03);
});

['soundFx', 'soundMusic', 'soundEgg'].forEach((key) => {
  $(key).addEventListener('change', (event) => {
    state.settings[key] = event.target.checked;
    saveState();
    if (event.target.checked && key === 'soundFx') beep(660, .08, 'sine', .03);
  });
});

$('startup').addEventListener('change', (event) => {
  state.settings.startup = event.target.checked;
  ipcRenderer.send('set-startup', event.target.checked);
  saveState();
  toast(event.target.checked ? '已设置开机自启' : '已取消开机自启');
});

$('attention').addEventListener('change', (event) => {
  state.settings.attention = event.target.checked;
  if (!event.target.checked) {
    stage.style.setProperty('--look-x', '0deg');
    stage.style.setProperty('--look-y', '0px');
  }
  saveState();
});

$('prank').addEventListener('change', (event) => {
  state.settings.prank = event.target.checked;
  saveState();
  toast(event.target.checked ? '恶搞模式已开启' : '恶搞模式已关闭');
});

$('panelClose').addEventListener('click', () => panel.classList.remove('show'));
$('wallClose').addEventListener('click', () => wall.classList.remove('show'));
$('chatClose').addEventListener('click', () => chat.classList.remove('show'));
$('chatSend').addEventListener('click', sendChat);
$('chatInput').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') { event.preventDefault(); sendChat(); }
});
$('aboutClose').addEventListener('click', () => about.classList.remove('show'));
$('growthClose').addEventListener('click', () => growth.classList.remove('show'));
$('checkUpdateBtn').addEventListener('click', checkUpdate);
$('downloadUpdateBtn').addEventListener('click', () => {
  if (updateInfo && updateInfo.downloadUrl) ipcRenderer.send('open-update-url', updateInfo.downloadUrl);
});
$('quitBtn').addEventListener('click', () => ipcRenderer.send('quit-app'));

ipcRenderer.on('pass-through-changed', (event, enabled) => {
  state.settings.passThrough = enabled;
  $('passThrough').checked = enabled;
  saveState();
  toast(enabled ? '鼠标穿透已开启' : '鼠标穿透已关闭');
});

ipcRenderer.on('startup-state', (event, enabled) => {
  const real = !!enabled;
  if (state.settings.startup === real) return;
  state.settings.startup = real;
  $('startup').checked = real;
  // Do not call set-startup here — that would just write the same value back.
  saveState();
});

ipcRenderer.on('app-info', (event, info) => {
  if (about.classList.contains('show')) renderAppInfo(info);
});

ipcRenderer.on('update-checked', (event, result) => {
  if (about.classList.contains('show')) renderCheckResult(result);
});

ipcRenderer.on('update-link-error', (event, message) => {
  toast(message, 2600);
});

setInterval(() => {
  let changed = false;
  if (state.incense > 0) {
    state.incense = clamp(state.incense - 1);
    changed = true;
  }
  if (state.mood > 0) {
    state.mood = clamp(state.mood - 1);
    changed = true;
  }
  if (!changed) return;
  saveState();
  renderState();
}, 30000);

setInterval(() => {
  if (!state.settings.prank || stage.classList.contains('sleeping')) return;
  const panelOpen = ['panel', 'wall', 'chat', 'about', 'growth']
    .some((id) => $(id).classList.contains('show'));
  if (panelOpen) return;
  const teaser = PRANK_LINES[Math.floor(Math.random() * PRANK_LINES.length)];
  spawnPrankText(teaser);
}, 90000);

applySettings();
renderState();
// Persist the offline decay result right away so a quick launch/quit cycle
// doesn't recompute the same decay every time from an old timestamp.
saveState();
markActive();
scheduleAmbient();
say('你好，我是熊猫烧香！', 2600);
if (process.env.PANDA_SELFTEST === '1') {
  console.log('RENDERER BOOT: ready');
  ipcRenderer.send('selftest-renderer-ready');
}

// Dev-only renderer self test. The main process sends this after startup so
// interaction paths are exercised for real, not just syntax-checked.
ipcRenderer.on('selftest-run', () => {
  console.log('RENDERER SELFTEST: received run');
  const errors = [];
  // A dev-only run must not leave a maxed-out pet in the user's real save.
  const savedStateRaw = localStorage.getItem(STORAGE_KEY);
  const savedScale = state.settings.scale;
  const savedOpacity = state.settings.opacity;
  const check = (name, ok) => {
    if (!ok) errors.push(`${name}: assertion failed`);
  };
  const tryRun = (name, fn) => {
    try { fn(); } catch (err) { errors.push(`${name}: ${err && err.message || err}`); }
  };
  const panels = ['panel', 'wall', 'chat', 'about', 'growth'];
  const onlyPanel = (id) => panels.every((p) => $(p).classList.contains('show') === (p === id));

  tryRun('openChat', openChat);
  check('openChat', chat.classList.contains('show'));

  tryRun('sendChat', () => {
    $('chatInput').value = '你好，熊猫';
    sendChat();
  });
  check('sendChat', $('chatInput').value === '' && state.stats.chats > 0);

  tryRun('doDecision', doDecision);
  check('doDecision', $('gameResult').textContent.includes('熊猫裁决'));
  tryRun('doDailyFortune', doDailyFortune);
  tryRun('doCheckin', doCheckin);
  tryRun('openWall', openWall);
  check('openWall', wall.classList.contains('show') && $('wallBody').children.length === ACHIEVEMENTS.length);

  tryRun('openGrowth', openGrowth);
  check('openGrowth', growth.classList.contains('show'));
  tryRun('levelUp', () => {
    state.exp = 0;
    state.level = 1;
    addExp(35, 'selftest');
    addExp(1500, 'selftest');
  });
  check('levelUp', state.level === LEVELS.length && $('growthLevel').textContent === String(LEVELS.length));

  tryRun('openAbout', openAbout);
  check('openAbout', about.classList.contains('show'));
  tryRun('checkUpdate', checkUpdate);

  tryRun('bondTalkLine', () => {
    const previousBond = state.bond;
    state.bond = 320;
    const line = bondTalkLine();
    state.bond = previousBond;
    if (!line || typeof line !== 'string') throw new Error('empty proactive line');
  });

  const headBefore = state.stats.headPats;
  tryRun('headPats', () => {
    for (let i = 0; i < 7; i += 1) handlePetClick('head');
  });
  check('headPats', state.stats.headPats >= headBefore + 7);

  const ticklesBefore = state.stats.tickles;
  tryRun('tickles', () => {
    for (let i = 0; i < 7; i += 1) handlePetClick('body');
  });
  check('tickles', state.stats.tickles >= ticklesBefore + 7 && pet.classList.contains('tickling'));

  // --- Panel exclusivity and every right-click action ---
  tryRun('actionFeed', () => ['feed-bamboo', 'feed-incense', 'feed-meme'].forEach((a) => handleAction(a)));
  tryRun('actionGames', () => ['fortune', 'daily', 'checkin', 'decision', 'dance'].forEach((a) => handleAction(a)));
  tryRun('actionRps', () => { for (let i = 0; i < 8; i += 1) playRps('rock'); });
  check('rpsMatch', state.stats.rpsMatches > 0);
  tryRun('actionPranks', () => ['swarm', 'shutdown', 'infect', 'mischief', 'anger'].forEach((a) => handleAction(a)));

  tryRun('openSettingsFromMenu', () => { openWall(); handleAction('settings'); });
  check('settingsExclusive', onlyPanel('panel'));
  tryRun('openAboutFromMenu', () => handleAction('about'));
  check('aboutExclusive', onlyPanel('about'));
  tryRun('openGrowthFromMenu', () => handleAction('growth'));
  check('growthExclusive', onlyPanel('growth'));
  tryRun('openWallFromMenu', () => handleAction('achievements'));
  check('wallExclusive', onlyPanel('wall'));
  tryRun('openChatFromMenu', () => handleAction('chat'));
  check('chatExclusive', onlyPanel('chat'));

  tryRun('chatNameMemory', () => {
    state.mood = 80;
    $('chatInput').value = '叫我阿香';
    sendChat();
  });
  check('chatNameMemory', state.chat.name === '阿香');
  tryRun('chatHistory', () => {
    check('chatHistorySaved', state.chat.history.length > 0 && state.chat.history.some((t) => t.me === '叫我阿香'));
    $('chatLog').innerHTML = '';
    openChat();
  });
  check('chatHistoryRestored', $('chatLog').textContent.includes('叫我阿香'));

  // A malformed save used to make openChat() throw on a null history entry.
  tryRun('dirtyHistoryOpen', () => {
    const savedHistory = state.chat.history;
    const savedLog = $('chatLog').innerHTML;
    try {
      state.chat.history = [null];
      $('chatLog').innerHTML = '';
      openChat();
      if (!chat.classList.contains('show')) throw new Error('chat did not open for dirty history');
    } finally {
      state.chat.history = savedHistory;
      $('chatLog').innerHTML = savedLog;
    }
  });

  // Re-reading the same daily fortune must not hand out EXP twice.
  tryRun('dailyExpGate', () => {
    doDailyFortune();
    const afterFirst = state.exp;
    doDailyFortune();
    if (state.exp !== afterFirst) throw new Error('daily fortune paid out twice');
  });

  tryRun('escapeClose', () => {
    openGrowth();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  check('escapeClose', !growth.classList.contains('show'));

  tryRun('themes', () => document.querySelectorAll('.theme-btn').forEach((btn) => btn.click()));
  check('themes', stage.dataset.theme === 'cyber');
  tryRun('soundToggles', () => ['soundOn', 'soundFx', 'soundMusic', 'soundEgg', 'prank', 'attention'].forEach((id) => {
    const el = $(id);
    el.checked = !el.checked;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.checked = !el.checked;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }));

  // A real drag must not be counted as a tap; a stationary press must be.
  const tapsBeforeDrag = state.stats.clicks;
  const mouse = (type, screenX) => new MouseEvent(type, {
    bubbles: true, button: 0, screenX, screenY: 120, clientX: 100, clientY: 100
  });
  tryRun('dragNotTap', () => {
    pet.dispatchEvent(mouse('mousedown', 100));
    document.dispatchEvent(mouse('mousemove', 180));
    document.dispatchEvent(mouse('mouseup', 180));
  });
  check('dragNotTap', state.stats.clicks === tapsBeforeDrag);
  tryRun('stationaryTap', () => {
    pet.dispatchEvent(mouse('mousedown', 220));
    document.dispatchEvent(mouse('mouseup', 220));
  });
  check('stationaryTap', state.stats.clicks === tapsBeforeDrag + 1);

  tryRun('toolbarAnchor', () => {
    const pr = petRoot.getBoundingClientRect();
    const tr = $('toolbar').getBoundingClientRect();
    const br = bubble.getBoundingClientRect();
    const centre = pr.left + pr.width / 2;
    const toolbarCentre = tr.left + tr.width / 2;
    const bubbleCentre = br.left + br.width / 2;
    if (Math.abs(toolbarCentre - centre) > 2) {
      throw new Error(`toolbar off-centre by ${(toolbarCentre - centre).toFixed(1)}px`);
    }
    if (Math.abs(bubbleCentre - centre) > 2) {
      throw new Error(`bubble off-centre by ${(bubbleCentre - centre).toFixed(1)}px`);
    }
  });

  tryRun('expCurve', () => {
    if (levelFromExp(0) !== 1 || levelFromExp(LEVELS[LEVELS.length - 1].exp) !== LEVELS.length) {
      throw new Error('level thresholds broken');
    }
    state.exp = 35;
    state.level = levelFromExp(35);
    const p = expProgress();
    if (p.percent < 0 || p.percent > 100) throw new Error('exp percent out of range');
  });

  tryRun('dirtySaveMigration', () => {
    const original = localStorage.getItem(STORAGE_KEY);
    try {
      localStorage.setItem(STORAGE_KEY, '{not json');
      const broken = loadState();
      if (broken.level !== 1 || broken.incense !== 80) throw new Error('broken JSON fallback failed');
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        incense: 'abc', mood: -50, exp: 9999, level: 1,
        stats: { clicks: 'x', feeds: null },
        settings: { scale: 99, theme: 'nope' },
        achievements: { firstClick: 'false', unknownBadge: true },
        chat: { history: [null, 'bad', { me: 5, panda: null }, { me: 'ok', panda: 'fine' }] },
        collection: [0, 0, 99, 1],
        daily: { fortuneId: 999 }
      }));
      const dirty = loadState();
      if (dirty.incense < 0 || dirty.incense > 100) throw new Error('incense not clamped');
      if (dirty.level !== LEVELS.length) throw new Error('level not derived from exp');
      if (dirty.settings.scale > 1.4 || dirty.settings.theme !== 'classic') throw new Error('settings not sanitized');
      if (!Array.isArray(dirty.chat.history)) throw new Error('history not sanitized');
      if (dirty.chat.history.some((turn) => !turn || typeof turn.me !== 'string' || typeof turn.panda !== 'string')) {
        throw new Error('history entries not sanitized');
      }
      if (dirty.collection.some((n) => n < 0 || n >= FORTUNES.length)) throw new Error('collection not sanitized');
      if (new Set(dirty.collection).size !== dirty.collection.length) throw new Error('collection not deduplicated');
      if (dirty.achievements.firstClick !== false || dirty.achievements.unknownBadge !== undefined) {
        throw new Error('achievements not sanitized');
      }
      if (dirty.daily.fortuneId >= FORTUNES.length) throw new Error('fortuneId not clamped');
    } finally {
      if (original === null) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, original);
    }
  });

  tryRun('restoreTestSettings', () => {
    state.settings.scale = savedScale;
    state.settings.opacity = savedOpacity;
    $('scale').value = savedScale;
    $('opacity').value = savedOpacity;
    applyUIScale(savedScale);
    sendScale(savedScale, true);
    ipcRenderer.send('set-opacity', savedOpacity);
  });

  // The final IPC assertions need the About panel open when replies arrive.
  tryRun('finalAbout', () => {
    openAbout();
    checkUpdate();
  });
  check('finalAbout', about.classList.contains('show'));

  setTimeout(() => {
    check('chatReply', $('chatLog').textContent.includes('记住啦'));
    check('appInfo', $('appVersion').textContent !== '读取中…' && $('appVersion').textContent !== '--');
    check('updateChecked', $('latestVersion').textContent !== '--' && $('updateStatus').textContent !== '正在读取版本信息…');
    check('updateButton', $('checkUpdateBtn').disabled === false);
    try {
      if (savedStateRaw === null) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, savedStateRaw);
    } catch (err) {
      errors.push(`restoreState: ${err && err.message || err}`);
    }
    console.log('RENDERER SELFTEST: sending done', errors.length ? errors.join(' | ') : 'OK');
    ipcRenderer.send('selftest-done', errors);
  }, 650);
});
