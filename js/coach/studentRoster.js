import { renderRosterScreen } from '../roster/rosterUi.js';
import {
  listMyStudents, listPendingStudentInvites, createStudentInvite, cancelStudentInvite, coachSignOut,
  getStudentAppState, listMyNotifications, markNotificationRead, canManageCatalog, canManageRegions,
} from './coachCloud.js';
import { cycleStatus } from './paymentCycle.js';
import { formatDateShortTr } from '../util.js';
import { initNotificationBell } from '../components/notificationBell.js';

function buildInviteLink(token) {
  const url = new URL('./join.html', location.href);
  url.hash = `/student/${token}`;
  return url.href;
}

// Ödeme rozeti için her öğrencinin uzak state'ini AYRICA okumak gerekiyor
// (payments[] students/{uid} dokümanında değil, users/{uid}/data/main'de) —
// paralel çekiliyor, bir öğrencinin okuması başarısız olursa sadece o satır
// rozetsiz kalıyor, tüm roster'ı bozmuyor.
// Kısa, rozet-boyutlu metin için gün-adı sonekinden (19'u/19'unda gibi, sayıya
// göre değişen ünlü uyumu) bilerek kaçınılıyor — tarih doğrudan gösteriliyor.
function badgeForCycle(cycle) {
  if (!cycle.hasPayment) return null;
  if (cycle.overdue) return { text: 'Gecikti', className: 'badge-danger' };
  if (cycle.countdown) {
    return { text: cycle.daysUntilDue === 0 ? 'Bugün' : `${cycle.daysUntilDue} gün`, className: 'badge-warning' };
  }
  return { text: formatDateShortTr(cycle.dueDate), className: '' };
}

async function paymentBadgeFor(studentUid) {
  try {
    const state = await getStudentAppState(studentUid);
    return badgeForCycle(cycleStatus((state && state.payments) || []));
  } catch (err) {
    console.error('Ödeme durumu okunamadı', studentUid, err);
    return null;
  }
}

export async function render(container) {
  container.innerHTML = `
    <div class="view-header">
      <h2 class="view-title">Öğrenciler</h2>
      <div class="view-header-actions" id="header-actions"></div>
    </div>
    <a class="more-menu-item" id="catalog-link" href="#/catalog" style="display:none; margin-bottom:var(--space-3);"><span>📋 Egzersiz Kütüphanesi</span><span class="chevron">›</span></a>
    <a class="more-menu-item" id="regions-link" href="#/regions" style="display:none; margin-bottom:var(--space-3);"><span>🎯 Hedef Bölgeler</span><span class="chevron">›</span></a>
    <div id="coach-body"></div>
  `;
  const headerActions = container.querySelector('#header-actions');
  initNotificationBell(headerActions, {
    listNotifications: listMyNotifications,
    markNotificationRead,
  });
  headerActions.insertAdjacentHTML('beforeend', '<a href="./index.html" class="btn btn-ghost">Kendi Antrenmanım</a><button type="button" class="btn btn-ghost" id="coach-signout-btn">Çıkış</button>');
  container.querySelector('#coach-signout-btn').addEventListener('click', () => coachSignOut());

  canManageCatalog().then((allowed) => {
    if (!allowed) return;
    const linkEl = container.querySelector('#catalog-link');
    if (!linkEl) return; // kullanıcı bu sırada başka ekrana geçmiş olabilir
    linkEl.style.display = '';
  });
  canManageRegions().then((allowed) => {
    if (!allowed) return;
    const linkEl = container.querySelector('#regions-link');
    if (!linkEl) return;
    linkEl.style.display = '';
  });

  await renderRosterScreen(container.querySelector('#coach-body'), {
    addPlaceholder: 'Öğrenci adı',
    addButtonLabel: 'Öğrenci Davet Et',
    emptyText: 'Henüz öğrenci eklenmedi.',
    statLabel: 'Öğrenci',
    loadItems: async () => {
      const students = await listMyStudents();
      const sorted = students.sort((a, b) => a.displayName.localeCompare(b.displayName, 'tr'));
      const badges = await Promise.all(sorted.map((s) => paymentBadgeFor(s.id)));
      return sorted.map((s, i) => ({
        id: s.id,
        title: s.displayName,
        subtitle: 'Yönetmek için dokun',
        href: `#/student/${s.id}`,
        badge: badges[i],
      }));
    },
    loadPendingInvites: async () => {
      const invites = await listPendingStudentInvites();
      return invites.map((inv) => ({ id: inv.id, displayName: inv.displayName, link: buildInviteLink(inv.id) }));
    },
    onAdd: async (name) => ({ link: buildInviteLink(await createStudentInvite(name)) }),
    onCancelInvite: (id) => cancelStudentInvite(id),
    extraStats: (items) => {
      const overdueCount = items.filter((i) => i.badge && i.badge.className === 'badge-danger').length;
      return overdueCount > 0 ? [{ value: overdueCount, label: 'Gecikmiş', warn: true }] : [];
    },
  });
}
