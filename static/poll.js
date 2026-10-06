/* Polling — bir yoxlamanın vəziyyətini dövri sorğulayır.
 *
 * Qaydalar:
 *  • Hər `open()` yeni NƏSİL başladır; köhnə nəslin sorğusu dayandırılır
 *    (AbortController), taymeri silinir, gecikmiş cavabı ekrana toxunmur.
 *  • Yeni yoxlamanın İLK sorğusu köhnə sorğunun bitməsini GÖZLƏMİR — "ümumi
 *    inFlight bayrağı" yoxdur, ona görə A→B keçidində polling donmur.
 *  • Bir nəsildə eyni anda yalnız bir sorğu olur: növbəti sorğu yalnız cavab
 *    gəldikdən sonra taymerlə qurulur.
 *  • Şəbəkə xətası polling-i dayandırmır — `onOffline(true)` və yenidən cəhd.
 *
 * Brauzerdə `window.createPoller`, Node-da `module.exports` (testlər üçün).
 */
(function (root) {
  'use strict';

  function createPoller(options) {
    const fetchCheck = options.fetchCheck;   // (id, signal) => {status: 'ok'|'notfound'|'offline', check}
    const onResult = options.onResult;       // (check) => true olsa polling dayanır
    const onOffline = options.onOffline || function () {};
    const onNotFound = options.onNotFound || function () {};
    const intervalMs = options.intervalMs;
    // Ox funksiyaları ilə: brauzerdə `obj.set = setTimeout; obj.set(...)` çağırışı
    // "Illegal invocation" verir (this ≠ window) — Node bunu bağışlayır.
    const timers = options.timers || {
      set: (fn, ms) => setTimeout(fn, ms),
      clear: (handle) => clearTimeout(handle),
    };

    let generation = 0;
    let id = null;
    let timer = null;
    let controller = null;

    function stop() {
      if (timer !== null) { timers.clear(timer); timer = null; }
      if (controller) { controller.abort(); controller = null; }
      id = null;
      generation += 1;
    }

    function open(checkId) {
      stop();
      id = checkId;
      tick(generation);
    }

    function schedule(gen) {
      timer = timers.set(function () { tick(gen); }, intervalMs);
    }

    async function tick(gen) {
      if (gen !== generation || id === null) return;
      timer = null;
      const own = new AbortController();
      controller = own;

      let outcome;
      try {
        outcome = await fetchCheck(id, own.signal);
      } catch (_) {
        outcome = { status: 'offline' };              // şəbəkə kəsilib və ya dayandırılıb
      }
      if (gen !== generation) return;                 // köhnə nəslin cavabı — toxunmuruq
      controller = null;

      if (outcome.status === 'notfound') {
        id = null;
        onNotFound();
        return;
      }
      if (outcome.status === 'offline') {
        onOffline(true);
        schedule(gen);
        return;
      }
      onOffline(false);
      if (onResult(outcome.check)) {                  // bitibsə sorğu dayanır
        id = null;
        return;
      }
      schedule(gen);
    }

    return {
      open: open,
      stop: stop,
      get generation() { return generation; },
      get activeId() { return id; },
    };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createPoller: createPoller };
  } else {
    root.createPoller = createPoller;
  }
})(this);
