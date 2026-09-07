import { escapeHtml } from '../util.js';

const PRE_DELAY_SECONDS = 5;
const INTENSE_THRESHOLD = 10;

// `bindSheetBackClose` (util.js) burada KASITLI olarak kullanılmıyor: o yardımcı
// her açılışta yeni bir history kaydı push edip normal kapanışta `history.back()`
// ile tüketiyor, ama `history.back()` ASENKRON (popstate hemen değil, bir sonraki
// tick'te ateşleniyor). Bir countdown açıkken hemen bir yenisi açılırsa (bkz.
// aşağıdaki activeState), eskisinin geciken `history.back()`'i araya girip YENİ
// countdown'un henüz kayıtlı popstate dinleyicisini tetikleyip onu da anında
// kapatabiliyordu — gerçek bir yarış durumu, test sırasında yakalandı. Çözüm:
// hızlı değişimde history'e HİÇ dokunma (aynı pushlanmış tek kayıt kalsın), sadece
// GERÇEK bir kapanışta (İptal/backdrop/geri tuşu, ardından yeni bir countdown
// açılmıyorsa) `history.back()` çağır.
let activeState = null; // { backdrop, intervalId, onPopState } | null

function teardownActive({ consumeHistory }) {
  if (!activeState) return;
  const { backdrop, intervalId, onPopState } = activeState;
  clearInterval(intervalId);
  backdrop.remove();
  window.removeEventListener('popstate', onPopState);
  activeState = null;
  if (consumeHistory) history.back();
}

// Plank/tutma gibi süre-bazlı egzersizler için: kısa bir hazırlık gecikmesinden
// sonra hedef süreden geriye sayan bir modal. Son 10sn'de nabız yoğunlaşır (bkz.
// dinlenme kronometresinin sürekli nabzından farklı, hedefe özel bir animasyon).
// Ses/titreşim bilinçli olarak bu turda yok — kullanıcı "sonraya kalabilir" dedi.
export function openCountdown({ targetSeconds, label }) {
  // Zaten açık bir countdown varsa SADECE DOM/interval/listener'ını temizle —
  // history'e dokunma, aşağıda o kaydı yeni countdown için yeniden kullanacağız.
  const wasActive = !!activeState;
  if (wasActive) teardownActive({ consumeHistory: false });

  const target = Math.max(1, Math.round(targetSeconds) || 0);
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop countdown-backdrop';
  backdrop.innerHTML = `
    <div class="countdown-modal">
      ${label ? `<div class="countdown-label">${escapeHtml(label)}</div>` : ''}
      <div class="countdown-display">${PRE_DELAY_SECONDS}</div>
      <div class="countdown-sub">Hazırlan...</div>
      <button type="button" class="btn btn-block countdown-cancel">İptal</button>
    </div>
  `;
  document.body.appendChild(backdrop);

  const modal = backdrop.querySelector('.countdown-modal');
  const display = backdrop.querySelector('.countdown-display');
  const sub = backdrop.querySelector('.countdown-sub');

  let phase = 'predelay';
  let remaining = PRE_DELAY_SECONDS;
  let intervalId = null;

  function close() { teardownActive({ consumeHistory: true }); }
  function onPopState() { teardownActive({ consumeHistory: false }); }

  if (!wasActive) history.pushState({ gymbnSheet: true }, '');
  window.addEventListener('popstate', onPopState);
  activeState = { backdrop, intervalId: null, onPopState };

  function tick() {
    remaining--;
    if (phase === 'predelay') {
      if (remaining <= 0) {
        phase = 'counting';
        remaining = target;
        sub.textContent = label ? 'Süre' : '';
      }
      display.textContent = String(remaining);
      return;
    }
    if (phase === 'counting') {
      if (remaining <= INTENSE_THRESHOLD && remaining > 0) modal.classList.add('countdown-intense');
      if (remaining <= 0) {
        phase = 'done';
        clearInterval(intervalId);
        modal.classList.remove('countdown-intense');
        modal.classList.add('countdown-done');
        display.textContent = '✓';
        sub.textContent = 'Bitti!';
        return;
      }
      display.textContent = String(remaining);
    }
  }

  intervalId = setInterval(tick, 1000);
  activeState.intervalId = intervalId; // yukarıda placeholder null ile oluşturulmuştu

  backdrop.querySelector('.countdown-cancel').addEventListener('click', close);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop && phase === 'done') close();
  });
}
