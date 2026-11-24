import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import net from 'net';
import type { AddressInfo } from 'net';
import type { Request, Response } from 'express';
import { sendContactMessage } from './contactController';

interface Session {
  commands: string[];
  data: string;
}

// A minimal SMTP server: enough of the protocol for nodemailer to log in
// and deliver one message, recording what it was sent.
const startSmtp = async () => {
  const sessions: Session[] = [];
  const server = net.createServer((socket) => {
    const session: Session = { commands: [], data: '' };
    sessions.push(session);
    let buffer = '';
    let inData = false;
    socket.write('220 test ESMTP\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      if (inData) {
        const end = buffer.indexOf('\r\n.\r\n');
        if (end === -1) return;
        session.data = buffer.slice(0, end);
        buffer = buffer.slice(end + 5);
        inData = false;
        socket.write('250 queued\r\n');
      }
      let line: number;
      while (!inData && (line = buffer.indexOf('\r\n')) !== -1) {
        const command = buffer.slice(0, line);
        buffer = buffer.slice(line + 2);
        session.commands.push(command);
        const verb = command.split(' ')[0].toUpperCase();
        if (verb === 'EHLO') socket.write('250-test\r\n250 AUTH PLAIN\r\n');
        else if (verb === 'AUTH') socket.write('235 accepted\r\n');
        else if (verb === 'DATA') {
          inData = true;
          socket.write('354 go ahead\r\n');
        } else if (verb === 'QUIT') socket.end('221 bye\r\n');
        else socket.write('250 ok\r\n');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { port, sessions, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
};

const fakeRes = () => {
  const res = { statusCode: 200, body: undefined as unknown };
  const api = {
    status(code: number) {
      res.statusCode = code;
      return api;
    },
    json(body: unknown) {
      res.body = body;
      return api;
    },
  };
  return { res, api: api as unknown as Response };
};

describe('sendContactMessage over SMTP', () => {
  let smtp: Awaited<ReturnType<typeof startSmtp>>;

  beforeEach(async () => {
    smtp = await startSmtp();
    vi.stubEnv('CONTACT_FORM_ENABLED', 'true');
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SMTP_HOST', '127.0.0.1');
    vi.stubEnv('SMTP_PORT', String(smtp.port));
    vi.stubEnv('SMTP_USER', 'mailer@example.com');
    vi.stubEnv('SMTP_PASS', 'secret');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await smtp.close();
  });

  it('logs in and delivers the message with the visitor as reply-to', async () => {
    const req = {
      body: { name: 'Ann <b>', email: 'ann@example.org', message: 'Hello\nthere' },
    } as Request;
    const { res, api } = fakeRes();

    await sendContactMessage(req, api);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, data: { sent: true } });
    expect(smtp.sessions).toHaveLength(1);
    const { commands, data } = smtp.sessions[0];
    const auth = commands.find((c) => c.startsWith('AUTH PLAIN'));
    expect(auth).toBeDefined();
    const credentials = Buffer.from(auth!.split(' ')[2], 'base64').toString('utf8');
    expect(credentials).toBe('\0mailer@example.com\0secret');
    expect(commands).toContain('MAIL FROM:<mailer@example.com>');
    expect(commands.some((c) => c.startsWith('RCPT TO:<'))).toBe(true);
    expect(data).toMatch(/^Reply-To: ann@example\.org$/m);
    expect(data).toMatch(/^Subject: Contact Form: Message from Ann &lt;b&gt;$/m);
    expect(data).toContain('Name: Ann <b>');
  });

  it('reports a failure when the mail server cannot be reached', async () => {
    vi.stubEnv('SMTP_PORT', '1');
    const req = { body: { name: 'Ann', email: 'ann@example.org', message: 'Hi' } } as Request;
    const { res, api } = fakeRes();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    await sendContactMessage(req, api);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Failed to send message' });
    error.mockRestore();
  });
});
