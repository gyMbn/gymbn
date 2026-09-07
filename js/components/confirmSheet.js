import { escapeHtml, bindSheetBackClose } from '../util.js';

// Native confirm() yerine uygulamanın kendi sheet dili — "onayladığımız her
// buton/alan her yerde aynı olsun" ilkesi: TEK tanım, her yıkıcı aksiyon
// aynısını kullanıyor. confirm()'ün senkron API'sine en yakın async karşılığı:
// Promise<boolean> döner.
export function confirmSheet(message, { confirmLabel = 'Sil', cancelLabel = 'Vazgeç', danger = true } = {}) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'sheet-backdrop';
    backdrop.innerHTML = `
      <div class="sheet">
        <div class="sheet-title">Emin misin?</div>
        <p class="confirm-sheet-message">${escapeHtml(message)}</p>
        <div class="confirm-sheet-actions">
          <button type="button" class="btn btn-block ${danger ? 'btn-danger' : 'btn-primary'} confirm-ok-btn">${escapeHtml(confirmLabel)}</button>
          <button type="button" class="btn btn-block confirm-cancel-btn">${escapeHtml(cancelLabel)}</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);

    // Geri tuşuyla kapanırsa (argümansız çağrı) `result` varsayılan olarak
    // false — bu genelde yıkıcı bir işlemi onaylıyor, geri tuşu ASLA "onaylandı"
    // anlamına gelmemeli.
    function doClose(result = false) {
      backdrop.remove();
      resolve(result);
    }
    const close = bindSheetBackClose(doClose);
    backdrop.querySelector('.confirm-ok-btn').addEventListener('click', () => close(true));
    backdrop.querySelector('.confirm-cancel-btn').addEventListener('click', () => close(false));
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(false); });
  });
}
