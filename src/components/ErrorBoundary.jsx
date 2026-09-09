import { Component } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, details) {
    console.error('Application view failed', error, details);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="fatal-error" role="alert">
        <AlertTriangle size={24} />
        <h1>This view could not be displayed.</h1>
        <p>Your database is unchanged. Reload the workspace to restore the current view.</p>
        <button className="button button-primary" type="button" onClick={() => window.location.reload()}><RefreshCw size={16} />Reload workspace</button>
      </div>
    );
  }
}
