// Simple RU/EN localization. All in-game text goes through t().
const STRINGS = {
  en: {
    tagline: 'Lifers wanted. Survival not guaranteed.',
    name: 'Prisoner name',
    suit_color: 'Hazmat suit color',
    accessory: 'Accessory',
    create: 'Create room',
    join: 'Join',
    mic_note: 'Microphone is required for voice chat',
    lang_switch: 'Русский',
    paused: 'PAUSED',
    room_code: 'Room code:',
    sensitivity: 'Mouse sensitivity',
    voice_volume: 'Voice volume',
    voice_mode: 'Voice mode',
    voice_open: 'Open mic',
    voice_ptt: 'Push to talk (V)',
    resume: 'Resume',
    leave: 'Leave room',
    controls: 'WASD — move   SHIFT — sprint   C — crouch   SPACE — jump\nF — flashlight   M — mute mic   V — push to talk\nT — text chat   ESC — menu',
    click_to_play: 'Click to continue',
    acc_none: 'None', acc_cap: 'Cap', acc_antenna: 'Antenna', acc_goggles: 'Goggles', acc_cone: 'Traffic cone', acc_crown: 'Crown',
    err_room_not_found: 'Room not found',
    err_room_full: 'Room is full (6/6)',
    err_connection: 'No connection to server',
    err_code: 'Enter a 4-character code',
    mic_live: 'MIC ON', mic_muted: 'MIC MUTED', mic_ptt: 'HOLD V TO TALK', mic_none: 'NO MICROPHONE',
    joined: '{name} entered the facility',
    left: '{name} left',
    you_host: 'You are the host',
    welcome: 'SECTOR 0 — TRAINING BLOCK',
  },
  ru: {
    tagline: 'Требуются пожизненно осуждённые. Выживание не гарантируется.',
    name: 'Имя заключённого',
    suit_color: 'Цвет костюма химзащиты',
    accessory: 'Аксессуар',
    create: 'Создать комнату',
    join: 'Войти',
    mic_note: 'Для голосового чата нужен микрофон',
    lang_switch: 'English',
    paused: 'ПАУЗА',
    room_code: 'Код комнаты:',
    sensitivity: 'Чувствительность мыши',
    voice_volume: 'Громкость голосов',
    voice_mode: 'Режим голоса',
    voice_open: 'Открытый микрофон',
    voice_ptt: 'Рация — зажать V',
    resume: 'Продолжить',
    leave: 'Покинуть комнату',
    controls: 'WASD — ходьба   SHIFT — бег   C — присесть   ПРОБЕЛ — прыжок\nF — фонарик   M — выключить микрофон   V — говорить (рация)\nT — текстовый чат   ESC — меню',
    click_to_play: 'Кликни, чтобы продолжить',
    acc_none: 'Нет', acc_cap: 'Кепка', acc_antenna: 'Антенна', acc_goggles: 'Очки', acc_cone: 'Дорожный конус', acc_crown: 'Корона',
    err_room_not_found: 'Комната не найдена',
    err_room_full: 'Комната заполнена (6/6)',
    err_connection: 'Нет связи с сервером',
    err_code: 'Введи код из 4 символов',
    mic_live: 'МИКРОФОН ВКЛ', mic_muted: 'МИКРОФОН ВЫКЛ', mic_ptt: 'ЗАЖМИ V, ЧТОБЫ ГОВОРИТЬ', mic_none: 'НЕТ МИКРОФОНА',
    joined: '{name} вошёл в комплекс',
    left: '{name} вышел',
    you_host: 'Ты хост',
    welcome: 'СЕКТОР 0 — УЧЕБНЫЙ БЛОК',
  },
};

let lang = (() => {
  try { return localStorage.getItem('po_lang') || (navigator.language.startsWith('ru') ? 'ru' : 'en'); }
  catch { return 'en'; }
})();

export function t(key, vars = {}) {
  let s = STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
  for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  return s;
}
export function getLang() { return lang; }
export function setLang(l) {
  lang = l;
  try { localStorage.setItem('po_lang', l); } catch {}
  applyI18n();
}
export function applyI18n(root = document) {
  document.documentElement.lang = lang;
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
}
