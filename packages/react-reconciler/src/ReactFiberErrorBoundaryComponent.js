export type ErrorBoundaryProps = {
  children?: ReactNodeList,
  fallback?: ReactNodeList,
  onCatch: () => void,
};

export type ErrorBoundaryState = {
  showFallback: boolean,
};
