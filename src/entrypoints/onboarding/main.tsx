import { OnboardingApp } from '@/features/onboarding/ui/OnboardingApp';
import { t } from '@/shared/i18n';
import { ErrorBoundary } from '@/shared/ui/ErrorBoundary';
import { mount } from '@/shared/ui/mount';

mount(
  <ErrorBoundary>
    <OnboardingApp />
  </ErrorBoundary>,
  t('onboarding.pageTitle'),
);
