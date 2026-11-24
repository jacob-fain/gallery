import StatusMessage from './StatusMessage';

/** Shown in place of a public page whose data failed to load. */
export default function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <StatusMessage
      message="This page could not be loaded. Check your connection and try again."
      action={{ label: 'Try again', onClick: onRetry }}
    />
  );
}
