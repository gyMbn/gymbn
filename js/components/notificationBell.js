import { escapeHtml, bindSheetBackClose } from '../util.js';

const ICON_BELL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';

const TYPE_META = {
  program_assigned: '📋',
  workout_started: '▶',
  workout_completed: '✅',
  system_message: '📢',
};

function timeAgoTr(date) {
  const diffMs = Date.now() - date.getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'az önce';
  if (min < 60) return `${min} dakika önce`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} saat önce`;
  const day = Math.floor(hr / 24);
  if (day < 2) return 'dün';
  return `${day} gün önce`;
}

// index.html'in kalıcı .app-header'ı ve coach.html'in roster ekranı gibi farklı
// yerlere aynı zili monte edebilmek için Firebase'den bilerek bağımsız — sadece
// listNotifications/markNotificationRead callback'lerini alıyor (rosterUi.js'in
// aynı deseni). Okunmamış sayısı ilk yüklemede + zile her dokunuşta tazeleniyor,
// canlı dinleyici (onSnapshot) YOK — kasıtlı, "uygulama içi" konseptin ötesine
// geçmiyoruz.
export function initNotificationBell(container, { listNotifications, markNotificationRead }) {
  const bellBtn = document.createElement('button');
  bellBtn.type = 'button';
  bellBtn.className = 'bell-btn';
  bellBtn.setAttribute('aria-label', 'Bildirimler');
  bellBtn.innerHTML = `${ICON_BELL}<span class="bell-dot" style="display:none;"></span>`;
  container.appendChild(bellBtn);

  const dot = bellBtn.querySelector('.bell-dot');
  let cache = [];

  async function refreshUnreadDot() {
    cache = await listNotifications();
    const hasUnread = cache.some((n) => !n.read);
    dot.style.display = hasUnread ? 'block' : 'none';
  }

  function fmtTime(n) {
    const ms = n.createdAt?.toMillis ? n.createdAt.toMillis() : (n.createdAt ?? Date.now());
    return timeAgoTr(new Date(ms));
  }

  function openSheet() {
    const backdrop = document.createElement('div');
    backdrop.className = 'sheet-backdrop';
    backdrop.innerHTML = `
      <div class="sheet notif-sheet">
        <div class="notif-sheet-head">
          <span class="notif-sheet-title">Bildirimler</span>
          <button type="button" class="notif-mark-read" id="notif-mark-all">Tümünü okundu işaretle</button>
        </div>
        <div id="notif-list"></div>
      </div>
    `;
    document.body.appendChild(backdrop);
    const close = bindSheetBackClose(() => backdrop.remove());
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });

    function renderList() {
      const listRoot = backdrop.querySelector('#notif-list');
      if (!cache.length) {
        listRoot.innerHTML = '<p class="empty-state">Henüz bildirim yok.</p>';
        return;
      }
      listRoot.innerHTML = cache.map((n) => `
        <div class="notif-item${n.read ? '' : ' unread'}" data-id="${n.id}">
          <div class="notif-icon">${TYPE_META[n.type] || '🔔'}</div>
          <div class="notif-body">
            <div class="notif-text">${escapeHtml(n.message)}</div>
            <div class="notif-time">${fmtTime(n)}</div>
          </div>
          ${n.read ? '' : '<div class="notif-unread-dot"></div>'}
        </div>
      `).join('');
      listRoot.querySelectorAll('.notif-item.unread').forEach((el) => {
        el.addEventListener('click', async () => {
          const id = el.dataset.id;
          const n = cache.find((x) => x.id === id);
          if (n) n.read = true;
          el.classList.remove('unread');
          el.querySelector('.notif-unread-dot')?.remove();
          dot.style.display = cache.some((x) => !x.read) ? 'block' : 'none';
          await markNotificationRead(id);
        });
      });
    }
    renderList();

    backdrop.querySelector('#notif-mark-all').addEventListener('click', async () => {
      const unread = cache.filter((n) => !n.read);
      unread.forEach((n) => { n.read = true; });
      renderList();
      dot.style.display = 'none';
      await Promise.all(unread.map((n) => markNotificationRead(n.id)));
    });
  }

  bellBtn.addEventListener('click', async () => {
    await refreshUnreadDot(); // sheet'i AÇMADAN önce taze veriyi bekle, yarım/eski liste görünmesin
    openSheet();
  });

  refreshUnreadDot();
}
