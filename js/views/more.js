import { exportBackup, importBackup } from '../storage.js';
import { isRestTimerAutoResetEnabled, setRestTimerAutoResetEnabled, isExerciseMediaEnabled, setExerciseMediaEnabled, ICON_COACH } from '../util.js';
import { confirmSheet } from '../components/confirmSheet.js';
import { reauthSheet } from '../components/reauthSheet.js';
import { getMyCoachInfo, getAccountKind, deleteMyAccount } from '../cloudSync.js';

export function render(container) {
  container.innerHTML = `
    <div class="view-header">
      <h2 class="view-title">Ayarlar</h2>
    </div>
    <div class="card coach-info-card" id="coach-info-card" style="display:none;">
      ${ICON_COACH}<span>Hocan: <strong id="coach-info-name"></strong></span>
    </div>
    <div class="more-menu">
      <a class="more-menu-item" href="#/exercises"><span>Egzersizler</span><span class="chevron">›</span></a>
      <a class="more-menu-item" href="#/day-types"><span>Gün Tipleri</span><span class="chevron">›</span></a>
      <a class="more-menu-item" href="#/payments"><span>Ödemeler</span><span class="chevron">›</span></a>
    </div>

    <div class="section-title">Ayarlar</div>
    <div class="card">
      <div class="setting-row">
        <div class="setting-row-text">
          <span class="setting-row-title">Dinlenme kronometresini otomatik sıfırla</span>
          <span class="setting-row-sub">Durdurulup 1 dakika dokunulmazsa sıfırlanır</span>
        </div>
        <button type="button" class="settings-toggle" id="auto-reset-toggle" role="switch" aria-label="Dinlenme kronometresini otomatik sıfırla"></button>
      </div>
      <div class="setting-row">
        <div class="setting-row-text">
          <span class="setting-row-title">Hareket videosu ve hedef bölge göster</span>
          <span class="setting-row-sub">Antrenman kartında bağlı video ve kas grubu bilgisini göster</span>
        </div>
        <button type="button" class="settings-toggle" id="exercise-media-toggle" role="switch" aria-label="Hareket videosu ve hedef bölge göster"></button>
      </div>
    </div>

    <div class="section-title">Yedekleme</div>
    <div class="card">
      <p class="muted" style="margin-bottom: var(--space-3);">
        Tüm verilerin bu telefonda saklanıyor. Kaza ile silinmesine karşı ara sıra yedek indirmen önerilir.
      </p>
      <button type="button" class="btn btn-block" id="export-btn" style="margin-bottom: var(--space-3);">Yedeği Dışa Aktar (.json indir)</button>
      <label class="btn btn-block" for="import-file" style="display:block; text-align:center; cursor:pointer;">Yedekten Geri Yükle</label>
      <input type="file" id="import-file" accept="application/json" style="display:none;">
    </div>

    <div class="section-title">Tehlikeli Bölge</div>
    <div class="card">
      <p class="muted" style="margin-bottom: var(--space-3);">
        Hesabını sildiğinde tüm antrenman verilerin ve hesabın kalıcı olarak silinir. Bu geri alınamaz.
      </p>
      <button type="button" class="btn btn-block btn-danger" id="delete-account-btn">Hesabımı Sil</button>
    </div>
  `;

  const autoResetToggle = container.querySelector('#auto-reset-toggle');
  function syncAutoResetToggle() {
    const on = isRestTimerAutoResetEnabled();
    autoResetToggle.classList.toggle('on', on);
    autoResetToggle.setAttribute('aria-checked', String(on));
  }
  syncAutoResetToggle();
  autoResetToggle.addEventListener('click', () => {
    setRestTimerAutoResetEnabled(!isRestTimerAutoResetEnabled());
    syncAutoResetToggle();
  });

  const exerciseMediaToggle = container.querySelector('#exercise-media-toggle');
  function syncExerciseMediaToggle() {
    const on = isExerciseMediaEnabled();
    exerciseMediaToggle.classList.toggle('on', on);
    exerciseMediaToggle.setAttribute('aria-checked', String(on));
  }
  syncExerciseMediaToggle();
  exerciseMediaToggle.addEventListener('click', () => {
    setExerciseMediaEnabled(!isExerciseMediaEnabled());
    syncExerciseMediaToggle();
  });

  container.querySelector('#export-btn').addEventListener('click', () => {
    exportBackup();
  });

  container.querySelector('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!(await confirmSheet('Mevcut tüm veriler yedekteki verilerle değiştirilecek.', { confirmLabel: 'Değiştir' }))) {
      e.target.value = '';
      return;
    }
    importBackup(file, (err) => {
      if (err) {
        alert('Yedek dosyası okunamadı: ' + err.message);
        return;
      }
      location.reload();
    });
  });

  const deleteBtn = container.querySelector('#delete-account-btn');
  deleteBtn.addEventListener('click', async () => {
    const { isCoach } = await getAccountKind();
    let message = 'Hesabın ve tüm antrenman verilerin kalıcı olarak silinecek. Bu geri alınamaz.';
    if (isCoach) {
      message += ' Bağlı öğrencilerinin kendi verileri etkilenmez, sadece "Hocan" satırında artık görünmezsin.';
    }
    if (!(await confirmSheet(message, { confirmLabel: 'Hesabımı Sil' }))) return;

    deleteBtn.disabled = true;
    deleteBtn.textContent = 'Siliniyor…';
    try {
      await deleteMyAccount();
    } catch (err) {
      if (err && err.code === 'auth/requires-recent-login') {
        const password = await reauthSheet('Hesap silme gibi hassas bir işlem için önce şifreni tekrar girmen gerekiyor.');
        if (!password) {
          deleteBtn.disabled = false;
          deleteBtn.textContent = 'Hesabımı Sil';
          return;
        }
        try {
          await deleteMyAccount(password);
        } catch (retryErr) {
          console.error('Hesap silinemedi (yeniden doğrulama sonrası)', retryErr);
          alert('Hesap silinemedi: şifren yanlış olabilir ya da bir bağlantı sorunu var. Tekrar dene.');
          deleteBtn.disabled = false;
          deleteBtn.textContent = 'Hesabımı Sil';
        }
        return;
      }
      console.error('Hesap silinemedi', err);
      alert('Hesap silinemedi, internet bağlantını kontrol edip tekrar dene.');
      deleteBtn.disabled = false;
      deleteBtn.textContent = 'Hesabımı Sil';
    }
  });

  getMyCoachInfo().then((info) => {
    if (!info) return;
    const nameEl = container.querySelector('#coach-info-name');
    const cardEl = container.querySelector('#coach-info-card');
    if (!nameEl || !cardEl) return; // kullanıcı bu sırada başka ekrana geçmiş olabilir
    nameEl.textContent = info.displayName;
    cardEl.style.display = '';
  });
}
