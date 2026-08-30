import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("SQUORA Schiedsrichter Note – unbehandelter Fehler", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash-screen" role="alert">
        <div className="crash-card">
          <h1>Es ist ein Fehler aufgetreten</h1>
          <p>Deine gespeicherten Spiele bleiben erhalten. Lade die Seite neu, um weiterzuarbeiten.</p>
          <pre>{this.state.error.message}</pre>
          <button onClick={() => window.location.reload()}>Seite neu laden</button>
        </div>
      </div>
    );
  }
}
