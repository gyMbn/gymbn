// confirmSheet.js'in aynı görsel dilini (sheet-backdrop) kullanan, ama bir metin
// yerine bir ŞİFRE alanı isteyen tek amaçlı sheet. Firebase'in hassas işlemler
// için (hesap silme gibi) "requires-recent-login" fırlattığı, uzun süredir
// oturumu açık kullanıcıları yeniden doğrulamak için kullanılıyor. confirmSheet
// gibi bir Promise döner — iptal edilirse null, girilirse şifre string'i.
import { escapeHtml } from '../util.js';

export function reauthSheet(message) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'sheet-backdrop';
    backdrop.innerHTML = `
      <div class="sheet">
        <div class="sheet-title">Şifreni tekrar gir</div>
        <p class="confirm-sheet-message">${escapeHtml(message)}</p>
        <input type="password" class="reauth-password-input" placeholder="Şifre" autocomplete="current-password" style="margin-bottom: var(--space-3);">
        <p class="auth-error reauth-error" style="display:none; margin-bottom: var(--space-3);"></p>
        <div class="confirm-sheet-actions">
          <button type="button" class="btn btn-block btn-danger reauth-ok-btn">Devam Et</button>
          <button type="button" class="btn btn-block reauth-cancel-btn">Vazgeç</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);

    const input = backdrop.querySelector('.reauth-password-input');
    const errorEl = backdrop.querySelector('.reauth-error');

    function close(result) {
      backdrop.remove();
      resolve(result);
    }
    function submit() {
      const password = input.value;
      if (!password) {
        errorEl.textContent = 'Şifreni yaz.';
        errorEl.style.display = 'block';
        return;
      }
      close(password);
    }
    backdrop.querySelector('.reauth-ok-btn').addEventListener('click', submit);
    backdrop.querySelector('.reauth-cancel-btn').addEventListener('click', () => close(null));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(null); });
    input.focus();
  });
}
