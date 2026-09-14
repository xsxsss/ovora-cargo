/**
 * pushService.ts
 * Web Push subscription management for Ovora Cargo.
 * Works with /push/vapid-key, /push/subscribe, /push/unsubscribe endpoints.
 */

import { projectId, publicAnonKey } from '../../../utils/supabase/info';
import { CSRF_HEADER, CSRF_TOKEN } from '../api/csrfToken';
import { withUserToken } from '../api/userToken';

const BASE = `https://${projectId}.supabase.co/functions/v1/make-server-4e36197a`;
const PUSH_STATE_KEY = 'ovora_push_subscribed'; // 'yes' | 'denied' | ''

/** Convert base64url VAPID key to Uint8Array for PushManager.subscribe */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/** Check if Web Push is supported by this browser */
export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** Current Notification.permission value */
export function getPushPermission(): NotificationPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'denied';
  return Notification.permission;
}

/** Was push already successfully subscribed for this device? */
export function isPushSubscribed(): boolean {
  return localStorage.getItem(PUSH_STATE_KEY) === 'yes';
}

/** Fetch VAPID public key from server (with retry) */
async function getVapidPublicKey(retries = 3): Promise<string> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`${BASE}/push/vapid-key`, {
        headers: withUserToken({ Authorization: `Bearer ${publicAnonKey}` }),
      });
      if (res.status === 503) {
        // Server still initializing VAPID — wait and retry
        await new Promise(r => setTimeout(r, 1500 * (i + 1)));
        continue;
      }
      const data = await res.json();
      if (!data.publicKey) throw new Error('No publicKey in response');
      return data.publicKey;
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw new Error('Failed to get VAPID key after retries');
}

/**
 * Request push permission and subscribe the current device.
 * Saves subscription to server so backend can send pushes.
 * Returns: 'granted' | 'denied' | 'unsupported'
 */
export async function subscribeToPush(userEmail: string): Promise<'granted' | 'denied' | 'unsupported'> {
  if (!isPushSupported()) return 'unsupported';

  // Ask browser for permission
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    localStorage.setItem(PUSH_STATE_KEY, 'denied');
    return 'denied';
  }

  try {
    const vapidKey = await getVapidPublicKey();
    const registration = await navigator.serviceWorker.ready;

    // Reuse existing subscription or create new
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey) as unknown as string,
      });
    }

    // Save to server
    const res = await fetch(`${BASE}/push/subscribe`, {
      method: 'POST',
      headers: withUserToken({
        'Content-Type': 'application/json',
        Authorization: `Bearer ${publicAnonKey}`,
        [CSRF_HEADER]: CSRF_TOKEN,
      }),
      body: JSON.stringify({ email: userEmail, subscription: subscription.toJSON() }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Server error saving subscription: ${err}`);
    }

    localStorage.setItem(PUSH_STATE_KEY, 'yes');
    return 'granted';
  } catch (err) {
    console.error('[Push] Subscribe error:', err);
    // Don't mark as 'denied' — user DID grant permission, just technical error
    return 'granted'; // permission was granted even if save failed
  }
}

/**
 * Unsubscribe from push notifications (e.g. on logout or settings toggle).
 */
export async function unsubscribeFromPush(userEmail: string): Promise<void> {
  if (!isPushSupported()) return;

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();

    if (subscription) {
      // Notify server
      await fetch(`${BASE}/push/unsubscribe`, {
        method: 'POST',
        headers: withUserToken({
          'Content-Type': 'application/json',
          Authorization: `Bearer ${publicAnonKey}`,
          [CSRF_HEADER]: CSRF_TOKEN,
        }),
        body: JSON.stringify({ email: userEmail, endpoint: subscription.endpoint }),
      }).catch(() => {});

      // Unsubscribe browser-side
      await subscription.unsubscribe();
    }

    localStorage.removeItem(PUSH_STATE_KEY);
  } catch (err) {
    console.error('[Push] Unsubscribe error:', err);
  }
}

/**
 * Re-subscribe on app launch if permission was previously granted
 * but subscription may have expired (browser resets subscriptions sometimes).
 */
export async function ensurePushSubscription(userEmail: string): Promise<void> {
  if (!isPushSupported()) return;
  if (getPushPermission() !== 'granted') return;

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      // Subscription expired — re-subscribe silently
      await subscribeToPush(userEmail);
    } else {
      // Refresh subscription on server (in case server lost it)
      const _vapidKey = await getVapidPublicKey();
      await fetch(`${BASE}/push/subscribe`, {
        method: 'POST',
        headers: withUserToken({
          'Content-Type': 'application/json',
          Authorization: `Bearer ${publicAnonKey}`,
          [CSRF_HEADER]: CSRF_TOKEN,
        }),
        body: JSON.stringify({ email: userEmail, subscription: subscription.toJSON() }),
      }).catch(() => {});
    }
  } catch (err) {
    console.error('[Push] ensurePushSubscription error:', err);
  }
}
