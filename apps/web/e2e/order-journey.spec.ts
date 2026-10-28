import { expect, test, type Browser, type Page } from '@playwright/test';

const PASSWORD = 'Tadka@2026';
const AREA = { label: 'Koramangala 6th Block, Bengaluru', lat: 12.9389, lng: 77.6268 };

async function loginAs(browser: Browser, email: string): Promise<Page> {
  const ctx = await browser.newContext();
  await ctx.addInitScript((a) => localStorage.setItem('tadka-location', JSON.stringify({ state: { location: a }, version: 0 })), AREA);
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  return page;
}

test('customer orders → restaurant prepares → rider delivers with OTP → customer reviews', async ({ browser }) => {
  // Rider goes online first so dispatch has someone to offer the order to.
  const rider = await loginAs(browser, 'rider@tadka.dev');
  await rider.goto('/partner/delivery');
  const onlineSwitch = rider.getByRole('switch', { name: 'Online for deliveries' });
  await expect(onlineSwitch).toBeVisible();
  if ((await onlineSwitch.getAttribute('aria-checked')) !== 'true') await onlineSwitch.click();
  await expect(onlineSwitch).toHaveAttribute('aria-checked', 'true');

  // Customer: browse, customise, add, checkout, pay through the (mock) gateway.
  const customer = await loginAs(browser, 'customer@tadka.dev');
  await customer.goto('/r/kaveri-tiffin-room');
  await customer.getByRole('button', { name: 'Add Mysore Masala Dosa' }).click();
  const dialog = customer.getByRole('dialog', { name: 'Mysore Masala Dosa' });
  await dialog.getByLabel('Extra butter').check();
  await dialog.getByRole('button', { name: /^Add · / }).click();
  await customer.getByRole('button', { name: 'Add Idli (2) with Sambar' }).click();

  await customer.goto('/checkout');
  await expect(customer.getByText('Extra butter')).toBeVisible();
  await expect(customer.getByText('Platform fee')).toBeVisible(); // Honest Price: fees itemised before paying
  const pay = customer.getByRole('button', { name: /^Pay ₹/ });
  await expect(pay).toBeEnabled();
  await pay.click();

  await customer.waitForURL(/\/pay\/mock\//);
  await expect(customer.getByText('Test payment gateway')).toBeVisible();
  await customer.getByRole('button', { name: /^Pay ₹/ }).click();
  await customer.waitForURL(/\/orders\/[a-f0-9]{24}/);
  await expect(customer.getByText('Order placed', { exact: true }).first()).toBeVisible();
  const orderNumber = (await customer.getByText(/TDK-[A-Z0-9]{6}/).first().textContent())!.match(/TDK-[A-Z0-9]{6}/)![0];

  // Restaurant: accept and prepare.
  const owner = await loginAs(browser, 'owner@tadka.dev');
  await owner.goto('/partner/restaurant');
  const ticket = owner.locator('article', { hasText: orderNumber });
  await ticket.getByRole('button', { name: 'Accept' }).click();

  // Rider receives the offer in real time and accepts.
  await rider.getByRole('button', { name: 'Accept delivery' }).click();
  await expect(rider.getByText('Active delivery')).toBeVisible();

  await owner.locator('article', { hasText: orderNumber }).getByRole('button', { name: 'Start preparing' }).click();
  await owner.locator('article', { hasText: orderNumber }).getByRole('button', { name: 'Mark ready' }).click();

  // Customer sees the explained ETA while it's in progress.
  await expect(customer.getByText('Estimated arrival')).toBeVisible();
  await expect(customer.getByText(/Updated because:/)).toBeVisible();

  await rider.getByRole('button', { name: 'Confirm pickup' }).click();
  await rider.getByRole('button', { name: 'Start trip to customer' }).click();

  const otp = (await customer.locator('section', { hasText: 'Delivery OTP' }).locator('p.num').textContent())!.trim();
  expect(otp).toMatch(/^\d{4}$/);
  await rider.getByLabel('Delivery OTP').fill(otp);
  await rider.getByRole('button', { name: 'Delivered' }).click();
  await expect(rider.getByText('Waiting for orders nearby')).toBeVisible();

  // Customer: delivered (pushed over the socket) and leaves a review.
  await expect(customer.getByText('How was it?')).toBeVisible();
  await customer.getByRole('group', { name: 'Food rating' }).getByRole('button', { name: '5 stars' }).click();
  await customer.getByRole('button', { name: 'Submit review' }).click();
  await expect(customer.getByText('Thanks for the review!')).toBeVisible();

  // Admin can inspect the full operational history.
  const admin = await loginAs(browser, 'admin@tadka.dev');
  await admin.goto(`/admin/orders?q=${orderNumber}`);
  await admin.getByRole('link', { name: orderNumber }).click();
  await expect(admin.getByRole('heading', { name: 'Notifications' })).toBeVisible();
  await expect(admin.getByText('ORDER_DELIVERED')).toBeVisible();
});

test('unauthenticated users are sent to login from protected areas', async ({ page }) => {
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/login\?next=%2Fadmin/);
});
