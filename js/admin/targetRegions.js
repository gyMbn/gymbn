import { escapeHtml, ICON_TRASH, normalizeForMatch } from '../util.js';
import { confirmSheet } from '../components/confirmSheet.js';

// exerciseCatalog.js'in aynı arama+eklemeli deseni — burada süre/video/bölge gibi
// egzersize özgü alanlar yok, sadece isim + (otomatik atanan) renk. Renk elle
// seçilmiyor ki kullanıcı her seferinde bir tasarım kararı vermek zorunda kalmasın.
// exerciseCatalog.js'teki AYNI sebep: Firestore fonksiyonları burada sabit import
// DEĞİL, çağıranın (adminApp.js veya coachApp.js) geçtiği parametreler — admin'in
// canManageRegions toggle'ıyla izin verdiği bir hoca da AYNI bu ekranı kullanabiliyor.
export async function render(container, { onBack, listRegions, addRegion, renameRegion, archiveRegion }) {
  container.innerHTML = `
    <div class="view-header">
      <button type="button" class="back-link" id="regions-back-btn" aria-label="Geri">←</button>
      <h2 class="view-title">Hedef Bölgeler</h2>
      <span></span>
    </div>
    <form class="add-form" id="add-form">
      <input type="text" id="add-input" placeholder="Yeni bölge adı" autocomplete="off">
      <button type="submit" class="btn btn-primary" id="add-submit-btn" disabled>Ekle</button>
    </form>
    <div class="search-hint" id="search-hint"></div>
    <div class="list" id="list-root"><p class="empty-state">Yükleniyor…</p></div>
  `;

  container.querySelector('#regions-back-btn').addEventListener('click', onBack);

  const listRoot = container.querySelector('#list-root');
  const addForm = container.querySelector('#add-form');
  const addInput = container.querySelector('#add-input');
  const addSubmitBtn = container.querySelector('#add-submit-btn');
  const searchHint = container.querySelector('#search-hint');

  let items = [];
  try {
    items = await listRegions();
  } catch (err) {
    console.error('Bölge listesi yüklenemedi', err);
    listRoot.innerHTML = '<p class="empty-state">Yüklenemedi, internet bağlantını kontrol edip tekrar dene.</p>';
    return;
  }

  function renderItems() {
    if (!items.length) {
      listRoot.innerHTML = '<p class="empty-state">Henüz eklenmedi.</p>';
    } else {
      items.sort((a, b) => a.name.localeCompare(b.name, 'tr'));
      listRoot.innerHTML = items.map((item) => `
        <div class="list-item" data-id="${item.id}">
          <div class="list-item-main region-row-main">
            <span class="region-color-dot" style="--dot-color:${item.color}"></span>
            <span class="list-item-title view-mode">${escapeHtml(item.name)}</span>
            <input type="text" class="edit-input" style="display:none" value="${escapeHtml(item.name)}">
          </div>
          <div class="list-item-actions">
            <button type="button" class="btn-icon edit-btn" aria-label="Düzenle">✎</button>
            <button type="button" class="btn-icon danger delete-btn" aria-label="Sil">${ICON_TRASH}</button>
          </div>
        </div>
      `).join('');
    }
    applyFilter();
  }

  // exerciseCatalog.js'teki AYNI düzeltme — bkz. oradaki yorum: "Ekle" artık
  // sadece isim BİREBİR (normalizeForMatch) eşleşiyorsa engelleniyor, salt
  // "benzer" (alt-dizge) eşleşme (ör. "Omuz" yazınca "Ön Omuz" varken) artık
  // engellemiyor, sadece listede öne çıkarıyor. Karşılaştırma da (filtre DAHİL)
  // toLocaleLowerCase('tr') DEĞİL normalizeForMatch() kullanıyor — Türkçe
  // locale'de büyük "I" küçülünce noktasız "ı" oluyor, İngilizce kökenli
  // isimlerde (bölge listesinde daha az ama olası) kullanıcının yazdığı küçük
  // "i" ile eşleşmemesine yol açıyordu.
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
      searchHint.textContent = 'Bu isimde bir bölge zaten var.';
      searchHint.classList.add('active');
      addSubmitBtn.disabled = true;
    } else if (visible === 0) {
      searchHint.textContent = 'Bu isimde bir bölge yok, yeni ekleyebilirsin.';
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
          await renameRegion(row.dataset.id, name);
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
      const { id, color } = await addRegion(name);
      items.push({ id, name, color, archived: false });
      renderItems();
    } catch (err) {
      console.error('Bölge eklenemedi', err);
      alert('Bölge eklenemedi, internet bağlantını kontrol edip tekrar dene.');
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
      if (await confirmSheet(`"${name}" silinsin mi? Bu bölge daha önce etiketlenmiş egzersizlerde kalmaya devam eder.`)) {
        try {
          await archiveRegion(item.id);
          items = items.filter((it) => it.id !== item.id);
          renderItems();
        } catch (err) {
          console.error('Bölge silinemedi', err);
          alert('Bölge silinemedi, internet bağlantını kontrol edip tekrar dene.');
        }
      }
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

  renderItems();
}
