import assert from 'node:assert/strict';
import test from 'node:test';
import { isCommand } from '../src/validation.js';

test('the IPC boundary accepts only documented command shapes', () => {
  for (const command of [
    { type: 'start', name: 'Alpha' },
    { type: 'pause' }, { type: 'resume' }, { type: 'stop' }, { type: 'later' },
    { type: 'resolve', choice: 'work' },
    { type: 'resolve', choice: 'break' },
    { type: 'resolve', choice: 'discard' },
    { type: 'settings', idleMinutes: 5, reminderMinutes: 10 },
    { type: 'renameProject', id: 'project', name: 'New name' },
    { type: 'archiveProject', id: 'project', archived: true },
    { type: 'correct', removeIds: ['record'], records: [
      { start: 1_000, end: 2_000, kind: 'work', projectId: 'project' },
      { start: 2_000, end: 3_000, kind: 'break', projectId: null },
    ] },
  ]) assert.equal(isCommand(command), true, JSON.stringify(command));
});

test('the IPC boundary rejects unknown commands, fields, dangerous payloads and non-finite timestamps', () => {
  for (const command of [
    null, [], 'stop', 4,
    { type: 'shell', command: 'open example.com' },
    { type: 'pause', extra: true },
    { type: 'start', name: 'Alpha', script: 'malicious' },
    { type: 'start', name: ['Alpha'] },
    { type: 'start', name: 'A'.repeat(100_000) },
    { type: 'resolve', choice: 'later' },
    { type: 'resolve', choice: 'split' },
    { type: 'resolve', choice: 'work', projectId: {} },
    { type: 'settings', idleMinutes: '5', reminderMinutes: 10 },
    { type: 'settings', idleMinutes: 5, reminderMinutes: Infinity },
    { type: 'archiveProject', id: 'project', archived: 'true' },
    { type: 'correct', removeIds: 'record', records: [] },
    { type: 'correct', removeIds: [null], records: [] },
    { type: 'correct', removeIds: [], records: [
      { start: NaN, end: 2_000, kind: 'work', projectId: 'project' },
    ] },
    { type: 'correct', removeIds: [], records: [
      { start: 1_000, end: Infinity, kind: 'work', projectId: 'project' },
    ] },
    { type: 'correct', removeIds: [], records: [
      { start: 1_000, end: 2_000, kind: 'discard', projectId: null },
    ] },
    { type: 'correct', removeIds: [], records: [
      { start: 1_000, end: 2_000, kind: 'work', projectId: 'project', source: 'tracked' },
    ] },
  ]) assert.equal(isCommand(command), false, JSON.stringify(command));
});
