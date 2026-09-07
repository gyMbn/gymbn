import { isoToDate, todayIso, pad2 } from '../util.js';

export function sortedPayments(payments) {
  return [...payments].sort((a, b) => b.date.localeCompare(a.date));
}

const COUNTDOWN_DAYS = 10;

function clampDayToMonth(year, month, day) {
  const lastDay = new Date(year, month + 1, 0).getDate();
  return Math.min(day, lastDay);
}

function anchorDateFor(anchorDay, year, month) {
  return new Date(year, month, clampDayToMonth(year, month, anchorDay));
}

// Bir ödeme, kendi ayının milad gününü KAPATIR — o gün gelmeden önce (erken),
// tam o gün, ya da geçtikten sonra (geç) yapılmış olması fark etmiyor. Sıradaki
// ödeme her zaman BİR SONRAKİ ayın milad günü. Eskiden bu sadece milad günü
// geçmişse/tam o günse bir sonraki aya atlıyordu — erken ödemede (ör. milad 5,
// ödeme 3'ünde) o ayın miladını hâlâ "önümüzde" gösteriyordu, "erken ödedim,
// hoca işaretledi ama uygulama hâlâ bu ayın ödemesini bekliyormuş gibi
// davranıyor" diye bildirilen gerçek bir kullanıcı şikayetiydi. storage.js'teki
// AYNI mantığın izole kopyası — biri değişirse ikisi de değişmeli.
function nextOccurrenceAfter(anchorDay, date) {
  let year = date.getFullYear();
  let month = date.getMonth() + 1;
  if (month > 11) { month = 0; year += 1; }
  return anchorDateFor(anchorDay, year, month);
}

function toIso(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function daysBetween(a, b) {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

// Kayan 4 haftalık döngü yerine sabit ayın günü: en ESKİ ödemenin günü kalıcı
// milad oluyor (ayrı bir ayar yok — "hangi gün ödemeye başladıysa o milad").
// Sıradaki ödeme, EN SON ödemeden sonraki ilk milad günü — geç ödense bile bir
// sonraki miladı ERTELEMİYOR, sadece o anki gecikmeyi kapatıyor (kullanıcının
// isteği: takvimdeki gün sabit kalsın, ödemenin ne zaman geldiği bir sonraki
// tarihi kaydırmasın). storage.js'in getPaymentCycleStatus()'ıyla AYNI mantığın
// izole kopyası — biri değişirse ikisi de değişmeli.
export function cycleStatus(payments) {
  const sorted = sortedPayments(payments);
  if (!sorted.length) return { hasPayment: false };

  const anchorDay = isoToDate(sorted[sorted.length - 1].date).getDate();
  const today = isoToDate(todayIso());
  const latestPaymentDate = isoToDate(sorted[0].date);
  const dueDate = nextOccurrenceAfter(anchorDay, latestPaymentDate);
  const overdue = today.getTime() > dueDate.getTime();

  if (overdue) {
    return {
      hasPayment: true,
      anchorDay,
      overdue: true,
      dueDate: toIso(dueDate),
      daysSinceDue: daysBetween(dueDate, today),
    };
  }
  const daysUntilDue = daysBetween(today, dueDate);
  return {
    hasPayment: true,
    anchorDay,
    overdue: false,
    dueDate: toIso(dueDate),
    daysUntilDue,
    countdown: daysUntilDue <= COUNTDOWN_DAYS,
  };
}
