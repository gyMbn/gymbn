import { onAuthReady, login, resetPassword } from './cloudSync.js';

export function boot(onSignedIn) {
  document.body.classList.add('auth-gate');
  showLoadingScreen();
  onAuthReady((user) => {
    if (user) {
      onSignedIn();
    } else {
      showLoginScreen();
    }
  });
}

export function unlockAppShell() {
  document.body.classList.remove('auth-gate');
}

function viewRoot() {
  return document.getElementById('view-root');
}

function showLoadingScreen() {
  viewRoot().innerHTML = `
    <div class="auth-screen">
      <div class="auth-card">
        <div class="auth-title">gyMbn</div>
        <p class="auth-loading">Yükleniyor…</p>
      </div>
    </div>
  `;
}

function showLoginScreen() {
  viewRoot().innerHTML = `
    <div class="auth-screen">
      <div class="auth-card">
        <div class="auth-title">gyMbn</div>
        <input type="email" id="auth-email" placeholder="E-posta" autocomplete="username">
        <input type="password" id="auth-password" placeholder="Şifre" autocomplete="current-password">
        <button type="button" class="btn btn-primary btn-block" id="auth-submit">Giriş Yap</button>
        <button type="button" class="btn btn-ghost btn-block" id="auth-reset">Şifremi unuttum</button>
        <p class="auth-error" id="auth-error" style="display:none;"></p>
        <p class="auth-hint" id="auth-hint" style="display:none;"></p>
      </div>
    </div>
  `;

  const emailInput = document.getElementById('auth-email');
  const passwordInput = document.getElementById('auth-password');
  const submitBtn = document.getElementById('auth-submit');
  const resetBtn = document.getElementById('auth-reset');
  const errorEl = document.getElementById('auth-error');
  const hintEl = document.getElementById('auth-hint');

  function showError(message) {
    hintEl.style.display = 'none';
    errorEl.textContent = message;
    errorEl.style.display = 'block';
    submitBtn.disabled = false;
    submitBtn.textContent = 'Giriş Yap';
  }

  function showHint(message) {
    errorEl.style.display = 'none';
    hintEl.textContent = message;
    hintEl.style.display = 'block';
  }

  function trySignIn() {
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    if (!email || !password) return;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Giriş yapılıyor…';
    hintEl.style.display = 'none';
    errorEl.style.display = 'none';
    login(email, password).catch((err) => {
      showError(loginErrorMessage(err));
      passwordInput.value = '';
      passwordInput.focus();
    });
  }

  function tryResetPassword() {
    const email = emailInput.value.trim();
    if (!email) {
      showError('Önce e-posta adresini yaz, sonra "Şifremi unuttum"a tıkla.');
      emailInput.focus();
      return;
    }
    resetBtn.disabled = true;
    resetBtn.textContent = 'Gönderiliyor…';
    errorEl.style.display = 'none';
    resetPassword(email)
      .then(() => showHint('Sıfırlama maili gönderildi. Gelmezse spam/gereksiz klasörüne bak.'))
      .catch((err) => showError(resetErrorMessage(err)))
      .finally(() => {
        resetBtn.disabled = false;
        resetBtn.textContent = 'Şifremi unuttum';
      });
  }

  submitBtn.addEventListener('click', trySignIn);
  resetBtn.addEventListener('click', tryResetPassword);
  emailInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') passwordInput.focus(); });
  passwordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') trySignIn(); });
  emailInput.focus();
}

function loginErrorMessage(err) {
  const code = err?.code || '';
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) {
    return 'E-posta veya şifre hatalı.';
  }
  if (code.includes('too-many-requests')) {
    return 'Çok fazla deneme yapıldı, biraz sonra tekrar deneyin.';
  }
  if (code.includes('network-request-failed')) {
    return 'İnternet bağlantısı yok.';
  }
  if (code.includes('invalid-email')) {
    return 'Geçersiz e-posta adresi.';
  }
  return 'Giriş başarısız, tekrar deneyin.';
}

function resetErrorMessage(err) {
  const code = err?.code || '';
  if (code.includes('invalid-email') || code.includes('missing-email')) {
    return 'Geçersiz e-posta adresi.';
  }
  if (code.includes('too-many-requests')) {
    return 'Çok fazla deneme yapıldı, biraz sonra tekrar deneyin.';
  }
  if (code.includes('network-request-failed')) {
    return 'İnternet bağlantısı yok.';
  }
  return 'Sıfırlama maili gönderilemedi, tekrar deneyin.';
}
