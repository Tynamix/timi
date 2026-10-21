import { native } from './bridge';
export function randomUUID(): string { return native<string>({ op: 'uuid' }); }
