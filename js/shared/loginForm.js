import { escapeHtml } from '../util.js';

// admin.html ve coach.html'in ikisinin de kullandığı, js/auth.js'in login
// ekranıyla aynı görsel dili paylaşan ama o dosyaya dokunmadan (bilerek ayrı
// tutuluyor — bkz. plan) genel bir giriş formu.

const REMEMBERED_KEY = 'gymbn_rememberedAccounts';
const PENDING_SWITCH_KEY = 'gymbn_pendingSwitchEmail';
const ROLE_LABELS = { admin: 'Admin', coach: 'Hoca' };

// Şifre HİÇBİR ZAMAN kaydedilmiyor — sadece "bu e-posta, bu rolle daha önce
// başarıyla giriş yaptı" bilgisi. admin.html ve coach.html AYNI origin'de
// (localStorage paylaşımlı), o yüzden bir sayfada giriş yapılan hesap diğer
// sayfada da tek tıkla çıkabiliyor.
function getRememberedAccounts() {
  try {
    const raw = localStorage.getItem(REMEMBERED_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function rememberAccount(email, role) {
  try {
    const list = getRememberedAccounts().filter((a) => a.email !== email);
    list.unshift({ email, role });
    localStorage.setItem(REMEMBERED_KEY, JSON.stringify(list.slice(0, 5)));
  } catch {
    // localStorage kullanılamıyorsa (gizli sekme vb.) sessizce atla — hatırlama
    // sadece bir kolaylık, giriş yapabilme yeteneğini hiç etkilemiyor.
  }
}

// "ali@gmail.com" -> "ali***@gmail.com" — ekranda tam e-postayı göstermemek için.
function maskEmail(email) {
  const at = email.indexOf('@');
  if (at <= 0) return email;
  return `${email.slice(0, Math.min(3, at))}***${email.slice(at)}`;
}

export function renderLoginForm(container, { title, subtitle, onSubmit, onResetPassword, role }) {
  const remembered = role ? getRememberedAccounts() : [];
  const chipsHtml = remembered.length ? `
    <div class="acc-chip-list">
      ${remembered.map((a, i) => `
        <button type="button" class="acc-chip" data-idx="${i}">
          <div class="acc-chip-avatar">${escapeHtml((ROLE_LABELS[a.role] || a.role || '?')[0])}</div>
          <div class="acc-chip-text">
            <div class="acc-chip-role">${escapeHtml(ROLE_LABELS[a.role] || a.role)}</div>
            <div class="acc-chip-email">${escapeHtml(maskEmail(a.email))}</div>
          </div>
          <div class="acc-chip-arrow">›</div>
        </button>
      `).join('')}
    </div>
    <div class="acc-divider">veya yeni hesapla gir</div>
  ` : '';

  container.innerHTML = `
    <div class="auth-screen">
      <div class="auth-card">
        <div class="auth-title">${title}</div>
        ${subtitle ? `<p class="auth-loading">${subtitle}</p>` : ''}
        ${chipsHtml}
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

  container.querySelectorAll('.acc-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const acc = remembered[Number(chip.dataset.idx)];
      if (!acc) return;
      if (acc.role === role) {
        // Aynı sayfa/rol — sadece e-postayı doldurup şifreye odaklan (tarayıcı
        // kayıtlı şifresi varsa genelde kendisi de dolduruyor).
        emailInput.value = acc.email;
        passwordInput.focus();
      } else {
        // Farklı rol (ör. coach.html'deyken Admin çipine basmak) — doğru sayfaya
        // GEÇ, e-postayı oraya sessionStorage üzerinden taşı (tek seferlik).
        try { sessionStorage.setItem(PENDING_SWITCH_KEY, acc.email); } catch { /* yoksay */ }
        location.href = acc.role === 'admin' ? './admin.html' : './coach.html';
      }
    });
  });

  // Diğer sayfadan bir "farklı role geç" tıklamasıyla gelindiyse, e-postayı
  // otomatik doldur (bir kereliğine — hemen tüketilip siliniyor).
  if (role) {
    try {
      const pending = sessionStorage.getItem(PENDING_SWITCH_KEY);
      if (pending) {
        sessionStorage.removeItem(PENDING_SWITCH_KEY);
        emailInput.value = pending;
      }
    } catch { /* yoksay */ }
  }

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
    onSubmit(email, password).then(() => {
      if (role) rememberAccount(email, role);
    }).catch((err) => {
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
