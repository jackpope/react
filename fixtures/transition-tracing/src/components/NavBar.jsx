import React from 'react';
import styles from './NavBar.module.css';

export default function NavBar({onNavigate, currentPage, profileId, isPending}) {
  function buttonClass(page, id) {
    if (page === 'profile') {
      return currentPage === 'profile' && profileId === id
        ? styles.buttonActive
        : styles.button;
    }
    return currentPage === page ? styles.buttonActive : styles.button;
  }

  return (
    <nav className={styles.nav}>
      <button
        className={buttonClass('home')}
        onClick={() => onNavigate('home')}>
        Home
      </button>
      <button
        className={buttonClass('profile', 1)}
        onClick={() => onNavigate('profile', 1)}>
        Profile (Alice)
      </button>
      <button
        className={buttonClass('profile', 2)}
        onClick={() => onNavigate('profile', 2)}>
        Profile (Bob)
      </button>
      <button
        className={buttonClass('search')}
        onClick={() => onNavigate('search')}>
        Search
      </button>
      <button
        className={buttonClass('activity')}
        onClick={() => onNavigate('activity')}>
        Activity
      </button>
      <button
        className={buttonClass('cpu')}
        onClick={() => onNavigate('cpu')}>
        CPU Suspense
      </button>
      {isPending && <span className={styles.pending}>Pending...</span>}
    </nav>
  );
}
