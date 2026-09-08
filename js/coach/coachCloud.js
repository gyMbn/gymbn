// Bilerek firebaseClient.js'in İZOLE app'i DEĞİL, cloudSync.js'in DEFAULT app'i
// kullanılıyor — hoca "Kendi Antrenmanım" sekmesine geçtiğinde index.html AYNI
// oturumu görsün diye (ikinci login yok). admin.html/join.html hâlâ izole kalıyor.
import { auth, db } from '../cloudSync.js';
import { DEFAULT_TRACKED_FIELDS } from '../util.js';
import {
  onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail,
} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js';
import {
  doc, getDoc, setDoc, deleteDoc, collection, query, where, orderBy, limit, getDocs, addDoc, updateDoc, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js';

// admin/adminCloud.js'teki AYNI palet — sadece bu dosyanın kendi addRegion()'ı için.
const REGION_COLOR_PALETTE = [
  '#b56b5c', '#5c8f7a', '#c9a15a', '#6b84a8', '#8a6a9c',
  '#b58a5c', '#6f8a8f', '#8b8f98', '#a3684f', '#4f7a6b',
];

export function onCoachAuthReady(callback) {
  return onAuthStateChanged(auth, callback);
}

export function coachLogin(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export function coachSignOut() {
  return signOut(auth);
}

export function coachResetPassword(email) {
  return sendPasswordResetEmail(auth, email);
}

export async function isCurrentUserCoach() {
  const user = auth.currentUser;
  if (!user) return false;
  const snap = await getDoc(doc(db, 'coaches', user.uid));
  return snap.exists();
}

export async function listMyStudents() {
  const uid = auth.currentUser.uid;
  const snap = await getDocs(query(collection(db, 'students'), where('coachId', '==', uid)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getStudent(studentUid) {
  const snap = await getDoc(doc(db, 'students', studentUid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function listPendingStudentInvites() {
  const uid = auth.currentUser.uid;
  const snap = await getDocs(query(
    collection(db, 'studentInvites'),
    where('coachId', '==', uid),
    where('status', '==', 'pending'),
  ));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function createStudentInvite(displayName) {
  const token = crypto.randomUUID();
  await setDoc(doc(db, 'studentInvites', token), {
    displayName,
    status: 'pending',
    coachId: auth.currentUser.uid,
    createdBy: auth.currentUser.uid,
    createdAt: serverTimestamp(),
  });
  return token;
}

export async function cancelStudentInvite(token) {
  await deleteDoc(doc(db, 'studentInvites', token));
}

/* assignProgram.js için: hedef öğrencinin users/{uid}/data/main dokümanına
   doğrudan erişim — storage.js'in yerel singleton'ından bilerek bağımsız,
   çünkü burada "bu cihazın" değil BAŞKA bir öğrencinin verisi düzenleniyor. */
export async function getStudentAppState(studentUid) {
  const snap = await getDoc(doc(db, 'users', studentUid, 'data', 'main'));
  return snap.exists() ? snap.data() : null;
}

export async function setStudentAppState(studentUid, state) {
  await setDoc(doc(db, 'users', studentUid, 'data', 'main'), { ...state, updatedAt: serverTimestamp() });
}

// Ortak egzersiz kataloğu — varsayılan olarak salt okunur (assignProgram.js/
// bulkAdd.js bunu kullanıyor). Admin'in canManageCatalog toggle'ıyla izin
// verdiği hocalar için YAZMA fonksiyonları da aşağıda — adminCloud.js'teki
// birebir aynıları, sadece bu dosyanın kendi `db`'siyle (bkz. dosya başı).
export async function listCatalog() {
  const snap = await getDocs(collection(db, 'exerciseCatalog'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((e) => !e.archived);
}

// Ayarlar/roster ekranındaki "Egzersiz Kütüphanesi" linkinin görünüp
// görünmeyeceğini belirlemek için — admin izin vermediyse sessizce false.
export async function canManageCatalog() {
  const user = auth.currentUser;
  if (!user) return false;
  try {
    const snap = await getDoc(doc(db, 'coaches', user.uid));
    return snap.exists() && snap.data().canManageCatalog === true;
  } catch (err) {
    console.error('Katalog yetkisi kontrol edilemedi', err);
    return false;
  }
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

// isDuration artık ayrı bir setCatalogDuration() yerine burada — bkz.
// adminCloud.js'teki aynı değişiklik ve exerciseCatalog.js'teki "Süre-bazlı
// egzersiz" satırı.
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

// targetRegions: okuma her hocada açık (canManageCatalog izni olan bir hoca
// video/hedef-bölge sheet'inin çip listesini doldurmak için bu koleksiyonu
// OKUYABİLMELİ — yoksa o sheet o hoca için boş/kırık görünür, bkz. firestore.rules).
export async function listRegions() {
  const snap = await getDocs(collection(db, 'targetRegions'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((r) => !r.archived).sort((a, b) => a.name.localeCompare(b.name, 'tr'));
}

// Ayarlar/roster ekranındaki "Hedef Bölgeler" linkinin görünüp görünmeyeceğini
// belirlemek için — canManageCatalog()'un aynı deseni, ayrı bir bayrak.
export async function canManageRegions() {
  const user = auth.currentUser;
  if (!user) return false;
  try {
    const snap = await getDoc(doc(db, 'coaches', user.uid));
    return snap.exists() && snap.data().canManageRegions === true;
  } catch (err) {
    console.error('Hedef bölge yetkisi kontrol edilemedi', err);
    return false;
  }
}

// admin/adminCloud.js'teki AYNI 3 fonksiyon — sadece bu dosyanın kendi `db`'siyle
// (bkz. dosya başı). canManageRegions izni verilmemiş bir hocada firestore.rules
// zaten reddeder, buradaki fonksiyonların kendisi bir yetki kontrolü YAPMIYOR.
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

/* ---------- Uygulama içi bildirimler ---------- */

// Öğrenciye "program atandı" bildirimindeki gönderen adı için.
export async function getMyCoachProfile() {
  const user = auth.currentUser;
  if (!user) return null;
  const snap = await getDoc(doc(db, 'coaches', user.uid));
  return snap.exists() ? { displayName: snap.data().displayName } : null;
}

export async function listMyNotifications() {
  const user = auth.currentUser;
  if (!user) return [];
  try {
    const snap = await getDocs(query(
      collection(db, 'notifications'),
      where('recipientUid', '==', user.uid),
      orderBy('createdAt', 'desc'),
      limit(30),
    ));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error('Bildirimler okunamadı', err);
    return [];
  }
}

export async function markNotificationRead(id) {
  try {
    await updateDoc(doc(db, 'notifications', id), { read: true });
  } catch (err) {
    console.error('Bildirim okundu işaretlenemedi', err);
  }
}

// Program atama başarıyla kaydedildikten sonra assignProgram.js'ten çağrılıyor.
// Bildirim yazımı başarısız olsa bile asıl atama zaten kaydedilmiş oluyor —
// burada sessizce yutuyoruz ki çağıran taraf "atama başarısız" gibi yanlış bir
// hata göstermek zorunda kalmasın.
export async function notifyStudent(studentUid, type, message) {
  try {
    const user = auth.currentUser;
    await addDoc(collection(db, 'notifications'), {
      recipientUid: studentUid,
      senderUid: user.uid,
      type,
      message,
      read: false,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.error('Öğrenciye bildirim gönderilemedi', err);
  }
}
