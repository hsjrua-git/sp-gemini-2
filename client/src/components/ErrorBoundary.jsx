import { Component } from 'react';
import i18next from '../i18n/index.js';
import EmptyState from './EmptyState.jsx';

class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Unhandled error in the interface:', error, info);
  }

  render() {
    if (this.state.error) {
      // A class component can't use the useTranslation hook, so read the
      // singleton instance directly (the same approach as i18n/errors.js) and
      // translate with explicit namespace prefixes.
      return (
        <main>
          <EmptyState
            tone="danger"
            title={i18next.t('nav:errors.ui.title')}
            description={i18next.t('nav:errors.ui.description')}
          >
            <button
              type="button"
              className="primary"
              onClick={() => window.location.reload()}
            >
              {i18next.t('nav:errors.ui.reload')}
            </button>
          </EmptyState>
        </main>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
