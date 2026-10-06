// Fayl seçimi testləri: node --test tests/js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { selectFile } = require(path.join(__dirname, '..', '..', 'static', 'upload.js'));

const docx = { name: 'plan.docx', size: 2048 };
const pdf = { name: 'plan.pdf', size: 2048 };

test('düzgün DOCX qəbul edilir', () => {
  assert.deepEqual(selectFile(docx), { file: docx, error: null });
});

test('DOCX-dən sonra PDF seçiləndə göndəriləcək fayl təmizlənir', () => {
  let state = selectFile(docx);
  assert.equal(state.file, docx);
  state = selectFile(pdf);                      // yeni seçim etibarsızdır
  assert.equal(state.file, null, 'əvvəlki DOCX səssizcə saxlanılmamalıdır');
  assert.match(state.error, /\.docx/);
});

test('boş və həddən böyük fayl', () => {
  assert.equal(selectFile({ name: 'a.docx', size: 0 }).file, null);
  const big = selectFile({ name: 'a.docx', size: 30 * 1024 * 1024 }, { maxBytes: 25 * 1024 * 1024, maxMb: 25 });
  assert.equal(big.file, null);
  assert.match(big.error, /25 MB/);
});

test('seçim ləğv edildikdə xəta yoxdur', () => {
  assert.deepEqual(selectFile(null), { file: null, error: null });
});
