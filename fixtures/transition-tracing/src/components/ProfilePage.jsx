import React, {Suspense} from 'react';
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

export default function ProfilePage({id}) {
  return (
    <TracingMarker name="profile">
      <Suspense
        fallback={<div className={styles.meta}>Loading profile header...</div>}>
        <ProfileHeader id={id} />
        <TracingMarker name="profile:photo-feed">
          <Suspense
            fallback={<div className={styles.meta}>Loading photo feed...</div>}>
            <PhotoFeed id={id} />
          </Suspense>
        </TracingMarker>
        <TracingMarker name="profile:profile-feed">
          <Suspense
            fallback={
              <div className={styles.meta}>Loading profile feed...</div>
            }>
            <ProfileFeed id={id} />
          </Suspense>
        </TracingMarker>
      </Suspense>
    </TracingMarker>
  );
}
