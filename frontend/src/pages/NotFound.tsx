import StatusMessage from '../components/StatusMessage/StatusMessage';

interface NotFoundProps {
  title?: string;
  message?: string;
  linkTo?: string;
  linkLabel?: string;
}

export default function NotFound({
  title = 'Page not found',
  message = 'This page does not exist or has moved.',
  linkTo = '/',
  linkLabel = 'Back to home',
}: NotFoundProps) {
  return (
    <>
      {/* The server answers every path with 200, so this keeps unknown paths out of search results. */}
      <meta name="robots" content="noindex" />
      <StatusMessage title={title} message={message} action={{ label: linkLabel, to: linkTo }} />
    </>
  );
}
