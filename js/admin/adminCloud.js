import { auth, db } from '../shared/firebaseClient.js';
import { DEFAULT_TRACKED_FIELDS } from '../util.js';
import {
  onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail,
} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js';
import {
  doc, getDoc, setDoc, deleteDoc, addDoc, collection, query, where, getDocs, getCountFromServer, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js';

export function onAdminAuthReady(callback) {
  return onAuthStateChanged(auth, callback);
}

export function adminLogin(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export function adminSignOut() {
  return signOut(auth);
}

export function adminResetPassword(email) {
  return sendPasswordResetEmail(auth, email);
}

export async function isCurrentUserAdmin() {
  const user = auth.currentUser;
  if (!user) return false;
  const snap = await getDoc(doc(db, 'admins', user.uid));
  return snap.exists();
}

export async function listCoachesWithCounts() {
  const snap = await getDocs(collection(db, 'coaches'));
  const coaches = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return Promise.all(coaches.map(async (c) => {
    const countSnap = await getCountFromServer(query(collection(db, 'students'), where('coachId', '==', c.id)));
    return { ...c, studentCount: countSnap.data().count };
  }));
}

// Admin'in coach roster'ındaki toggle'ı için — SADECE bu tek alanı değiştiriyor
// (firestore.rules'taki dar update kuralı zaten başka bir alana izin vermiyor).
export async function setCoachCatalogPermission(coachUid, allowed) {
  await setDoc(doc(db, 'coaches', coachUid), { canManageCatalog: !!allowed }, { merge: true });
}

// setCoachCatalogPermission'ın aynı deseni, hedef bölge listesi için — ayrı,
// bağımsız bir izin.
export async function setCoachRegionsPermission(coachUid, allowed) {
  await setDoc(doc(db, 'coaches', coachUid), { canManageRegions: !!allowed }, { merge: true });
}

export async function listPendingCoachInvites() {
  const snap = await getDocs(query(collection(db, 'coachInvites'), where('status', '==', 'pending')));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function createCoachInvite(displayName) {
  const token = crypto.randomUUID();
  await setDoc(doc(db, 'coachInvites', token), {
    displayName,
    status: 'pending',
    createdBy: auth.currentUser.uid,
    createdAt: serverTimestamp(),
  });
  return token;
}

export async function cancelCoachInvite(token) {
  await deleteDoc(doc(db, 'coachInvites', token));
}

// ---- Sistem Mesajı: admin'in tüm hocalara+öğrencilere aynı anda tek yönlü bir
// duyuru göndermesi (ör. "bugün şunlar değişti"). Var olan bildirim sistemi
// (notifications/{id}, bkz. coachCloud.js'in notifyStudent'ı) hoca↔öğrenci
// ilişkisine göre hedefli — admin'in HERKESE ulaşabilmesi için firestore.rules'a
// dar bir isAdmin() istisnası eklendi, mevcut iki dal (coach→öğrenci,
// öğrenci→hoca) hiç değişmedi. Batch yerine Promise.allSettled kullanıyoruz:
// biri (silinmiş/bozuk bir hesap yüzünden) başarısız olursa diğerleri yine de
// ulaşsın istiyoruz, tek bir atomik yazım burada gerekli değil. ----
export async function broadcastSystemMessage(message) {
  const [coachSnap, studentSnap] = await Promise.all([
    getDocs(collection(db, 'coaches')),
    getDocs(collection(db, 'students')),
  ]);
  const recipientUids = [...new Set([...coachSnap.docs.map((d) => d.id), ...studentSnap.docs.map((d) => d.id)])];
  const senderUid = auth.currentUser.uid;
  // Her alıcıya AYRI bir doküman yazılıyor (bkz. üstteki not) ama hepsi aynı
  // broadcastId'yi taşıyor — "Gönderilen Mesajlar" ekranı bunları TEK bir geçmiş
  // kayıt olarak gruplayabilsin ve silme bu grubun TÜMÜNÜ birden kaldırabilsin diye.
  const broadcastId = crypto.randomUUID();
  const results = await Promise.allSettled(recipientUids.map((recipientUid) => addDoc(collection(db, 'notifications'), {
    recipientUid,
    senderUid,
    type: 'system_message',
    message,
    read: false,
    createdAt: serverTimestamp(),
    broadcastId,
  })));
  const failed = results.filter((r) => r.status === 'rejected').length;
  return { total: recipientUids.length, failed };
}

// "Gönderilen Mesajlar" geçmişi — aynı broadcastId'yi taşıyan (tek gönderim,
// alıcı sayısı kadar doküman) kayıtları TEK satıra indiriyor. orderBy YOK
// (recipientUid+createdAt için gerekip de unutulan composite index'in yol açtığı
// v72'deki sessiz FAILED_PRECONDITION hatası tekrar yaşanmasın diye) — sıralama
// istemci tarafında, zaten en fazla birkaç yüz kayıt olur.
export async function listMyBroadcasts() {
  const snap = await getDocs(query(collection(db, 'notifications'), where('type', '==', 'system_message')));
  const groups = new Map();
  snap.docs.forEach((d) => {
    const data = d.data();
    const key = data.broadcastId || d.id; // broadcastId'siz eski kayıtlar (bu alan eklenmeden ÖNCE gönderilenler) kendi başına bir grup kalsın
    if (!groups.has(key)) groups.set(key, { broadcastId: key, message: data.message, createdAt: data.createdAt?.toMillis?.() ?? 0, count: 0 });
    groups.get(key).count += 1;
  });
  return [...groups.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteBroadcast(broadcastId) {
  const snap = await getDocs(query(collection(db, 'notifications'), where('broadcastId', '==', broadcastId)));
  await Promise.allSettled(snap.docs.map((d) => deleteDoc(d.ref)));
}

// ---- exerciseCatalog: hocalar+öğrenciler arasında paylaşılan tek egzersiz listesi.
// Sadece admin yazabiliyor (bkz. firestore.rules) — hoca sadece coachCloud.js'teki
// salt-okunur listCatalog() kopyasıyla okuyor. ----

export async function listCatalog() {
  const snap = await getDocs(collection(db, 'exerciseCatalog'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((e) => !e.archived);
}

export async function addCatalogExercise(name, isDuration = false) {
  const id = crypto.randomUUID();
  await setDoc(doc(db, 'exerciseCatalog', id), {
    name: name.trim(),
    videoUrl: '',
    targetRegions: [],
    isDuration: !!isDuration,
    archived: false,
    trackedFields: DEFAULT_TRACKED_FIELDS,
    createdAt: serverTimestamp(),
  });
  return id;
}

export async function renameCatalogExercise(id, name) {
  await setDoc(doc(db, 'exerciseCatalog', id), { name: name.trim() }, { merge: true });
}

// targetRegions: [{name, color}] — regions koleksiyonundan seçilenlerin O ANKİ
// isim/renginin kopyası (bkz. dosya sonu). dayEntry.js hiçbir zaman regions
// koleksiyonuna bakmıyor, sadece bu kopyayı okuyor. isDuration artık ayrı bir
// setCatalogDuration() yerine burada — bkz. exerciseCatalog.js'teki "Süre-bazlı
// egzersiz" satırı ve bu değişikliğin geldiği sohbet.
export async function setCatalogMedia(id, { videoUrl, targetRegions, trackedFields, isDuration }) {
  await setDoc(doc(db, 'exerciseCatalog', id), {
    videoUrl: videoUrl || '',
    targetRegions: targetRegions || [],
    trackedFields: trackedFields?.length ? trackedFields : DEFAULT_TRACKED_FIELDS,
    isDuration: !!isDuration,
  }, { merge: true });
}

export async function archiveCatalogExercise(id) {
  await setDoc(doc(db, 'exerciseCatalog', id), { archived: true }, { merge: true });
}

// ---- targetRegions: hedef bölge kataloğu, sadece admin (bkz. firestore.rules).
// Renk elle seçilmiyor — oluşturma sırasındaki kayıt sayısına göre sabit bir
// paletten otomatik atanıyor, tek amacı kartlarda görsel ayrım sağlamak. ----

const REGION_COLOR_PALETTE = [
  '#b56b5c', '#5c8f7a', '#c9a15a', '#6b84a8', '#8a6a9c',
  '#b58a5c', '#6f8a8f', '#8b8f98', '#a3684f', '#4f7a6b',
];

export async function listRegions() {
  const snap = await getDocs(collection(db, 'targetRegions'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((r) => !r.archived).sort((a, b) => a.name.localeCompare(b.name, 'tr'));
}

export async function addRegion(name) {
  const existing = await listRegions();
  const id = crypto.randomUUID();
  const color = REGION_COLOR_PALETTE[existing.length % REGION_COLOR_PALETTE.length];
  await setDoc(doc(db, 'targetRegions', id), {
    name: name.trim(),
    color,
    archived: false,
    createdAt: serverTimestamp(),
  });
  return { id, color };
}

export async function renameRegion(id, name) {
  await setDoc(doc(db, 'targetRegions', id), { name: name.trim() }, { merge: true });
}

export async function archiveRegion(id) {
  await setDoc(doc(db, 'targetRegions', id), { archived: true }, { merge: true });
}
