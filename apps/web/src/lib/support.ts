/**
 * Support (HLP-2, HLP-4). The response target is a promise we make on the contact form, the status
 * page and in the help articles, so it lives in one place.
 */
export const SUPPORT_RESPONSE_BUSINESS_DAYS = 2;

export const SUPPORT_TOPICS = ['setup', 'booth', 'printing', 'sharing', 'account', 'other'] as const;
export type SupportTopic = (typeof SUPPORT_TOPICS)[number];

export const SUPPORT_MESSAGE_MIN = 10;
export const SUPPORT_MESSAGE_MAX = 4000;
