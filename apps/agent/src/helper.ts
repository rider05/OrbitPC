// Session-0 user-session helper (skeleton).
//
// On a production split the Windows service runs as a non-interactive
// process and this helper runs inside the logged-in user's interactive session.
// Interactive-only actions (screen capture, clipboard, notifications, lock
// toast) execute HERE so the service never touches the user desktop directly.
//
// In the current single-process dev build this module simply opens an IPC
// endpoint so the shape is in place; the dispatcher already treats
// windows-adapter as the helper-side implementation.
import { createIpcServer, PIPE_NAME } from './ipc.js';

const server = createIpcServer((msg, reply) => {
  // Dev-echo: physical split will route lock/clipboard/notification/capture
  // here through Session-0-isolated IPC.
  reply({ commandId: msg.commandId, nonce: msg.nonce, kind: `${msg.kind}.helper-ack` });
});
server.listen(PIPE_NAME, () => console.log('[helper] listening for user-session ops'));
server.on('error', (e) => console.warn(`[helper] ${(e as Error).message}`));
