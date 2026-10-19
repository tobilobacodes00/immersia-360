import type en from '@immersia/i18n/messages/en';

// Typed messages: every `t('key')` is checked against the English catalogue at typecheck, so a key
// that is missing, or that resolves to a namespace object instead of a string, fails CI.
declare module 'next-intl' {
  interface AppConfig {
    Messages: typeof en;
  }
}
