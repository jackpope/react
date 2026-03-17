import React, {useState} from 'react';
import {getDelayKeys, getDelay, setDelay} from '../data/fakeApi';
import styles from './DelayConfig.module.css';

export default function DelayConfig() {
  const [, forceUpdate] = useState(0);
  const keys = getDelayKeys();

  return (
    <div className={styles.container}>
      {keys.map(key => (
        <div key={key} className={styles.row}>
          <label className={styles.label}>{key}</label>
          <input
            className={styles.input}
            type="number"
            value={getDelay(key)}
            onChange={e => {
              setDelay(key, Number(e.target.value));
              forceUpdate(n => n + 1);
            }}
            step={100}
            min={0}
          />
          <span className={styles.unit}>ms</span>
        </div>
      ))}
    </div>
  );
}
