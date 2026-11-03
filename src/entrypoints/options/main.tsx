import { OptionsApp, OptionsRecovery } from '@/features/options/ui/OptionsApp';
import { ErrorBoundary } from '@/shared/ui/ErrorBoundary';
import { mount } from '@/shared/ui/mount';

// Données illisibles au chargement : page de secours qui garde la restauration d'une sauvegarde.
mount(
  <ErrorBoundary fallback={<OptionsRecovery />}>
    <OptionsApp />
  </ErrorBoundary>,
);
