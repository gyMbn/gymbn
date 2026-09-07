import { isoToDate, todayIso, pad2, DEFAULT_TRACKED_FIELDS, normalizeForMatch } from './util.js';
import { scheduleCloudPush } from './cloudSync.js';

const STORAGE_KEY = 'gymbnData';
const SCHEMA_VERSION = 1;

let state = null;
let historyIndex = {};
let saveTimer = null;

export function uid(prefix) {
  const time = Date.now().toString(36).slice(-4);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${time}${rand}`;
}

function defaultState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: 0,
    exercises: [],
    dayTypes: [
      { id: uid('dt'), name: 'Anterior-1', archived: false },
      { id: uid('dt'), name: 'Posterior-1', archived: false },
      { id: uid('dt'), name: 'Anterior-2', archived: false },
      { id: uid('dt'), name: 'Posterior-2', archived: false },
    ],
    dayEntries: [],
    payments: [],
    measurements: [],
  };
}

// "Son sefer" gerçekten KAYDEDİLMİŞ (en az bir set touched) örnekler arasından,
// günün takvim tarihine değil `loggedAt`'e (gerçek kayıt anı) göre seçiliyor —
// program haftalık atanıp sırayla değil karışık yapılabiliyor (ör. 20'sini
// 17'sinden önce girme), o yüzden tarih sırası "son"u yanlış gösterebiliyordu.
// Bu alan eklenmeden ÖNCE kaydedilmiş eski örneklerde `loggedAt` yok — o yüzden
// eski veri kaybolmasın diye günün tarihine düşüyoruz (eski davranışla aynı sıra).
function rebuildHistoryIndex() {
  const idx = {};
  for (const day of state.dayEntries) {
    for (const inst of day.exercises) {
      if (!inst.actualSets.some((s) => s.touched)) continue;
      (idx[inst.exerciseId] ??= []).push({
        date: day.date,
        dayEntryId: day.id,
        prescribed: inst.prescribed,
        actualSets: inst.actualSets,
        loggedAt: inst.loggedAt || isoToDate(day.date).getTime(),
      });
    }
  }
  for (const list of Object.values(idx)) list.sort((a, b) => a.loggedAt - b.loggedAt);
  historyIndex = idx;
}

export function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      state = JSON.parse(raw);
    } catch (e) {
      console.error('gymbnData parse edilemedi, varsayılan boş veriyle başlanıyor', e);
      state = defaultState();
    }
  } else {
    state = defaultState();
  }
  if (!Array.isArray(state.exercises)) state.exercises = [];
  if (!Array.isArray(state.dayTypes)) state.dayTypes = [];
  if (!Array.isArray(state.dayEntries)) state.dayEntries = [];
  if (!Array.isArray(state.payments)) state.payments = [];
  if (typeof state.updatedAt !== 'number') state.updatedAt = 0;
  rebuildHistoryIndex();
  return state;
}

export function getState() {
  return state;
}

export function saveState(debounce = true) {
  clearTimeout(saveTimer);
  const persist = () => {
    state.updatedAt = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    rebuildHistoryIndex();
    scheduleCloudPush(state);
  };
  if (debounce) {
    saveTimer = setTimeout(persist, 300);
  } else {
    persist();
  }
}

/* ---------- Exercise & day-type libraries (shared shape) ---------- */

function createLibraryItem(collectionKey, prefix, name, extra = {}) {
  const item = { id: uid(prefix), name: name.trim(), archived: false, ...extra };
  state[collectionKey].push(item);
  saveState(false);
  return item;
}

function renameLibraryItem(collectionKey, id, name) {
  const item = state[collectionKey].find((it) => it.id === id);
  if (!item) return;
  item.name = name.trim();
  saveState(false);
}

function archiveLibraryItem(collectionKey, id) {
  const item = state[collectionKey].find((it) => it.id === id);
  if (!item) return;
  item.archived = true;
  saveState(false);
}

function activeLibraryItems(collectionKey) {
  return state[collectionKey].filter((it) => !it.archived);
}

function libraryItemById(collectionKey, id) {
  return state[collectionKey].find((it) => it.id === id) || null;
}

// resolveFromCatalog/bindToCatalog/syncAllWithCatalog üçü de kataloktan AYNI 5
// alanı kopyalıyor — tek yerden, birini güncelleyip diğerini unutma riskini
// (bkz. trackedFields'ın kopyalamaya hiç dahil edilmediği sohbet) engelliyor.
// Geriye bir şey GERÇEKTEN değişti mi diye bildiriyor — syncAllWithCatalog
// bunu gereksiz saveState/cloud push'tan kaçınmak için kullanıyor.
function applyCatalogFields(item, catalogEx) {
  const next = {
    name: catalogEx.name,
    isDuration: !!catalogEx.isDuration,
    videoUrl: catalogEx.videoUrl || '',
    targetRegions: catalogEx.targetRegions || [],
    trackedFields: catalogEx.trackedFields || DEFAULT_TRACKED_FIELDS,
  };
  const changed = Object.keys(next).some((key) => JSON.stringify(item[key]) !== JSON.stringify(next[key]));
  Object.assign(item, next);
  return changed;
}

export const exercises = {
  add: (name, isDuration = false) => createLibraryItem('exercises', 'ex', name, { isDuration }),
  rename: (id, name) => renameLibraryItem('exercises', id, name),
  archive: (id) => archiveLibraryItem('exercises', id),
  // isDuration artık libraryList.js'in kendi ayrı ⏱ düğmesi yerine bu sheet'in
  // içinde yaşıyor (bkz. "Süre-bazlı egzersiz" satırı ve bu değişikliğin geldiği
  // sohbet) — o yüzden ayrı bir setDuration() yerine tek setMedia() çağrısının
  // parçası. `typeof` kontrolü, ileride isDuration'sız çağıran biri çıkarsa
  // (olmaması gerekiyor, ama savunma amaçlı) var olan değeri silmesin diye.
  setMedia: (id, { videoUrl, targetRegions, trackedFields, isDuration }) => {
    const item = libraryItemById('exercises', id);
    if (!item) return;
    item.videoUrl = videoUrl || '';
    item.targetRegions = targetRegions || [];
    delete item.targetRegion;
    // Boş dizi kaydetmiyoruz — hiçbir alan seçilmemiş bir egzersiz UI'da hiçbir
    // şey gösteremez hale gelir, bunun yerine varsayılana düşüyoruz.
    if (trackedFields) item.trackedFields = trackedFields.length ? trackedFields : DEFAULT_TRACKED_FIELDS;
    if (typeof isDuration === 'boolean') item.isDuration = isDuration;
    saveState(false);
  },
  active: () => activeLibraryItems('exercises'),
  all: () => state.exercises,
  byId: (id) => libraryItemById('exercises', id),
  // assignProgram.js'teki resolveLocalExercise ile aynı desen: paylaşılan admin
  // kataloğundan gelen egzersizin O ANKİ verisini (isim/video/hedef bölge) kopyalar.
  // Aynı katalog kaydı ikinci kez kullanılırsa (aynı sourceCatalogId) yeni kopya
  // açmak yerine var olanı tazeler — admin sonradan video/bölge güncellerse bir
  // sonraki yapıştırmada otomatik yansır. bulkAdd.js'in coach-yönetimli hesap
  // yolundan çağrılıyor, bireysel kullanımda hiç devreye girmiyor.
  // İLK atamada (sourceCatalogId'li kayıt yok) körü körüne yeni açmadan önce
  // isme göre (normalizeForMatch) hiç bağlanmamış bir yerel kaydı arıyor —
  // assignProgram.js'teki AYNI düzeltme, bkz. oradaki yorum ve bu değişikliğin
  // geldiği sohbet. Zaten başka bir katalog kaydına bağlı bir egzersiz asla
  // isimle "ele geçirilmiyor".
  resolveFromCatalog: (catalogEx) => {
    let item = state.exercises.find((e) => e.sourceCatalogId === catalogEx.id);
    if (!item) {
      const normalizedName = normalizeForMatch(catalogEx.name);
      item = state.exercises.find((e) => !e.sourceCatalogId && normalizeForMatch(e.name) === normalizedName) || null;
    }
    if (!item) {
      item = { id: uid('ex'), archived: false, sourceCatalogId: catalogEx.id };
      state.exercises.push(item);
    }
    item.sourceCatalogId = catalogEx.id;
    applyCatalogFields(item, catalogEx);
    saveState(false);
    return item;
  },
  // resolveFromCatalog'dan FARKLI: burada hangi yerel egzersizin bağlanacağı
  // zaten BİLİNİYOR (id ile) — elle yazılmış eski bir kaydı (ör. "bench press")
  // kütüphanedeki gerçek karşılığıyla eşleştirmek için, YENİ bir kayıt açmak
  // yerine VAR OLANI yerinde günceller. Bu sayede o egzersizin geçmişteki VE
  // gelecekteki tüm günleri (hepsi bu id'yi referans alıyor) tek işlemle
  // kütüphaneye bağlanmış olur — dayEntries'e hiç dokunmaya gerek yok.
  bindToCatalog: (id, catalogEx) => {
    const item = libraryItemById('exercises', id);
    if (!item) return null;
    item.sourceCatalogId = catalogEx.id;
    applyCatalogFields(item, catalogEx);
    saveState(false);
    return item;
  },
  // Kataloğa zaten bağlı (sourceCatalogId'li) HER egzersizi verilen katalog
  // listesiyle sessizce tazeler. resolveFromCatalog/bindToCatalog SADECE o an
  // dokunulan tek kaydı güncelliyordu — admin kataloğu düzenlediğinde ZATEN
  // bağlı bir öğrenci kaydı bunu ancak BİR SONRAKİ atamada görüyordu ("Hyper
  // Extension" un iki kere elle tazelenmek zorunda kaldığı sohbete bkz).
  // dayEntry.js ve exerciseLibrary.js kataloğu zaten her açılışta sessizce
  // çekiyor (bkz. oradaki çağrı) — buraya bağlanınca yeni bir ekran/buton
  // olmadan her açılışta kendiliğinden güncel kalıyor. Hiçbir şey değişmediyse
  // (ezici çoğunluk) saveState/cloud push hiç tetiklenmiyor.
  syncAllWithCatalog: (catalog) => {
    if (!catalog || !catalog.length) return 0;
    const byId = new Map(catalog.map((c) => [c.id, c]));
    let changedCount = 0;
    for (const item of state.exercises) {
      if (!item.sourceCatalogId) continue;
      const catalogEx = byId.get(item.sourceCatalogId);
      if (!catalogEx) continue; // kataloğdan arşivlenmiş/silinmiş olabilir, dokunma
      if (applyCatalogFields(item, catalogEx)) changedCount++;
    }
    if (changedCount) saveState(false);
    return changedCount;
  },
};

export const dayTypes = {
  add: (name) => createLibraryItem('dayTypes', 'dt', name),
  rename: (id, name) => renameLibraryItem('dayTypes', id, name),
  archive: (id) => archiveLibraryItem('dayTypes', id),
  active: () => activeLibraryItems('dayTypes'),
  all: () => state.dayTypes,
  byId: (id) => libraryItemById('dayTypes', id),
};

/* ---------- Day entries ---------- */

export function getDayEntries() {
  return state.dayEntries;
}

export function getDayEntryById(id) {
  return state.dayEntries.find((d) => d.id === id) || null;
}

export function getDayEntryByDate(dateIso) {
  return state.dayEntries.find((d) => d.date === dateIso) || null;
}

export function suggestNextDayNumber() {
  if (!state.dayEntries.length) return null;
  const max = Math.max(...state.dayEntries.map((d) => Number(d.dayNumber) || 0));
  return max + 1;
}

export function createDayEntry({ date, dayNumber, dayTypeId }) {
  const entry = {
    id: uid('day'),
    date,
    dayNumber: dayNumber ?? null,
    dayTypeId: dayTypeId ?? null,
    exercises: [],
  };
  state.dayEntries.push(entry);
  saveState(false);
  return entry;
}

export function updateDayEntryField(dayId, field, value, debounce = false) {
  const entry = getDayEntryById(dayId);
  if (!entry) return;
  entry[field] = value;
  saveState(debounce);
}

export function deleteDayEntry(dayId) {
  state.dayEntries = state.dayEntries.filter((d) => d.id !== dayId);
  saveState(false);
}

/* ---------- Exercise instances within a day entry ---------- */

function findInstance(dayId, instId) {
  const entry = getDayEntryById(dayId);
  return entry ? entry.exercises.find((e) => e.id === instId) || null : null;
}

// "Yapılan" set alanları artık sayısal seçiciler (reps 0-30, rir 0-9) — prescribed
// serbest metin olabildiği için ("8-9", "75sn", "tükenene kadar") ilk sayıyı çıkarıp
// makul bir başlangıç değerine indirgiyoruz; kullanıcı zaten seçiciden düzeltebilir.
// Export edilmiş: setRows.js aynı mantığı seçicide hocanın hedefini işaretlemek için
// de kullanıyor (bkz. openNumberPicker'ın target parametresi).
export function extractLeadingInt(str, fallback) {
  const match = String(str ?? '').match(/\d+/);
  return match ? parseInt(match[0], 10) : fallback;
}

function clampRir(n) {
  return Math.max(0, Math.min(9, n));
}

function trackedFieldsOf(exercise) {
  return (exercise && exercise.trackedFields) || DEFAULT_TRACKED_FIELDS;
}

// Süre-bazlı egzersizlerde rir alanı "rezerv saniye" anlamına geldiği için
// (bkz. exercises.isDuration) 0-9'a sıkıştırılmıyor, sadece negatif olamıyor.
// setCount kendi satırı DEĞİL — sadece kaç satır (buildActualSetsFromPrescribed)
// olacağını belirliyor. Diğer yeni alanlar (süre/eğim/hız/mesafe/direnç)
// serbest metin, prescribed'daki değeri olduğu gibi kopyalıyor.
function buildOneActualSet(prescribed, trackedFields, isDuration) {
  const row = { touched: false };
  trackedFields.forEach((key) => {
    if (key === 'setCount') return;
    if (key === 'reps') {
      row.reps = String(extractLeadingInt(prescribed.reps, 0));
    } else if (key === 'rir') {
      const rirValue = extractLeadingInt(prescribed.rir, 0);
      row.rir = String(isDuration ? Math.max(0, rirValue) : clampRir(rirValue));
    } else {
      row[key] = prescribed[key] ?? '';
    }
  });
  return row;
}

// "Set" trackedFields'ta yoksa (ör. Yürüyüş) tek satır yeterli — akordiyon
// çoğaltma/silme kavramı hiç yok, bkz. setRows.js. Varsa mevcut davranış aynen
// korunuyor (prescribed.setCount kadar satır).
function buildActualSetsFromPrescribed(prescribed, exercise) {
  const isDuration = !!(exercise && exercise.isDuration);
  const trackedFields = trackedFieldsOf(exercise);
  const count = trackedFields.includes('setCount') ? Math.max(1, Number(prescribed.setCount) || 1) : 1;
  const rows = [];
  for (let i = 0; i < count; i++) {
    rows.push(buildOneActualSet(prescribed, trackedFields, isDuration));
  }
  return rows;
}

function buildInstance(exerciseId, prescribed) {
  const exercise = libraryItemById('exercises', exerciseId);
  return {
    id: uid('exi'),
    exerciseId,
    note: '',
    status: null,
    loggedAt: null,
    prescribed,
    actualSets: buildActualSetsFromPrescribed(prescribed, exercise),
  };
}

// Geçmişte bu egzersizin kaydı varsa AYNEN o reçete kopyalanıyor (mevcut
// davranış) — yoksa egzersizin KENDİ trackedFields'ına göre boş bir reçete
// kuruluyor (setCount:3, rir:'0' varsayılanları eski sabit objeyle birebir
// aynı, diğer her alan boş metin).
export function addExerciseInstance(dayId, exerciseId) {
  const entry = getDayEntryById(dayId);
  if (!entry) return null;
  const last = getLastInstance(exerciseId, dayId);
  const exercise = libraryItemById('exercises', exerciseId);
  const prescribed = last ? { ...last.prescribed } : buildDefaultPrescribed(trackedFieldsOf(exercise));
  const inst = buildInstance(exerciseId, prescribed);
  entry.exercises.push(inst);
  saveState(false);
  return inst;
}

function buildDefaultPrescribed(trackedFields) {
  const p = {};
  trackedFields.forEach((key) => {
    p[key] = key === 'setCount' ? 3 : key === 'rir' ? '0' : '';
  });
  return p;
}

export function addExerciseInstanceWithPrescribed(dayId, exerciseId, prescribed) {
  const entry = getDayEntryById(dayId);
  if (!entry) return null;
  const inst = buildInstance(exerciseId, prescribed);
  entry.exercises.push(inst);
  saveState(false);
  return inst;
}

export function removeExerciseInstance(dayId, instId) {
  const entry = getDayEntryById(dayId);
  if (!entry) return;
  entry.exercises = entry.exercises.filter((e) => e.id !== instId);
  saveState(false);
}

export function updateInstancePrescribed(dayId, instId, field, value, debounce = false) {
  const inst = findInstance(dayId, instId);
  if (!inst) return;
  inst.prescribed[field] = value;
  if (inst.actualSets.every((s) => !s.touched)) {
    const exercise = libraryItemById('exercises', inst.exerciseId);
    inst.actualSets = buildActualSetsFromPrescribed(inst.prescribed, exercise);
  }
  saveState(debounce);
}

export function updateInstanceNote(dayId, instId, note) {
  const inst = findInstance(dayId, instId);
  if (!inst) return;
  inst.note = note;
  saveState(true);
}

export function updateInstanceStatus(dayId, instId, status) {
  const inst = findInstance(dayId, instId);
  if (!inst) return;
  inst.status = status;
  saveState(false);
}

export function addActualSet(dayId, instId) {
  const inst = findInstance(dayId, instId);
  if (!inst) return;
  const exercise = libraryItemById('exercises', inst.exerciseId);
  const isDuration = !!(exercise && exercise.isDuration);
  const trackedFields = trackedFieldsOf(exercise);
  const last = inst.actualSets[inst.actualSets.length - 1];
  if (last) {
    const row = { touched: false };
    trackedFields.forEach((key) => { if (key !== 'setCount') row[key] = last[key]; });
    inst.actualSets.push(row);
  } else {
    inst.actualSets.push(buildOneActualSet(inst.prescribed, trackedFields, isDuration));
  }
  saveState(false);
}

export function removeActualSet(dayId, instId, setIndex) {
  const inst = findInstance(dayId, instId);
  if (!inst) return;
  inst.actualSets.splice(setIndex, 1);
  saveState(false);
}

export function updateActualSetField(dayId, instId, setIndex, field, value, debounce = false) {
  const inst = findInstance(dayId, instId);
  if (!inst) return;
  const row = inst.actualSets[setIndex];
  row[field] = value;
  row.touched = true;
  inst.loggedAt = Date.now();
  for (let i = setIndex + 1; i < inst.actualSets.length; i++) {
    const next = inst.actualSets[i];
    if (!next.touched) {
      next.weight = row.weight;
      next.reps = row.reps;
      next.rir = row.rir;
    }
  }
  saveState(debounce);
}

/* ---------- "Last time this exercise" lookup ---------- */

export function getLastInstance(exerciseId, excludeDayEntryId) {
  const list = historyIndex[exerciseId];
  if (!list) return null;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].dayEntryId !== excludeDayEntryId) return list[i];
  }
  return null;
}

/* ---------- Payments ---------- */

export function getPayments() {
  return [...state.payments].sort((a, b) => b.date.localeCompare(a.date));
}

export function addPayment(date, amount, note) {
  const payment = { id: uid('pay'), date, amount: amount || null, note: note || '' };
  state.payments.push(payment);
  saveState(false);
  return payment;
}

export function deletePayment(id) {
  state.payments = state.payments.filter((p) => p.id !== id);
  saveState(false);
}

const PAYMENT_COUNTDOWN_DAYS = 10;

function clampDayToMonth(year, month, day) {
  const lastDay = new Date(year, month + 1, 0).getDate();
  return Math.min(day, lastDay);
}

function anchorDateFor(anchorDay, year, month) {
  return new Date(year, month, clampDayToMonth(year, month, anchorDay));
}

// Bir ödeme, kendi ayının milad gününü KAPATIR — o gün gelmeden önce (erken),
// tam o gün, ya da geçtikten sonra (geç) yapılmış olması fark etmiyor. Sıradaki
// ödeme her zaman BİR SONRAKİ ayın milad günü. Eskiden bu sadece milad günü
// geçmişse/tam o günse bir sonraki aya atlıyordu — erken ödemede (ör. milad 5,
// ödeme 3'ünde) o ayın miladını hâlâ "önümüzde" gösteriyordu, "erken ödedim,
// hoca işaretledi ama uygulama hâlâ bu ayın ödemesini bekliyormuş gibi
// davranıyor" diye bildirilen gerçek bir kullanıcı şikayetiydi.
function nextOccurrenceAfter(anchorDay, date) {
  let year = date.getFullYear();
  let month = date.getMonth() + 1;
  if (month > 11) { month = 0; year += 1; }
  return anchorDateFor(anchorDay, year, month);
}

function paymentDaysBetween(a, b) {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

// Kayan 4 haftalık döngü yerine sabit ayın günü: en ESKİ ödemenin günü kalıcı
// milad oluyor (ayrı bir ayar yok — "hangi gün ödemeye başladıysa o milad").
// Sıradaki ödeme, EN SON ödemeden sonraki ilk milad günü — geç ödense bile bir
// sonraki miladı ERTELEMİYOR, sadece o anki gecikmeyi kapatıyor. js/coach/
// paymentCycle.js'te İZOLE bir kopyası var (coach sayfaları bu dosyayı import
// edemiyor) — biri değişirse ikisi de değişmeli.
export function getPaymentCycleStatus() {
  const sorted = getPayments();
  if (!sorted.length) return { hasPayment: false };

  const anchorDay = isoToDate(sorted[sorted.length - 1].date).getDate();
  const today = isoToDate(todayIso());
  const latestPaymentDate = isoToDate(sorted[0].date);
  const dueDate = nextOccurrenceAfter(anchorDay, latestPaymentDate);
  const overdue = today.getTime() > dueDate.getTime();
  const dueDateIso = `${dueDate.getFullYear()}-${pad2(dueDate.getMonth() + 1)}-${pad2(dueDate.getDate())}`;

  if (overdue) {
    return {
      hasPayment: true,
      anchorDay,
      overdue: true,
      dueDate: dueDateIso,
      daysSinceDue: paymentDaysBetween(dueDate, today),
    };
  }
  const daysUntilDue = paymentDaysBetween(today, dueDate);
  return {
    hasPayment: true,
    anchorDay,
    overdue: false,
    dueDate: dueDateIso,
    daysUntilDue,
    countdown: daysUntilDue <= PAYMENT_COUNTDOWN_DAYS,
  };
}

/* ---------- Backup: export / import ---------- */

export function exportBackup() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `gymbn-yedek-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function importBackup(file, onDone) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed || !Array.isArray(parsed.dayEntries)) throw new Error('Geçersiz yedek dosyası formatı');
      if (!Array.isArray(parsed.exercises)) parsed.exercises = [];
      if (!Array.isArray(parsed.dayTypes)) parsed.dayTypes = [];
      if (!Array.isArray(parsed.payments)) parsed.payments = [];
      if (!parsed.schemaVersion) parsed.schemaVersion = SCHEMA_VERSION;
      state = parsed;
      saveState(false);
      onDone(null);
    } catch (e) {
      onDone(e);
    }
  };
  reader.onerror = () => onDone(new Error('Dosya okunamadı'));
  reader.readAsText(file);
}
