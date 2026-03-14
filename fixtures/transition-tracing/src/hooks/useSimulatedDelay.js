import {use} from 'react';
import {fetchResource} from '../data/fakeApi';

const cache = new Map();

export function clearCache() {
  cache.clear();
}

export function invalidate(resource, id) {
  const key = resource + ':' + id;
  cache.delete(key);
}

export function useData(resource, id) {
  const key = resource + ':' + id;

  if (!cache.has(key)) {
    const promise = fetchResource(resource, id);
    cache.set(key, promise);
  }

  return use(cache.get(key));
}
