const delays = {
  profileHeader: 500,
  photoFeed: 1500,
  profileFeed: 2000,
  fullSizePhoto: 800,
  searchResults: 1200,
};

const shouldError = {};

export function setDelay(resource, ms) {
  delays[resource] = ms;
}

export function getDelay(resource) {
  return delays[resource];
}

export function getDelayKeys() {
  return Object.keys(delays);
}

export function setShouldError(resource, bool) {
  shouldError[resource] = bool;
}

export function fetchResource(resource, id) {
  const ms = delays[resource] !== undefined ? delays[resource] : 1000;

  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (shouldError[resource]) {
        reject(new Error(`Failed to fetch ${resource} (id: ${id})`));
      } else {
        resolve({type: resource, id, loadedAt: Date.now()});
      }
    }, ms);
  });
}

export {shouldError};
