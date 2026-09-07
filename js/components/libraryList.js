import { escapeHtml, ICON_TRASH, ICON_MEDIA, EXERCISE_REGIONS, TRACKED_FIELD_TYPES, DEFAULT_TRACKED_FIELDS, normalizeForMatch, bindSheetBackClose } from '../util.js';
import { confirmSheet } from './confirmSheet.js';
import { getAnyAccessibleCatalog } from '../cloudSync.js';
import { closestCatalogMatch } from '../shared/catalogMatch.js';

// enableCatalogMatch: SADECE exerciseLibrary.js için (dayTypeLibrary.js'in
// kataloğa bağlı bir kavramı hiç yok, o hiç bu alanı geçmiyor). "Kimse yeni
// hareket eklemeyecek, herkes admin'den eklenen hareketleri kullanacak" —
// standing prensip, bkz. bu özelliğin geldiği sohbet (hem coach-yönetimli
// öğrenciler HEM koçun kendi "Kendi Antrenmanım" hesabı için, hesap türü fark
// etmeksizin AYNI kural). Mantık: yazdığın isim kataloğa TAM ya da YAKIN
// (yazım hatası ihtimali) uyuyorsa VE kendi listende buna zaten benzer/aynı
// bir kayıt varsa, "Ekle" o kaydı ele geçirmesin diye devre dışı kalıyor —
// sadece açık bir "Bağla/Güncelle" düğmesiyle, ne olacağı ÖNCE gösterilerek
// ilerlenebiliyor. Kataloğa hiç uymayan GERÇEKTEN yeni bir isimse "Ekle" artık
// hep devre dışı — kütüphane dışı bağımsız kayıt hiçbir hesapta oluşmasın diye.
export function renderLibraryList(container, { title, store, placeholder, backHref, showMediaEditor, enableCatalogMatch }) {
  container.innerHTML = `
    <div class="view-header">
      <a href="${backHref}" class="back-link" aria-label="Geri">←</a>
      <h2 class="view-title">${title}</h2>
      <span></span>
    </div>
    <form class="add-form" id="add-form">
      <input type="text" id="add-input" placeholder="${placeholder}" autocomplete="off">
      <button type="submit" class="btn btn-primary">Ekle</button>
    </form>
    <div class="search-hint" id="add-hint"></div>
    <div id="add-suggest"></div>
    <div class="list" id="list-root"></div>
  `;

  const listRoot = container.querySelector('#list-root');
  const addForm = container.querySelector('#add-form');
  const addInput = container.querySelector('#add-input');
  const addSubmitBtn = addForm.querySelector('button[type="submit"]');
  const addHint = container.querySelector('#add-hint');
  const addSuggest = container.querySelector('#add-suggest');

  let catalog = null;
  if (enableCatalogMatch) {
    getAnyAccessibleCatalog().then((cat) => {
      catalog = cat;
      // Kataloğa zaten bağlı egzersizleri de sessizce tazele — bkz. storage.js'teki
      // syncAllWithCatalog ve "Hyper Extension" un elle tazeletilmek zorunda
      // kaldığı sohbet. Bir şey gerçekten değiştiyse listeyi yeniden çiz.
      if (store.syncAllWithCatalog?.(cat)) renderItems();
      updateAddState();
    });
  }

  function findLocalMatch(name, excludeId) {
    const q = normalizeForMatch(name);
    const active = store.active();
    const exact = active.find((it) => it.id !== excludeId && normalizeForMatch(it.name) === q);
    if (exact) return exact;
    return active.find((it) => it.id !== excludeId && closestCatalogMatch(it.name, [{ id: '_', name }])) || null;
  }

  // Hem "Ekle" hem önerinin kendi düğmesi AYNI bu fonksiyonu çağırıyor —
  // ikisinin ayrı ayrı hesaplayıp tutarsız kalması (bu özelliğin demo
  // aşamasında iki kere yaşandı) böyle engelleniyor.
  function commitAdd(effectiveName, catalogEx) {
    const localMatch = findLocalMatch(effectiveName, null);
    if (localMatch) {
      if (catalogEx) store.bindToCatalog(localMatch.id, catalogEx);
      else store.rename(localMatch.id, effectiveName);
    } else if (catalogEx) {
      store.resolveFromCatalog(catalogEx);
    } else {
      store.add(effectiveName);
    }
    addInput.value = '';
    renderItems();
    updateAddState();
    addInput.focus();
  }

  function updateAddState() {
    if (!enableCatalogMatch) return;
    const name = addInput.value;
    const q = normalizeForMatch(name);
    addSuggest.innerHTML = '';
    if (!q) { addHint.textContent = ''; addHint.classList.remove('active'); addSubmitBtn.disabled = false; return; }

    const exactOwn = store.active().find((it) => normalizeForMatch(it.name) === q);
    if (exactOwn) {
      addHint.textContent = 'Bu isimde bir egzersizin zaten var.';
      addHint.classList.add('active');
      addSubmitBtn.disabled = true;
      return;
    }
    addHint.textContent = '';
    addHint.classList.remove('active');

    // Kataloğa hiç uymayan, gerçekten yeni bir isim artık kimse için serbestçe
    // eklenemiyor — bkz. dosya başındaki not.
    const blockUnlisted = () => {
      addHint.textContent = 'Bu hareket kütüphanede yok. Kütüphaneye eklenmesi için admin\'e ilet.';
      addHint.classList.add('active');
      addSubmitBtn.disabled = true;
    };

    if (!catalog || !catalog.length) { blockUnlisted(); return; }
    const catalogEx = catalog.find((c) => normalizeForMatch(c.name) === q) || closestCatalogMatch(name, catalog);
    if (!catalogEx) { blockUnlisted(); return; }

    const effectiveName = catalogEx.name;
    const localMatch = findLocalMatch(effectiveName, null);
    if (localMatch) {
      addSubmitBtn.disabled = true;
      addSuggest.innerHTML = `
        <div class="exercise-bind-suggestion">
          <span>Listende zaten <b>"${escapeHtml(localMatch.name)}"</b> var, kütüphaneye bağlayayım mı?</span>
          <button type="button" class="exercise-bind-btn" id="bind-btn">Bağla</button>
        </div>
      `;
      container.querySelector('#bind-btn').addEventListener('click', () => commitAdd(effectiveName, catalogEx));
      return;
    }

    addSubmitBtn.disabled = false;
    if (normalizeForMatch(catalogEx.name) !== q) {
      addSuggest.innerHTML = `
        <div class="exercise-bind-suggestion">
          <span>Kütüphanede <b>"${escapeHtml(catalogEx.name)}"</b> var, bunu mu demek istedin?</span>
          <button type="button" class="exercise-bind-btn" id="bind-btn">Buna Bağla</button>
        </div>
      `;
      container.querySelector('#bind-btn').addEventListener('click', () => commitAdd(catalogEx.name, catalogEx));
    }
  }
  addInput.addEventListener('input', updateAddState);

  function renderItems() {
    const items = store.active();
    if (!items.length) {
      listRoot.innerHTML = '<p class="empty-state">Henüz eklenmedi.</p>';
      return;
    }
    listRoot.innerHTML = items.map((item) => `
      <div class="list-item" data-id="${item.id}">
        <div class="list-item-main">
          <span class="list-item-title view-mode">${escapeHtml(item.name)}</span>
          <input type="text" class="edit-input" style="display:none" value="${escapeHtml(item.name)}">
        </div>
        <div class="list-item-actions">
          ${showMediaEditor ? `<button type="button" class="btn-icon media-btn${(item.videoUrl || item.targetRegions?.length) ? ' active' : ''}" aria-label="Video ve hedef bölge" title="Video ve hedef bölge">${ICON_MEDIA}</button>` : ''}
          <button type="button" class="btn-icon edit-btn" aria-label="Düzenle">✎</button>
          <button type="button" class="btn-icon danger delete-btn" aria-label="Sil">${ICON_TRASH}</button>
        </div>
      </div>
    `).join('');
  }

  function enterEdit(row) {
    row.querySelector('.view-mode').style.display = 'none';
    const input = row.querySelector('.edit-input');
    input.style.display = '';
    input.focus();
    input.select();
  }

  function exitEdit(row, save) {
    const input = row.querySelector('.edit-input');
    const viewSpan = row.querySelector('.view-mode');
    if (save) {
      const name = input.value.trim();
      if (name) {
        store.rename(row.dataset.id, name);
        viewSpan.textContent = name;
      }
    } else {
      input.value = viewSpan.textContent;
    }
    input.style.display = 'none';
    viewSpan.style.display = '';
  }

  addForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (addSubmitBtn.disabled) return;
    const name = addInput.value.trim();
    if (!name) return;
    if (enableCatalogMatch) {
      const q = normalizeForMatch(name);
      const catalogEx = catalog && (catalog.find((c) => normalizeForMatch(c.name) === q) || closestCatalogMatch(name, catalog));
      commitAdd(catalogEx ? catalogEx.name : name, catalogEx || null);
    } else {
      store.add(name);
      addInput.value = '';
      renderItems();
      addInput.focus();
    }
  });

  listRoot.addEventListener('click', async (e) => {
    const row = e.target.closest('.list-item');
    if (!row) return;
    if (e.target.closest('.edit-btn')) {
      enterEdit(row);
    } else if (e.target.closest('.delete-btn')) {
      const name = row.querySelector('.view-mode').textContent;
      if (await confirmSheet(`"${name}" silinsin mi?`)) {
        store.archive(row.dataset.id);
        renderItems();
      }
    } else if (e.target.closest('.media-btn')) {
      openMediaSheet(store.byId(row.dataset.id));
    }
  });

  function openMediaSheet(item) {
    const selectedNames = new Set((item.targetRegions || []).map((r) => r.name));
    if (item.targetRegion) selectedNames.add(item.targetRegion); // eski tekil alan, göç
    const selectedFields = new Set(item.trackedFields || DEFAULT_TRACKED_FIELDS);

    const backdrop = document.createElement('div');
    backdrop.className = 'sheet-backdrop';
    backdrop.innerHTML = `
      <div class="sheet">
        <div class="sheet-title">${escapeHtml(item.name)}</div>
        <div class="sheet-sub">Video linki, hedef bölge(ler) ve takip edilecek alanlar</div>
        <div class="field">
          <label>Video linki</label>
          <input type="text" id="media-url" placeholder="https://..." value="${escapeHtml(item.videoUrl || '')}">
        </div>
        <div class="field">
          <label>Hedef bölge (birden fazla seçebilirsin)</label>
          <div class="region-grid" id="media-region-grid">
            ${[...EXERCISE_REGIONS].sort((a, b) => a.name.localeCompare(b.name, 'tr')).map((r) => (
              `<button type="button" class="region-chip${selectedNames.has(r.name) ? ' selected' : ''}" data-name="${escapeHtml(r.name)}" data-color="${r.color}">${escapeHtml(r.name)}</button>`
            )).join('')}
          </div>
        </div>
        <div class="field">
          <label>Takip edilecek alanlar (istediğin kadar seç)</label>
          <div class="region-grid" id="media-field-grid">
            ${TRACKED_FIELD_TYPES.map((f) => (
              `<button type="button" class="region-chip${selectedFields.has(f.key) ? ' selected' : ''}" data-key="${f.key}">${escapeHtml(f.label)}${f.unit ? ` (${f.unit})` : ''}</button>`
            )).join('')}
          </div>
        </div>
        <div class="setting-row" id="media-duration-row" style="margin-bottom:var(--space-4);">
          <div class="setting-row-text">
            <span class="setting-row-title">Süre-bazlı egzersiz</span>
            <span class="setting-row-sub">Tekrar/Rir saniye olarak yorumlanır (plank, statik tutuş)</span>
          </div>
          <button type="button" class="settings-toggle${item.isDuration ? ' on' : ''}" id="media-duration-toggle" aria-label="Süre-bazlı egzersiz" role="switch" aria-checked="${item.isDuration ? 'true' : 'false'}"></button>
        </div>
        <button type="button" class="btn btn-primary btn-block" id="media-save">Kaydet</button>
      </div>
    `;
    document.body.appendChild(backdrop);

    const durationRow = backdrop.querySelector('#media-duration-row');
    const durationToggle = backdrop.querySelector('#media-duration-toggle');
    const fieldGrid = backdrop.querySelector('#media-field-grid');

    // Süre-bazlı anahtarı sadece Tekrar veya Rir seçiliyken bir anlam taşıyor
    // (bkz. dosya başındaki not) — ikisi de kapalıyken anahtarı tamamen gizle,
    // Yürüyüş gibi hareketlerde hiç kafa karıştırmasın.
    function syncDurationRowVisibility() {
      const hasRepsOrRir = !!fieldGrid.querySelector('[data-key="reps"].selected, [data-key="rir"].selected');
      durationRow.style.display = hasRepsOrRir ? 'flex' : 'none';
    }
    syncDurationRowVisibility();

    backdrop.querySelectorAll('.region-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        chip.classList.toggle('selected');
        if (chip.closest('#media-field-grid')) syncDurationRowVisibility();
      });
    });

    durationToggle.addEventListener('click', () => {
      const isOn = durationToggle.classList.toggle('on');
      durationToggle.setAttribute('aria-checked', isOn ? 'true' : 'false');
    });

    const close = bindSheetBackClose(() => backdrop.remove());
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });

    backdrop.querySelector('#media-save').addEventListener('click', () => {
      const videoUrl = backdrop.querySelector('#media-url').value.trim();
      const targetRegions = [...backdrop.querySelectorAll('#media-region-grid .region-chip.selected')].map((chip) => ({
        name: chip.dataset.name,
        color: chip.dataset.color,
      }));
      const trackedFields = [...backdrop.querySelectorAll('#media-field-grid .region-chip.selected')].map((chip) => chip.dataset.key);
      // Satır gizliyken (Tekrar/Rir hiç seçili değilken) anahtarın önceki
      // durumu ne olursa olsun isDuration'ı false'a düşürüyoruz — gizli bir
      // anahtarın görünmeyen "açık" hâli kalıcı olarak saklanmasın.
      const isDuration = durationRow.style.display !== 'none' && durationToggle.classList.contains('on');
      store.setMedia(item.id, { videoUrl, targetRegions, trackedFields, isDuration });
      close();
      renderItems();
    });
  }

  listRoot.addEventListener('keydown', (e) => {
    if (!e.target.classList.contains('edit-input')) return;
    const row = e.target.closest('.list-item');
    if (e.key === 'Enter') {
      e.preventDefault();
      exitEdit(row, true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      exitEdit(row, false);
    }
  });

  listRoot.addEventListener('focusout', (e) => {
    if (!e.target.classList.contains('edit-input')) return;
    const row = e.target.closest('.list-item');
    if (row && row.querySelector('.edit-input').style.display !== 'none') {
      exitEdit(row, true);
    }
  });

  renderItems();
}
