import { verifySigning } from './distribution.mjs';

if (process.platform !== 'darwin') throw new Error('Signing checks require macOS.');
await verifySigning(process.env);
console.log('Developer ID signing, secure timestamp, Hardened Runtime, verification and executable launch succeeded.');
