import { test, expect, APIRequestContext } from '@playwright/test';

// Restful-Booker is a public practice API; admin/password123 is its published
// demo credential. Each test creates its own booking so tests stay independent.

const booking = () => ({
  firstname: 'Qa',
  lastname: `Portfolio-${Date.now()}`,
  totalprice: 245,
  depositpaid: true,
  bookingdates: { checkin: '2026-11-01', checkout: '2026-11-04' },
  additionalneeds: 'Breakfast',
});

async function token(request: APIRequestContext): Promise<string> {
  const res = await request.post('/auth', {
    data: { username: 'admin', password: 'password123' },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.token, 'auth should return a token').toBeTruthy();
  return body.token;
}

async function create(request: APIRequestContext) {
  const data = booking();
  const res = await request.post('/booking', { data, headers: { Accept: 'application/json' } });
  expect(res.status()).toBe(200);
  const body = await res.json();
  return { id: body.bookingid as number, sent: data, returned: body.booking };
}

test('create returns an id and echoes every field', async ({ request }) => {
  const { id, sent, returned } = await create(request);
  expect(typeof id).toBe('number');
  expect(returned).toEqual(sent);
});

test('a created booking reads back unchanged (record-level check)', async ({ request }) => {
  const { id, sent } = await create(request);
  const res = await request.get(`/booking/${id}`, { headers: { Accept: 'application/json' } });
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual(sent);
});

test('the new booking is findable by name, exactly once', async ({ request }) => {
  const { id, sent } = await create(request);
  const res = await request.get('/booking', {
    params: { firstname: sent.firstname, lastname: sent.lastname },
  });
  const ids = (await res.json()).map((b: { bookingid: number }) => b.bookingid);
  expect(ids.filter((x: number) => x === id)).toHaveLength(1);
});

test('update needs auth; with a token it persists', async ({ request }) => {
  const { id, sent } = await create(request);
  const changed = { ...sent, totalprice: 300 };

  const anonymous = await request.put(`/booking/${id}`, { data: changed });
  expect(anonymous.status()).toBe(403);

  const auth = await request.put(`/booking/${id}`, {
    data: changed,
    headers: { Cookie: `token=${await token(request)}`, Accept: 'application/json' },
  });
  expect(auth.status()).toBe(200);

  const read = await request.get(`/booking/${id}`, { headers: { Accept: 'application/json' } });
  expect((await read.json()).totalprice).toBe(300);
});

test('delete removes the booking', async ({ request }) => {
  const { id } = await create(request);
  const del = await request.delete(`/booking/${id}`, {
    headers: { Cookie: `token=${await token(request)}` },
  });
  expect(del.status()).toBe(201); // this API answers 201 on delete
  expect((await request.get(`/booking/${id}`)).status()).toBe(404);
});

test('bad credentials do not return a token', async ({ request }) => {
  const res = await request.post('/auth', { data: { username: 'admin', password: 'wrong' } });
  const body = await res.json();
  expect(body.token).toBeUndefined();
  expect(body.reason).toBe('Bad credentials');
});
