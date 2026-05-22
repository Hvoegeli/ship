import React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Cat-6: top-level React error boundary. Previously only the `<Outlet>`/editor
 * subtree was wrapped, so a throw in a provider, the app chrome, or a public
 * route produced a blank white screen with no recovery path. This wraps the
 * entire render tree (providers + router) and shows a recoverable fallback
 * instead. React error boundaries must be class components.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Surface to the console/observability instead of failing silently.
    console.error('Uncaught render error:', error, info.componentStack);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="flex h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center"
        >
          <h1 className="text-xl font-medium text-foreground">Something went wrong</h1>
          <p className="max-w-md text-sm text-muted">
            The app hit an unexpected error and couldn&apos;t render this view. Your work is saved;
            reloading usually fixes it.
          </p>
          <button
            onClick={this.handleReload}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90"
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
