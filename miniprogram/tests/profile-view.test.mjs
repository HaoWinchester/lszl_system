import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const modulePath = join(root, 'domain/profile-view.ts');

test('profile avatar uses the first real display character', async () => {
  assert.ok(existsSync(modulePath), 'profile view helper should exist');
  const { avatarLetterOf } = await import(pathToFileURL(modulePath).href);

  assert.equal(avatarLetterOf('佩奇老师', 'admin'), '佩');
  assert.equal(avatarLetterOf('', 'admin'), 'A');
  assert.equal(avatarLetterOf('', ''), '学');
});
