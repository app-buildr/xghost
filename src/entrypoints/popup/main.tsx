import { PopupApp } from '@/features/popup/ui/PopupApp';
import { ErrorBoundary } from '@/shared/ui/ErrorBoundary';
import { mount } from '@/shared/ui/mount';

mount(
  <ErrorBoundary>
    <PopupApp />
  </ErrorBoundary>,
);
