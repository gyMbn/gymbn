import { escapeHtml, normalizeForMatch, bindSheetBackClose } from '../util.js';

export function openPicker({ title, items, onSelect, emptyMessage }) {
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet">
      <div class="sheet-title">${escapeHtml(title)}</div>
      <input type="text" class="sheet-search-input" placeholder="Ara..." autocomplete="off">
      <div class="sheet-list"></div>
      <button type="button" class="btn btn-block sheet-close">Kapat</button>
    </div>
  `;
  document.body.appendChild(backdrop);

  const searchInput = backdrop.querySelector('.sheet-search-input');
  const listEl = backdrop.querySelector('.sheet-list');

  // normalizeForMatch kullanıyoruz, toLocaleLowerCase('tr-TR') DEĞİL — aynı
  // Türkçe büyük/küçük "I" hatası burada da vardı (bkz. exerciseCatalog.js/
  // targetRegions.js'teki aynı düzeltme): İngilizce kökenli isimlerde ("Incline"
  // gibi) büyük I'nın Türkçe locale'de noktasız "ı"ya dönüşmesi, kullanıcının
  // yazdığı küçük "i" ile eşleşmemesine yol açıyordu.
  function renderList(filterText) {
    const q = normalizeForMatch(filterText);
    const filtered = q ? items.filter((it) => normalizeForMatch(it.name).includes(q)) : items;
    if (!filtered.length) {
      listEl.innerHTML = `<p class="sheet-empty">${escapeHtml(emptyMessage || 'Sonuç yok.')}</p>`;
      return;
    }
    listEl.innerHTML = filtered.map((it) => `<div class="sheet-list-item" data-id="${it.id}">${escapeHtml(it.name)}</div>`).join('');
  }

  const close = bindSheetBackClose(() => backdrop.remove());

  searchInput.addEventListener('input', () => renderList(searchInput.value));

  listEl.addEventListener('click', (e) => {
    const row = e.target.closest('.sheet-list-item');
    if (!row) return;
    onSelect(row.dataset.id);
    close();
  });

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });

  backdrop.querySelector('.sheet-close').addEventListener('click', close);

  renderList('');
  searchInput.focus();
}
