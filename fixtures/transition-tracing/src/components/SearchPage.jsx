import React, {Suspense, useState} from 'react';
import {useData, invalidate} from '../hooks/useSimulatedDelay';
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
  const [showResults, setShowResults] = useState(true);

  function toggleErrorMode() {
    const next = !errorMode;
    setErrorMode(next);
    setShouldError('searchResults', next);
  }

  function removeResults() {
    setShowResults(false);
  }

  function restoreResults() {
    invalidate('searchResults', 'default');
    setShowResults(true);
  }

  return (
    <div className={styles.page}>
      <h1>Search</h1>
      <p className={styles.description}>
        <strong>Marker incomplete:</strong> Click "Remove Results" while the
        loading fallback is visible to unmount the TracingMarker during a
        pending transition. This triggers <code>onMarkerIncomplete</code> with
        deletion info in the event log.
      </p>
      <div className={styles.toolbar}>
        <button
          onClick={toggleErrorMode}
          className={
            errorMode ? styles.errorToggleActive : styles.errorToggle
          }>
          {errorMode ? 'Error Mode: ON' : 'Error Mode: OFF'}
        </button>
        {showResults ? (
          <button className={styles.removeButton} onClick={removeResults}>
            Remove Results
          </button>
        ) : (
          <button className={styles.restoreButton} onClick={restoreResults}>
            Restore Results
          </button>
        )}
      </div>
      {showResults && (
        <TracingMarker name="search">
          <ErrorBoundary>
            <Suspense
              name="search:results"
              fallback={
                <div className={styles.meta}>Loading search results...</div>
              }>
              <SearchResults />
            </Suspense>
          </ErrorBoundary>
        </TracingMarker>
      )}
    </div>
  );
}
