import {
  dayTypes, exercises, createDayEntry, getDayEntryByDate, getDayEntries, suggestNextDayNumber,
  addExerciseInstanceWithPrescribed, updateDayEntryField, deleteDayEntry,
} from '../storage.js';
import {
  normalizeForMatch, addDaysIso, mondayOfWeek, todayIso, escapeHtml, formatDateShortTr, statusBadge, bindSheetBackClose,
} from '../util.js';
import { parseWeeklyProgramText } from '../bulkParse.js';
import { confirmSheet } from '../components/confirmSheet.js';
import { getMyCatalogIfManaged, getCoachOwnCatalogForLinking } from '../cloudSync.js';
import { closestCatalogMatch } from '../shared/catalogMatch.js';
import { openPicker } from '../components/picker.js';

// `catalog` null ise bireysel hesap — eski serbest metin davranışı, hiç değişmedi.
// Bir dizi ise (boş olsa bile) hesap coach-yönetimli bir öğrenci — o zaman isim
// alanı zorunlu bir katalog seçimine dönüyor (assignProgram.js'teki AYNI mantık),
// "kendi uydurma" bir isim yazıp sistemde tekrarlayan/yazım-hatalı kayıtlar
// çoğaltmasın diye — kullanıcının kendi isteği.
export async function render(container, params) {
  const monday = (params && params.mondayIso) || mondayOfWeek(todayIso());
  const catalog = await getMyCatalogIfManaged();
  if (catalog && !catalog.length) {
    container.innerHTML = `
      <div class="view-header">
        <button type="button" class="back-link" id="back-btn" aria-label="Geri">←</button>
        <h2 class="view-title">Programı Yapıştır</h2>
        <span></span>
      </div>
      <p class="empty-state">Egzersiz kütüphanesi henüz boş. Hocandan admin ekranından en az bir egzersiz eklemesini iste.</p>
    `;
    container.querySelector('#back-btn').addEventListener('click', () => history.back());
    return;
  }
  // catalog zaten zorunlu-dropdown modundaysa (coach-yönetimli öğrenci) ayrıca
  // "isteğe bağlı eşleştirme" özelliğine gerek yok — o zaten kataloğa bağlı.
  // Sadece bireysel/serbest-metin modda VE hesap aynı zamanda coach ise (Kendi
  // Antrenmanım) devreye giriyor — bkz. getCoachOwnCatalogForLinking.
  const linkCatalog = catalog ? null : await getCoachOwnCatalogForLinking();
  renderPasteScreen(container, monday, catalog, linkCatalog);
}

function weekDates(monday) { return Array.from({ length: 7 }, (_, i) => addDaysIso(monday, i)); }
function weekRangeLabel(monday) { return `${formatDateShortTr(monday)} – ${formatDateShortTr(addDaysIso(monday, 6))}`; }

// assignProgram.js'teki AYNI "aynı haftaya 2. program giremezsin" kuralı — bkz.
// oradaki yorum. TEK fark: bu ekrana zaten week.js'in ‹ › gezinmesinden
// gelinebiliyor, o yüzden burada assignProgram.js gibi otomatik "sıradaki boş
// haftaya atla" YOK — hafta doluysa sadece engelleniyor, kullanıcı ya siler ya
// da zaten sahip olduğu gezinmeyle kendi başka bir haftaya gider.
function weekIsOccupied(monday) {
  return weekDates(monday).some((d) => { const e = getDayEntryByDate(d); return e && e.exercises.length > 0; });
}

function findWeekAssignmentSeq(monday) {
  for (const d of weekDates(monday)) {
    const e = getDayEntryByDate(d);
    if (e && e.exercises.length) return e.assignmentSeq ?? null;
  }
  return null;
}

// assignProgram.js'teki suggestNextAssignmentSeq'in AYNI mantığı — bkz. oradaki yorum.
function suggestNextAssignmentSeq() {
  const max = Math.max(0, ...getDayEntries().map((d) => Number(d.assignmentSeq) || 0));
  return max + 1;
}

function countTouchedExercisesInWeek(monday) {
  let count = 0;
  for (const d of weekDates(monday)) {
    const entry = getDayEntryByDate(d);
    if (!entry) continue;
    for (const inst of entry.exercises) {
      if (inst.actualSets.some((s) => s.touched)) count++;
    }
  }
  return count;
}

function deleteWeekAssignment(monday) {
  for (const d of weekDates(monday)) {
    const entry = getDayEntryByDate(d);
    if (entry) deleteDayEntry(entry.id);
  }
}

function renderPasteScreen(container, monday, catalog, linkCatalog) {
  const occupied = weekIsOccupied(monday);
  const conflictSeq = occupied ? findWeekAssignmentSeq(monday) : null;

  // assignProgram.js'teki AYNI "en son dolu haftayı kopyala" kısayolu — bkz.
  // oradaki yorum. Bireysel/coach-yönetimli her iki modda da çalışıyor, sadece
  // kataloğa eşleşme kavramı (catalog varsa) korunuyor.
  const sourceMonday = findMostRecentSourceWeek(monday);

  container.innerHTML = `
    <div class="view-header">
      <button type="button" class="back-link" id="back-btn" aria-label="Geri">←</button>
      <h2 class="view-title">Programı Yapıştır</h2>
      <span></span>
    </div>
    ${occupied ? `
      <div class="week-conflict-banner">
        <span class="week-conflict-flag">⚠</span>
        <div>
          <strong>${weekRangeLabel(monday)}</strong> haftasına zaten bir program eklenmiş${conflictSeq ? ` <span class="week-conflict-id">(Program #${conflictSeq})</span>` : ''}.
          Devam etmek için önce bu haftanın programını silmen ya da başka bir haftaya gitmen gerekiyor.
        </div>
      </div>
      <button type="button" class="btn btn-block btn-danger" id="delete-week-btn">🗑 ${weekRangeLabel(monday)} Haftasının Programını Sil</button>
    ` : `
      ${sourceMonday ? `
        <button type="button" class="btn btn-block" id="copy-prev-week-btn">↻ ${weekRangeLabel(sourceMonday)} Programını Kopyala</button>
        <p class="muted" style="text-align:center; margin:var(--space-2) 0 var(--space-4);">veya</p>
      ` : ''}
      <p class="muted bulk-intro">Hocanın attığı haftalık programı, gün başlıklarının arasında boş satır bırakarak aşağıya yapıştır:</p>
      <textarea id="paste-textarea" class="bulk-textarea" placeholder="Anterior - 1
dumbell shoulder press 2 set 8-9 tekrar 12.5kg
...

Posterior - 1
Barfiks 3 set 5-6 tekrar
..."></textarea>
      <button type="button" class="btn btn-primary btn-block" id="parse-btn">Ayrıştır</button>
    `}
  `;

  container.querySelector('#back-btn').addEventListener('click', () => history.back());

  if (occupied) {
    container.querySelector('#delete-week-btn').addEventListener('click', async () => {
      const touchedCount = countTouchedExercisesInWeek(monday);
      const idSuffix = conflictSeq ? ` (Program #${conflictSeq})` : '';
      const message = touchedCount
        ? `${weekRangeLabel(monday)} haftasının programı${idSuffix} tamamen silinecek.\n\n⚠ Bu haftada ${touchedCount} egzersiz gerçekten işaretlenmiş — gerçek antrenman verisi var. Yine de silinsin mi?`
        : `${weekRangeLabel(monday)} haftasının programı${idSuffix} silinsin mi?`;
      if (!(await confirmSheet(message, { confirmLabel: 'Sil' }))) return;
      deleteWeekAssignment(monday);
      renderPasteScreen(container, monday, catalog, linkCatalog);
    });
    return;
  }

  if (sourceMonday) {
    container.querySelector('#copy-prev-week-btn').addEventListener('click', () => {
      const blocks = assignDefaultDates(buildBlocksFromExistingWeek(catalog, sourceMonday), monday);
      renderReviewScreen(container, monday, blocks, catalog, linkCatalog);
    });
  }

  container.querySelector('#parse-btn').addEventListener('click', () => {
    const text = container.querySelector('#paste-textarea').value;
    if (!text.trim()) return;
    const blocks = assignDefaultDates(
      parseWeeklyProgramText(text).map((b) => enrichBlock(b, catalog)),
      monday,
    );
    renderReviewScreen(container, monday, blocks, catalog, linkCatalog);
  });
}

// assignProgram.js'teki findMostRecentSourceWeek'in AYNI mantığı — bkz. oradaki
// yorum — sadece `state.dayEntries` yerine storage.js'in `getDayEntries()`'ini
// okuyor. `beforeMonday`den kesinlikle önceki, en az bir egzersizli günü olan en
// son tarihin haftasının Pazartesi'sini döner; yoksa null.
function findMostRecentSourceWeek(beforeMonday) {
  let latestDate = null;
  for (const entry of getDayEntries()) {
    if (!entry.exercises.length) continue;
    if (entry.date >= beforeMonday) continue;
    if (!latestDate || entry.date > latestDate) latestDate = entry.date;
  }
  return latestDate ? mondayOfWeek(latestDate) : null;
}

// assignProgram.js'teki buildBlocksFromExistingWeek'in bireysel/serbest-metin
// modu da destekleyen ikizi — bkz. oradaki yorum (sourceCatalogId önce ID ile,
// bulamazsa enrichBlock()'un yaptığı AYNI isim eşleştirmesiyle deneniyor).
// `catalog` null ise (bireysel hesap) catalogId/parsedName kavramı hiç yok,
// buildExerciseRow zaten bunu bekliyor (bkz. `if (catalog) {...} else {...}` dalları).
function buildBlocksFromExistingWeek(catalog, weekMonday) {
  const weekDates = Array.from({ length: 7 }, (_, i) => addDaysIso(weekMonday, i));
  const entries = weekDates.map((d) => getDayEntryByDate(d)).filter((e) => e && e.exercises.length);
  return entries.map((entry) => {
    const dt = entry.dayTypeId ? dayTypes.byId(entry.dayTypeId) : null;
    return {
      dayTypeRaw: dt ? dt.name : 'Antrenman',
      dayTypeId: entry.dayTypeId || null,
      assignedDate: null,
      exercises: entry.exercises.map((inst) => {
        const exercise = exercises.byId(inst.exerciseId);
        const base = {
          weight: inst.prescribed.weight || '',
          setCount: inst.prescribed.setCount ?? '',
          reps: inst.prescribed.reps ?? '',
          rir: inst.prescribed.rir ?? '',
          coachNote: inst.prescribed.coachNote || '',
          lastTime: buildLastTimeInfo(inst, exercise),
        };
        if (!catalog) return { ...base, name: exercise ? exercise.name : '' };
        const parsedName = exercise ? exercise.name : '';
        const sourceCatalogId = exercise?.sourceCatalogId || null;
        let catalogMatch = sourceCatalogId ? catalog.find((c) => c.id === sourceCatalogId) : null;
        if (!catalogMatch) {
          const normalizedName = normalizeForMatch(parsedName);
          catalogMatch = catalog.find((c) => normalizeForMatch(c.name) === normalizedName) || null;
        }
        return {
          ...base,
          name: catalogMatch ? catalogMatch.name : parsedName,
          parsedName,
          catalogId: catalogMatch ? catalogMatch.id : null,
        };
      }),
    };
  });
}

// assignProgram.js'teki buildLastTimeInfo'nun AYNI mantığı — bkz. oradaki yorum.
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

function enrichBlock(block, catalog) {
  const normalized = normalizeForMatch(block.dayTypeRaw);
  const matched = dayTypes.active().find((dt) => normalizeForMatch(dt.name) === normalized);
  return {
    dayTypeRaw: block.dayTypeRaw,
    dayTypeId: matched ? matched.id : null,
    assignedDate: null,
    exercises: block.exercises.map((ex) => {
      if (!catalog) return { ...ex };
      const parsedName = ex.name;
      const normalizedName = normalizeForMatch(parsedName);
      const match = catalog.find((c) => normalizeForMatch(c.name) === normalizedName);
      return { ...ex, parsedName, catalogId: match ? match.id : null };
    }),
  };
}

function assignDefaultDates(blocks, monday) {
  const weekDates = Array.from({ length: 7 }, (_, i) => addDaysIso(monday, i));
  const emptyDates = weekDates.filter((d) => !getDayEntryByDate(d));
  const occupiedDates = weekDates.filter((d) => getDayEntryByDate(d));
  // Prefer empty days as defaults (the common case: filling a fresh week), then fall
  // back to already-occupied days rather than leaving a block unassigned — bulk-add
  // only ever appends exercises, so assigning into an occupied day is safe, just not
  // the first guess. The user can always change the date freely either way.
  const preferredOrder = [...emptyDates, ...occupiedDates];
  blocks.forEach((block, i) => {
    block.assignedDate = preferredOrder[i] || weekDates[i % 7] || null;
  });
  return blocks;
}

function describeExistingEntry(dateIso) {
  const entry = getDayEntryByDate(dateIso);
  if (!entry) return '';
  const dt = entry.dayTypeId ? dayTypes.byId(entry.dayTypeId) : null;
  const parts = [dt ? dt.name : null, entry.exercises.length ? `${entry.exercises.length} egzersiz` : 'boş gün kaydı'].filter(Boolean);
  return `Bu günde zaten kayıt var: ${parts.join(' · ')}. Yeni egzersizler bunun üzerine eklenecek.`;
}

function renderReviewScreen(container, monday, blocks, catalog, linkCatalog) {
  // Bu ekrana ulaşıldıysa hedef hafta KESİNLİKLE boş (renderPasteScreen zaten
  // doluyken bu akışa hiç girmiyor) — bkz. assignProgram.js'teki AYNI mantık.
  const assignmentSeq = suggestNextAssignmentSeq();
  container.innerHTML = `
    <div class="view-header">
      <button type="button" class="back-link" id="back-to-paste-btn" aria-label="Geri">←</button>
      <h2 class="view-title">Önizleme</h2>
      <span></span>
    </div>
    <p class="muted bulk-intro">${blocks.length} gün bulundu · <strong>${weekRangeLabel(monday)}</strong> haftasına atanacak <span class="week-conflict-id">(Program #${assignmentSeq})</span>.</p>
    <p class="muted bulk-intro">${catalog ? 'Kırmızı çerçeveli egzersizler kataloğa eşleşmedi, kendin seç. ' : ''}Yanlış ayrıştırılan bir alan varsa düzelt, sonra onayla.</p>
    ${blocks.length > 1 ? `
    <div class="toggle-all-row">
      <button type="button" id="expand-all-btn">Tümünü Aç</button><span class="toggle-all-dot">·</span><button type="button" id="collapse-all-btn">Tümünü Kapat</button>
    </div>` : ''}
    <div id="blocks-root"></div>
    <button type="button" class="btn btn-primary btn-block" id="confirm-btn">Onayla ve Ekle</button>
  `;

  container.querySelector('#back-to-paste-btn').addEventListener('click', () => {
    renderPasteScreen(container, monday, catalog, linkCatalog);
  });

  const blocksRoot = container.querySelector('#blocks-root');
  // assignProgram.js'teki AYNI varsayılan — hepsi kapalı, bkz. oradaki yorum.
  blocks.forEach((block) => {
    blocksRoot.appendChild(buildBlockCard(block, catalog, false, linkCatalog));
  });

  // assignProgram.js'teki AYNI tümünü aç/kapat — bkz. oradaki yorum.
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

  container.querySelector('#confirm-btn').addEventListener('click', async () => {
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
    commitBlocks(blocks, catalog, assignmentSeq);
    location.hash = '#/week/' + monday;
  });
}

function buildBlockCard(block, catalog, startOpen, linkCatalog) {
  const card = document.createElement('div');
  card.className = 'card bulk-block-card';

  const dayTypeOptions = dayTypes.active().map((dt) => (
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
      </div>
    </div>
  `;

  const header = card.querySelector('.block-acc-header');
  const body = card.querySelector('.block-acc-body');
  const headerTitle = card.querySelector('.block-acc-header-title');
  const headerSub = card.querySelector('.block-acc-header-sub');

  // assignProgram.js'teki AYNI mantık — bkz. oradaki yorum.
  function updateHeaderText() {
    const dt = block.dayTypeId ? dayTypes.byId(block.dayTypeId) : null;
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
    dateInfo.textContent = block.assignedDate ? describeExistingEntry(block.assignedDate) : '';
  }
  dateInput.addEventListener('change', (e) => {
    block.assignedDate = e.target.value || null;
    updateDateInfo();
    updateHeaderText();
  });
  updateDateInfo();

  const exList = card.querySelector('.block-exercise-list');
  block.exercises.forEach((ex) => {
    exList.appendChild(buildExerciseRow(ex, block, exList, catalog, linkCatalog));
  });

  return card;
}

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

// Tekrar/Rir için aralık-veya-tekil seçici — assignProgram.js'teki AYNI bileşen,
// bkz. oradaki yorum (bulkParse.js'in RIR_RE/REPS_RE'si aralık üretebiliyor,
// UNTIL_FAILURE_RE de reps'e özel tek serbest metin, o yüzden Rir'de checkbox yok).
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

function buildExerciseRow(ex, block, exList, catalog, linkCatalog) {
  const row = document.createElement('div');
  row.className = 'bulk-exercise-row';

  // Serbest-metin modda (catalog yok) bu isim zaten kütüphaneye bağlı bir
  // yerel kayıtla eşleşiyor mu — bağlıysa isim kutusu kilitlenip "✓ Kütüphane:
  // ..." rozeti gösteriliyor, "değiştir" ile tekrar açılabiliyor. linkCatalog
  // sadece coach kendi hesabında (Kendi Antrenmanım) VE katalog gerçekten
  // erişilebilirse dolu geliyor — bkz. getCoachOwnCatalogForLinking.
  const existingLocal = !catalog ? exercises.active().find((e) => normalizeForMatch(e.name) === normalizeForMatch(ex.name)) : null;
  const linkedCatalogName = existingLocal?.sourceCatalogId && linkCatalog
    ? (linkCatalog.find((c) => c.id === existingLocal.sourceCatalogId)?.name || existingLocal.name)
    : null;

  let nameFieldHtml;
  if (catalog) {
    const sortedCatalog = [...catalog].sort((a, b) => a.name.localeCompare(b.name, 'tr'));
    const options = sortedCatalog.map((c) => (
      `<option value="${c.id}"${ex.catalogId === c.id ? ' selected' : ''}>${escapeHtml(c.name)}</option>`
    )).join('');
    const placeholderLabel = ex.catalogId
      ? '— eşleşme yok, seç —'
      : `"${ex.parsedName || ''}" — eşleşme yok, seç`;
    const suggestion = ex.catalogId ? null : closestCatalogMatch(ex.parsedName, catalog);
    nameFieldHtml = `
      <div class="bulk-ex-name-wrap">
        <select class="bulk-ex-name-select${ex.catalogId ? '' : ' unresolved'}">
          <option value="">${escapeHtml(placeholderLabel)}</option>
          ${options}
        </select>
        ${suggestion ? `<button type="button" class="bulk-ex-suggest-btn" data-suggest-id="${suggestion.id}">Bunu mu demek istedin: "${escapeHtml(suggestion.name)}"?</button>` : ''}
      </div>
    `;
  } else {
    nameFieldHtml = `
      <div class="bulk-ex-name-wrap">
        <input type="text" class="bulk-ex-name" value="${escapeHtml(ex.name)}" placeholder="Egzersiz adı"${linkedCatalogName ? ' disabled' : ''}>
        ${linkCatalog && linkCatalog.length ? `<div class="link-catalog-area">${linkedCatalogName
          ? `<span class="linked-tag"><span class="linked-chk">✓</span> Kütüphane: ${escapeHtml(linkedCatalogName)} <button type="button" class="link-change-btn">değiştir</button></span>`
          : `<button type="button" class="link-btn">Kütüphaneden eşleştir</button>`}</div>` : ''}
      </div>
    `;
  }

  row.innerHTML = `
    <div class="bulk-exercise-row-top">
      ${nameFieldHtml}
      <button type="button" class="btn-icon danger bulk-ex-remove" aria-label="Satırı sil">×</button>
    </div>
    <div class="bulk-exercise-row-fields">
      <div class="field">
        <label>Ağırlık</label>
        <input type="text" class="bulk-ex-field" data-field="weight" value="${escapeHtml(ex.weight)}">
      </div>
      <div class="field">
        <label>Set</label>
        <button type="button" class="bulk-picker-trigger${ex.setCount === '' ? ' empty' : ''}" data-field="setCount">${escapeHtml(fieldDisplay(ex.setCount))}</button>
      </div>
      <div class="field">
        <label>Tekrar</label>
        <button type="button" class="bulk-picker-trigger${ex.reps === '' ? ' empty' : ''}" data-field="reps">${escapeHtml(fieldDisplay(ex.reps))}</button>
      </div>
      <div class="field">
        <label>Rir</label>
        <button type="button" class="bulk-picker-trigger${ex.rir === '' ? ' empty' : ''}" data-field="rir">${escapeHtml(fieldDisplay(ex.rir))}</button>
      </div>
    </div>
    ${ex.lastTime ? `
      <div class="bulk-ex-last-time">${statusBadge(ex.lastTime.status)}Geçen sefer: ${escapeHtml(ex.lastTime.summary)}${ex.lastTime.note ? ` — <span class="bulk-ex-last-time-note">"${escapeHtml(ex.lastTime.note)}"</span>` : ''}</div>
    ` : ''}
    <input type="text" class="bulk-ex-note" value="${escapeHtml(ex.coachNote)}" placeholder="Hoca notu (opsiyonel)">
  `;

  if (catalog) {
    const nameSelect = row.querySelector('.bulk-ex-name-select');
    function resolveSelection(catalogId) {
      const catalogEx = catalog.find((c) => c.id === catalogId);
      ex.catalogId = catalogEx ? catalogEx.id : null;
      ex.name = catalogEx ? catalogEx.name : '';
      nameSelect.value = ex.catalogId || '';
      nameSelect.classList.toggle('unresolved', !ex.catalogId);
      const suggestBtn = row.querySelector('.bulk-ex-suggest-btn');
      if (suggestBtn) suggestBtn.style.display = ex.catalogId ? 'none' : '';
    }
    nameSelect.addEventListener('change', (e) => resolveSelection(e.target.value));
    const suggestBtn = row.querySelector('.bulk-ex-suggest-btn');
    if (suggestBtn) {
      suggestBtn.addEventListener('click', () => resolveSelection(suggestBtn.dataset.suggestId));
    }
  } else {
    const nameInput = row.querySelector('.bulk-ex-name');
    nameInput.addEventListener('input', (e) => {
      ex.name = e.target.value;
    });

    // "Kütüphaneden eşleştir" / "değiştir" — bkz. bu değişikliğin geldiği sohbet.
    // Seçim onaylandığı ANDA kalıcı: hangi yerel egzersizin bağlanacağı isme göre
    // bulunuyor/oluşturuluyor (commitBlocks'un aynı find-or-create mantığı), sonra
    // exercises.bindToCatalog VAR OLAN kaydı yerinde günceller — bu sayede o ismin
    // geçmişteki VE gelecekteki tüm günleri, hiçbirine tek tek dokunmadan otomatik
    // bağlanmış olur. Onay ekranında "Onayla"ya basılmasını beklemiyor, tıpkı
    // Egzersiz Kütüphanesi'nde isim/video değiştirmenin anında kalıcı olması gibi.
    function wireLinkArea() {
      const area = row.querySelector('.link-catalog-area');
      if (!area) return;
      const openBtn = area.querySelector('.link-btn, .link-change-btn');
      if (!openBtn) return;
      openBtn.addEventListener('click', () => {
        openPicker({
          title: 'Kütüphaneden Eşleştir',
          items: linkCatalog,
          emptyMessage: 'Eşleşen kayıt yok.',
          onSelect: async (catalogId) => {
            const catalogEx = linkCatalog.find((c) => c.id === catalogId);
            if (!catalogEx) return;
            const proceed = await confirmSheet(
              `"${ex.name}" artık kütüphanedeki "${catalogEx.name}" ile aynı sayılacak. İsim buna göre güncellenecek, kütüphanede video/hedef bölge varsa oradan gelecek. Bu egzersizin geçmiş ve gelecekteki TÜM kayıtları bu eşleşmeyi kullanacak.`,
              { confirmLabel: 'Eşleştir', danger: false },
            );
            if (!proceed) return;
            let localEx = exercises.active().find((e) => normalizeForMatch(e.name) === normalizeForMatch(ex.name));
            if (!localEx) localEx = exercises.add(ex.name);
            exercises.bindToCatalog(localEx.id, catalogEx);
            ex.name = catalogEx.name;
            nameInput.value = catalogEx.name;
            nameInput.disabled = true;
            area.innerHTML = `<span class="linked-tag"><span class="linked-chk">✓</span> Kütüphane: ${escapeHtml(catalogEx.name)} <button type="button" class="link-change-btn">değiştir</button></span>`;
            wireLinkArea();
          },
        });
      });
    }
    wireLinkArea();
  }

  row.querySelector('.bulk-ex-field[data-field="weight"]').addEventListener('input', (e) => {
    ex.weight = e.target.value;
  });

  const setBtn = row.querySelector('[data-field="setCount"]');
  setBtn.addEventListener('click', () => {
    openSetPicker({
      current: ex.setCount === '' ? null : ex.setCount,
      onSelect: (value) => {
        ex.setCount = value;
        setBtn.textContent = fieldDisplay(value);
        setBtn.classList.remove('empty');
      },
    });
  });

  const repsBtn = row.querySelector('[data-field="reps"]');
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

  const rirBtn = row.querySelector('[data-field="rir"]');
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

  row.querySelector('.bulk-ex-note').addEventListener('input', (e) => {
    ex.coachNote = e.target.value;
  });
  row.querySelector('.bulk-ex-remove').addEventListener('click', () => {
    const idx = Array.from(exList.children).indexOf(row);
    if (idx !== -1) block.exercises.splice(idx, 1);
    row.remove();
  });

  return row;
}

function commitBlocks(blocks, catalog, assignmentSeq) {
  for (const block of blocks) {
    if (!block.assignedDate) continue;

    let dayTypeId = block.dayTypeId;
    if (!dayTypeId) {
      dayTypeId = dayTypes.add(block.dayTypeRaw || 'Antrenman').id;
    }

    let entry = getDayEntryByDate(block.assignedDate);
    if (!entry) {
      entry = createDayEntry({ date: block.assignedDate, dayNumber: suggestNextDayNumber(), dayTypeId });
    } else if (!entry.dayTypeId) {
      // Fill in a missing day-type on an existing shell entry, but never overwrite one
      // that's already set — bulk-add should never silently relabel a day.
      updateDayEntryField(entry.id, 'dayTypeId', dayTypeId, false);
    }
    updateDayEntryField(entry.id, 'assignmentSeq', assignmentSeq, false);

    for (const ex of block.exercises) {
      let exercise;
      if (catalog) {
        // Onayla ekranı zaten eşleşmemiş (.unresolved) satır varken engelliyor —
        // catalogId'siz bir satıra buraya kadar gelinmemesi gerekiyor, savunma amaçlı atla.
        if (!ex.catalogId) continue;
        const catalogEx = catalog.find((c) => c.id === ex.catalogId);
        if (!catalogEx) continue;
        exercise = exercises.resolveFromCatalog(catalogEx);
      } else {
        if (!ex.name) continue;
        const normalized = normalizeForMatch(ex.name);
        exercise = exercises.active().find((e) => normalizeForMatch(e.name) === normalized);
        // Sadece YENİ oluşturulan bir egzersiz için süre tipi otomatik ayarlanıyor —
        // zaten var olan bir eşleşmenin tipini sürpriz şekilde değiştirmiyoruz.
        if (!exercise) exercise = exercises.add(ex.name, ex.detectedDuration);
      }
      addExerciseInstanceWithPrescribed(
        entry.id,
        exercise.id,
        { weight: ex.weight, setCount: ex.setCount, reps: ex.reps, rir: ex.rir, coachNote: ex.coachNote },
      );
    }
  }
}
