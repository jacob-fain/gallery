import { Component, type ReactNode } from 'react';
import StatusMessage from './StatusMessage/StatusMessage';

interface ErrorBoundaryState {
  failed: boolean;
}

/**
 * Catches render errors anywhere below it, including a lazy chunk that still
 * fails after lazyWithReload's one reload, and shows a reload screen instead
 * of a blank page. React itself logs the caught error to the console.
 */
export default class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <StatusMessage
        fullPage
        title="Something went wrong"
        message="Reloading the page usually fixes this."
        action={{ label: 'Reload', onClick: () => window.location.reload() }}
      />
    );
  }
}
