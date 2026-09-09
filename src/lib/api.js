export async function api(path, options = {}) {
  const { timeoutMs = 15000, signal: externalSignal, headers, ...requestOptions } = options;
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) cancel();
  externalSignal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    const response = await fetch(`/api${path}`, {
      ...requestOptions,
      headers: { 'Content-Type': 'application/json', ...headers },
      signal: controller.signal,
    });
    if (response.status === 204) return null;
    let data;
    try { data = await response.json(); } catch {
      throw new Error(response.ok ? 'The server returned an unreadable response. Please refresh and try again.' : `The server could not complete the request (${response.status}). Please try again.`);
    }
    if (!response.ok) {
      const error = new Error(data?.message || 'Request failed');
      error.status = response.status;
      error.fields = data?.fields || {};
      throw error;
    }
    return data;
  } catch (error) {
    if (timedOut) throw new Error('The request timed out. Refresh to check the latest state before retrying a saved change.');
    if (error instanceof TypeError) throw new Error('Unable to reach the server. Check your connection and try again.');
    throw error;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', cancel);
  }
}
