// Polling testləri: node --test tests/js
// Brauzer və şəbəkə yoxdur — fetch və taymerlər əl ilə idarə olunur.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { createPoller } = require(path.join(__dirname, '..', '..', 'static', 'poll.js'));

/** Cavabı testin özü verən fetch: hər çağırış gözləyən söz (deferred) qaytarır. */
function fakeFetch() {
  const calls = [];
  const fn = (id, signal) => new Promise((resolve, reject) => {
    calls.push({ id, signal, resolve, reject });
  });
  return { fn, calls };
}

/** Əl ilə işə salınan taymerlər. */
function fakeTimers() {
  const pending = new Map();
  let next = 1;
  return {
    set(fn) { const h = next++; pending.set(h, fn); return h; },
    clear(h) { pending.delete(h); },
    count() { return pending.size; },
    runAll() { const fns = [...pending.values()]; pending.clear(); fns.forEach((f) => f()); },
  };
}

const flush = () => new Promise((r) => setImmediate(r));

function setup(overrides = {}) {
  const fetch = fakeFetch();
  const timers = fakeTimers();
  const seen = { results: [], offline: [], notFound: 0 };
  const poller = createPoller({
    fetchCheck: fetch.fn,
    onResult: (check) => { seen.results.push(check.id); return check.run_state === 'tamamlandi'; },
    onOffline: (flag) => seen.offline.push(flag),
    onNotFound: () => { seen.notFound += 1; },
    intervalMs: 1500,
    timers,
    ...overrides,
  });
  return { poller, fetch, timers, seen };
}

const running = (id) => ({ status: 'ok', check: { id, run_state: 'isleyir' } });

test('A sorğusu davam edərkən B açılır — B dərhal sorğulanır, polling donmur', async () => {
  const { poller, fetch, timers, seen } = setup();

  poller.open('A');
  assert.equal(fetch.calls.length, 1);

  poller.open('B');                                   // A hələ cavab verməyib
  assert.equal(fetch.calls.length, 2, 'B üçün sorğu göndərilməlidir');
  assert.equal(fetch.calls[1].id, 'B');
  assert.equal(fetch.calls[0].signal.aborted, true, 'köhnə A sorğusu dayandırılmalıdır');

  fetch.calls[0].resolve(running('A'));               // gecikən A cavabı
  await flush();
  assert.deepEqual(seen.results, [], 'köhnə cavab ekrana toxunmamalıdır');
  assert.equal(timers.count(), 0, 'köhnə nəsil taymer qurmamalıdır');

  fetch.calls[1].resolve(running('B'));
  await flush();
  assert.deepEqual(seen.results, ['B']);
  assert.equal(timers.count(), 1, 'B üçün növbəti sorğu planlaşdırılmalıdır');

  timers.runAll();
  assert.equal(fetch.calls.length, 3);
  assert.equal(fetch.calls[2].id, 'B');
});

test('şəbəkə xətası polling-i dayandırmır, bərpadan sonra davam edir', async () => {
  const { poller, fetch, timers, seen } = setup();
  poller.open('A');
  fetch.calls[0].reject(new TypeError('Failed to fetch'));
  await flush();
  assert.deepEqual(seen.offline, [true]);
  assert.equal(timers.count(), 1);

  timers.runAll();
  fetch.calls[1].resolve(running('A'));
  await flush();
  assert.deepEqual(seen.offline, [true, false]);
  assert.deepEqual(seen.results, ['A']);
});

test('şəbəkə xətası zamanı B-yə keçid — köhnə xəta B-ni pozmur', async () => {
  const { poller, fetch, timers, seen } = setup();
  poller.open('A');
  poller.open('B');
  fetch.calls[0].reject(new Error('A kəsildi'));
  await flush();
  assert.deepEqual(seen.offline, [], 'A-nın xətası göstərilməməlidir');
  fetch.calls[1].resolve(running('B'));
  await flush();
  assert.deepEqual(seen.results, ['B']);
  assert.equal(timers.count(), 1);
});

test('bitmiş yoxlamada sorğu dayanır', async () => {
  const { poller, fetch, timers } = setup();
  poller.open('A');
  fetch.calls[0].resolve({ status: 'ok', check: { id: 'A', run_state: 'tamamlandi' } });
  await flush();
  assert.equal(timers.count(), 0);
  assert.equal(poller.activeId, null);
});

test('tapılmayan yoxlama — onNotFound, taymer yoxdur', async () => {
  const { poller, fetch, timers, seen } = setup();
  poller.open('X');
  fetch.calls[0].resolve({ status: 'notfound' });
  await flush();
  assert.equal(seen.notFound, 1);
  assert.equal(timers.count(), 0);
});

test('stop — taymer silinir və gözləyən sorğu dayandırılır', async () => {
  const { poller, fetch, timers, seen } = setup();
  poller.open('A');
  fetch.calls[0].resolve(running('A'));
  await flush();
  poller.open('B');
  poller.stop();
  assert.equal(timers.count(), 0);
  assert.equal(fetch.calls[1].signal.aborted, true);
  fetch.calls[1].resolve(running('B'));
  await flush();
  assert.deepEqual(seen.results, ['A']);
});

test('retry: bitmiş (xəta) yoxlama eyni id ilə yenidən açılanda polling yenidən başlayır', async () => {
  const { poller, fetch, timers, seen } = setup({
    onResult: (check) => { seen.results.push(check.run_state); return check.run_state !== 'isleyir'; },
  });
  poller.open('A');
  fetch.calls[0].resolve({ status: 'ok', check: { id: 'A', run_state: 'xeta' } });
  await flush();
  assert.equal(timers.count(), 0, 'xəta ilə bitmiş yoxlama sorğulanmır');

  poller.open('A');                                   // istifadəçi "davam etdir" basdı
  assert.equal(fetch.calls.length, 2);
  fetch.calls[1].resolve(running('A'));
  await flush();
  assert.equal(timers.count(), 1, 'davam edən yoxlama yenidən sorğulanır');
  assert.deepEqual(seen.results, ['xeta', 'isleyir']);
});

test('standart taymerlər brauzerdəki kimi sərt setTimeout ilə də işləyir (regression)', async () => {
  // Brauzer setTimeout-u yalnız window/undefined `this` ilə qəbul edir; başqa
  // obyektin metodu kimi çağırılanda "Illegal invocation" atır. Node bağışlayır —
  // ona görə köhnə kod Node testlərində keçir, brauzerdə isə polling dayanırdı.
  const realSet = globalThis.setTimeout;
  const realClear = globalThis.clearTimeout;
  function strict(fn) {
    return function (...args) {
      if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
      return fn.apply(globalThis, args);
    };
  }
  globalThis.setTimeout = strict(realSet);
  globalThis.clearTimeout = strict(realClear);
  try {
    const fetch = fakeFetch();
    const poller = createPoller({ fetchCheck: fetch.fn, intervalMs: 1,
                                  onResult: () => false });   // davam edir → taymer qurulur
    poller.open('A');
    fetch.calls[0].resolve(running('A'));
    await new Promise((r) => realSet(r, 20));
    assert.ok(fetch.calls.length >= 2, 'ikinci sorğu taymerlə göndərilməlidir');
    poller.stop();
  } finally {
    globalThis.setTimeout = realSet;
    globalThis.clearTimeout = realClear;
  }
});
