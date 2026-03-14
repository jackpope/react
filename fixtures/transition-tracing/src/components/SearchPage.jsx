import React, {Suspense, useState} from 'react';
import {useData} from '../hooks/useSimulatedDelay';
import {setShouldError} from '../data/fakeApi';
import styles from './SearchPage.module.css';

const TracingMarker = React.unstable_TracingMarker;

function SearchResults() {
  const data = useData('searchResults', 'default');
  return (
    <div className={styles.content}>
      <h3>Search Results</h3>
      <p>Found results (query: default)</p>
      <p className={styles.meta}>
        Loaded at {new Date(data.loadedAt).toLocaleTimeString()}
      </p>
    </div>
  );
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {error: null};
  }

  static getDerivedStateFromError(error) {
    return {error};
  }

  render() {
    if (this.state.error) {
      return (
        <div className={styles.errorDisplay}>
          <h3>Error</h3>
          <p>{this.state.error.message}</p>
          <button
            onClick={() => this.setState({error: null})}
            className={styles.retryButton}>
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function SearchPage() {
  const [errorMode, setErrorMode] = useState(false);

  function toggleErrorMode() {
    const next = !errorMode;
    setErrorMode(next);
    setShouldError('searchResults', next);
  }

  return (
    <div className={styles.page}>
      <h1>Search</h1>
      <button
        onClick={toggleErrorMode}
        className={errorMode ? styles.errorToggleActive : styles.errorToggle}>
        {errorMode ? 'Error Mode: ON' : 'Error Mode: OFF'}
      </button>
      <TracingMarker name="search">
        <ErrorBoundary>
          <Suspense
            fallback={
              <div className={styles.meta}>Loading search results...</div>
            }>
            <SearchResults />
          </Suspense>
        </ErrorBoundary>
      </TracingMarker>
    </div>
  );
}
