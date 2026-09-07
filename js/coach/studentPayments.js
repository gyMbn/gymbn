import { getStudent, getStudentAppState, setStudentAppState } from './coachCloud.js';
import { cycleStatus, sortedPayments } from './paymentCycle.js';
import { escapeHtml, formatDateLongTr, monthLabelTr, todayIso, ICON_TRASH } from '../util.js';
import { confirmSheet } from '../components/confirmSheet.js';

function uid() {
  return `pay_${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 8)}`;
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

  const state = remoteState || { payments: [] };
  state.payments = state.payments || [];
  renderScreen(container, studentUid, student, state);
}

function renderLoadingScreen(container) {
  container.innerHTML = '<p class="empty-state">Yükleniyor…</p>';
}

function renderErrorScreen(container, studentUid, message) {
  container.innerHTML = `
    <div class="view-header">
      <a href="#/student/${studentUid}" class="back-link" aria-label="Geri">←</a>
      <h2 class="view-title">Ödemeler</h2>
      <span></span>
    </div>
    <p class="empty-state">${escapeHtml(message)}</p>
  `;
}

// monthLabelTr "Ağustos 2026" döndürüyor (bkz. util.js) — burada yıl değil,
// sadece ay adı lazım. Türkçe ay adları hep tek kelime (Ocak, Şubat, ...,
// Aralık), o yüzden ilk kelimeyi almak güvenli.
function monthNameOnly(iso) {
  return monthLabelTr(iso).split(' ')[0];
}

function buildCycleCard(payments) {
  const cycle = cycleStatus(payments);
  if (!cycle.hasPayment) {
    return `
      <div class="stat-card">
        <div class="stat-label">Ödeme</div>
        <div class="stat-detail">Henüz ödeme kaydı yok.</div>
      </div>
    `;
  }
  // Ödeme günü yaklaştıysa/geldiyse/geçtiyse: pasif bir gün sayacı yerine
  // doğrudan "alındı mı?" diye soruyoruz — hoca "evet"e bastığında bugünün
  // tarihiyle ödeme kaydediliyor ve döngü bir sonraki aya geçiyor (erken
  // ödense bile, bkz. paymentCycle.js'teki nextOccurrenceAfter düzeltmesi).
  if (cycle.countdown || cycle.overdue) {
    const monthName = monthNameOnly(cycle.dueDate);
    return `
      <div class="stat-card">
        <div class="stat-label">${monthName} Ödemesi</div>
        <div class="confirm-cycle-status${cycle.overdue ? ' is-overdue' : ''}">
          ${monthName} ödemesi alındı mı?${cycle.overdue ? ' <span class="badge badge-danger">Gecikti</span>' : ''}
        </div>
        <div class="confirm-cycle-actions">
          <button type="button" class="btn btn-primary" id="mark-paid-btn">✓ Evet, Alındı</button>
          <button type="button" class="btn btn-ghost" id="mark-unpaid-btn">Henüz Değil</button>
        </div>
      </div>
    `;
  }
  return `
    <div class="stat-card">
      <div class="stat-label">Ödeme Günü</div>
      <div class="stat-value">${formatDateLongTr(cycle.dueDate)}</div>
      <div class="stat-detail">Sabit ödeme günü: ${cycle.anchorDay}</div>
    </div>
  `;
}

// "Evet, Alındı"ya basılınca cycle kartının yerine kısa süreliğine gösterilen
// onay — [[feedback_motion_feedback_principle]]: her etkileşimin görünür bir
// tepkisi olmalı, sessizce bir sonraki döngüye atlamak yerine.
function buildJustMarkedCard(monthName, dateIso) {
  return `
    <div class="stat-card">
      <div class="confirm-just-marked">
        <div class="check-badge">✓</div>
        <div>
          <div style="font-weight:700;">${monthName} ödemesi alındı</div>
          <div class="stat-detail" style="margin-top:0;">${formatDateLongTr(dateIso)} olarak kaydedildi</div>
        </div>
      </div>
    </div>
  `;
}

function buildPaymentList(payments) {
  const sorted = sortedPayments(payments);
  if (!sorted.length) return '<p class="empty-state">Henüz ödeme kaydı yok.</p>';
  return sorted.map((p) => `
    <div class="list-item" data-id="${escapeHtml(p.id)}">
      <div class="list-item-main">
        <div class="list-item-title">${formatDateLongTr(p.date)}</div>
        ${p.amount ? `<div class="list-item-sub">${escapeHtml(p.amount)}</div>` : ''}
      </div>
      <div class="list-item-actions">
        <button type="button" class="btn-icon danger delete-btn" aria-label="Sil">${ICON_TRASH}</button>
      </div>
    </div>
  `).join('');
}

function renderScreen(container, studentUid, student, state) {
  container.innerHTML = `
    <div class="view-header">
      <a href="#/student/${studentUid}" class="back-link" aria-label="Geri">←</a>
      <h2 class="view-title">${escapeHtml(student.displayName)}</h2>
      <span></span>
    </div>
    <div id="cycle-summary">${buildCycleCard(state.payments)}</div>
    <form class="card" id="add-payment-form">
      <div class="form-row">
        <div class="field">
          <label>Tarih</label>
          <input type="date" id="payment-date" value="${todayIso()}" max="${todayIso()}">
        </div>
        <div class="field">
          <label>Tutar (opsiyonel)</label>
          <input type="text" id="payment-amount" inputmode="decimal" placeholder="₺">
        </div>
      </div>
      <button type="submit" class="btn btn-primary btn-block">+ Ödeme Ekle</button>
    </form>
    <div class="section-title">Geçmiş Ödemeler</div>
    <div class="list" id="payment-list">${buildPaymentList(state.payments)}</div>
  `;

  wireScreen(container, studentUid, state);
}

function wireScreen(container, studentUid, state) {
  const form = container.querySelector('#add-payment-form');
  const summaryEl = container.querySelector('#cycle-summary');
  const listEl = container.querySelector('#payment-list');

  function refresh() {
    summaryEl.innerHTML = buildCycleCard(state.payments);
    listEl.innerHTML = buildPaymentList(state.payments);
    wireDeleteButtons();
    wireCycleCard();
  }

  // "Henüz Değil" butonuna bilerek handler yok: "hayır" zaten mevcut durum,
  // değiştirecek/kaydedilecek bir şey yok — sadece butonun kendi .btn:active
  // basma tepkisi yeterli.
  function wireCycleCard() {
    const markPaidBtn = summaryEl.querySelector('#mark-paid-btn');
    if (!markPaidBtn) return;
    const markUnpaidBtn = summaryEl.querySelector('#mark-unpaid-btn');
    markPaidBtn.addEventListener('click', async () => {
      const cycle = cycleStatus(state.payments);
      const monthName = monthNameOnly(cycle.dueDate);
      markPaidBtn.disabled = true;
      if (markUnpaidBtn) markUnpaidBtn.disabled = true;
      const payment = { id: uid(), date: todayIso(), amount: null, note: '' };
      state.payments.push(payment);
      try {
        await setStudentAppState(studentUid, state);
        summaryEl.innerHTML = buildJustMarkedCard(monthName, payment.date);
        setTimeout(refresh, 900);
      } catch (err) {
        console.error('Ödeme kaydedilemedi', err);
        alert('Ödeme kaydedilemedi, internet bağlantını kontrol edip tekrar dene.');
        const idx = state.payments.findIndex((p) => p.id === payment.id);
        if (idx !== -1) state.payments.splice(idx, 1);
        markPaidBtn.disabled = false;
        if (markUnpaidBtn) markUnpaidBtn.disabled = false;
      }
    });
  }

  function wireDeleteButtons() {
    listEl.querySelectorAll('.delete-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('.list-item');
        const id = row.dataset.id;
        if (!(await confirmSheet('Bu ödeme kaydı silinsin mi?'))) return;
        btn.disabled = true;
        const idx = state.payments.findIndex((p) => p.id === id);
        const [removed] = state.payments.splice(idx, 1);
        try {
          await setStudentAppState(studentUid, state);
          refresh();
        } catch (err) {
          console.error('Ödeme silinemedi', err);
          alert('Ödeme silinemedi, internet bağlantını kontrol edip tekrar dene.');
          state.payments.splice(idx, 0, removed);
          btn.disabled = false;
        }
      });
    });
  }
  wireDeleteButtons();
  wireCycleCard();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const dateInput = container.querySelector('#payment-date');
    const amountInput = container.querySelector('#payment-amount');
    if (!dateInput.value) return;
    const submitBtn = form.querySelector('button');
    submitBtn.disabled = true;
    const payment = { id: uid(), date: dateInput.value, amount: amountInput.value.trim() || null, note: '' };
    state.payments.push(payment);
    try {
      await setStudentAppState(studentUid, state);
      refresh();
    } catch (err) {
      console.error('Ödeme kaydedilemedi', err);
      alert('Ödeme kaydedilemedi, internet bağlantını kontrol edip tekrar dene.');
      // pop() değil id'ye göre çıkarma — eş zamanlı bir silme işlemi araya
      // girmiş olabileceğinden diziye pozisyona göre değil kimliğe göre
      // dokunmak daha güvenli (bkz. delete handler'daki aynı desen).
      const idx = state.payments.findIndex((p) => p.id === payment.id);
      if (idx !== -1) state.payments.splice(idx, 1);
    } finally {
      submitBtn.disabled = false;
    }
  });
}
