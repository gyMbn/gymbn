import { escapeHtml, ICON_TRASH, vibrate } from '../util.js';
import { confirmSheet } from '../components/confirmSheet.js';

// libraryList.js'in .list/.list-item görsel dilini paylaşıyor ama roster'a özgü
// üç farkı karşılıyor: veri asenkron (Firestore), satırlar tıklanabilir link
// olabiliyor (öğrenci → program atama), ve "davet oluştur" akışı (link üretip
// göstermek + bekleyen davetleri listelemek) var. libraryList.js'in kendisi
// senkron store.active() varsayıyor, bu yüzden doğrudan kullanılamadı.
// container'ı zaten SAHİPLENMİŞ bir yer varsayar — üstteki başlık/geri/çıkış
// gibi sayfaya özgü header'ı çağıran kendi çiziyor (admin.html'de "back" hiç
// anlamlı değil, coach.html'de öğrenci satırına tıklanınca gidilecek yer farklı
// olduğu için bu kısım kasıtlı olarak burada değil).
export async function renderRosterScreen(container, config) {
  const {
    addPlaceholder, addButtonLabel = 'Davet Oluştur',
    loadItems, loadPendingInvites, onAdd, onCancelInvite,
    emptyText = 'Henüz eklenmedi.', statLabel, extraStats, onToggle,
  } = config;

  container.innerHTML = `
    <div class="stat-strip" id="roster-stat-strip"></div>
    <form class="add-form" id="roster-add-form">
      <input type="text" id="roster-add-input" placeholder="${escapeHtml(addPlaceholder)}" autocomplete="off">
      <button type="submit" class="btn btn-primary">${escapeHtml(addButtonLabel)}</button>
    </form>
    <div class="search-hint" id="roster-search-hint"></div>
    <div id="roster-invite-panel"></div>
    <div id="roster-pending-root"></div>
    <div class="list" id="roster-list-root"><p class="empty-state">Yükleniyor…</p></div>
  `;

  const addForm = container.querySelector('#roster-add-form');
  const addInput = container.querySelector('#roster-add-input');
  const invitePanel = container.querySelector('#roster-invite-panel');
  const pendingRoot = container.querySelector('#roster-pending-root');
  const listRoot = container.querySelector('#roster-list-root');
  const statStrip = container.querySelector('#roster-stat-strip');
  const searchHint = container.querySelector('#roster-search-hint');

  function renderInvitePanel(link) {
    invitePanel.innerHTML = `
      <div class="card invite-link-card">
        <p class="muted">Davet linki oluşturuldu, kopyala ve gönder:</p>
        <div class="invite-link-row">
          <input type="text" readonly value="${escapeHtml(link)}" class="invite-link-input" id="invite-link-input">
          <button type="button" class="btn btn-primary invite-copy-btn" data-copied-label="Kopyalandı ✓"><span class="copy-label-text">Kopyala</span></button>
        </div>
      </div>
    `;
    const btn = invitePanel.querySelector('.invite-copy-btn');
    btn.addEventListener('click', () => copyLink(link, btn));
  }

  // Kopyalama sessizce oluyordu, tıklandığı belli olmuyordu — buton kısa süre
  // başarı rengine "parlayıp" yavaşça eski haline dönüyor, ifadesi de aynı anda
  // değişip geri dönüyor (metin buton "Kopyalandı ✓", ikon buton "✓"), artı
  // hafif bir haptik darbe. Sadece kopyalama GERÇEKTEN başarılıysa tetikleniyor —
  // clipboard API başarısız olup input'a odaklanma yedeğine düştüğünde değil.
  function flashCopied(btn) {
    vibrate(15);
    btn.classList.add('is-copied');
    setTimeout(() => btn.classList.remove('is-copied'), 900);
    const label = btn.querySelector('.copy-label-text');
    if (!label) return;
    const original = label.textContent;
    const copiedText = btn.dataset.copiedLabel || '✓';
    label.style.opacity = '0';
    setTimeout(() => {
      label.textContent = copiedText;
      label.style.opacity = '1';
    }, 150);
    setTimeout(() => {
      label.style.opacity = '0';
      setTimeout(() => {
        label.textContent = original;
        label.style.opacity = '1';
      }, 150);
    }, 1300);
  }

  async function copyLink(link, btn) {
    try {
      await navigator.clipboard.writeText(link);
      if (btn) flashCopied(btn);
    } catch {
      const input = invitePanel.querySelector('#invite-link-input');
      if (input) { input.focus(); input.select(); }
    }
  }

  function renderPending(invites) {
    if (!invites.length) {
      pendingRoot.innerHTML = '';
      return;
    }
    pendingRoot.innerHTML = `
      <div class="roster-pending-section">
        <div class="list-item-sub roster-pending-heading">Bekleyen Davetler</div>
        <div class="list">
          ${invites.map((inv) => `
            <div class="list-item" data-invite-id="${escapeHtml(inv.id)}">
              <div class="list-item-main">
                <span class="list-item-title">${escapeHtml(inv.displayName)}</span>
                <div class="list-item-sub">Bekliyor</div>
              </div>
              <div class="list-item-actions">
                <button type="button" class="btn-icon invite-copy-again-btn" aria-label="Linki kopyala" title="Linki kopyala"><span class="copy-label-text">⧉</span></button>
                ${onCancelInvite ? `<button type="button" class="btn-icon danger invite-cancel-btn" aria-label="İptal et">${ICON_TRASH}</button>` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
    pendingRoot.querySelectorAll('.list-item').forEach((row, i) => {
      const copyAgainBtn = row.querySelector('.invite-copy-again-btn');
      copyAgainBtn.addEventListener('click', () => copyLink(invites[i].link, copyAgainBtn));
      const cancelBtn = row.querySelector('.invite-cancel-btn');
      if (cancelBtn) {
        cancelBtn.addEventListener('click', async () => {
          if (!(await confirmSheet(`"${invites[i].displayName}" daveti iptal edilsin mi?`, { confirmLabel: 'İptal Et' }))) return;
          cancelBtn.disabled = true;
          try {
            await onCancelInvite(invites[i].id);
            await reload();
          } catch (err) {
            console.error('Davet iptal edilemedi', err);
            alert('Davet iptal edilemedi, tekrar dene.');
            cancelBtn.disabled = false;
          }
        });
      }
    });
  }

  function renderList(items) {
    if (!items.length) {
      listRoot.innerHTML = `<p class="empty-state">${escapeHtml(emptyText)}</p>`;
      return;
    }
    listRoot.innerHTML = items.map((item) => {
      const tag = item.href ? 'a' : 'div';
      const hrefAttr = item.href ? ` href="${item.href}"` : '';
      return `
        <${tag} class="list-item"${hrefAttr} data-id="${escapeHtml(item.id)}">
          <div class="list-item-main">
            <span class="list-item-title">${escapeHtml(item.title)}</span>
            ${item.subtitle ? `<div class="list-item-sub">${escapeHtml(item.subtitle)}</div>` : ''}
          </div>
          ${item.badge ? `<span class="badge ${escapeHtml(item.badge.className || '')}">${escapeHtml(item.badge.text)}</span>` : ''}
          ${item.toggles ? `
            <div class="list-item-toggles-col">
              ${item.toggles.map((t) => `
                <div class="list-item-toggle-group">
                  <span class="list-item-toggle-label">${escapeHtml(t.label)}</span>
                  <button type="button" class="settings-toggle roster-toggle-btn${t.value ? ' on' : ''}" role="switch" aria-checked="${!!t.value}" aria-label="${escapeHtml(t.label)}" data-toggle-key="${escapeHtml(t.key)}"></button>
                </div>
              `).join('')}
            </div>
          ` : ''}
        </${tag}>
      `;
    }).join('');
  }

  // Genel, opt-in satır-içi izin anahtarları (ör. admin'in hoca listesindeki
  // "Kütüphane"/"Hedef Bölge" toggle'ları) — item.toggles vermeyen hiçbir ekran
  // (coach.html'in kendi öğrenci roster'ı dahil) bundan hiç etkilenmiyor. Bir
  // satırda birden fazla bağımsız toggle olabiliyor, data-toggle-key hangisine
  // basıldığını onToggle'a taşıyor. Satır bir <a> ise (burada değil ama genel
  // olsun diye) tıklamanın navigasyonu tetiklememesi için stopPropagation/
  // preventDefault var.
  listRoot.addEventListener('click', async (e) => {
    const toggleBtn = e.target.closest('.roster-toggle-btn');
    if (!toggleBtn || !onToggle) return;
    e.preventDefault();
    e.stopPropagation();
    const row = toggleBtn.closest('.list-item');
    const id = row.dataset.id;
    const key = toggleBtn.dataset.toggleKey;
    const next = !toggleBtn.classList.contains('on');
    toggleBtn.classList.toggle('on', next);
    toggleBtn.setAttribute('aria-checked', String(next));
    toggleBtn.disabled = true;
    try {
      await onToggle(id, key, next);
    } catch (err) {
      console.error('İzin güncellenemedi', err);
      toggleBtn.classList.toggle('on', !next);
      toggleBtn.setAttribute('aria-checked', String(!next));
      alert('İzin güncellenemedi, tekrar dene.');
    } finally {
      toggleBtn.disabled = false;
    }
  });

  // İstatistik şeridi: sayım taşı + (varsa) ekran-özel ek taşlar (ör. roster'da
  // "N Gecikmiş" — admin'in hoca listesinde bu kavram yok, extraStats verilmezse
  // hiç eklenmiyor, şerit tek taşta kalıyor).
  function renderStatStrip(count, items) {
    if (!statLabel) return;
    const tiles = [`
      <div class="stat-tile">
        <div class="stat-tile-value">${count}</div>
        <div class="stat-tile-label">${escapeHtml(statLabel)}</div>
      </div>
    `];
    if (extraStats) {
      extraStats(items).forEach((s) => {
        tiles.push(`
          <div class="stat-tile${s.warn ? ' warn' : ''}">
            <div class="stat-tile-value">${s.value}</div>
            <div class="stat-tile-label">${escapeHtml(s.label)}</div>
          </div>
        `);
      });
    }
    statStrip.innerHTML = tiles.join('');
  }

  // "Öğrenci/Hoca adı" kutusu iki iş görüyor: normal submit'te yeni davet oluşturur,
  // yazarken de aşağıdaki listeyi (hem eklenmiş hem bekleyen) anlık filtreler — datatable
  // arama mantığı. Sıfır eşleşmede "davet et" ipucu göstererek arama mı yeni ekleme mi
  // yaptığı karışmasın diye.
  function rowMatches(row, q) {
    const title = row.querySelector('.list-item-title');
    return !q || (title && title.textContent.toLocaleLowerCase('tr').includes(q));
  }

  function applyFilter() {
    const q = addInput.value.trim().toLocaleLowerCase('tr');
    let listVisible = 0;
    listRoot.querySelectorAll('.list-item').forEach((row) => {
      const match = rowMatches(row, q);
      row.classList.toggle('hidden-by-filter', !match);
      if (match) listVisible++;
    });
    let pendingVisible = 0;
    pendingRoot.querySelectorAll('.list-item').forEach((row) => {
      const match = rowMatches(row, q);
      row.classList.toggle('hidden-by-filter', !match);
      if (match) pendingVisible++;
    });
    const pendingSection = pendingRoot.querySelector('.roster-pending-section');
    if (pendingSection) pendingSection.style.display = pendingVisible ? '' : 'none';

    if (!q) {
      searchHint.textContent = '';
      searchHint.classList.remove('active');
    } else if (listVisible + pendingVisible === 0) {
      searchHint.textContent = `Bu isimde kimse yok — eklemek için "${addForm.querySelector('button').textContent}"e dokun.`;
      searchHint.classList.add('active');
    } else {
      searchHint.textContent = `${listVisible + pendingVisible} eşleşme.`;
      searchHint.classList.remove('active');
    }
  }
  addInput.addEventListener('input', applyFilter);

  async function reload() {
    invitePanel.innerHTML = '';
    const [items, invites] = await Promise.all([loadItems(), loadPendingInvites()]);
    renderList(items);
    renderPending(invites);
    renderStatStrip(items.length, items);
    applyFilter();
  }

  addForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = addInput.value.trim();
    if (!name) return;
    const submitBtn = addForm.querySelector('button');
    submitBtn.disabled = true;
    try {
      const { link } = await onAdd(name);
      addInput.value = '';
      renderInvitePanel(link);
      await reload();
    } catch (err) {
      console.error('Davet oluşturulamadı', err);
      alert('Davet oluşturulamadı, tekrar dene.');
    } finally {
      submitBtn.disabled = false;
    }
  });

  try {
    await reload();
  } catch (err) {
    console.error('Liste yüklenemedi', err);
    listRoot.innerHTML = '<p class="empty-state">Liste yüklenemedi, sayfayı yenile.</p>';
  }
}
