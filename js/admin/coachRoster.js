import { renderRosterScreen } from '../roster/rosterUi.js';
import {
  listCoachesWithCounts, listPendingCoachInvites, createCoachInvite, cancelCoachInvite,
  setCoachCatalogPermission, setCoachRegionsPermission,
} from './adminCloud.js';

function buildInviteLink(token) {
  const url = new URL('./join.html', location.href);
  url.hash = `/coach/${token}`;
  return url.href;
}

export async function render(container) {
  await renderRosterScreen(container, {
    addPlaceholder: 'Hoca adı',
    addButtonLabel: 'Hoca Davet Et',
    emptyText: 'Henüz hoca eklenmedi.',
    statLabel: 'Hoca',
    loadItems: async () => {
      const coaches = await listCoachesWithCounts();
      return coaches
        .sort((a, b) => a.displayName.localeCompare(b.displayName, 'tr'))
        .map((c) => ({
          id: c.id,
          title: c.displayName,
          subtitle: `${c.studentCount} öğrenci`,
          // Güvendiğin hocaya, admin'in "Egzersiz Kütüphanesi"/"Hedef Bölgeler"
          // ekranlarındaki AYNI yazma izinlerini ver — ikisi de ayrı bir liste
          // değil, aynı paylaşılan koleksiyonlar; izinler birbirinden bağımsız.
          toggles: [
            { key: 'catalog', label: 'Kütüphane', value: c.canManageCatalog === true },
            { key: 'regions', label: 'Hedef Bölge', value: c.canManageRegions === true },
          ],
        }));
    },
    loadPendingInvites: async () => {
      const invites = await listPendingCoachInvites();
      return invites.map((inv) => ({ id: inv.id, displayName: inv.displayName, link: buildInviteLink(inv.id) }));
    },
    onAdd: async (name) => ({ link: buildInviteLink(await createCoachInvite(name)) }),
    onCancelInvite: (id) => cancelCoachInvite(id),
    onToggle: (id, key, allowed) => (key === 'regions' ? setCoachRegionsPermission(id, allowed) : setCoachCatalogPermission(id, allowed)),
  });
}
