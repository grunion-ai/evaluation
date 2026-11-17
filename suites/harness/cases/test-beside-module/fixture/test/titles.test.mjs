import { test } from 'node:test';
import assert from 'node:assert/strict';
import { titleCase } from '../src/titles.mjs';

test('titleCase', () => assert.equal(titleCase('hello world'), 'Hello World'));
