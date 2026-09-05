import { auth, db } from './shared/firebaseClient.js';
import { createUserWithEmailAndPassword } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js';
import { doc, getDoc, runTransaction, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js';
import { authErrorMessage } from './shared/loginForm.js';
import { escapeHtml } from './util.js';

const viewRoot = document.getElementById('view-root');

main();

async function main() {
  const parsed = parseHash();
  if (!parsed) {
    renderMessage('Geçersiz davet linki.', true);
    return;
  }
  renderMessage('Davet kontrol ediliyor…', false);
  const { role, token } = parsed;
  const inviteCollection = role === 'coach' ? 'coachInvites' : 'studentInvites';

  let inviteSnap;
  try {
    inviteSnap = await getDoc(doc(db, inviteCollection, token));
  } catch (err) {
    console.error('Davet okunamadı', err);
    renderMessage('Davet yüklenemedi, internet bağlantını kontrol edip tekrar dene.', true);
    return;
  }
  if (!inviteSnap.exists() || inviteSnap.data().status !== 'pending') {
    renderMessage('Bu davet bulunamadı ya da zaten kullanılmış.', true);
    return;
  }
  renderJoinForm(role, token, inviteSnap.data());
}

function parseHash() {
  const match = location.hash.match(/^#\/(coach|student)\/([^/]+)$/);
  if (!match) return null;
  return { role: match[1], token: decodeURIComponent(match[2]) };
}

function renderMessage(text, isError) {
  viewRoot.innerHTML = `
    <div class="auth-screen">
      <div class="auth-card">
        <div class="auth-title">gyMbn</div>
        <p class="${isError ? 'auth-error' : 'auth-loading'}">${escapeHtml(text)}</p>
      </div>
    </div>
  `;
}

function renderJoinForm(role, token, invite) {
  const roleLabel = role === 'coach' ? 'hoca' : 'öğrenci';
  viewRoot.innerHTML = `
    <div class="auth-screen">
      <div class="auth-card">
        <div class="auth-title">gyMbn</div>
        <p class="auth-loading">${escapeHtml(invite.displayName)} olarak (${roleLabel}) katılıyorsun. Hesabını oluşturmak için e-posta ve şifre belirle.</p>
        <input type="email" id="join-email" placeholder="E-posta" autocomplete="username">
        <input type="password" id="join-password" placeholder="Şifre (en az 6 karakter)" autocomplete="new-password">
        <button type="button" class="btn btn-primary btn-block" id="join-submit">Hesap Oluştur</button>
        <p class="auth-error" id="join-error" style="display:none;"></p>
      </div>
    </div>
  `;

  const emailInput = viewRoot.querySelector('#join-email');
  const passwordInput = viewRoot.querySelector('#join-password');
  const submitBtn = viewRoot.querySelector('#join-submit');
  const errorEl = viewRoot.querySelector('#join-error');

  function showError(message) {
    errorEl.textContent = message;
    errorEl.style.display = 'block';
    submitBtn.disabled = false;
    submitBtn.textContent = 'Hesap Oluştur';
  }

  async function trySubmit() {
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    if (!email || !password) return;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Hesap oluşturuluyor…';
    errorEl.style.display = 'none';

    let userCredential;
    try {
      userCredential = await createUserWithEmailAndPassword(auth, email, password);
    } catch (err) {
      showError(authErrorMessage(err));
      return;
    }

    try {
      await claimInvite(role, token, userCredential.user.uid, email);
    } catch (err) {
      console.error('Davet tamamlanamadı', err);
      try {
        await userCredential.user.delete();
      } catch (cleanupErr) {
        console.error('Yarım kalan hesap geri alınamadı', cleanupErr);
      }
      showError('Davet tamamlanamadı (belki az önce başka biri kullandı). Linki tekrar açıp dene.');
      return;
    }

    location.href = role === 'coach' ? './coach.html' : './index.html';
  }

  submitBtn.addEventListener('click', trySubmit);
  passwordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') trySubmit(); });
}

async function claimInvite(role, token, uid, email) {
  const inviteCollection = role === 'coach' ? 'coachInvites' : 'studentInvites';
  const roleCollection = role === 'coach' ? 'coaches' : 'students';
  const inviteRef = doc(db, inviteCollection, token);
  const roleRef = doc(db, roleCollection, uid);

  await runTransaction(db, async (tx) => {
    const freshInvite = await tx.get(inviteRef);
    if (!freshInvite.exists() || freshInvite.data().status !== 'pending') {
      throw new Error('invite-not-pending');
    }
    const invite = freshInvite.data();
    const roleDoc = { displayName: invite.displayName, email, createdAt: serverTimestamp(), inviteToken: token };
    if (role === 'student') roleDoc.coachId = invite.coachId;
    tx.set(roleRef, roleDoc);
    tx.update(inviteRef, { status: 'claimed', claimedUid: uid });
  });
}
