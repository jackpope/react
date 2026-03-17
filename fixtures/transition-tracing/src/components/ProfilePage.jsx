import React, {Suspense, useState, startTransition} from 'react';
import {useData} from '../hooks/useSimulatedDelay';
import styles from './ProfilePage.module.css';

const TracingMarker = React.unstable_TracingMarker;

function ProfileHeader({id}) {
  const data = useData('profileHeader', id);
  return (
    <div className={styles.section}>
      <h2>Profile Header for User {data.id}</h2>
      <p className={styles.meta}>
        Loaded at {new Date(data.loadedAt).toLocaleTimeString()}
      </p>
    </div>
  );
}

function PhotoFeed({id}) {
  const data = useData('photoFeed', id);
  return (
    <div className={styles.section}>
      <h3>Photo Feed</h3>
      <p>Showing photos for user {data.id}</p>
      <p className={styles.meta}>
        Loaded at {new Date(data.loadedAt).toLocaleTimeString()}
      </p>
    </div>
  );
}

function ProfileFeed({id}) {
  const data = useData('profileFeed', id);
  return (
    <div className={styles.section}>
      <h3>Profile Feed</h3>
      <p>Showing feed for user {data.id}</p>
      <p className={styles.meta}>
        Loaded at {new Date(data.loadedAt).toLocaleTimeString()}
      </p>
    </div>
  );
}

function Recommendations({id}) {
  const data = useData('recommendations', id);
  return (
    <div className={styles.section}>
      <h3>Recommendations</h3>
      <p>Recommended content for user {data.id}</p>
      <p className={styles.meta}>
        Loaded at {new Date(data.loadedAt).toLocaleTimeString()}
      </p>
    </div>
  );
}

export default function ProfilePage({id, eventEmitter}) {
  const [showRecs, setShowRecs] = useState(false);

  function loadRecommendations() {
    if (eventEmitter) {
      eventEmitter.emit({
        type: 'user-click',
        label: 'load-recommendations',
        timestamp: performance.now(),
      });
    }
    startTransition(
      () => {
        setShowRecs(true);
      },
      {name: 'load-recommendations'}
    );
  }

  return (
    <TracingMarker name="profile">
      <Suspense
        name="profile:header"
        fallback={<div className={styles.meta}>Loading profile header...</div>}>
        <ProfileHeader id={id} />
        <TracingMarker name="profile:photo-feed">
          <Suspense
            name="profile:photo-feed:suspense"
            fallback={<div className={styles.meta}>Loading photo feed...</div>}>
            <PhotoFeed id={id} />
          </Suspense>
        </TracingMarker>
        <TracingMarker name="profile:profile-feed">
          <Suspense
            name="profile:profile-feed:suspense"
            fallback={
              <div className={styles.meta}>Loading profile feed...</div>
            }>
            <ProfileFeed id={id} />
          </Suspense>
        </TracingMarker>
      </Suspense>

      <div className={styles.recsSection}>
        <p className={styles.description}>
          <strong>Concurrent transitions:</strong> Click "Load Recommendations"
          to start an independent transition while the profile is visible. If
          you navigate away while recommendations are loading, the
          recommendations transition fires{' '}
          <code>onTransitionIncomplete</code> and its marker fires{' '}
          <code>onMarkerIncomplete</code>.
        </p>
        {!showRecs ? (
          <button className={styles.recsButton} onClick={loadRecommendations}>
            Load Recommendations
          </button>
        ) : (
          <TracingMarker name="profile:recommendations">
            <Suspense
              name="profile:recommendations:suspense"
              fallback={
                <div className={styles.meta}>Loading recommendations...</div>
              }>
              <Recommendations id={id} />
            </Suspense>
          </TracingMarker>
        )}
      </div>
    </TracingMarker>
  );
}
