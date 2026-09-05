import {
  onAdminAuthReady, adminLogin, adminSignOut, adminResetPassword, isCurrentUserAdmin,
  listCatalog, addCatalogExercise, renameCatalogExercise, setCatalogMedia, archiveCatalogExercise,
  listRegions, broadcastSystemMessage, listMyBroadcasts, deleteBroadcast,
} from './admin/adminCloud.js';
import { renderLoginForm } from './shared/loginForm.js';
import { confirmSheet } from './components/confirmSheet.js';
import { escapeHtml } from './util.js';
import * as coachRoster from './admin/coachRoster.js';
import * as exerciseCatalog from './admin/exerciseCatalog.js';
import * as targetRegions from './admin/targetRegions.js';
import * as broadcastHistory from './admin/broadcastHistory.js';

const viewRoot = document.getElementById('view-root');

renderLoading();
onAdminAuthReady(async (user) => {
  if (!user) {
    renderLogin();
    return;
  }
  let ok = false;
  try {
    ok = await isCurrentUserAdmin();
  } catch (err) {
    console.error('Admin yetkisi kontrol edilemedi', err);
  }
  if (!ok) {
    renderAccessDenied();
    return;
  }
  renderAdminShell();
});

function renderLoading() {
  viewRoot.innerHTML = `
    <div class="auth-screen">
      <div class="auth-card">
        <div class="auth-title">gyMbn — Admin</div>
        <p class="auth-loading">Yükleniyor…</p>
      </div>
    </div>
  `;
}

function renderLogin() {
  renderLoginForm(viewRoot, {
    title: 'gyMbn — Admin',
    onSubmit: (email, password) => adminLogin(email, password),
    onResetPassword: (email) => adminResetPassword(email),
  });
}

function renderAccessDenied() {
  viewRoot.innerHTML = `
    <div class="auth-screen">
      <div class="auth-card">
        <div class="auth-title">gyMbn — Admin</div>
        <p class="auth-error">Bu hesabın admin yetkisi yok.</p>
        <button type="button" class="btn btn-ghost btn-block" id="signout-btn">Çıkış Yap</button>
      </div>
    </div>
  `;
  viewRoot.querySelector('#signout-btn').addEventListener('click', () => adminSignOut());
}

function renderAdminShell() {
  document.body.classList.remove('auth-gate');
  showRoster();
}

function showRoster() {
  viewRoot.innerHTML = `
    <div class="view-header">
      <h2 class="view-title">Hocalar</h2>
      <button type="button" class="btn btn-ghost" id="admin-signout-btn">Çıkış</button>
    </div>
    <div class="more-menu">
      <a href="#" class="more-menu-item" id="catalog-nav-link"><span>Egzersiz Kütüphanesi</span><span class="chevron">›</span></a>
      <a href="#" class="more-menu-item" id="regions-nav-link"><span>Hedef Bölgeler</span><span class="chevron">›</span></a>
      <a href="#" class="more-menu-item" id="broadcast-nav-link"><span>📢 Sistem Mesajı Gönder</span><span class="chevron">›</span></a>
      <a href="#" class="more-menu-item" id="broadcast-history-nav-link"><span>📜 Gönderilen Mesajlar</span><span class="chevron">›</span></a>
    </div>
    <div id="admin-body"></div>
  `;
  viewRoot.querySelector('#admin-signout-btn').addEventListener('click', () => adminSignOut());
  viewRoot.querySelector('#catalog-nav-link').addEventListener('click', (e) => {
    e.preventDefault();
    showCatalog();
  });
  viewRoot.querySelector('#regions-nav-link').addEventListener('click', (e) => {
    e.preventDefault();
    showRegions();
  });
  viewRoot.querySelector('#broadcast-nav-link').addEventListener('click', (e) => {
    e.preventDefault();
    openBroadcastSheet();
  });
  viewRoot.querySelector('#broadcast-history-nav-link').addEventListener('click', (e) => {
    e.preventDefault();
    showBroadcastHistory();
  });
  coachRoster.render(viewRoot.querySelector('#admin-body'));
}

function showBroadcastHistory() {
  broadcastHistory.render(viewRoot, { onBack: showRoster, listMyBroadcasts, deleteBroadcast });
}

const DRAFT_CATEGORIES = { new: '🆕 Yeni', fix: '🐛 Düzeltildi', improvement: '✨ İyileştirme' };
const DISMISSED_DRAFTS_KEY = 'gymbn_admin_dismissedDrafts';

function readDismissedDraftIds() {
  try {
    return new Set(JSON.parse(localStorage.getItem(DISMISSED_DRAFTS_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

function dismissDraftId(id) {
  const ids = readDismissedDraftIds();
  ids.add(id);
  localStorage.setItem(DISMISSED_DRAFTS_KEY, JSON.stringify([...ids]));
}

// Taslaklar Claude'un çalışma sonrası doldurduğu, repo'daki statik bir dosya
// (changelog-drafts.json) — canlı bir Firestore koleksiyonu DEĞİL, çünkü
// Claude'un buraya YALNIZCA senin tarayıcın o an bağlıyken yazabilme şansı var;
// git commit ile her zaman güncelleyebiliyor. "×" ile kaldırma SADECE bu
// tarayıcıda kalıcı (localStorage) — dosyanın kendisini değiştirmiyor.
async function loadDraftItems() {
  try {
    const res = await fetch('./changelog-drafts.json', { cache: 'no-store' });
    if (!res.ok) return [];
    const all = await res.json();
    const dismissed = readDismissedDraftIds();
    return all.filter((d) => !dismissed.has(d.id));
  } catch (err) {
    console.error('Taslak listesi okunamadı', err);
    return [];
  }
}

// Tüm hocalara+öğrencilere aynı anda tek yönlü bir duyuru — bkz.
// adminCloud.js'teki broadcastSystemMessage yorumu. Kendi ekranı/route'u yok
// (admin.html'de zaten router yok), libraryList.js'in openMediaSheet'i gibi
// yerinde bir sheet — bu kadar küçük, tek-seferlik bir eylem için ayrı bir
// dosya/route açmaya değmiyor.
async function openBroadcastSheet() {
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet">
      <div class="sheet-title">📢 Sistem Mesajı Gönder</div>
      <div class="sheet-sub">Tüm hocalara ve öğrencilere bildirim olarak gönderilir.</div>
      <div class="drafts-label">
        <h3>Taslak Değişiklikler</h3>
        <span class="drafts-count" id="drafts-count"></span>
      </div>
      <div id="drafts-root"><p class="empty-state">Yükleniyor…</p></div>
      <button type="button" class="add-selected-btn" id="add-selected-btn" disabled>Seçilenleri Mesaja Ekle</button>
      <div class="divider"></div>
      <textarea id="broadcast-textarea" class="bulk-textarea" style="min-height:110px;" placeholder="Mesajını yaz…"></textarea>
      <div class="muted" id="broadcast-result" style="text-align:center; margin-top:var(--space-2); min-height:1.2em;"></div>
      <button type="button" class="btn btn-primary btn-block" id="broadcast-send-btn">Gönder</button>
    </div>
  `;
  document.body.appendChild(backdrop);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });

  const textarea = backdrop.querySelector('#broadcast-textarea');
  const resultEl = backdrop.querySelector('#broadcast-result');
  const sendBtn = backdrop.querySelector('#broadcast-send-btn');
  const draftsRoot = backdrop.querySelector('#drafts-root');
  const draftsCount = backdrop.querySelector('#drafts-count');
  const addSelectedBtn = backdrop.querySelector('#add-selected-btn');

  let drafts = await loadDraftItems();
  const selected = new Set();

  function renderDrafts() {
    draftsCount.textContent = drafts.length ? `${drafts.length} madde` : '';
    if (!drafts.length) {
      draftsRoot.innerHTML = '<p class="empty-state">Taslak yok.</p>';
      addSelectedBtn.disabled = true;
      return;
    }
    draftsRoot.innerHTML = Object.entries(DRAFT_CATEGORIES).map(([key, label]) => {
      const items = drafts.filter((d) => d.category === key);
      if (!items.length) return '';
      return `
        <div class="cat-group">
          <div class="cat-heading">${label}</div>
          ${items.map((d) => `
            <div class="draft-item${selected.has(d.id) ? ' checked' : ''}" data-id="${d.id}">
              <span class="draft-check">${selected.has(d.id) ? '✓' : ''}</span>
              <span class="draft-text">${escapeHtml(d.text)}</span>
              <button type="button" class="draft-dismiss" data-dismiss="${d.id}" title="Listeden kaldır">×</button>
            </div>
          `).join('')}
        </div>
      `;
    }).join('');

    draftsRoot.querySelectorAll('.draft-item').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.draft-dismiss')) return;
        const id = el.dataset.id;
        selected.has(id) ? selected.delete(id) : selected.add(id);
        renderDrafts();
      });
    });
    draftsRoot.querySelectorAll('.draft-dismiss').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.dismiss;
        dismissDraftId(id);
        drafts = drafts.filter((d) => d.id !== id);
        selected.delete(id);
        renderDrafts();
      });
    });
    addSelectedBtn.disabled = selected.size === 0;
  }
  renderDrafts();

  addSelectedBtn.addEventListener('click', () => {
    const grouped = Object.entries(DRAFT_CATEGORIES).map(([key, label]) => {
      const items = drafts.filter((d) => selected.has(d.id) && d.category === key);
      if (!items.length) return '';
      return `${label}:\n${items.map((d) => `• ${d.text}`).join('\n')}`;
    }).filter(Boolean).join('\n\n');
    textarea.value = textarea.value.trim() ? `${textarea.value.trim()}\n\n${grouped}` : grouped;
  });

  sendBtn.addEventListener('click', async () => {
    const message = textarea.value.trim();
    if (!message) return;
    if (!(await confirmSheet('Bu mesaj TÜM hocalara ve öğrencilere gönderilecek. Emin misin?', { confirmLabel: 'Gönder', danger: false }))) return;
    sendBtn.disabled = true;
    sendBtn.textContent = 'Gönderiliyor…';
    try {
      const { total, failed } = await broadcastSystemMessage(message);
      resultEl.textContent = failed ? `✓ ${total - failed}/${total} kişiye gönderildi (${failed} başarısız)` : `✓ ${total} kişiye gönderildi`;
      textarea.value = '';
      sendBtn.textContent = 'Gönder';
    } catch (err) {
      console.error('Sistem mesajı gönderilemedi', err);
      resultEl.textContent = 'Gönderilemedi, internet bağlantını kontrol edip tekrar dene.';
      sendBtn.textContent = 'Gönder';
    }
    sendBtn.disabled = false;
  });
}

function showCatalog() {
  exerciseCatalog.render(viewRoot, {
    onBack: showRoster,
    listCatalog, addCatalogExercise, renameCatalogExercise, setCatalogMedia, archiveCatalogExercise,
    listRegions,
  });
}

function showRegions() {
  targetRegions.render(viewRoot, { onBack: showRoster });
}
