import { escapeHtml, ICON_TRASH, ICON_MEDIA, normalizeForMatch, TRACKED_FIELD_TYPES, DEFAULT_TRACKED_FIELDS, bindSheetBackClose } from '../util.js';
import { confirmSheet } from '../components/confirmSheet.js';

// libraryList.js'in aynı görsel/etkileşim dili — sadece veri kaynağı yerel
// storage.js yerine ortak exerciseCatalog koleksiyonu (async Firestore).
// Varsayılan olarak admin'in tek yazabildiği yer burasıydı; artık admin'in
// canManageCatalog toggle'ıyla izin verdiği bir hoca da AYNI bu ekranı
// kullanabiliyor — o yüzden Firestore fonksiyonları burada sabit import
// DEĞİL, çağıranın (adminApp.js veya coachApp.js) geçtiği parametreler:
// hangi app'in oturumunu (izole admin app'i mi, coach'un paylaşılan
// oturumu mu) kullanacağını çağıran belirliyor, bu dosya hiç bilmiyor.
export async function render(container, {
  onBack, listCatalog, addCatalogExercise, renameCatalogExercise, setCatalogMedia,
  archiveCatalogExercise, listRegions,
}) {
  container.innerHTML = `
    <div class="view-header">
      <button type="button" class="back-link" id="catalog-back-btn" aria-label="Geri">←</button>
      <h2 class="view-title">Egzersiz Kütüphanesi</h2>
      <span></span>
    </div>
    <form class="add-form" id="add-form">
      <input type="text" id="add-input" placeholder="Yeni egzersiz adı" autocomplete="off">
      <button type="submit" class="btn btn-primary" id="add-submit-btn" disabled>Ekle</button>
    </form>
    <div class="search-hint" id="search-hint"></div>
    <div class="list" id="list-root"><p class="empty-state">Yükleniyor…</p></div>
  `;

  container.querySelector('#catalog-back-btn').addEventListener('click', onBack);

  const listRoot = container.querySelector('#list-root');
  const addForm = container.querySelector('#add-form');
  const addInput = container.querySelector('#add-input');
  const addSubmitBtn = container.querySelector('#add-submit-btn');
  const searchHint = container.querySelector('#search-hint');

  let items = [];
  let regions = [];
  try {
    [items, regions] = await Promise.all([listCatalog(), listRegions()]);
  } catch (err) {
    console.error('Katalog yüklenemedi', err);
    listRoot.innerHTML = '<p class="empty-state">Katalog yüklenemedi, internet bağlantını kontrol edip tekrar dene.</p>';
    return;
  }

  function renderItems() {
    if (!items.length) {
      listRoot.innerHTML = '<p class="empty-state">Henüz eklenmedi.</p>';
    } else {
      items.sort((a, b) => a.name.localeCompare(b.name, 'tr'));
      listRoot.innerHTML = items.map((item) => `
        <div class="list-item" data-id="${item.id}">
          <div class="list-item-main">
            <span class="list-item-title view-mode">${escapeHtml(item.name)}</span>
            <input type="text" class="edit-input" style="display:none" value="${escapeHtml(item.name)}">
          </div>
          <div class="list-item-actions">
            <button type="button" class="btn-icon media-btn${(item.videoUrl || item.targetRegions?.length) ? ' active' : ''}" aria-label="Video ve hedef bölge" title="Video ve hedef bölge">${ICON_MEDIA}</button>
            <button type="button" class="btn-icon edit-btn" aria-label="Düzenle">✎</button>
            <button type="button" class="btn-icon danger delete-btn" aria-label="Sil">${ICON_TRASH}</button>
          </div>
        </div>
      `).join('');
    }
    applyFilter();
  }

  // Yazarken listeyi anlık filtrele (rosterUi.js'teki aynı arama mantığı) — "Ekle"
  // düğmesi SADECE isim BİREBİR (normalizeForMatch ile) mevcut bir kayıtla
  // eşleşiyorsa devre dışı kalıyor. Önceden "benzer" (alt-dizge) eşleşme bile
  // engelliyordu — "bench press" yazınca "Pause Bench Press" varsa eklemeyi
  // tamamen kilitliyordu, halbuki ikisi apayrı hareketler. Artık benzer kayıtlar
  // hâlâ listede öne çıkarılıyor (yazım farkıyla yanlışlıkla ikinci bir kopya
  // açmayı önlemek için, kullanıcının kendi isteği) ama sadece GERÇEKTEN aynı
  // isim varsa "Ekle" engelleniyor.
  // ÖNEMLİ: filtre ve eşleşme her ikisi de normalizeForMatch() kullanıyor,
  // toLocaleLowerCase('tr') DEĞİL — Türkçe locale'de büyük "I" küçülünce
  // noktasız "ı" oluyor ("İncline" değil "Incline" gibi İngilizce kökenli
  // hareket isimlerinde bu, kullanıcının yazdığı küçük "i" ile hiç eşleşmiyordu).
  // normalizeForMatch zaten uygulamanın her yerinde bu tür karşılaştırma için
  // kullanılan TEK doğru kaynak, burası da ona uyuyor.
  function rowMatches(row, q) {
    const title = row.querySelector('.list-item-title');
    return !q || (title && normalizeForMatch(title.textContent).includes(q));
  }

  function applyFilter() {
    const q = normalizeForMatch(addInput.value);
    let visible = 0;
    listRoot.querySelectorAll('.list-item').forEach((row) => {
      const match = rowMatches(row, q);
      row.classList.toggle('hidden-by-filter', !match);
      if (match) visible++;
    });
    const exactMatch = !!q && items.some((it) => normalizeForMatch(it.name) === q);
    if (!q) {
      searchHint.textContent = '';
      searchHint.classList.remove('active');
      addSubmitBtn.disabled = true;
    } else if (exactMatch) {
      searchHint.textContent = 'Bu isimde bir egzersiz zaten var.';
      searchHint.classList.add('active');
      addSubmitBtn.disabled = true;
    } else if (visible === 0) {
      searchHint.textContent = 'Bu isimde bir egzersiz yok, yeni ekleyebilirsin.';
      searchHint.classList.remove('active');
      addSubmitBtn.disabled = false;
    } else {
      searchHint.textContent = `${visible} benzer kayıt var, önce onlara bak.`;
      searchHint.classList.add('active');
      addSubmitBtn.disabled = false;
    }
  }
  addInput.addEventListener('input', applyFilter);

  function enterEdit(row) {
    row.querySelector('.view-mode').style.display = 'none';
    const input = row.querySelector('.edit-input');
    input.style.display = '';
    input.focus();
    input.select();
  }

  async function exitEdit(row, save) {
    const input = row.querySelector('.edit-input');
    const viewSpan = row.querySelector('.view-mode');
    if (save) {
      const name = input.value.trim();
      if (name) {
        const item = items.find((it) => it.id === row.dataset.id);
        item.name = name;
        viewSpan.textContent = name;
        try {
          await renameCatalogExercise(row.dataset.id, name);
        } catch (err) {
          console.error('İsim güncellenemedi', err);
        }
      }
    } else {
      input.value = viewSpan.textContent;
    }
    input.style.display = 'none';
    viewSpan.style.display = '';
  }

  addForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (addSubmitBtn.disabled) return;
    const name = addInput.value.trim();
    if (!name) return;
    addInput.value = '';
    addInput.focus();
    try {
      const id = await addCatalogExercise(name);
      items.push({ id, name, videoUrl: '', targetRegions: [], isDuration: false, archived: false, trackedFields: DEFAULT_TRACKED_FIELDS });
      renderItems();
    } catch (err) {
      console.error('Egzersiz eklenemedi', err);
      alert('Egzersiz eklenemedi, internet bağlantını kontrol edip tekrar dene.');
    }
  });

  listRoot.addEventListener('click', async (e) => {
    const row = e.target.closest('.list-item');
    if (!row) return;
    const item = items.find((it) => it.id === row.dataset.id);
    if (e.target.closest('.edit-btn')) {
      enterEdit(row);
    } else if (e.target.closest('.delete-btn')) {
      const name = row.querySelector('.view-mode').textContent;
      if (await confirmSheet(`"${name}" silinsin mi?`)) {
        try {
          await archiveCatalogExercise(item.id);
          items = items.filter((it) => it.id !== item.id);
          renderItems();
        } catch (err) {
          console.error('Egzersiz silinemedi', err);
          alert('Egzersiz silinemedi, internet bağlantını kontrol edip tekrar dene.');
        }
      }
    } else if (e.target.closest('.media-btn')) {
      openMediaSheet(item);
    }
  });

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

  function openMediaSheet(item) {
    // targetRegions dizisindeki isimleri kataloğun GÜNCEL region listesiyle eşleştir
    // (id saklamıyoruz, isim üzerinden — bkz. dosya başı notu). Ayrıca eski tekil
    // `targetRegion` alanından (bu özellik çoklu-seçime geçmeden önceki veri) da
    // aynı şekilde tek bir ön-seçim türetiyoruz, ilk kez göç ederken kaybolmasın.
    const selectedNames = new Set((item.targetRegions || []).map((r) => r.name));
    if (item.targetRegion) selectedNames.add(item.targetRegion);
    const selectedIds = new Set(regions.filter((r) => selectedNames.has(r.name)).map((r) => r.id));
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
            ${regions.length ? regions.map((r) => (
              `<button type="button" class="region-chip${selectedIds.has(r.id) ? ' selected' : ''}" data-id="${r.id}">${escapeHtml(r.name)}</button>`
            )).join('') : '<p class="empty-state">Henüz bölge eklenmedi, önce Hedef Bölgeler ekranından ekle.</p>'}
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

    backdrop.querySelector('#media-save').addEventListener('click', async () => {
      const videoUrl = backdrop.querySelector('#media-url').value.trim();
      const targetRegions = [...backdrop.querySelectorAll('#media-region-grid .region-chip.selected')].map((chip) => {
        const region = regions.find((r) => r.id === chip.dataset.id);
        return { name: region.name, color: region.color };
      });
      const trackedFields = [...backdrop.querySelectorAll('#media-field-grid .region-chip.selected')].map((chip) => chip.dataset.key);
      // Satır gizliyken (Tekrar/Rir hiç seçili değilken) anahtarın önceki
      // durumu ne olursa olsun isDuration'ı false'a düşürüyoruz — gizli bir
      // anahtarın görünmeyen "açık" hâli kalıcı olarak saklanmasın.
      const isDuration = durationRow.style.display !== 'none' && durationToggle.classList.contains('on');
      const saveBtn = backdrop.querySelector('#media-save');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Kaydediliyor…';
      try {
        await setCatalogMedia(item.id, { videoUrl, targetRegions, trackedFields, isDuration });
        item.videoUrl = videoUrl;
        item.targetRegions = targetRegions;
        item.trackedFields = trackedFields.length ? trackedFields : DEFAULT_TRACKED_FIELDS;
        item.isDuration = isDuration;
        close();
        renderItems();
      } catch (err) {
        console.error('Video/bölge kaydedilemedi', err);
        saveBtn.disabled = false;
        saveBtn.textContent = 'Kaydet';
        alert('Kaydedilemedi, internet bağlantını kontrol edip tekrar dene.');
      }
    });
  }

  renderItems();
}
