import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js';
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  deleteUser,
  reauthenticateWithCredential,
  EmailAuthProvider,
} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  serverTimestamp,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  addDoc,
  updateDoc,
} from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyBxS_9poiPlGAj0XuZMZ1t14a3kpCcwk0w',
  authDomain: 'gymbn-33e8f.firebaseapp.com',
  projectId: 'gymbn-33e8f',
  storageBucket: 'gymbn-33e8f.firebasestorage.app',
  messagingSenderId: '190634675327',
  appId: '1:190634675327:web:ff37d7d1ac76b10ae8434a',
};

const LOCAL_STORAGE_KEY = 'gymbnData'; // storage.js'deki STORAGE_KEY ile aynı tutulmalı

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.error('Auth kalıcılığı ayarlanamadı', err);
});

// coachCloud.js bilerek buradan import ediyor: hoca "Kendi Antrenmanım" ekranına
// geçtiğinde index.html'in AYNI oturumunu kullansın diye (ikinci login olmasın).
export { auth, db };

let pullCompleted = false;
let pushTimer = null;

function userDocRef() {
  const user = auth.currentUser;
  if (!user) return null;
  return doc(db, 'users', user.uid, 'data', 'main');
}

export function onAuthReady(callback) {
  return onAuthStateChanged(auth, callback);
}

export function login(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export function resetPassword(email) {
  return sendPasswordResetEmail(auth, email);
}

export function signOutUser() {
  return signOut(auth);
}

/**
 * Firestore'daki doküman yerelden yeniyse localStorage'ı üzerine yazıp reload eder.
 * Dönüş değeri true ise reload zaten tetiklendi, çağıran initApp() çağırmamalı.
 */
export async function pullRemoteIfNewer(localUpdatedAt) {
  const ref = userDocRef();
  if (!ref) {
    pullCompleted = true;
    return false;
  }
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      pullCompleted = true;
      return false;
    }
    const remote = snap.data();
    const remoteUpdatedAt = remote.updatedAt && typeof remote.updatedAt.toMillis === 'function'
      ? remote.updatedAt.toMillis()
      : 0;
    if (remoteUpdatedAt > (localUpdatedAt || 0)) {
      const { updatedAt, ...rest } = remote;
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({ ...rest, updatedAt: remoteUpdatedAt }));
      pullCompleted = true;
      location.reload();
      return true;
    }
    pullCompleted = true;
    return false;
  } catch (err) {
    console.error('Bulut verisi çekilemedi', err);
    pullCompleted = true;
    return false;
  }
}

// Bu hesap bir hocaya bağlı öğrenciyse students/{uid} dokümanını (displayName +
// coachId) döner, değilse (bireysel kullanım, ki çoğu hesap böyle) sessizce null
// — hata fırlatmıyor.
async function getMyStudentRecord() {
  const user = auth.currentUser;
  if (!user) return null;
  const snap = await getDoc(doc(db, 'students', user.uid));
  return snap.exists() ? snap.data() : null;
}

// Ayarlar ekranındaki salt-okunur "Hocan: ..." satırı için. firestore.rules'ta
// coaches/{uid}'in get izni buna göre genişletildi (bkz. isMyCoach).
export async function getMyCoachInfo() {
  try {
    const rec = await getMyStudentRecord();
    if (!rec || !rec.coachId) return null;
    const coachSnap = await getDoc(doc(db, 'coaches', rec.coachId));
    return coachSnap.exists() ? { displayName: coachSnap.data().displayName } : null;
  } catch (err) {
    console.error('Hoca bilgisi okunamadı', err);
    return null;
  }
}

// Ayarlar ekranındaki "◀ Hoca Paneline Dön" linki için: bu hesabın AYNI ZAMANDA
// coaches/{uid} dokümanı da varsa (yani coach.html'den "Kendi Antrenmanım" ile
// buraya geldiyse) true döner. Hata/yoksa sessizce false.
export async function isCurrentUserAlsoCoach() {
  try {
    const user = auth.currentUser;
    if (!user) return false;
    const snap = await getDoc(doc(db, 'coaches', user.uid));
    return snap.exists();
  } catch (err) {
    console.error('Hoca yetkisi kontrol edilemedi', err);
    return false;
  }
}

// "Hesabımı sil" ekranının doğru uyarı metnini gösterebilmesi için: bu hesap
// coach-yönetimli bir öğrenci mi, kendi de bir hoca mı (Kendi Antrenmanım'daki
// gibi), yoksa bağımsız bireysel bir hesap mı — üçü birbirini dışlamıyor (bir
// hoca kendi hesabıyla aynı zamanda başka bir hocaya bağlı öğrenci OLAMAZ ama
// koda güvenmek yerine ikisini de gerçekten sorup dönüyoruz).
export async function getAccountKind() {
  const [studentRec, coach] = await Promise.all([
    getMyStudentRecord(),
    isCurrentUserAlsoCoach(),
  ]);
  return { isStudent: !!studentRec, isCoach: coach };
}

// Hesabı ve TÜM Firestore verisini kalıcı olarak siler, en son da Firebase Auth
// hesabının kendisini siler (bu adım geri alınamaz). Sıra bilerek böyle: Firestore
// temizliği auth hesabı hâlâ varken yapılıyor (auth silinirse kurallar artık
// isSignedIn()'i geçemez, yarım kalan temizlik bir daha tamamlanamaz).
// `password` verilmezse normal silme denenir; Firebase "requires-recent-login"
// fırlatırsa (uzun süredir açık bir oturum) çağıran taraf kullanıcıdan şifresini
// isteyip bu fonksiyonu password'lü tekrar çağırmalı — o zaman önce yeniden
// doğrulama yapılıp silme işlemine öyle devam edilir.
export async function deleteMyAccount(password) {
  const user = auth.currentUser;
  if (!user) throw new Error('no-user');

  if (password) {
    const credential = EmailAuthProvider.credential(user.email, password);
    await reauthenticateWithCredential(user, credential);
  }

  const { isStudent, isCoach } = await getAccountKind();
  await deleteDoc(doc(db, 'users', user.uid, 'data', 'main'));
  if (isStudent) await deleteDoc(doc(db, 'students', user.uid));
  if (isCoach) await deleteDoc(doc(db, 'coaches', user.uid));

  // Bildirimlerin silinmesi ZORUNLU değil (alıcı zaten sadece kendi bildirimini
  // görüyor, bu hesap silinince kimse onlara erişemez) — kapsamı gereksiz
  // büyütmemek için bilerek atlandı.
  // auth.js'in login ekranı bunu görüp bir kereliğine "hesabın silindi" ipucu
  // gösteriyor — deleteUser() sonrası onAuthStateChanged hemen tetiklenip
  // view-root'u login ekranına çevireceği için, o an başka bir yerde mesaj
  // göstermenin bir anlamı yok.
  sessionStorage.setItem('gymbn_accountDeleted', '1');
  await deleteUser(user);
}

// bulkAdd.js için: hesap coach-yönetimli bir öğrenciyse (students/{uid} var)
// paylaşılan admin kataloğunu döner — o zaman bulkAdd.js "kendi uydurma" isim
// kabul etmeyip zorunlu bir dropdown'a geçiyor (hoca tarafındaki AYNI mantık,
// tekrarlayan/yazım-hatalı isimler sistem genelinde çoğalmasın diye). Bireysel
// hesaplarda (students dokümanı yok) null dönüp bulkAdd.js'in eski serbest metin
// davranışını hiç değiştirmiyor. firestore.rules'ta exerciseCatalog'un get/list
// izni buna göre genişletildi (bkz. isManagedStudent).
export async function getMyCatalogIfManaged() {
  try {
    const rec = await getMyStudentRecord();
    if (!rec) return null;
    const snap = await getDocs(collection(db, 'exerciseCatalog'));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((e) => !e.archived);
  } catch (err) {
    console.error('Katalog okunamadı', err);
    return null;
  }
}

// getMyCatalogIfManaged'dan FARKLI amaç: o "bu hesap ZORUNLU dropdown görsün mü"
// sorusuna cevap veriyor (sadece coach-yönetimli öğrenciler). Bu ise "Kendi
// Antrenmanım"daki bir hocanın kendi SERBEST yazdığı bir egzersizi İSTEĞE BAĞLI
// olarak kütüphaneye bağlayabilmesi için — hoca zaten isCoach() ile kataloğu
// okuyabiliyor (assignProgram.js'te olduğu gibi), burada sadece aynı veriyi
// bulkAdd.js'in bireysel/serbest-metin ekranına da (salt bu opsiyonel eşleştirme
// özelliği için) taşıyoruz. Coach değilse veya hata olursa sessizce null.
export async function getCoachOwnCatalogForLinking() {
  try {
    const isCoach = await isCurrentUserAlsoCoach();
    if (!isCoach) return null;
    const snap = await getDocs(collection(db, 'exerciseCatalog'));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((e) => !e.archived);
  } catch (err) {
    console.error('Katalog okunamadı', err);
    return null;
  }
}

// dayEntry.js'nin "+ Egzersiz Ekle" gibi İSTEĞE BAĞLI kütüphane-arama
// özellikleri için — hesap TÜRÜ ne olursa olsun (coach-yönetimli öğrenci VEYA
// coach'un kendisi) erişebildiği bir katalog varsa onu döner. İkisinin kendi
// ayrı, spesifik anlamını (zorunlu dropdown / opsiyonel eşleştirme) DEĞİŞTİRMİYOR
// — sadece "bu hesap için bakılacak bir katalog var mı" diye TEK yerden
// sorulabilsin diye. İkisi de yoksa (gerçek bireysel hesap) null.
export async function getAnyAccessibleCatalog() {
  const managed = await getMyCatalogIfManaged();
  if (managed) return managed;
  return getCoachOwnCatalogForLinking();
}

/* ---------- Uygulama içi bildirimler ---------- */

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

// Antrenman başlat/tamamla anlarında çağrılıyor — sadece hocaya bağlı hesaplarda
// gerçekten bir şey yazıyor, bireysel kullanımda sessizce hiçbir şey yapmıyor.
// `detail` sadece olayın kendisini anlatıyor ("Anterior-1 antrenmanına başladı") —
// öğrencinin adını students/{uid}'den kendi ekliyor, çağıran taraf bilmek zorunda
// değil (personal app kendi adını hiç saklamıyor, sadece bu dokümanda duruyor).
export async function notifyMyCoach(type, detail) {
  const user = auth.currentUser;
  if (!user) return;
  try {
    const rec = await getMyStudentRecord();
    if (!rec || !rec.coachId) return;
    const name = rec.displayName || 'Öğrencin';
    await addDoc(collection(db, 'notifications'), {
      recipientUid: rec.coachId,
      senderUid: user.uid,
      type,
      message: `${name} ${detail}`,
      read: false,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.error('Hocaya bildirim gönderilemedi', err);
  }
}

/** storage.js'in saveState()'i her çağrıldığında tetiklenir; kendi içinde ayrı debounce'u var. */
export function scheduleCloudPush(state) {
  if (!pullCompleted) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => pushNow(state), 1500);
}

async function pushNow(state) {
  const ref = userDocRef();
  if (!ref) return;
  try {
    await setDoc(ref, { ...state, updatedAt: serverTimestamp() });
  } catch (err) {
    console.error('Bulut senkronu başarısız', err);
  }
}
