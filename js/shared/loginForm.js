// admin.html ve coach.html'in ikisinin de kullandığı, js/auth.js'in login
// ekranıyla aynı görsel dili paylaşan ama o dosyaya dokunmadan (bilerek ayrı
// tutuluyor — bkz. plan) genel bir giriş formu. escapeHtml burada gerekmiyor:
// hiçbir kullanıcı verisi innerHTML'e enjekte edilmiyor.
export function renderLoginForm(container, { title, subtitle, onSubmit, onResetPassword }) {
  container.innerHTML = `
    <div class="auth-screen">
      <div class="auth-card">
        <div class="auth-title">${title}</div>
        ${subtitle ? `<p class="auth-loading">${subtitle}</p>` : ''}
        <input type="email" id="lf-email" placeholder="E-posta" autocomplete="username">
        <input type="password" id="lf-password" placeholder="Şifre" autocomplete="current-password">
        <button type="button" class="btn btn-primary btn-block" id="lf-submit">Giriş Yap</button>
        ${onResetPassword ? '<button type="button" class="btn btn-ghost btn-block" id="lf-reset">Şifremi unuttum</button>' : ''}
        <p class="auth-error" id="lf-error" style="display:none;"></p>
        <p class="auth-hint" id="lf-hint" style="display:none;"></p>
      </div>
    </div>
  `;

  const emailInput = container.querySelector('#lf-email');
  const passwordInput = container.querySelector('#lf-password');
  const submitBtn = container.querySelector('#lf-submit');
  const resetBtn = container.querySelector('#lf-reset');
  const errorEl = container.querySelector('#lf-error');
  const hintEl = container.querySelector('#lf-hint');

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

  function trySubmit() {
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    if (!email || !password) return;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Giriş yapılıyor…';
    hintEl.style.display = 'none';
    errorEl.style.display = 'none';
    onSubmit(email, password).catch((err) => {
      showError(authErrorMessage(err));
      passwordInput.value = '';
      passwordInput.focus();
    });
  }

  submitBtn.addEventListener('click', trySubmit);
  emailInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') passwordInput.focus(); });
  passwordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') trySubmit(); });

  if (onResetPassword) {
    resetBtn.addEventListener('click', () => {
      const email = emailInput.value.trim();
      if (!email) {
        showError('Önce e-posta adresini yaz, sonra "Şifremi unuttum"a tıkla.');
        emailInput.focus();
        return;
      }
      resetBtn.disabled = true;
      resetBtn.textContent = 'Gönderiliyor…';
      errorEl.style.display = 'none';
      onResetPassword(email)
        .then(() => showHint('Sıfırlama maili gönderildi. Gelmezse spam/gereksiz klasörüne bak.'))
        .catch((err) => showError(authErrorMessage(err)))
        .finally(() => {
          resetBtn.disabled = false;
          resetBtn.textContent = 'Şifremi unuttum';
        });
    });
  }

  emailInput.focus();
}

export function authErrorMessage(err) {
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
  if (code.includes('invalid-email') || code.includes('missing-email')) {
    return 'Geçersiz e-posta adresi.';
  }
  if (code.includes('email-already-in-use')) {
    return 'Bu e-posta zaten kayıtlı.';
  }
  if (code.includes('weak-password')) {
    return 'Şifre en az 6 karakter olmalı.';
  }
  return 'İşlem başarısız, tekrar deneyin.';
}
