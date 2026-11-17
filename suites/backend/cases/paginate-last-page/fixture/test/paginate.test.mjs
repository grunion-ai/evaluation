import { test } from 'node:test';
import assert from 'node:assert/strict';
import { page, pageCount } from '../src/paginate.mjs';

test('full pages', () => {
  assert.equal(pageCount(20, 10), 2);
  assert.deepEqual(page([1, 2, 3, 4], 2, 2), [3, 4]);
});
