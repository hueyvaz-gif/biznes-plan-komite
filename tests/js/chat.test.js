// AI köməkçi və bazar icmalının saf funksiyaları: node --test tests/js/chat.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const Chat = require(path.join(__dirname, '..', '..', 'static', 'chat.js'));
const Market = require(path.join(__dirname, '..', '..', 'static', 'market.js'));

test('söhbətlər kontekstə görə ayrılır — başqa planın mesajları qarışmır', () => {
  const store = Chat.createStore();
  const a = Chat.contextKey({ checkId: 'aaaaaaaaaaaa' });
  const b = Chat.contextKey({ checkId: 'bbbbbbbbbbbb' });
  const general = Chat.contextKey(null);
  store.add(a, { role: 'user', text: 'A planı haqqında' });
  store.add(b, { role: 'user', text: 'B planı haqqında' });
  assert.equal(general, 'umumi');
  assert.deepEqual(store.list(a).map((m) => m.text), ['A planı haqqında']);
  assert.deepEqual(store.list(b).map((m) => m.text), ['B planı haqqında']);
  assert.deepEqual(store.list(general), []);
});

test('modelə gedən tarixçə: yalnız uğurlu sual-cavab, xəta mesajları yox, son 8', () => {
  const messages = [];
  for (let i = 0; i < 12; i += 1) messages.push({ role: i % 2 ? 'assistant' : 'user', text: 'm' + i });
  messages.push({ role: 'user', text: 'uğursuz', failed: true });
  messages.push({ role: 'error', text: 'Server xətası' });
  const history = Chat.historyFor(messages);
  assert.equal(history.length, 8);
  assert.deepEqual(history[history.length - 1], { role: 'assistant', text: 'm11' });
  assert.ok(history.every((m) => m.role === 'user' || m.role === 'assistant'));
});

test('cavab bloklara bölünür; HTML mətn kimi qalır', () => {
  const blocks = Chat.parseReply('Əvvəlcə bu 3 məqamı dəqiqləşdirək:\n1. Biznes ideyanız\n2. Hədəf müştəriləriniz\n'
    + '3. <b>Məhsul</b>\n\nHansı sahədə biznes qurursunuz?\n- bir\n- iki');
  assert.deepEqual(blocks.map((b) => b.type), ['p', 'ol', 'p', 'ul']);
  assert.deepEqual(blocks[1].items, ['Biznes ideyanız', 'Hədəf müştəriləriniz', '<b>Məhsul</b>']);
  assert.equal(blocks[3].items.length, 2);
});

test('hazır suallar: "Hesabatı izah et" yalnız tamamlanmış yoxlamada', () => {
  assert.deepEqual(Chat.suggestions(null), ['Planı necə hazırlayım?', 'Nələri yoxlayırsınız?']);
  assert.ok(!Chat.suggestions({ checkId: 'x', runState: 'isleyir' }).includes('Hesabatı izah et'));
  assert.ok(Chat.suggestions({ checkId: 'x', runState: 'tamamlandi' }).includes('Hesabatı izah et'));
  assert.equal(Chat.contextLabel(null), 'Sənəd yüklənməyib');
  assert.equal(Chat.contextLabel({ checkId: 'x', planId: 'Zavod', version: 2, runState: 'tamamlandi' }),
    'Zavod · v2 · nəticə hazırdır');
});

test('bazar: Azərbaycan formatı, istiqamət mətnlə, vahid aydın', () => {
  assert.equal(Market.rateText(1.7), '1,7000');
  assert.equal(Market.priceText(220, 'USD'), '$220,00');
  assert.equal(Market.priceText(7025.28, 'AZN'), '7\u00a0025\u00a0AZN');
  assert.deepEqual(Market.change(0.8), { dir: 'up', text: '↑\u00a00,8%', label: 'artım 0,8%' });
  assert.equal(Market.change(-0.4).dir, 'down');
  assert.equal(Market.change(0).text, '→\u00a00%');
  assert.equal(Market.change(null), null);
  assert.equal(Market.dateText('2026-10-05T14:30:00'), '05.10.2026 14:30');
  assert.equal(Market.movement({ a: 1 }, 'a', 2), 'up');
  assert.equal(Market.movement({}, 'a', 2), null);
  assert.ok(Market.SAMPLE.sample, 'demo nümunəsi açıq işarələnib');
});
