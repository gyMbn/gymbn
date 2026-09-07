import { getStudent, getStudentAppState, setStudentAppState } from './coachCloud.js';
import { escapeHtml, formatDateShortTr, todayIso, bindSheetBackClose } from '../util.js';

// Demo'da onaylanan "yansıyan diyagram" birebir: asıl giriş sağdaki liste,
// silüet sadece dokunulan satırı aydınlatan dekoratif bir referans — kendisi
// dokunulabilir değil, hassas bölge hesabı gerekmiyor. Cinsiyet seçimi kalıcı
// bir öğrenci alanı DEĞİL, sadece hangi diyagramın gösterileceğine dair
// oturum-içi bir görünüm tercihi (kullanıcı istemedi, eklemedik).
const MEASUREMENT_TYPES = [
  { type: 'height', label: 'Boy', unit: 'cm', part: 'whole', icon: '<path d="M12 20V4M6 8l6-4 6 4"/>' },
  { type: 'weight', label: 'Kilo', unit: 'kg', part: 'whole', icon: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>' },
  { type: 'chest', label: 'Göğüs', unit: 'cm', part: 'chest', icon: '<path d="M4 8c2-3 14-3 16 0M4 8v4c2 5 14 5 16 0V8"/>' },
  { type: 'waist', label: 'Bel', unit: 'cm', part: 'waist', icon: '<path d="M5 6h14l-3 12H8Z"/>' },
  { type: 'arm', label: 'Kol', unit: 'cm', part: 'arm', icon: '<path d="M8 4a4 4 0 0 1 8 0v6a4 4 0 0 1-8 0Z"/><path d="M12 14v6"/>' },
  { type: 'leg', label: 'Bacak', unit: 'cm', part: 'leg', icon: '<path d="M9 3h6l1 10-2 8h-2l-1-7-1 7H8l-2-8Z"/>' },
];

function recordsFor(measurements, type) {
  return measurements.filter((m) => m.type === type).sort((a, b) => a.date.localeCompare(b.date));
}
function latestFor(measurements, type) {
  const list = recordsFor(measurements, type);
  return list.length ? list[list.length - 1] : null;
}
function earliestDate(measurements) {
  if (!measurements.length) return null;
  return measurements.reduce((min, m) => (m.date < min ? m.date : min), measurements[0].date);
}
function latestDate(measurements) {
  if (!measurements.length) return null;
  return measurements.reduce((max, m) => (m.date > max ? m.date : max), measurements[0].date);
}

export async function render(container, { studentUid }) {
  renderLoadingScreen(container);

  let student;
  let remoteState;
  try {
    [student, remoteState] = await Promise.all([getStudent(studentUid), getStudentAppState(studentUid)]);
  } catch (err) {
    console.error('Öğrenci verisi yüklenemedi', err);
    renderErrorScreen(container, studentUid, 'Öğrenci verisi yüklenemedi, internet bağlantını kontrol edip tekrar dene.');
    return;
  }
  if (!student) {
    renderErrorScreen(container, studentUid, 'Öğrenci bulunamadı.');
    return;
  }

  const state = remoteState || { measurements: [] };
  state.measurements = state.measurements || [];
  renderScreen(container, studentUid, student, state);
}

function renderLoadingScreen(container) {
  container.innerHTML = '<p class="empty-state">Yükleniyor…</p>';
}

function renderErrorScreen(container, studentUid, message) {
  container.innerHTML = `
    <div class="view-header">
      <a href="#/student/${studentUid}" class="back-link" aria-label="Geri">←</a>
      <h2 class="view-title">Ölçümler</h2>
      <span></span>
    </div>
    <p class="empty-state">${escapeHtml(message)}</p>
  `;
}

let currentGender = 'female';

function renderScreen(container, studentUid, student, state) {
  const start = earliestDate(state.measurements);
  const last = latestDate(state.measurements);

  container.innerHTML = `
    <div class="view-header">
      <a href="#/student/${studentUid}" class="back-link" aria-label="Geri">←</a>
      <h2 class="view-title">${escapeHtml(student.displayName)}</h2>
      <span></span>
    </div>
    <div class="timeline-note">
      ${start ? `<span>Başlangıç: <b>${formatDateShortTr(start)}</b></span><span>Son ölçüm: <b>${formatDateShortTr(last)}</b></span>` : '<span>Henüz ölçüm kaydedilmedi.</span>'}
    </div>
    <div class="gender-toggle" id="gender-toggle">
      <button type="button" class="gender-btn" data-gender="female">Kadın</button>
      <button type="button" class="gender-btn" data-gender="male">Erkek</button>
    </div>
    <div class="diagram-row">
      <div class="body-diagram-wrap">
        <svg viewBox="0 0 200 280" data-gender="female">
          <circle class="body-part" data-part="whole" cx="100" cy="30" r="21"/>
          <rect class="body-part" data-part="whole" x="93" y="47" width="14" height="13"/>
          <rect class="body-part" data-part="chest" x="68" y="58" width="64" height="50" rx="22"/>
          <rect class="body-part" data-part="waist" x="80" y="102" width="40" height="34" rx="18"/>
          <rect class="body-part" data-part="waist" x="70" y="130" width="60" height="26" rx="20"/>
          <rect class="body-part" data-part="arm" x="34" y="62" width="20" height="78" rx="10"/>
          <rect class="body-part" data-part="arm" x="146" y="62" width="20" height="78" rx="10"/>
          <rect class="body-part" data-part="leg" x="76" y="154" width="21" height="100" rx="10"/>
          <rect class="body-part" data-part="leg" x="103" y="154" width="21" height="100" rx="10"/>
        </svg>
        <svg viewBox="0 0 200 280" data-gender="male">
          <circle class="body-part" data-part="whole" cx="100" cy="30" r="22"/>
          <rect class="body-part" data-part="whole" x="92" y="48" width="16" height="14"/>
          <rect class="body-part" data-part="chest" x="63" y="58" width="74" height="56" rx="16"/>
          <rect class="body-part" data-part="waist" x="74" y="112" width="52" height="42" rx="14"/>
          <rect class="body-part" data-part="arm" x="28" y="63" width="26" height="88" rx="13"/>
          <rect class="body-part" data-part="arm" x="146" y="63" width="26" height="88" rx="13"/>
          <rect class="body-part" data-part="leg" x="72" y="154" width="25" height="100" rx="12"/>
          <rect class="body-part" data-part="leg" x="103" y="154" width="25" height="100" rx="12"/>
        </svg>
      </div>
      <div class="measure-list" id="measure-list">
        ${MEASUREMENT_TYPES.map((m) => {
          const rec = latestFor(state.measurements, m.type);
          return `
            <button type="button" class="measure-row" data-type="${m.type}" data-part="${m.part}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">${m.icon}</svg>
              <span class="measure-row-label">${escapeHtml(m.label)}<span class="measure-row-dates">${rec ? 'Son: ' + formatDateShortTr(rec.date) : 'Henüz girilmedi'}</span></span>
              <span class="measure-row-val">${rec ? escapeHtml(String(rec.value)) + m.unit : '—'}</span>
            </button>
          `;
        }).join('')}
      </div>
    </div>
    ${buildProgressSection(state.measurements)}
  `;

  wireScreen(container, studentUid, student, state);
  wireProgressSparklines(container, state.measurements);
}

// En az 2 kaydı olan ölçümler için küçük bir eğilim kartı — tek kayıtla eğilim
// göstermenin anlamı yok, o yüzden yeni girilen bir ölçüm ikinci kayda kadar
// burada görünmüyor. "goodDir" (artış mı azalış mı iyi) bilerek eklenmedi —
// bu, öğrencinin hedefine (kesme/kütle) bağlı, uygulama bunu bilmiyor; nötr
// bir ok+fark gösteriliyor, yorum yapılmıyor.
function buildProgressSection(measurements) {
  const withHistory = MEASUREMENT_TYPES.filter((m) => recordsFor(measurements, m.type).length >= 2);
  if (!withHistory.length) return '';
  return `
    <div class="section-title measure-progress-title">İlerleme</div>
    <div class="measure-cards" id="measure-cards">
      ${withHistory.map((m) => {
        const recs = recordsFor(measurements, m.type);
        const first = recs[0];
        const last = recs[recs.length - 1];
        const delta = Math.round((last.value - first.value) * 100) / 100;
        const arrow = delta > 0 ? '↑' : delta < 0 ? '↓' : '→';
        return `
          <div class="measure-card" data-type="${m.type}">
            <div class="measure-card-info">
              <div class="measure-card-label">${escapeHtml(m.label)}</div>
              <div class="measure-card-val">${escapeHtml(String(last.value))}${m.unit}</div>
              <div class="measure-card-delta">${arrow} ${Math.abs(delta)}${m.unit}</div>
              <div class="measure-card-dates">${formatDateShortTr(first.date)} → ${formatDateShortTr(last.date)}</div>
            </div>
            <svg class="spark" viewBox="0 0 140 40"></svg>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function wireProgressSparklines(container, measurements) {
  container.querySelectorAll('.measure-card').forEach((card) => {
    const type = card.dataset.type;
    const values = recordsFor(measurements, type).map((r) => r.value);
    buildSparkline(card.querySelector('.spark'), values);
  });
}

// setRows.js/dayEntry.js'in kalıcı label deseniyle aynı ruhta, ama bu kez bir
// çizgi grafik — brainstorm demosundaki buildLineChart'ın tek-seri, sade kopyası.
function buildSparkline(svg, values, { w = 140, h = 40, pad = 6 } = {}) {
  if (values.length < 2) return;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = (w - pad * 2) / (values.length - 1);
  const points = values.map((v, i) => [pad + i * stepX, pad + (h - pad * 2) * (1 - (v - min) / range)]);
  const pathD = points.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  const color = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim();

  const areaD = `${pathD} L${points[points.length - 1][0]},${h - pad} L${points[0][0]},${h - pad} Z`;
  const area = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  area.setAttribute('d', areaD);
  area.setAttribute('fill', color);
  area.setAttribute('opacity', '0.14');
  svg.appendChild(area);

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', pathD);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', color);
  path.setAttribute('stroke-width', '2');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);

  const last = points[points.length - 1];
  const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  ring.setAttribute('cx', last[0]); ring.setAttribute('cy', last[1]); ring.setAttribute('r', '7');
  ring.setAttribute('fill', color); ring.setAttribute('opacity', '0.22');
  svg.appendChild(ring);
  const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  dot.setAttribute('cx', last[0]); dot.setAttribute('cy', last[1]); dot.setAttribute('r', '3.5');
  dot.setAttribute('fill', color);
  svg.appendChild(dot);
}

function wireScreen(container, studentUid, student, state) {
  const list = container.querySelector('#measure-list');
  const diagramWrap = container.querySelector('.body-diagram-wrap');
  let activeType = null;

  function lightUp(part) {
    diagramWrap.querySelectorAll(`svg[data-gender="${currentGender}"] .body-part`).forEach((p) => {
      p.classList.toggle('lit', p.dataset.part === part);
    });
  }

  function setGender(gender) {
    currentGender = gender;
    container.querySelectorAll('.gender-btn').forEach((b) => b.classList.toggle('active', b.dataset.gender === gender));
    diagramWrap.querySelectorAll('svg').forEach((svg) => svg.classList.toggle('shown', svg.dataset.gender === gender));
    if (activeType) lightUp(MEASUREMENT_TYPES.find((m) => m.type === activeType).part);
  }
  container.querySelectorAll('.gender-btn').forEach((btn) => {
    btn.addEventListener('click', () => setGender(btn.dataset.gender));
  });
  setGender(currentGender);

  list.querySelectorAll('.measure-row').forEach((row) => {
    row.addEventListener('click', () => {
      const type = row.dataset.type;
      const meta = MEASUREMENT_TYPES.find((m) => m.type === type);
      activeType = type;
      lightUp(meta.part);
      openEntrySheet(meta, state, (value, date) => {
        state.measurements.push({ id: uid(), type, date, value });
        return saveMeasurements(studentUid, state).then(() => {
          renderScreen(container, studentUid, student, state);
        });
      });
    });
  });
}

function uid() {
  return `ms_${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 8)}`;
}

async function saveMeasurements(studentUid, state) {
  await setStudentAppState(studentUid, state);
}

function openEntrySheet(meta, state, onSave) {
  const current = latestFor(state.measurements, meta.type);
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet">
      <div class="sheet-title">${escapeHtml(meta.label)}</div>
      <div class="sheet-sub">${current ? `Şu anki değer: ${escapeHtml(String(current.value))}${meta.unit}` : 'Yeni ölçüm ekle'}</div>
      <div class="sheet-field">
        <input type="date" id="entry-date" value="${todayIso()}">
        <input type="text" id="entry-value" inputmode="decimal" placeholder="${meta.unit}">
      </div>
      <button type="button" class="btn btn-primary btn-block" id="entry-save">Kaydet</button>
    </div>
  `;
  document.body.appendChild(backdrop);

  const close = bindSheetBackClose(() => backdrop.remove());
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });

  const saveBtn = backdrop.querySelector('#entry-save');
  saveBtn.addEventListener('click', async () => {
    const dateVal = backdrop.querySelector('#entry-date').value;
    const rawValue = backdrop.querySelector('#entry-value').value.trim().replace(',', '.');
    const numValue = parseFloat(rawValue);
    if (!dateVal || !rawValue || isNaN(numValue) || numValue <= 0) return;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Kaydediliyor…';
    try {
      await onSave(numValue, dateVal);
      close();
    } catch (err) {
      console.error('Ölçüm kaydedilemedi', err);
      alert('Ölçüm kaydedilemedi, internet bağlantını kontrol edip tekrar dene.');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Kaydet';
    }
  });
}
