import assert from 'node:assert/strict';
import test from 'node:test';

import { UsageAlertService } from '../src/main/usageAlerts.js';
import { t } from '../src/shared/i18n.js';

test('checkUsageAlerts does nothing if percent is null', async () => {
  const calls = [];
  const service = new UsageAlertService({ showNotification: (title, body) => calls.push({ title, body }) });

  await service.checkUsageAlerts({ quota: {} });
  assert.equal(calls.length, 0);
  assert.equal(service.lastKnownSessionPercent, null);
});

test('checkUsageAlerts does nothing on first known percent', async () => {
  const calls = [];
  const service = new UsageAlertService({ showNotification: (title, body) => calls.push({ title, body }) });

  await service.checkUsageAlerts({
    quota: { session: { percent: 50 } },
    preferences: { notifications: { limitAlert: true, expireAlert: true } }
  });

  assert.equal(calls.length, 0);
  assert.equal(service.lastKnownSessionPercent, 50);
});

test('checkUsageAlerts triggers highUsage alert when crossing 70%', async () => {
  const calls = [];
  const service = new UsageAlertService({ showNotification: (title, body) => calls.push({ title, body }) });

  service.lastKnownSessionPercent = 69;

  await service.checkUsageAlerts({
    quota: { session: { percent: 70 } },
    preferences: { language: 'en', notifications: { limitAlert: true } }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].title, t('alert.highUsage.title', 'en'));
  assert.equal(service.lastKnownSessionPercent, 70);
});

test('checkUsageAlerts triggers critical alert when crossing 90%', async () => {
  const calls = [];
  const service = new UsageAlertService({ showNotification: (title, body) => calls.push({ title, body }) });

  service.lastKnownSessionPercent = 89;

  await service.checkUsageAlerts({
    quota: { session: { percent: 90 } },
    preferences: { language: 'en', notifications: { limitAlert: true } }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].title, t('alert.critical.title', 'en'));
});

test('checkUsageAlerts triggers expire alert when crossing 100%', async () => {
  const calls = [];
  const service = new UsageAlertService({ showNotification: (title, body) => calls.push({ title, body }) });

  service.lastKnownSessionPercent = 99;

  await service.checkUsageAlerts({
    quota: { session: { percent: 100 } },
    preferences: { language: 'en', notifications: { expireAlert: true } }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].title, t('notification.expireTitle', 'en'));
});

test('checkUsageAlerts does not trigger alerts if notifications are disabled', async () => {
  const calls = [];
  const service = new UsageAlertService({ showNotification: (title, body) => calls.push({ title, body }) });

  service.lastKnownSessionPercent = 60;

  await service.checkUsageAlerts({
    quota: { session: { percent: 100 } },
    preferences: { notifications: { limitAlert: false, expireAlert: false } }
  });

  assert.equal(calls.length, 0);
});

test('checkUsageAlerts triggers multiple alerts if both cross thresholds simultaneously', async () => {
  const calls = [];
  const service = new UsageAlertService({ showNotification: (title, body) => calls.push({ title, body }) });

  service.lastKnownSessionPercent = 80;

  await service.checkUsageAlerts({
    quota: { session: { percent: 100 } },
    preferences: { language: 'en', notifications: { limitAlert: true, expireAlert: true } }
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].title, t('notification.expireTitle', 'en'));
  assert.equal(calls[1].title, t('alert.critical.title', 'en'));
});
