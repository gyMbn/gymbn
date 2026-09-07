import { normalizeForMatch, addDaysIso, mondayOfWeek, todayIso, escapeHtml, formatDateShortTr, statusBadge, DEFAULT_TRACKED_FIELDS, TRACKED_FIELD_TYPES, bindSheetBackClose } from '../util.js';
import { parseWeeklyProgramText } from '../bulkParse.js';
import { getStudent, getStudentAppState, setStudentAppState, listCatalog, getMyCoachProfile, notifyStudent } from './coachCloud.js';
import { confirmSheet } from '../components/confirmSheet.js';
import { closestCatalogMatch } from '../shared/catalogMatch.js';

// bulkAdd.js'in AYNI yapıştır→ayrıştır→düzenlenebilir önizleme→onayla akışı,
// ama js/storage.js'in yerel singleton'ı yerine BAŞKA bir kullanıcının uzaktan
// çekilen state objesi üzerinde çalışıyor — bilerek bulkAdd.js'e dokunulmadı
// (bkz. plan), storage.js'in CRUD yardımcıları da BİLEREK import edilmedi:
// storage.js, cloudSync.js'i import ediyor ve o da kendi (paylaşılan/localStorage
// kalıcı) Firebase auth oturumunu başlatıyor — bu sayfanın izole, bellek-içi
// auth oturumuyla (bkz. shared/firebaseClient.js) çakışmaması için CRUD mantığı
// burada küçük, saf bir kopya olarak tutuluyor.

function uid(prefix) {
  const time = Date.now().toString(36).slice(-4);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${time}${rand}`;
}

function emptyState() {
  return { schemaVersion: 1, updatedAt: 0, exercises: [], dayTypes: [], dayEntries: [], payments: [], measurements: [] };
}

function activeDayTypes(state) { return state.dayTypes.filter((d) => !d.archived); }
function findDayEntryByDate(state, dateIso) { return state.dayEntries.find((d) => d.date === dateIso) || null; }
function suggestNextDayNumber(state) {
  if (!state.dayEntries.length) return null;
  return Math.max(...state.dayEntries.map((d) => Number(d.dayNumber) || 0)) + 1;
}
function addDayType(state, name) {
  const item = { id: uid('dt'), name: name.trim(), archived: false };
  state.dayTypes.push(item);
  return item;
}
function createDayEntry(state, { date, dayNumber, dayTypeId }) {
  const entry = { id: uid('day'), date, dayNumber: dayNumber ?? null, dayTypeId: dayTypeId ?? null, exercises: [] };
  state.dayEntries.push(entry);
  return entry;
}

function weekDates(monday) { return Array.from({ length: 7 }, (_, i) => addDaysIso(monday, i)); }

// Bir haftanın en az bir egzersizli günü var mı — "aynı haftaya 2. program
// giremezsin" kuralının temeli. Boş gün kayıtları (dayType seçilmiş ama hiç
// egzersiz eklenmemiş) işgal sayılmıyor, tıpkı findMostRecentSourceWeek'te olduğu gibi.
function weekIsOccupied(state, monday) {
  return weekDates(monday).some((d) => { const e = findDayEntryByDate(state, d); return e && e.exercises.length > 0; });
}

// Haftayı işgal eden ilk günün assignmentSeq'i — bu alan bu özellikten ÖNCE
// oluşturulmuş eski kayıtlarda hiç yok, o yüzden null dönebilir; çağıran taraf
// numarasız bir uyarı gösteriyor o durumda.
function findWeekAssignmentSeq(state, monday) {
  for (const d of weekDates(monday)) {
    const e = findDayEntryByDate(state, d);
    if (e && e.exercises.length) return e.assignmentSeq ?? null;
  }
  return null;
}

// `startMonday`den başlayıp (dahil), hiç egzersizli günü olmayan ilk haftayı
// bulana kadar hafta hafta ileri gidiyor. 2 yıllık güvenlik sınırı sadece
// pratikte hiç ulaşılmayacak bir sonsuz döngüyü engellemek için.
function findNextEmptyWeek(state, startMonday) {
  let candidate = startMonday;
  for (let i = 0; i < 104; i++) {
    if (!weekIsOccupied(state, candidate)) return candidate;
    candidate = addDaysIso(candidate, 7);
  }
  return candidate;
}

// Bu haftaya YENİ bir program atanacaksa hangi haftaya gideceğini ve varsa
// çakışan mevcut programın kimliğini tek yerde topluyor.
function getWeekConflict(state, monday) {
  if (!weekIsOccupied(state, monday)) return { occupied: false, seq: null, targetMonday: monday };
  return {
    occupied: true,
    seq: findWeekAssignmentSeq(state, monday),
    targetMonday: findNextEmptyWeek(state, addDaysIso(monday, 7)),
  };
}

// Her "Onayla ve Ata" tıklaması, öğrencinin tüm kayıtları arasında tekil bir
// sıra numarası alıyor (öğrenciye özel — state başka birinin verisi değil).
// Bir sorun çıkarsa "hangi atama bu günü oluşturdu" diye kolayca tespit edilsin
// diye — kullanıcının kendi isteği.
function suggestNextAssignmentSeq(state) {
  const max = Math.max(0, ...state.dayEntries.map((d) => Number(d.assignmentSeq) || 0));
  return max + 1;
}

// Silme onayında "burada gerçek veri var mı" uyarısı için — kaç egzersizin en
// az bir seti gerçekten işaretlenmiş, bkz. buildLastTimeInfo'daki AYNI kontrol.
function countTouchedExercisesInWeek(state, monday) {
  let count = 0;
  for (const d of weekDates(monday)) {
    const entry = findDayEntryByDate(state, d);
    if (!entry) continue;
    for (const inst of entry.exercises) {
      if (inst.actualSets.some((s) => s.touched)) count++;
    }
  }
  return count;
}

// Hocanın yanlış attığı bir haftayı geri almasını sağlıyor — o haftanın 7
// tarihindeki gün kayıtlarını (boş olanlar dahil) tamamen kaldırıyor, hafta
// gerçekten "boş" sayılsın diye.
function deleteWeekAssignment(state, monday) {
  const dates = new Set(weekDates(monday));
  state.dayEntries = state.dayEntries.filter((d) => !dates.has(d.date));
}

// storage.js'in (module-private, export edilmemiş) buildActualSetsFromPrescribed'ıyla
// AYNI mantığın kasıtlı küçük kopyası — bkz. dosya başındaki not.
function extractLeadingInt(str, fallback) {
  const match = String(str ?? '').match(/\d+/);
  return match ? parseInt(match[0], 10) : fallback;
}
function clampRir(n) { return Math.max(0, Math.min(9, n)); }

const SET_COUNT_MAX = 20;
const REPS_MAX = 30;
const RIR_MAX = 9;
const UNTIL_FAILURE_TEXT = 'tükenene kadar';

function fieldDisplay(value) {
  return value === '' || value == null ? '—' : String(value);
}

function parseRangeValue(str) {
  const match = String(str ?? '').match(/^(\d+)(?:-(\d+))?$/);
  if (!match) return { start: null, end: null };
  return { start: parseInt(match[1], 10), end: match[2] ? parseInt(match[2], 10) : null };
}

function formatRangeValue(start, end) {
  if (start == null) return '';
  if (end == null || end === start) return String(start);
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  return `${lo}-${hi}`;
}

// Set için sade, tekil seçici — setRows.js'in openNumberPicker'ıyla aynı iskelet
// (target kavramı hariç, burada karşılaştırılacak bir hedef yok, kendisi hedefi girer).
function openSetPicker({ current, onSelect }) {
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  let cells = '';
  for (let i = 1; i <= SET_COUNT_MAX; i++) {
    cells += `<button type="button" class="number-picker-cell${i === current ? ' selected' : ''}" data-value="${i}">${i}</button>`;
  }
  backdrop.innerHTML = `
    <div class="sheet">
      <div class="sheet-title">Set</div>
      <button type="button" class="zero-btn${current === 0 ? ' selected' : ''}" data-value="0">0</button>
      <hr class="zero-divider">
      <div class="number-picker-grid">${cells}</div>
      <button type="button" class="btn btn-block sheet-close">Kapat</button>
    </div>
  `;
  document.body.appendChild(backdrop);

  const close = bindSheetBackClose(() => backdrop.remove());
  function handlePick(e) {
    const cell = e.target.closest('.number-picker-cell, .zero-btn');
    if (!cell) return;
    onSelect(Number(cell.dataset.value));
    close();
  }
  backdrop.querySelector('.number-picker-grid').addEventListener('click', handlePick);
  backdrop.querySelector('.zero-btn').addEventListener('click', handlePick);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  backdrop.querySelector('.sheet-close').addEventListener('click', close);

  const selectedEl = backdrop.querySelector('.number-picker-cell.selected');
  if (selectedEl) selectedEl.scrollIntoView({ block: 'center' });
}

// Tekrar/Rir için aralık-veya-tekil seçici: bir sayıya dokun = tekil aday, ikinci
// (farklı) sayıya dokun = aralık, aynı sayıya tekrar dokunursan tekile döner.
// `allowFailure` (sadece Tekrar) verilirse "Tükenene kadar" checkbox'ı eklenir —
// bulkParse.js'te UNTIL_FAILURE_RE ile eşleşen TEK serbest metin değeri bu, Rir hiç
// metin almadığı için orada checkbox yok.
function openRangePicker({ title, max, current, allowFailure, onSelect }) {
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  const isFailure = !!allowFailure && current === UNTIL_FAILURE_TEXT;
  let { start, end } = isFailure ? { start: null, end: null } : parseRangeValue(current);

  backdrop.innerHTML = `
    <div class="sheet">
      <div class="sheet-title">${escapeHtml(title)}</div>
      ${allowFailure ? `
        <div class="checkbox-row">
          <input type="checkbox" id="range-failure-check"${isFailure ? ' checked' : ''}>
          <label for="range-failure-check">Tükenene kadar</label>
        </div>
      ` : ''}
      <div class="range-readout"></div>
      <button type="button" class="zero-btn" data-value="0">0</button>
      <hr class="zero-divider">
      <div class="number-picker-grid"></div>
      <button type="button" class="btn btn-block sheet-close">Kapat</button>
    </div>
  `;
  document.body.appendChild(backdrop);

  const grid = backdrop.querySelector('.number-picker-grid');
  const zeroBtn = backdrop.querySelector('.zero-btn');
  const readout = backdrop.querySelector('.range-readout');
  const checkbox = backdrop.querySelector('#range-failure-check');

  function pick(i) {
    if (start == null || end != null) { start = i; end = null; }
    else { end = i; }
    render();
  }

  function render() {
    let cells = '';
    for (let i = 1; i <= max; i++) {
      const inRange = start != null && end != null && i >= Math.min(start, end) && i <= Math.max(start, end);
      const isEdge = i === start || i === end;
      cells += `<button type="button" class="number-picker-cell${isEdge ? ' selected' : inRange ? ' range-mid' : ''}" data-value="${i}">${i}</button>`;
    }
    grid.innerHTML = cells;
    zeroBtn.classList.toggle('selected', start === 0 || end === 0);
    updateReadout();
    updateFailureState();
    const selectedEl = grid.querySelector('.selected');
    if (selectedEl) selectedEl.scrollIntoView({ block: 'center' });
  }

  function updateReadout() {
    if (checkbox && checkbox.checked) { readout.textContent = 'Tükenene kadar seçili'; return; }
    if (start != null && end != null) {
      readout.textContent = formatRangeValue(start, end) + ' seçili';
    } else if (start != null) {
      readout.textContent = start + ' seçili — aralık için ikinci sayıya dokun';
    } else {
      readout.textContent = '';
    }
  }

  function updateFailureState() {
    if (!checkbox) return;
    grid.classList.toggle('grid-disabled', checkbox.checked);
    zeroBtn.classList.toggle('grid-disabled', checkbox.checked);
  }

  grid.addEventListener('click', (e) => {
    const cell = e.target.closest('.number-picker-cell');
    if (cell) pick(Number(cell.dataset.value));
  });
  zeroBtn.addEventListener('click', () => pick(0));
  if (checkbox) checkbox.addEventListener('change', () => { updateReadout(); updateFailureState(); });

  // Bu picker'da gerçek bir "vazgeç" kavramı yok — Kapat/backdrop/geri tuşu
  // hepsi o an seçili olan değeri onSelect ile commit ediyor.
  const close = bindSheetBackClose(() => {
    onSelect(checkbox && checkbox.checked ? UNTIL_FAILURE_TEXT : formatRangeValue(start, end));
    backdrop.remove();
  });
  backdrop.querySelector('.sheet-close').addEventListener('click', close);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });

  render();
}
// storage.js'in (module-private) buildOneActualSet/buildActualSetsFromPrescribed'ıyla
// AYNI mantığın kasıtlı küçük kopyası — bkz. dosya başındaki not. trackedFields'ta
// olmayan bir alan satıra hiç girmiyor (ör. Yürüyüş'te weight/rir yok) — eskiden
// bu fonksiyon hep weight/reps/rir'e sabitti, kataloğun gerçek takip alanlarına
// hiç bakmıyordu (bkz. bu düzeltmenin geldiği sohbet — "Süre" alanı olan bir
// egzersiz toplu atamada hiçbir zaman Süre değeri alamıyordu).
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
function buildActualSetsFromPrescribed(prescribed, trackedFields, isDuration) {
  const count = trackedFields.includes('setCount') ? Math.max(1, Number(prescribed.setCount) || 1) : 1;
  const rows = [];
  for (let i = 0; i < count; i++) rows.push(buildOneActualSet(prescribed, trackedFields, isDuration));
  return rows;
}
function addExerciseInstanceWithPrescribed(state, dayId, exerciseId, prescribed) {
  const entry = state.dayEntries.find((d) => d.id === dayId);
  if (!entry) return null;
  const exercise = state.exercises.find((e) => e.id === exerciseId);
  const isDuration = !!(exercise && exercise.isDuration);
  const trackedFields = (exercise && exercise.trackedFields) || DEFAULT_TRACKED_FIELDS;
  const inst = {
    id: uid('exi'),
    exerciseId,
    note: '',
    status: null,
    prescribed,
    actualSets: buildActualSetsFromPrescribed(prescribed, trackedFields, isDuration),
  };
  entry.exercises.push(inst);
  return inst;
}

export async function render(container, { studentUid }) {
  renderLoadingScreen(container);

  let student;
  let remoteState;
  let catalog;
  try {
    [student, remoteState, catalog] = await Promise.all([getStudent(studentUid), getStudentAppState(studentUid), listCatalog()]);
  } catch (err) {
    console.error('Öğrenci verisi yüklenemedi', err);
    renderErrorScreen(container, studentUid, 'Öğrenci verisi yüklenemedi, internet bağlantını kontrol edip tekrar dene.');
    return;
  }
  if (!student) {
    renderErrorScreen(container, studentUid, 'Öğrenci bulunamadı.');
    return;
  }
  if (!catalog.length) {
    renderErrorScreen(container, studentUid, 'Egzersiz kütüphanesi henüz boş. Önce admin ekranından en az bir egzersiz eklenmeli.');
    return;
  }

  const state = remoteState || emptyState();
  const monday = mondayOfWeek(todayIso());
  renderPasteScreen(container, student, state, monday, catalog);
}

function weekRangeLabel(monday) {
  return `${formatDateShortTr(monday)} – ${formatDateShortTr(addDaysIso(monday, 6))}`;
}

function renderLoadingScreen(container) {
  container.innerHTML = '<p class="empty-state">Yükleniyor…</p>';
}

function renderErrorScreen(container, studentUid, message) {
  container.innerHTML = `
    <div class="view-header">
      <a href="#/student/${studentUid}" class="back-link" aria-label="Geri">←</a>
      <h2 class="view-title">Program Ata</h2>
      <span></span>
    </div>
    <p class="empty-state">${escapeHtml(message)}</p>
  `;
}

function renderPasteScreen(container, student, state, monday, catalog) {
  // Aynı haftaya 2. bir program giremiyoruz (kullanıcının isteği) — bu hafta
  // zaten dolu ise yeni program otomatik olarak sıradaki BOŞ haftaya gidiyor,
  // hafta gezinmesi hiç eklemeden (bu ekranın zaten hiç hafta navigasyonu yok).
  // Coach isterse aynı yerden çakışan haftayı silip bu haftaya girmeyi tercih edebilir.
  const conflict = getWeekConflict(state, monday);
  const assignMonday = conflict.targetMonday;

  // En son eklenen programı kopyalama — "yapıştır+ayrıştır" yapılmış gibi AYNI
  // önizleme ekranına düşüyor, sadece kaynak metin yerine öğrencinin GERÇEKTEN
  // kayıtlı en son dolu haftası. Sabit "geçen hafta" DEĞİL — hedef haftadan (artık
  // her zaman bu hafta olmayabilir) önceki, en az bir egzersizli günü olan en son
  // haftayı arıyoruz. Hiç böyle bir hafta yoksa düğme hiç gösterilmiyor.
  const sourceMonday = findMostRecentSourceWeek(state, assignMonday);

  container.innerHTML = `
    <div class="view-header">
      <a href="#/student/${student.id}" class="back-link" aria-label="Geri">←</a>
      <h2 class="view-title">Program Ata</h2>
      <span></span>
    </div>
    <p class="muted bulk-intro">Öğrenci: <strong>${escapeHtml(student.displayName)}</strong></p>
    ${conflict.occupied ? `
      <div class="week-conflict-banner">
        <span class="week-conflict-flag">⚠</span>
        <div>
          <strong>${weekRangeLabel(monday)}</strong> haftasına zaten bir program atanmış${conflict.seq ? ` <span class="week-conflict-id">(Program #${conflict.seq})</span>` : ''}.
          Devam edersen yeni program otomatik olarak <strong>${weekRangeLabel(assignMonday)}</strong> haftasına atanacak.
        </div>
      </div>
      <button type="button" class="btn btn-block btn-danger" id="delete-week-btn">🗑 ${weekRangeLabel(monday)} Haftasının Programını Sil</button>
      <p class="muted" style="text-align:center; margin:var(--space-2) 0 var(--space-4);">veya</p>
    ` : ''}
    ${sourceMonday ? `
      <button type="button" class="btn btn-block" id="copy-prev-week-btn">↻ ${weekRangeLabel(sourceMonday)} Programını Kopyala</button>
      <p class="muted" style="text-align:center; margin:var(--space-2) 0 var(--space-4);">veya</p>
    ` : ''}
    <p class="muted bulk-intro">Haftalık programı, gün başlıklarının arasında boş satır bırakarak aşağıya yapıştır:</p>
    <textarea id="paste-textarea" class="bulk-textarea" placeholder="Anterior - 1
dumbell shoulder press 2 set 8-9 tekrar 12.5kg
...

Posterior - 1
Barfiks 3 set 5-6 tekrar
..."></textarea>
    <button type="button" class="btn btn-primary btn-block" id="parse-btn">Ayrıştır</button>
  `;

  if (conflict.occupied) {
    container.querySelector('#delete-week-btn').addEventListener('click', async () => {
      const touchedCount = countTouchedExercisesInWeek(state, monday);
      const idSuffix = conflict.seq ? ` (Program #${conflict.seq})` : '';
      const message = touchedCount
        ? `${weekRangeLabel(monday)} haftasının programı${idSuffix} tamamen silinecek.\n\n⚠ Bu haftada ${touchedCount} egzersiz gerçekten işaretlenmiş — öğrenci bu haftadan gerçek antrenman verisi girmiş. Yine de silinsin mi?`
        : `${weekRangeLabel(monday)} haftasının programı${idSuffix} silinsin mi?`;
      if (!(await confirmSheet(message, { confirmLabel: 'Sil' }))) return;

      const deleteBtn = container.querySelector('#delete-week-btn');
      deleteBtn.disabled = true;
      deleteBtn.textContent = 'Siliniyor…';
      try {
        deleteWeekAssignment(state, monday);
        await setStudentAppState(student.id, state);
      } catch (err) {
        console.error('Hafta silinemedi', err);
        alert('Silinemedi, internet bağlantını kontrol edip tekrar dene.');
        deleteBtn.disabled = false;
        deleteBtn.textContent = `🗑 ${weekRangeLabel(monday)} Haftasının Programını Sil`;
        return;
      }
      renderPasteScreen(container, student, state, monday, catalog);
    });
  }

  if (sourceMonday) {
    container.querySelector('#copy-prev-week-btn').addEventListener('click', () => {
      const blocks = assignDefaultDates(buildBlocksFromExistingWeek(state, catalog, sourceMonday), state, assignMonday);
      renderReviewScreen(container, student, state, monday, assignMonday, blocks, catalog);
    });
  }

  container.querySelector('#parse-btn').addEventListener('click', () => {
    const text = container.querySelector('#paste-textarea').value;
    if (!text.trim()) return;
    const blocks = assignDefaultDates(
      parseWeeklyProgramText(text).map((b) => enrichBlock(b, state, catalog)),
      state, assignMonday,
    );
    renderReviewScreen(container, student, state, monday, assignMonday, blocks, catalog);
  });
}

// `beforeMonday`den KESİNLİKLE önceki (bu hafta hariç), en az bir egzersizli günü
// olan en son tarihi bulup o tarihin ait olduğu haftanın Pazartesi'sini döner —
// böyle bir tarih hiç yoksa null. Sabit bir "1 hafta öncesi" aralığı DEĞİL, tüm
// geçmişi tarar; ne kadar eskiyse eskisin fark etmiyor (bkz. renderPasteScreen).
function findMostRecentSourceWeek(state, beforeMonday) {
  let latestDate = null;
  for (const entry of state.dayEntries) {
    if (!entry.exercises.length) continue;
    if (entry.date >= beforeMonday) continue;
    if (!latestDate || entry.date > latestDate) latestDate = entry.date;
  }
  return latestDate ? mondayOfWeek(latestDate) : null;
}

// Kaynak haftanın (findMostRecentSourceWeek'in bulduğu) GERÇEK (kayıtlı)
// günlerini, enrichBlock()'un ayrıştırılmış metinden ürettiğiyle AYNI şekle
// çeviriyor — önizleme ekranı ikisi arasındaki farkı hiç bilmiyor. Egzersizsiz
// (boş/dinlenme) günler atlanıyor, kopyalanacak bir şey yok çünkü.
// Önce exercise.sourceCatalogId ile ID üzerinden eşleştirmeyi deniyoruz (bkz.
// resolveLocalExercise) — bu en sağlam yol, kataloğun ismi sonradan değişse
// bile kırılmıyor. AMA bu alan hiç set edilmemiş (kataloğa hiç bağlanmamadan
// önce eklenmiş eski bir kayıt) ya da işaret ettiği katalog girdisi artık
// arşivlenmiş/silinmiş olabilir — o durumda enrichBlock()'un yapıştırılan metin
// için zaten yaptığı AYNI isim eşleştirmesine (normalizeForMatch) düşüyoruz:
// kopyalanan hafta, aynı metni elle yapıştırmaktan daha az şansa sahip olmasın.
// İkisi de bulamazsa (isim de kataloğa uymuyorsa) önizlemede normal şekilde
// "eşleşme yok" olarak işleniyor.
function buildBlocksFromExistingWeek(state, catalog, weekMonday) {
  const weekDates = Array.from({ length: 7 }, (_, i) => addDaysIso(weekMonday, i));
  const entries = weekDates.map((d) => findDayEntryByDate(state, d)).filter((e) => e && e.exercises.length);
  return entries.map((entry) => {
    const dt = entry.dayTypeId ? state.dayTypes.find((d) => d.id === entry.dayTypeId) : null;
    return {
      dayTypeRaw: dt ? dt.name : 'Antrenman',
      dayTypeId: entry.dayTypeId || null,
      assignedDate: null,
      exercises: entry.exercises.map((inst) => {
        const exercise = state.exercises.find((e) => e.id === inst.exerciseId);
        const parsedName = exercise ? exercise.name : '';
        const sourceCatalogId = exercise?.sourceCatalogId || null;
        let catalogMatch = sourceCatalogId ? catalog.find((c) => c.id === sourceCatalogId) : null;
        if (!catalogMatch) {
          const normalizedName = normalizeForMatch(parsedName);
          catalogMatch = catalog.find((c) => normalizeForMatch(c.name) === normalizedName) || null;
        }
        // Hangi alanlar kopyalanacak: eşleşen kataloğun (bulunduysa), yoksa
        // yerel egzersizin kendi trackedFields'ı — eskiden sabit weight/
        // setCount/reps/rir'e sıkışmıştı, "Süre" gibi başka alanlar kopyalarken
        // sessizce kayboluyordu (bkz. bu düzeltmenin geldiği sohbet).
        const trackedFields = (catalogMatch && catalogMatch.trackedFields) || (exercise && exercise.trackedFields) || DEFAULT_TRACKED_FIELDS;
        const ex = {
          name: catalogMatch ? catalogMatch.name : parsedName,
          parsedName,
          catalogId: catalogMatch ? catalogMatch.id : null,
          coachNote: inst.prescribed.coachNote || '',
          lastTime: buildLastTimeInfo(inst, exercise),
        };
        trackedFields.forEach((key) => { ex[key] = inst.prescribed[key] ?? ''; });
        return ex;
      }),
    };
  });
}

// Kopyalanan hafta sadece HOCANIN o zaman istediğini (prescribed) taşırsa,
// öğrencinin gerçekte ne yaptığını hiç görmeden aynı sayılar ileri kopyalanabilir
// — ör. hoca 5 tekrar istemiş ama öğrenci 3 yapıp not düşmüşse, bunu görmeden
// tekrar 5 atamak yanlış olur. Bu yüzden salt-bilgilendirme amaçlı, DÜZENLENEMEZ
// bir "geçen sefer gerçekte ne oldu" özeti de taşınıyor (review ekranında her
// zaman görünür, ama commitBlocks hâlâ SADECE editable prescribed alanları
// kaydediyor — bu obje hiç oraya gitmiyor). Hiç set işaretlenmemişse (hâlâ
// prescribed'dan kopya varsayılan değerler) gösterecek gerçek bir şey yok, null
// dönüyor.
function buildLastTimeInfo(inst, exercise) {
  const touched = inst.actualSets.filter((s) => s.touched);
  if (!touched.length) return null;
  const isDuration = !!(exercise && exercise.isDuration);
  return {
    summary: summarizeActualSets(touched, isDuration),
    note: inst.note || '',
    status: inst.status || null,
  };
}

function summarizeActualSets(touchedSets, isDuration) {
  const unit = isDuration ? 'sn' : 'tekrar';
  const weight = joinUnique(touchedSets.map((s) => s.weight || '-'));
  const reps = touchedSets.map((s) => s.reps || '-').join(',');
  return weight && weight !== '-' ? `${weight} × ${reps} ${unit}` : `${reps} ${unit}`;
}

function joinUnique(values) {
  const unique = [...new Set(values)];
  return unique.length === 1 ? unique[0] : values.join('/');
}

function enrichBlock(block, state, catalog) {
  const normalized = normalizeForMatch(block.dayTypeRaw);
  const matched = activeDayTypes(state).find((dt) => normalizeForMatch(dt.name) === normalized);
  return {
    dayTypeRaw: block.dayTypeRaw,
    dayTypeId: matched ? matched.id : null,
    assignedDate: null,
    exercises: block.exercises.map((ex) => {
      const parsedName = ex.name;
      const normalizedName = normalizeForMatch(parsedName);
      const match = catalog.find((c) => normalizeForMatch(c.name) === normalizedName);
      return { ...ex, parsedName, catalogId: match ? match.id : null };
    }),
  };
}

function assignDefaultDates(blocks, state, monday) {
  const weekDates = Array.from({ length: 7 }, (_, i) => addDaysIso(monday, i));
  const emptyDates = weekDates.filter((d) => !findDayEntryByDate(state, d));
  const occupiedDates = weekDates.filter((d) => findDayEntryByDate(state, d));
  const preferredOrder = [...emptyDates, ...occupiedDates];
  blocks.forEach((block, i) => {
    block.assignedDate = preferredOrder[i] || weekDates[i % 7] || null;
  });
  return blocks;
}

function describeExistingEntry(state, dateIso) {
  const entry = findDayEntryByDate(state, dateIso);
  if (!entry) return '';
  const dt = entry.dayTypeId ? state.dayTypes.find((d) => d.id === entry.dayTypeId) : null;
  const parts = [dt ? dt.name : null, entry.exercises.length ? `${entry.exercises.length} egzersiz` : 'boş gün kaydı'].filter(Boolean);
  return `Bu günde zaten kayıt var: ${parts.join(' · ')}. Yeni egzersizler bunun üzerine eklenecek.`;
}

function renderReviewScreen(container, student, state, monday, assignMonday, blocks, catalog) {
  // Bu ekrana geldiğimizde hedef hafta KESİNLİKLE boş (getWeekConflict zaten
  // öyle bir hafta bulmuştu) — o yüzden commitBlocks'un dokunacağı her gün
  // yepyeni, aynı tek atamaya (assignmentSeq) ait olacak.
  const assignmentSeq = suggestNextAssignmentSeq(state);
  container.innerHTML = `
    <div class="view-header">
      <button type="button" class="back-link" id="back-to-paste-btn" aria-label="Geri">←</button>
      <h2 class="view-title">Önizleme</h2>
      <span></span>
    </div>
    <p class="muted bulk-intro">Öğrenci: <strong>${escapeHtml(student.displayName)}</strong></p>
    <p class="muted bulk-intro">${blocks.length} gün bulundu · <strong>${weekRangeLabel(assignMonday)}</strong> haftasına atanacak <span class="week-conflict-id">(Program #${assignmentSeq})</span>.</p>
    <p class="muted bulk-intro">Kırmızı çerçeveli egzersizler kataloğa eşleşmedi, kendin seç. Yanlış ayrıştırılan başka bir alan varsa düzelt, sonra onayla.</p>
    ${blocks.length > 1 ? `
    <div class="toggle-all-row">
      <button type="button" id="expand-all-btn">Tümünü Aç</button><span class="toggle-all-dot">·</span><button type="button" id="collapse-all-btn">Tümünü Kapat</button>
    </div>` : ''}
    <div id="blocks-root"></div>
    <button type="button" class="btn btn-primary btn-block" id="confirm-btn">Onayla ve Ata</button>
  `;

  container.querySelector('#back-to-paste-btn').addEventListener('click', () => {
    renderPasteScreen(container, student, state, monday, catalog);
  });

  const blocksRoot = container.querySelector('#blocks-root');
  // Hepsi kapalı geliyor — kullanıcının kendi isteği: önce tüm günlerin doğru
  // yakalandığını (başlık + tarih + egzersiz sayısı) tek bakışta, dağınıklık
  // olmadan görüp öyle isteğine göre tek tek açmak istiyor. Her kart bağımsız
  // açılıp kapanıyor.
  blocks.forEach((block) => blocksRoot.appendChild(buildBlockCard(block, state, catalog, false)));

  // Birden fazla gün olunca hepsini tek tek açıp kapatmak yorucu oluyor —
  // kullanıcının kendi isteği (bkz. bu değişikliğin geldiği sohbet).
  const expandAllBtn = container.querySelector('#expand-all-btn');
  const collapseAllBtn = container.querySelector('#collapse-all-btn');
  if (expandAllBtn) {
    expandAllBtn.addEventListener('click', () => {
      blocksRoot.querySelectorAll('.block-acc-header, .block-acc-body').forEach((el) => el.classList.remove('collapsed'));
    });
    collapseAllBtn.addEventListener('click', () => {
      blocksRoot.querySelectorAll('.block-acc-header, .block-acc-body').forEach((el) => el.classList.add('collapsed'));
    });
  }

  const confirmBtn = container.querySelector('#confirm-btn');
  confirmBtn.addEventListener('click', async () => {
    const unresolved = blocksRoot.querySelector('.bulk-ex-name-select.unresolved');
    if (unresolved) {
      unresolved.scrollIntoView({ behavior: 'smooth', block: 'center' });
      unresolved.focus();
      return;
    }
    const skipped = blocks.filter((b) => !b.assignedDate).length;
    if (skipped && !(await confirmSheet(`${skipped} gün tarihe atanmadığı için eklenmeyecek. Devam edilsin mi?`, { confirmLabel: 'Devam Et', danger: false }))) {
      return;
    }
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Kaydediliyor…';
    try {
      commitBlocks(state, blocks, catalog, assignmentSeq);
      await setStudentAppState(student.id, state);
      notifyStudentOfAssignment(student.id, blocks); // arka planda, redirect'i beklemiyor
      location.hash = '#/';
    } catch (err) {
      console.error('Program atanamadı', err);
      alert('Program kaydedilemedi, internet bağlantını kontrol edip tekrar dene.');
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Onayla ve Ata';
    }
  });
}

function buildBlockCard(block, state, catalog, startOpen) {
  const card = document.createElement('div');
  card.className = 'card bulk-block-card';

  const dayTypeOptions = activeDayTypes(state).map((dt) => (
    `<option value="${dt.id}"${dt.id === block.dayTypeId ? ' selected' : ''}>${escapeHtml(dt.name)}</option>`
  )).join('');
  const newDayTypeOption = block.dayTypeId
    ? ''
    : `<option value="" selected>Yeni: ${escapeHtml(block.dayTypeRaw || 'İsimsiz')}</option>`;

  card.innerHTML = `
    <div class="block-acc-header${startOpen ? '' : ' collapsed'}">
      <div class="block-acc-header-main">
        <span class="block-acc-header-title"></span>
        <span class="block-acc-header-sub"></span>
      </div>
      <span class="block-acc-badge">${block.exercises.length} egzersiz</span>
      <span class="block-acc-chev">▾</span>
    </div>
    <div class="block-acc-body${startOpen ? '' : ' collapsed'}">
      <div class="block-acc-body-inner">
        <div class="form-row">
          <div class="field">
            <label>Gün Tipi</label>
            <select class="block-daytype-select">${newDayTypeOption}${dayTypeOptions}</select>
          </div>
          <div class="field">
            <label>Tarih</label>
            <input type="date" class="block-date-input" value="${block.assignedDate || ''}">
          </div>
        </div>
        <div class="block-date-info muted"></div>
        <div class="block-exercise-list"></div>
        <button type="button" class="btn btn-block block-add-exercise-btn">+ Egzersiz Ekle</button>
      </div>
    </div>
  `;

  const header = card.querySelector('.block-acc-header');
  const body = card.querySelector('.block-acc-body');
  const headerTitle = card.querySelector('.block-acc-header-title');
  const headerSub = card.querySelector('.block-acc-header-sub');
  const badge = card.querySelector('.block-acc-badge');
  function updateBadge() {
    badge.textContent = `${block.exercises.length} egzersiz`;
  }

  // Başlık şeridi, gün tipi/tarih değiştikçe (aşağıdaki iki change listener'ında)
  // canlı güncelleniyor — kapalıyken bile hangi gün olduğu doğru görünsün diye.
  function updateHeaderText() {
    const dt = block.dayTypeId ? state.dayTypes.find((d) => d.id === block.dayTypeId) : null;
    headerTitle.textContent = dt ? dt.name : (block.dayTypeRaw || 'İsimsiz');
    headerSub.textContent = block.assignedDate ? formatDateShortTr(block.assignedDate) : 'Tarih seçilmedi';
  }
  updateHeaderText();

  header.addEventListener('click', () => {
    header.classList.toggle('collapsed');
    body.classList.toggle('collapsed');
  });

  card.querySelector('.block-daytype-select').addEventListener('change', (e) => {
    block.dayTypeId = e.target.value || null;
    updateHeaderText();
  });

  const dateInput = card.querySelector('.block-date-input');
  const dateInfo = card.querySelector('.block-date-info');
  function updateDateInfo() {
    dateInfo.textContent = block.assignedDate ? describeExistingEntry(state, block.assignedDate) : '';
  }
  dateInput.addEventListener('change', (e) => {
    block.assignedDate = e.target.value || null;
    updateDateInfo();
    updateHeaderText();
  });
  updateDateInfo();

  const exList = card.querySelector('.block-exercise-list');
  block.exercises.forEach((ex) => {
    exList.appendChild(buildExerciseRow(ex, block, exList, catalog, updateBadge));
  });

  // "Önceki haftayı kopyala" ile gelen bir günde, o gün için hoca yeni bir
  // egzersiz ekleyemiyordu (sadece kopyalanan satırların değerlerini
  // değiştirebiliyordu) — kullanıcının kendi isteği. Yeni satır, yapıştırılan
  // metinden hiç eşleşmemiş bir satırla AYNI boş/unresolved durumda başlıyor:
  // hoca kataloktan seçmek ZORUNDA, serbest metin girişi yok (bkz. proje
  // genelindeki "bağımsız hareket kalmamalı" ilkesi).
  card.querySelector('.block-add-exercise-btn').addEventListener('click', () => {
    const ex = { name: '', parsedName: '', catalogId: null, weight: '', setCount: '', reps: '', rir: '', coachNote: '', lastTime: null };
    block.exercises.push(ex);
    const row = buildExerciseRow(ex, block, exList, catalog, updateBadge);
    row.classList.add('row-appear');
    exList.appendChild(row);
    updateBadge();
    row.querySelector('.bulk-ex-name-select').focus();
  });

  return card;
}

// Seçili (ya da henüz seçilmemiş) egzersizin hangi alanları takip ettiği —
// kataloğun kendi ayarına göre. Eşleşmemiş satırlar için varsayılan 4 alan
// (Ağırlık/Set/Tekrar/Rir) gösterilir, gerçek liste seçim yapılınca gelir.
function fieldsForExercise(ex, catalog) {
  const catalogEx = catalog.find((c) => c.id === ex.catalogId);
  return (catalogEx && catalogEx.trackedFields) || DEFAULT_TRACKED_FIELDS;
}

// Bilinen 4 alan (weight/setCount/reps/rir) kendi özel kontrolünü korur (metin
// kutusu ya da sayı seçici) — geri kalan her şey (süre/eğim/hız/mesafe/direnç)
// weight ile aynı basit metin kutusu, etiketi TRACKED_FIELD_TYPES'tan.
function buildFieldHtml(ex, key) {
  if (key === 'weight') {
    return `<div class="field"><label>Ağırlık</label><input type="text" class="bulk-ex-field" data-field="weight" value="${escapeHtml(ex.weight || '')}"></div>`;
  }
  if (key === 'setCount') {
    return `<div class="field"><label>Set</label><button type="button" class="bulk-picker-trigger${ex.setCount === '' || ex.setCount == null ? ' empty' : ''}" data-field="setCount">${escapeHtml(fieldDisplay(ex.setCount))}</button></div>`;
  }
  if (key === 'reps') {
    return `<div class="field"><label>Tekrar</label><button type="button" class="bulk-picker-trigger${ex.reps === '' || ex.reps == null ? ' empty' : ''}" data-field="reps">${escapeHtml(fieldDisplay(ex.reps))}</button></div>`;
  }
  if (key === 'rir') {
    return `<div class="field"><label>Rir</label><button type="button" class="bulk-picker-trigger${ex.rir === '' || ex.rir == null ? ' empty' : ''}" data-field="rir">${escapeHtml(fieldDisplay(ex.rir))}</button></div>`;
  }
  const meta = TRACKED_FIELD_TYPES.find((f) => f.key === key);
  const label = meta ? `${meta.label}${meta.unit ? ` (${meta.unit})` : ''}` : key;
  return `<div class="field"><label>${escapeHtml(label)}</label><input type="text" class="bulk-ex-field" data-field="${escapeHtml(key)}" value="${escapeHtml(ex[key] || '')}"></div>`;
}

function buildExerciseRow(ex, block, exList, catalog, onCountChange) {
  const row = document.createElement('div');
  row.className = 'bulk-exercise-row';
  const sortedCatalog = [...catalog].sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  const options = sortedCatalog.map((c) => (
    `<option value="${c.id}"${ex.catalogId === c.id ? ' selected' : ''}>${escapeHtml(c.name)}</option>`
  )).join('');
  const placeholderLabel = ex.catalogId
    ? '— eşleşme yok, seç —'
    : (ex.parsedName ? `"${ex.parsedName}" — eşleşme yok, seç` : '— egzersiz seç —');
  const suggestion = ex.catalogId ? null : closestCatalogMatch(ex.parsedName, catalog);
  row.innerHTML = `
    <div class="bulk-exercise-row-top">
      <div class="bulk-ex-name-wrap">
        <select class="bulk-ex-name-select${ex.catalogId ? '' : ' unresolved'}">
          <option value="">${escapeHtml(placeholderLabel)}</option>
          ${options}
        </select>
        ${suggestion ? `<button type="button" class="bulk-ex-suggest-btn" data-suggest-id="${suggestion.id}">Bunu mu demek istedin: "${escapeHtml(suggestion.name)}"?</button>` : ''}
      </div>
      <button type="button" class="btn-icon danger bulk-ex-remove" aria-label="Satırı sil">×</button>
    </div>
    <div class="bulk-exercise-row-fields">
      ${fieldsForExercise(ex, catalog).map((key) => buildFieldHtml(ex, key)).join('')}
    </div>
    ${ex.lastTime ? `
      <div class="bulk-ex-last-time">${statusBadge(ex.lastTime.status)}Geçen sefer: ${escapeHtml(ex.lastTime.summary)}${ex.lastTime.note ? ` — <span class="bulk-ex-last-time-note">"${escapeHtml(ex.lastTime.note)}"</span>` : ''}</div>
    ` : ''}
    <input type="text" class="bulk-ex-note" value="${escapeHtml(ex.coachNote)}" placeholder="Hoca notu (opsiyonel)">
  `;

  const nameSelect = row.querySelector('.bulk-ex-name-select');
  const fieldsWrap = row.querySelector('.bulk-exercise-row-fields');

  // Alanlar her yeniden çizildiğinde (ilk kurulumda VE resolveSelection sonrası,
  // bkz. aşağısı) yeniden çağrılıyor — eski düğümler innerHTML ile atılıp yenileri
  // takılıyor, o yüzden eski dinleyicilerin ayrıca sökülmesi gerekmiyor.
  function wireFields() {
    fieldsWrap.querySelectorAll('.bulk-ex-field').forEach((input) => {
      input.addEventListener('input', (e) => {
        ex[e.target.dataset.field] = e.target.value;
      });
    });
    const setBtn = fieldsWrap.querySelector('[data-field="setCount"]');
    if (setBtn) {
      setBtn.addEventListener('click', () => {
        openSetPicker({
          current: (ex.setCount === '' || ex.setCount == null) ? null : ex.setCount,
          onSelect: (value) => {
            ex.setCount = value;
            setBtn.textContent = fieldDisplay(value);
            setBtn.classList.remove('empty');
          },
        });
      });
    }
    const repsBtn = fieldsWrap.querySelector('[data-field="reps"]');
    if (repsBtn) {
      repsBtn.addEventListener('click', () => {
        openRangePicker({
          title: 'Tekrar',
          max: REPS_MAX,
          current: ex.reps,
          allowFailure: true,
          onSelect: (value) => {
            ex.reps = value;
            repsBtn.textContent = fieldDisplay(value);
            repsBtn.classList.toggle('empty', value === '');
          },
        });
      });
    }
    const rirBtn = fieldsWrap.querySelector('[data-field="rir"]');
    if (rirBtn) {
      rirBtn.addEventListener('click', () => {
        openRangePicker({
          title: 'Rir',
          max: RIR_MAX,
          current: ex.rir,
          onSelect: (value) => {
            ex.rir = value;
            rirBtn.textContent = fieldDisplay(value);
            rirBtn.classList.toggle('empty', value === '');
          },
        });
      });
    }
  }
  wireFields();

  function resolveSelection(catalogId) {
    const catalogEx = catalog.find((c) => c.id === catalogId);
    ex.catalogId = catalogEx ? catalogEx.id : null;
    ex.name = catalogEx ? catalogEx.name : '';
    nameSelect.value = ex.catalogId || '';
    nameSelect.classList.toggle('unresolved', !ex.catalogId);
    const suggestBtn = row.querySelector('.bulk-ex-suggest-btn');
    if (suggestBtn) suggestBtn.style.display = ex.catalogId ? 'none' : '';
    // Hangi hareket seçildiğine göre takip alanları değişebilir (ör. Ağırlık
    // kaldırmadan Yürüyüş'e geçmek) — alan listesi ve dinleyicileri baştan.
    fieldsWrap.innerHTML = fieldsForExercise(ex, catalog).map((key) => buildFieldHtml(ex, key)).join('');
    wireFields();
  }
  nameSelect.addEventListener('change', (e) => resolveSelection(e.target.value));
  const suggestBtn = row.querySelector('.bulk-ex-suggest-btn');
  if (suggestBtn) {
    suggestBtn.addEventListener('click', () => resolveSelection(suggestBtn.dataset.suggestId));
  }

  row.querySelector('.bulk-ex-note').addEventListener('input', (e) => {
    ex.coachNote = e.target.value;
  });
  row.querySelector('.bulk-ex-remove').addEventListener('click', () => {
    const idx = Array.from(exList.children).indexOf(row);
    if (idx !== -1) block.exercises.splice(idx, 1);
    row.remove();
    if (onCountChange) onCountChange();
  });

  return row;
}

// Egzersiz kimliği artık ortak katalogdan geliyor (Önizleme ekranındaki dropdown'da
// eşleştirildi) — burada sadece o kataloğun O ANKİ video/hedef bölge/isim verisini
// öğrencinin kendi state.exercises'ına kopyalıyoruz (sourceCatalogId ile işaretli).
// Öğrencinin kendi uygulaması (dayEntry.js) hâlâ sadece kendi yerel listesine bakıyor,
// hiç değişmedi — admin kataloğu sonradan güncellerse, hocanın bir sonraki atamasında
// (aynı sourceCatalogId üzerinden) taze veri tekrar kopyalanıyor.
// Bir katalog hareketi bu öğrenciye İLK KEZ atanıyorsa (sourceCatalogId'si
// olan bir kayıt hiç yoksa), körü körüne yeni bir kayıt açmadan ÖNCE aynı
// isimde (normalizeForMatch) ama hiç kataloğa bağlanmamış bir yerel kaydı
// (ör. öğrencinin daha önce kendi eklediği "bench press") arayıp ONU
// kataloğa bağlıyoruz — buildBlocksFromExistingWeek'in (v83) okuma tarafında
// zaten yaptığı isim-yedekleme mantığının AYNISI, burada yazma/atama tarafına
// da uygulanıyor. Bunsuz, öğrencinin coach'a bağlanmadan ÖNCEki tüm geçmişi
// (aynı hareket, aynı isim) "İlk kez yapılıyor" görünüyordu — bkz. bu
// düzeltmenin geldiği sohbet. Zaten kataloğa bağlı (başka bir sourceCatalogId
// taşıyan) bir kayıt asla bu şekilde "ele geçirilmiyor", sadece HİÇ
// bağlanmamış kayıtlar aday sayılıyor.
function resolveLocalExercise(state, catalogEx) {
  let exercise = state.exercises.find((e) => e.sourceCatalogId === catalogEx.id);
  if (!exercise) {
    const normalizedName = normalizeForMatch(catalogEx.name);
    exercise = state.exercises.find((e) => !e.sourceCatalogId && normalizeForMatch(e.name) === normalizedName) || null;
  }
  if (!exercise) {
    exercise = { id: uid('ex'), archived: false, sourceCatalogId: catalogEx.id };
    state.exercises.push(exercise);
  }
  exercise.sourceCatalogId = catalogEx.id;
  exercise.name = catalogEx.name;
  exercise.isDuration = !!catalogEx.isDuration;
  exercise.videoUrl = catalogEx.videoUrl || '';
  exercise.targetRegions = catalogEx.targetRegions || [];
  // Tracked-fields özelliği (Faz 1) eklendiğinde bu kopyalama unutulmuştu —
  // kataloğun "Takip Edilecek Alanlar" ayarı hiç buraya yansımıyordu, atanan
  // egzersiz her zaman DEFAULT_TRACKED_FIELDS'a (Ağırlık/Set/Tekrar/Rir)
  // düşüyordu, kataloğun kendisinde ne seçili olursa olsun. Bkz. bu düzeltmenin
  // geldiği sohbet (Hyper Extension'ın Süre yerine Tekrar göstermesi).
  exercise.trackedFields = catalogEx.trackedFields || DEFAULT_TRACKED_FIELDS;
  return exercise;
}

function commitBlocks(state, blocks, catalog, assignmentSeq) {
  for (const block of blocks) {
    if (!block.assignedDate) continue;

    let dayTypeId = block.dayTypeId;
    if (!dayTypeId) {
      dayTypeId = addDayType(state, block.dayTypeRaw || 'Antrenman').id;
    }

    let entry = findDayEntryByDate(state, block.assignedDate);
    if (!entry) {
      entry = createDayEntry(state, { date: block.assignedDate, dayNumber: suggestNextDayNumber(state), dayTypeId });
    } else if (!entry.dayTypeId) {
      entry.dayTypeId = dayTypeId;
    }
    entry.assignmentSeq = assignmentSeq;

    for (const ex of block.exercises) {
      if (!ex.catalogId) continue;
      const catalogEx = catalog.find((c) => c.id === ex.catalogId);
      if (!catalogEx) continue;
      const exercise = resolveLocalExercise(state, catalogEx);
      // Hangi alanlar geçerliyse (weight/setCount/reps/rir ya da süre/eğim/hız/
      // mesafe/direnç) sadece ONLAR kopyalanıyor — sabit 4 alan değil.
      const trackedFields = exercise.trackedFields || DEFAULT_TRACKED_FIELDS;
      const prescribed = { coachNote: ex.coachNote };
      trackedFields.forEach((key) => { prescribed[key] = ex[key] ?? ''; });
      addExerciseInstanceWithPrescribed(state, entry.id, exercise.id, prescribed);
    }
  }
}

// Ekranın kendi redirect'ini (location.hash) BEKLETMİYOR — bildirim gecikse/
// başarısız olsa bile hoca zaten atamayı tamamlamış oluyor, buradaki hata
// notifyStudent'ın kendi içinde sessizce yutuluyor.
async function notifyStudentOfAssignment(studentUid, blocks) {
  const names = blocks.filter((b) => b.assignedDate).map((b) => b.dayTypeRaw).filter(Boolean);
  if (!names.length) return;
  const coachProfile = await getMyCoachProfile();
  const coachName = coachProfile?.displayName || 'Hocan';
  notifyStudent(studentUid, 'program_assigned', `${coachName} sana yeni bir program atadı: ${names.join(', ')}`);
}
