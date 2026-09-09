import { createApp } from '../server/app.js';
import { createCloudDatabase } from '../server/cloud-database.js';

const app = createApp(createCloudDatabase());

export default function handler(request, response) {
  const rewrittenPath = Array.isArray(request.query?.path)
    ? request.query.path.join('/')
    : request.query?.path;

  if (rewrittenPath) {
    const url = new URL(request.url, 'https://northstar.local');
    url.searchParams.delete('path');
    const query = url.searchParams.toString();
    request.url = `/api/${rewrittenPath}${query ? `?${query}` : ''}`;
  }

  return app(request, response);
}
