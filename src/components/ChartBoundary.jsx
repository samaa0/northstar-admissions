import { Component } from 'react';
import { EmptyState } from './Ui.jsx';

export default class ChartBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error('Report chart failed', error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <div className="chart-recovery" role="status"><EmptyState title="Chart unavailable" detail="Your report results are still available below. You can continue searching, sorting and exporting." action={<button type="button" className="button button-secondary" onClick={() => this.setState({ failed: false })}>Retry chart</button>} /></div>;
  }
}
