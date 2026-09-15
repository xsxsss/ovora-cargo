import { describe, it, expect } from 'vitest';
import { isE2eLoginEnabled, isE2eEmail, PRODUCTION_PROJECT_REF } from './e2eLogin.tsx';

const STAGING = 'https://xrtqquuwlnnihphszyns.supabase.co';
const PROD = `https://${PRODUCTION_PROJECT_REF}.supabase.co`;

describe('тестовый вход', () => {
  it('на боевом проекте выключен даже с флагом', () => {
    expect(isE2eLoginEnabled(PROD, 'true')).toBe(false);
  });

  it('на тестовом проекте — только с флагом true', () => {
    expect(isE2eLoginEnabled(STAGING, 'true')).toBe(true);
    expect(isE2eLoginEnabled(STAGING, undefined)).toBe(false);
    expect(isE2eLoginEnabled(STAGING, '1')).toBe(false);
  });

  it('без адреса проекта выключен', () => {
    expect(isE2eLoginEnabled('', 'true')).toBe(false);
  });

  it('только тестовые адреса e2e+…@ovora.test', () => {
    expect(isE2eEmail('e2e+driver-1@ovora.test')).toBe(true);
    expect(isE2eEmail('saburov@gmail.com')).toBe(false);
    expect(isE2eEmail('e2e+x@ovora.test.evil.com')).toBe(false);
    expect(isE2eEmail('E2E+X@ovora.test')).toBe(false);
    expect(isE2eEmail(null)).toBe(false);
  });
});
