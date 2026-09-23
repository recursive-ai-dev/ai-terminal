import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Last line of defence for render errors: shows what failed and offers a
 * reload instead of leaving the user with a blank window.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[ui] unhandled render error", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" className="error-screen">
        <div className="error-screen-card">
          <div className="error-screen-kicker">AI TERMINAL</div>
          <h1>Something went wrong.</h1>
          <p>The interface hit an unexpected error. Your shell session will restart when you reload.</p>
          <pre>{error.message || String(error)}</pre>
          <button type="button" onClick={() => window.location.reload()}>reload interface</button>
        </div>
      </div>
    );
  }
}
