export function pad2(n) {
  return String(n).padStart(2, '0');
}

export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function isoToDate(isoStr) {
  const [y, m, d] = isoStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDaysIso(isoStr, days) {
  const d = isoToDate(isoStr);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function mondayOfWeek(isoStr) {
  const day = isoToDate(isoStr).getDay();
  return addDaysIso(isoStr, day === 0 ? -6 : 1 - day);
}

export function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function dayOfWeekLabel(isoStr) {
  return capitalize(isoToDate(isoStr).toLocaleDateString('tr-TR', { weekday: 'long' }));
}

export function formatDateLongTr(isoStr) {
  return isoToDate(isoStr).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function formatDateShortTr(isoStr) {
  return isoToDate(isoStr).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
}

export function monthLabelTr(isoStr) {
  return capitalize(isoToDate(isoStr).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' }));
}

export function normalizeForMatch(str) {
  return String(str ?? '')
    .toLowerCase()
    .trim()
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ');
}

const VIEWPORT_LOCKED = 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover';
const VIEWPORT_ZOOMABLE = 'width=device-width, initial-scale=1, viewport-fit=cover';

export function setViewportZoomable(zoomable) {
  const meta = document.querySelector('meta[name="viewport"]');
  if (meta) meta.setAttribute('content', zoomable ? VIEWPORT_ZOOMABLE : VIEWPORT_LOCKED);
}

export function setAppChromeHidden(hidden) {
  document.body.classList.toggle('chrome-hidden', hidden);
}

// Bir sheet/modal açıldığında çağır: Android/tarayıcının donanım "geri" tuşu,
// arkadaki sayfada gezinmek yerine bu sheet'i kapatsın diye sahte bir history
// kaydı iter. Sheet'i backdrop tıklaması/Kaydet/X gibi normal yollardan
// kapatırken `backdrop.remove()` DEĞİL, bu fonksiyonun döndürdüğü `close`
// fonksiyonu çağrılmalı — hem gerçek kapatmayı yapar (verdiğin `doClose`
// üzerinden) hem de sahte history kaydını tüketir, geri tuşuna basıldığında
// tekrar ekstra bir "geri" adımı kalmasın diye.
// `close(...args)` verdiğin argümanları `doClose`'a aynen iletir (ör. bir
// confirm/reauth sheet'inin Promise sonucu) — geri tuşuyla kapanırsa `doClose`
// HİÇ argümansız çağrılır, o yüzden confirm/reauth gibi Promise döndüren
// sheet'ler `doClose(result = <güvenli varsayılan>)` şeklinde tanımlanmalı
// (ör. bir onay sheet'inde geri tuşu ASLA "onaylandı" anlamına gelmemeli).
export function bindSheetBackClose(doClose) {
  history.pushState({ gymbnSheet: true }, '');
  let closed = false;
  function onPopState() {
    if (closed) return;
    closed = true;
    window.removeEventListener('popstate', onPopState);
    doClose();
  }
  window.addEventListener('popstate', onPopState);
  return function close(...args) {
    if (closed) return;
    closed = true;
    window.removeEventListener('popstate', onPopState);
    doClose(...args);
    history.back();
  };
}

// Egzersiz durumunu (good/bad/neutral/null) her yerde aynı görünen tek bir rozete
// çeviriyor: yeşil ✓ (good), kırmızı ▼ (bad), turuncu − (kullanıcının GERÇEKTEN
// seçtiği "fena değildi"). Hiç işaretlenmemiş (status null/undefined) durumda
// HİÇBİR ŞEY dönmüyor — eskiden bu da aynı turuncu "−" ile gösteriliyordu, henüz
// hiç dokunulmamış bir egzersizle gerçekten "fena değildi" diye işaretlenmiş bir
// egzersiz ayırt edilemiyordu. `animate:true` SADECE kullanıcı az önce bu durumu
// seçtiğinde (dayEntry.js) geçiliyor — rozet büyüyüp çiziliyor + bir halka
// patlıyor; weekSummary/weekSummaryDesktop gibi salt geçmiş veri gösteren yerler
// hep `animate:false` (varsayılan) kullanıyor.
const STATUS_BADGE_PATHS = {
  good: 'M5 13l4 4L19 7',
  bad: 'M6 9l6 6 6-6',
  neutral: 'M5 12h14',
};

export function statusBadge(status, animate = false) {
  if (!status) return '';
  const key = status === 'good' ? 'good' : status === 'bad' ? 'bad' : 'neutral';
  const cls = `status-badge status-badge-${key}${animate ? ' status-badge-pop' : ''}`;
  const ring = animate ? '<span class="status-badge-ring"></span>' : '';
  return `<span class="${cls}"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path class="status-badge-path" d="${STATUS_BADGE_PATHS[key]}"/></svg>${ring}</span>`;
}

// navigator.vibrate Android Chrome'da çalışıyor, iOS Safari'de hiç yok — sessizce
// yok sayılıyor (hata fırlatmıyor), her tarayıcıda güvenle çağrılabilir.
export function vibrate(pattern) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // bazı tarayıcılar izin/gizlilik nedeniyle fırlatabilir, sessizce yok say
  }
}

// Çizgili SVG ikonlar — emoji yerine (tema/işletim sistemine göre tutarsız
// görünmesinler diye), currentColor kullanıyorlar ki her yerde çevredeki metin
// rengini otomatik alsınlar.
export const ICON_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 6h16M9 6V4h6v2M6 6l1 14h10l1-14"/></svg>';
export const ICON_NOTE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M21 11.5a8.4 8.4 0 0 1-8.9 8.4 9 9 0 0 1-3.6-.7L3 20l1-4.7a8.3 8.3 0 0 1-.9-3.8A8.4 8.4 0 0 1 12 3a8.3 8.3 0 0 1 9 8.5Z"/></svg>';
export const ICON_COACH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 11l18-7-7 18-3-8-8-3Z"/></svg>';
export const ICON_MEDIA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M10 8.5l6 3.5-6 3.5v-7Z" fill="currentColor" stroke="none"/></svg>';

// Egzersiz hedef bölgeleri: kişisel kütüphanenin (libraryList.js) kullandığı
// SABİT liste — Firestore'suz, tek cihazda çalışır. Admin'in ortak kataloğu
// (exerciseCatalog.js) bunu KULLANMIYOR, kendi dinamik `targetRegions`
// koleksiyonuna sahip (bkz. adminCloud.js) — ikisi kasıtlı olarak ayrı.
export const EXERCISE_REGIONS = [
  { name: 'Göğüs', color: '#b56b5c' },
  { name: 'Sırt', color: '#5c8f7a' },
  { name: 'Ön Omuz', color: '#c9a15a' },
  { name: 'Yan Omuz', color: '#c9a15a' },
  { name: 'Arka Omuz', color: '#c9a15a' },
  { name: 'Biceps', color: '#6b84a8' },
  { name: 'Triceps', color: '#6b84a8' },
  { name: 'Ön Kol', color: '#6b84a8' },
  { name: 'Ön Bacak', color: '#8a6a9c' },
  { name: 'Arka Bacak', color: '#8a6a9c' },
  { name: 'Baldır', color: '#8a6a9c' },
  { name: 'Kalça', color: '#b58a5c' },
  { name: 'Karın', color: '#6f8a8f' },
  { name: 'Tüm Vücut', color: '#8b8f98' },
];

// Her egzersiz bu paletten hangi alanları takip edeceğini seçiyor (çoklu-seçim,
// EXERCISE_REGIONS'daki AYNI desen) — "kuvvet hareketi" mi "kardiyo" mu diye
// sabit bir TİP seçmek yerine, hangi alanların anlamlı olduğunu doğrudan
// işaretliyorsun. Yeni bir ihtiyaç (ör. nabız) çıkarsa buraya bir satır eklemek
// yeterli, var olan hiçbir egzersizi bozmuyor. Sırası prescribed-fields'ta ve
// set girişinde gösterilecekleri sırayı da belirliyor.
export const TRACKED_FIELD_TYPES = [
  { key: 'weight', label: 'Ağırlık', unit: 'kg' },
  { key: 'setCount', label: 'Set', unit: '' },
  { key: 'reps', label: 'Tekrar', unit: '' },
  { key: 'rir', label: 'Rir', unit: '' },
  { key: 'duration', label: 'Süre', unit: 'dk' },
  { key: 'incline', label: 'Eğim', unit: '%' },
  { key: 'speed', label: 'Hız', unit: 'km/h' },
  { key: 'distance', label: 'Mesafe', unit: 'km' },
  { key: 'resistance', label: 'Direnç', unit: 'seviye' },
];

// Bu özellikten ÖNCE oluşturulmuş her egzersiz (yani ezici çoğunluk) hiç
// trackedFields kaydetmedi — okurken eksikse buna düşülüyor, tek bir kayıt bile
// göç etmeye gerek yok. Yeni eklenen bir egzersiz de aynı varsayılanla başlıyor.
export const DEFAULT_TRACKED_FIELDS = ['weight', 'setCount', 'reps', 'rir'];

const YOUTUBE_ID_RE = /(?:youtube\.com\/watch\?v=|youtube\.com\/embed\/|youtube\.com\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

export function youTubeEmbedId(url) {
  return url?.match(YOUTUBE_ID_RE)?.[1] || null;
}

const SHOW_EXERCISE_MEDIA_KEY = 'gymbn_showExerciseMedia';

export function isExerciseMediaEnabled() {
  const v = localStorage.getItem(SHOW_EXERCISE_MEDIA_KEY);
  return v === null ? true : v === '1';
}

export function setExerciseMediaEnabled(enabled) {
  localStorage.setItem(SHOW_EXERCISE_MEDIA_KEY, enabled ? '1' : '0');
}

export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${pad2(m)}:${pad2(sec)}`;
  return `${m}:${pad2(sec)}`;
}

const REST_TIMER_AUTO_RESET_KEY = 'gymbn_restTimerAutoReset';

export function isRestTimerAutoResetEnabled() {
  const v = localStorage.getItem(REST_TIMER_AUTO_RESET_KEY);
  return v === null ? true : v === '1';
}

export function setRestTimerAutoResetEnabled(enabled) {
  localStorage.setItem(REST_TIMER_AUTO_RESET_KEY, enabled ? '1' : '0');
}

const REST_TIMER_BIG_KEY = 'gymbn_restTimerBig';

export function isRestTimerBigEnabled() {
  return localStorage.getItem(REST_TIMER_BIG_KEY) === '1';
}

export function setRestTimerBigEnabled(big) {
  localStorage.setItem(REST_TIMER_BIG_KEY, big ? '1' : '0');
}

export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}
