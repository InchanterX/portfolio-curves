import { useCallback, useEffect, useState } from 'react';

export function getHash(): string {
  const h = window.location.hash.replace(/^#/, '');
  return h || '/';
}

export function navigate(to: string) {
  window.location.hash = to;
}

export function useHashRoute(): string {
  const [route, setRoute] = useState(getHash);

  useEffect(() => {
    const onChange = () => setRoute(getHash());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return route;
}

/** Exact match or prefix match for nested sections */
export function useMatch() {
  const route = useHashRoute();
  return useCallback(
    (path: string) => route === path || route.startsWith(path + '/'),
    [route],
  );
}
