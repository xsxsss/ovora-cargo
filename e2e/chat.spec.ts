import { test, expect, type APIRequestContext } from '@playwright/test';
import { API, siteHeaders } from './env';

// Чат: читать, писать и удалять может только участник; участники нового чата — настоящие пользователи.
// Вход — тестовый (/e2e/login), существует только на тестовой площадке.

const run = Date.now().toString(36);
const driver = `e2e+chat-driver-${run}@ovora.test`;
const sender = `e2e+chat-sender-${run}@ovora.test`;
const stranger = `e2e+chat-stranger-${run}@ovora.test`;
const chatId = `pair_e2e_${run}`;

async function login(request: APIRequestContext, email: string, role: 'driver' | 'sender') {
  const res = await request.post(`${API}/e2e/login`, { headers: siteHeaders(), data: { email, role } });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()).token as string;
}

const as = (token: string) => siteHeaders({ 'X-User-Token': token });

test.describe.serial('чат', () => {
  let driverToken = '';
  let senderToken = '';
  let strangerToken = '';

  test.beforeAll(async ({ request }) => {
    const probe = await request.post(`${API}/e2e/login`, { headers: siteHeaders(), data: { email: driver, role: 'driver' } });
    test.skip(probe.status() === 404, 'тестовый вход выключен на этом сервере');
    driverToken = await login(request, driver, 'driver');
    senderToken = await login(request, sender, 'sender');
    strangerToken = await login(request, stranger, 'sender');
  });

  test('нельзя создать чат с несуществующим участником — даже первым сообщением', async ({ request }) => {
    const res = await request.post(`${API}/chat/message`, {
      headers: as(strangerToken),
      data: { chatId: `pair_fake_${run}`, senderId: stranger, senderName: 'S', text: 'hi', type: 'text',
        participants: [stranger, `nobody-${run}@example.com`] },
    });
    expect(res.status()).toBe(403);
  });

  test('первое сообщение раньше init создаёт чат с проверенными участниками', async ({ request }) => {
    const res = await request.post(`${API}/chat/message`, {
      headers: as(senderToken),
      data: { chatId, senderId: sender, senderName: 'Отправитель', text: 'Здравствуйте', type: 'text', participants: [sender, driver] },
    });
    expect(res.status(), await res.text()).toBe(200);
  });

  test('участник видит сообщения, посторонний — нет', async ({ request }) => {
    const own = await request.get(`${API}/chat/${chatId}/messages?callerEmail=${encodeURIComponent(driver)}`, { headers: as(driverToken) });
    expect(own.status(), await own.text()).toBe(200);
    expect((await own.json()).messages.some((m: any) => m.text === 'Здравствуйте')).toBe(true);

    const other = await request.get(`${API}/chat/${chatId}/messages?callerEmail=${encodeURIComponent(driver)}`, { headers: as(strangerToken) });
    expect(other.status()).toBe(403);
  });

  test('непрочитанное считается у получателя и сбрасывается', async ({ request }) => {
    const list = await (await request.get(`${API}/chats/user/${encodeURIComponent(driver)}`, { headers: as(driverToken) })).json();
    expect(list.chats.find((ch: any) => ch.chatId === chatId)?.unread).toBe(1);

    const read = await request.put(`${API}/chat/${chatId}/read`, { headers: as(driverToken), data: { userEmail: driver } });
    expect(read.status()).toBe(200);
    const after = await (await request.get(`${API}/chats/user/${encodeURIComponent(driver)}`, { headers: as(driverToken) })).json();
    expect(after.chats.find((ch: any) => ch.chatId === chatId)?.unread).toBe(0);
  });

  test('список чатов другого человека не отдаётся', async ({ request }) => {
    const res = await request.get(`${API}/chats/user/${encodeURIComponent(driver)}`, { headers: as(strangerToken) });
    expect(res.status()).toBe(403);
  });

  test('посторонний не пишет в чужой чат и не удаляет его', async ({ request }) => {
    const msg = await request.post(`${API}/chat/message`, {
      headers: as(strangerToken),
      data: { chatId, senderId: stranger, senderName: 'X', text: 'spam', type: 'text', participants: [stranger, driver] },
    });
    expect(msg.status()).toBe(403);
    const del = await request.delete(`${API}/chat/${chatId}?callerEmail=${encodeURIComponent(stranger)}`, { headers: as(strangerToken) });
    expect(del.status()).toBe(403);
  });

  test('чужое и несуществующее сообщение не удаляются', async ({ request }) => {
    const msgs = (await (await request.get(`${API}/chat/${chatId}/messages`, { headers: as(driverToken) })).json()).messages;
    const senderMsg = msgs.find((m: any) => m.senderId === sender);
    const foreign = await request.delete(`${API}/chat/${chatId}/message/${senderMsg.msgId}`, { headers: as(driverToken) });
    expect(foreign.status()).toBe(403);
    const missing = await request.delete(`${API}/chat/${chatId}/message/nope_${run}`, { headers: as(driverToken) });
    expect(missing.status()).toBe(404);
  });

  test('участник удаляет чат', async ({ request }) => {
    const res = await request.delete(`${API}/chat/${chatId}`, { headers: as(senderToken) });
    expect(res.status(), await res.text()).toBe(200);
    const msgs = await (await request.get(`${API}/chat/${chatId}/messages`, { headers: as(senderToken) })).json();
    expect(msgs.messages).toEqual([]);
  });
});
