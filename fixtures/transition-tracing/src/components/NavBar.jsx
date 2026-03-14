import React from 'react';
import styles from './NavBar.module.css';

export default function NavBar({onNavigate, currentPage, profileId}) {
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
    </nav>
  );
}
