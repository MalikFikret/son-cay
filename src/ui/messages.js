// Turkish texts for errors (pure, no DOM). The room layer and the engine only produce stable
// English codes; this is the one place that turns them into what a player reads. A raw code is
// never shown.

import { ROOM_ERR } from '../rooms/index.js';

const GENERIC = 'Bir şeyler ters gitti. Sayfayı yenileyip tekrar dene.';
const OFFLINE = 'Sunucuya bağlanılamadı. İnternet bağlantını kontrol et.';

/** One message per room-layer error code (tests/ui-messages.test.js checks that none is missing). */
export const ROOM_MESSAGES = Object.freeze({
  [ROOM_ERR.INVALID_CODE]: 'Bu masa kodu geçersiz. Kod 6 karakterdir.',
  [ROOM_ERR.ROOM_NOT_FOUND]: 'Bu kodla açık bir masa yok.',
  [ROOM_ERR.ROOM_FULL]: 'Bu masa dolu.',
  [ROOM_ERR.INVALID_NAME]: 'Ad 1-20 karakter olmalı; . $ # [ ] / kullanılamaz.',
  [ROOM_ERR.NAME_TAKEN]: 'Bu ad masada zaten var, başka bir ad seç.',
  [ROOM_ERR.INVALID_PIN]: 'Şifre 4 rakam olmalı.',
  [ROOM_ERR.WRONG_PIN]: 'Şifre yanlış.',
  [ROOM_ERR.RETRY_LATER]: 'Çok sık denendi. Biraz bekle, sonra tekrar dene.',
  [ROOM_ERR.INVALID_SEAT]: 'Önce listeden adını seç.',
  [ROOM_ERR.INVALID_SEAT_ORDER]: 'Oturma sırası geçersiz.',
  [ROOM_ERR.SEAT_EMPTY]: 'Bu yer artık boş.',
  [ROOM_ERR.ALREADY_MEMBER]: 'Bu masada zaten başka bir yerin var.',
  [ROOM_ERR.NOT_MEMBER]: 'Bu masada artık yerin yok.',
  [ROOM_ERR.SEAT_LOST]: 'Bu masada artık yerin yok.',
  [ROOM_ERR.NOT_IN_LOBBY]: 'Bu, yalnızca maçlar arasında yapılabilir.',
  [ROOM_ERR.INVALID_SETTINGS]: 'Masa ayarları geçersiz.',
  [ROOM_ERR.NOT_ENOUGH_PLAYERS]: 'Maçı başlatmak için en az 3 oyuncu gerekir.',
  [ROOM_ERR.INVALID_ACTION]: 'Bu hamle şu an yapılamaz.',
  [ROOM_ERR.ACTION_NOT_ALLOWED]: 'Bu hamle şu an yapılamaz.',
  [ROOM_ERR.NO_MATCH]: 'Şu an süren bir maç yok.',
  [ROOM_ERR.PLAYER_NOT_ALIVE]: 'Bu oyuncu artık maçta değil.',
  [ROOM_ERR.SEAT_PRESENT]: 'Bu oyuncu hâlâ bağlı.',
  [ROOM_ERR.CODE_GENERATION_FAILED]: 'Masa kurulamadı, tekrar dene.',
  [ROOM_ERR.WRITE_DENIED]: 'İşlem kabul edilmedi, tekrar dene.',
  // Programming or setup errors: nothing the player can fix by changing their input.
  [ROOM_ERR.INVALID_UID]: GENERIC,
  [ROOM_ERR.INVALID_DEPENDENCIES]: GENERIC,
  [ROOM_ERR.INVALID_VISIBILITY]: GENERIC,
  [ROOM_ERR.INVALID_MODE]: GENERIC,
});

/** Messages of checks the screens make before any request. */
export const FORM_MESSAGES = Object.freeze({
  CODE_EMPTY: 'Masa kodunu yaz.',
  NAME_EMPTY: 'Adını yaz.',
  BAD_INVITE: 'Davet bağlantısı geçersiz. Kodu elle yazmayı dene.',
  COPY_FAILED: 'Kopyalanamadı. Bağlantıyı elle seçip kopyala.',
  SETTINGS_FAILED: 'Ayar kaydedilemedi; önceki değer geri geldi.',
  CONNECT_FAILED: OFFLINE,
});

export const GENERIC_MESSAGE = GENERIC;
export const OFFLINE_MESSAGE = OFFLINE;

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function looksOffline(error) {
  const text = `${error?.code ?? ''} ${error?.message ?? ''}`.toLowerCase();
  return text.includes('offline') || text.includes('network') || text.includes('unavailable');
}

/**
 * The Turkish message for an error: a RoomError (by its code), a bare code string, or any other
 * error (network problems get the offline message, everything else a generic one).
 * @param {unknown} error
 * @returns {string}
 */
export function errorMessage(error) {
  const code = typeof error === 'string' ? error : error?.code;
  if (typeof code === 'string' && hasOwn(ROOM_MESSAGES, code)) return ROOM_MESSAGES[code];
  if (typeof code === 'string' && hasOwn(FORM_MESSAGES, code)) return FORM_MESSAGES[code];
  if (error && typeof error === 'object' && looksOffline(error)) return OFFLINE;
  return GENERIC;
}

/** Errors after which the recover button waits (the rules allow one claim per seat every 2 s). */
export const RETRY_WAIT_CODES = Object.freeze([ROOM_ERR.WRONG_PIN, ROOM_ERR.RETRY_LATER]);
export const RETRY_WAIT_SECONDS = 2;

/**
 * Texts of the waiting room's options, seat order, start and Tablo (functions take values that
 * are inserted as text, never as markup). Player names are never put inside a word: Turkish
 * suffixes depend on the name, so the texts say "adlı oyuncu" instead.
 */
export const TEXT = Object.freeze({
  // Seat order
  seatOrderRandom: 'Oturma sırası: rastgele',
  seatOrderManual: 'Oturma sırası: elle',
  editSeatOrder: 'Oturma sırasını elle düzenle',
  seatOrderTitle: 'Oturma sırası',
  seatOrderHint: 'Oklarla sırala. Sonradan oturanlar sona eklenir.',
  moveUp: (name) => `${name}: yukarı`,
  moveDown: (name) => `${name}: aşağı`,
  randomOrder: 'Rastgele',
  save: 'Kaydet',
  cancel: 'Vazgeç',
  // Player options
  optionsFor: (name) => `${name} için seçenekler`,
  rename: 'İsmini değiştir',
  newName: 'Yeni ad',
  handOver: 'Masa sahipliğini devret',
  handOverConfirm: (name) => `Masa sahipliği ${name} adlı oyuncuya geçsin mi?`,
  handOverYes: 'Evet, devret',
  kick: 'Masadan çıkar',
  kickConfirm: (name) => `${name} adlı oyuncu masadan çıkarılsın mı?`,
  kickYes: 'Evet, çıkar',
  // Starting a match
  startMatch: 'Maçı başlat',
  startNote: 'Bağlantısı olmayanlar da maça dahil olur. En az 3 oyuncu gerekir.',
  startTooFew: 'Maçı başlatmak için en az 3 oyuncu gerekir.',
  absentTitle: 'Bağlantısı olmayanlar var',
  absentText: 'Bu oyuncular şu an bağlı değil. Maç başlarsa onlar da oynar.',
  startAnyway: 'Yine de başlat',
  starting: 'Başlatılıyor…',
  // Tablo
  tablo: 'Tablo',
  close: 'Kapat',
  tabMatch: 'Bu maç',
  tabSession: 'Oturum',
  matchHeader: (n, rounds, mode) => `Maç ${n} · ${rounds} tur · ${mode}`,
  noMatchYet: 'Henüz biten bir maç yok. İlk maç bitince burada görünür.',
  colRank: '#',
  colPlayer: 'Oyuncu',
  colRounds: 'Tur',
  colPoints: 'Puan',
  colMatches: 'Maç',
  colWins: 'Kzn.',
  won: 'Kazandı',
  draw: 'Berabere bitti',
  outInRound: (round) => `${round}. turda çıktı`,
  removedInRound: (round) => `${round}. turda masadan çıkarıldı`,
  me: 'sen',
  leftPlayer: 'Ayrılan oyuncu',
  hpLabel: (hp) => `${hp} can`,
  winsLabel: 'galibiyet',
  lineLiveOnOther: 'Başkasına dolu',
  lineBlankOnOther: 'Başkasına boş',
  lineBlankOnSelf: 'Kendine boş',
  lineLiveOnSelf: 'Kendine dolu',
  lineEliminations: 'Eleme',
  lineRounds: (count) => `Tur sonu (${count} tur)`,
  lineWin: 'Kazanma (maç sonunda)',
  linePredictions: 'Tahmin',
  lineTotal: 'Toplam',
  times: (count) => `${count} kez`,
  matchFootnote: 'Kazanan başta, çıkanlar çıkış sırasına göre (son çıkan önce) dizilir. Satıra dokun, puanın nereden geldiğini gör.',
  sessionHeader: (matches) => `${matches} maç oynandı · bekleme salonu`,
  noSessionYet: 'Henüz maç oynanmadı.',
  sessionFootnote: 'Puanın altındaki küçük sayı, son maçta kazanılan puandır.',

  // Masa (the match table)
  roundTitle: (round) => `${round}. tur`,
  tableSubtitle: (code, mode) => `Masa ${code} · ${mode}`,
  settings: 'Ayarlar',
  howToPlay: 'Nasıl oynanır',
  soon: 'Yakında',
  directionClockwise: 'Sıra saat yönünde dönüyor',
  directionCounter: 'Sıra saat yönünün tersine dönüyor',
  revolverAt: (name) => `Tabanca şuna dönük: ${name}`,
  tagMe: 'sen',
  tagTurn: 'sırası',
  tagTarget: 'hedef',
  tagAbsent: 'bağlantı yok',
  livesLabel: (hp, max) => `${hp} / ${max} can`,
  seatLabel: (name, tags, lives) => [name, tags, lives].filter(Boolean).join(', '),
  yourTurn: 'Sıra sende',
  turnOf: (name) => `Sıra: ${name}`,
  lootOf: (name) => `Ganimet sırası: ${name}`,
  youWon: 'Kazandın',
  winnerIs: (name) => `Kazanan: ${name}`,
  drawResult: 'Berabere',
  lastEventPrefix: 'Son olay: ',
  matchBegan: 'Maç başladı.',
  shotAtOther: (shooter, target) => `${shooter} ateş etti · hedef: ${target}.`,
  shotAtSelf: (shooter) => `${shooter} kendine ateş etti.`,
  shotOnTimeout: (shooter) => `Süre doldu: ${shooter} kendine ateş etti.`,
  effectLive: 'Dolu.',
  effectBlank: 'Boş.',
  playerOut: (name) => `${name} oyundan çıktı.`,
  playerRemovedLine: (name) => `${name} masadan çıkarıldı.`,
  toolUsedLine: (name, tool) => `${name} malzeme kullandı: ${tool}.`,
  turnSkippedLine: (name) => `${name} hapiste, sırası geçti.`,
  matchOver: 'Maç bitti.',
  reloadLive: (count) => `${count} Dolu`,
  reloadBlank: (count) => `${count} Boş`,
  reloadLabel: 'Mermiler dolduruldu',
  secondsLeft: (seconds) => `${seconds} saniye kaldı`,
  handTitle: (count) => `Elin · ${count} malzeme`,
  handEmpty: 'Elin boş',
  handSoon: 'kullanım yakında',
  fire: 'Ateş et',
  chooseTarget: 'Hedef seç',
  chooseTargetHint: 'Bir oyuncuya ya da kendine dokun',
  targetIs: (name) => `hedef: ${name}`,
  targetSelf: 'hedef: kendin',
  slideToCancel: 'Vazgeçmek için dışarı kaydır',
  firing: 'Ateşleniyor…',
  shotRefused: 'Atış kabul edilmedi. Sıra değişmiş olabilir.',
  watchingWaiting: 'Bu maçı izliyorsun, sonraki maçta oynarsın.',
  watchingOut: 'Oyundan çıktın. Maçın sonunu izliyorsun.',
});
