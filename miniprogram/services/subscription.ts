import { request } from './http';

export interface SubscriptionState {
  subscription: {
    planId?: string;
    status?: string;
    expiresAt?: string | null;
  };
  entitlements: { allExamPapers?: boolean };
}

export function getMySubscription(): Promise<SubscriptionState> {
  return request({ path: '/api/v1/subscriptions/me' });
}
