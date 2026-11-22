// Error messages people see. No Forge imports, so it is unit-testable.
// Product failures carry the HTTP status, the product and the step; they become plain sentences here and the raw
// response only goes to the app logs. Roadworthy's own checks throw UserError, already written for people.

export class UserError extends Error {}

const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);

export function friendly(e) {
  if (e instanceof UserError) return e.message;
  const status = Number(e?.status) || 0;
  if (!status) return 'Something went wrong in Roadworthy. Please try again.';
  const product = e.product || 'Jira';
  const doing = e.what ? lower(e.what) : 'that';
  if (status === 401 || status === 403) return `Couldn't finish ${doing}: ${product} says you don't have permission.`;
  if (status === 404) return `Couldn't finish ${doing}: ${product} couldn't find it. It may have been deleted or moved.`;
  if (status === 429) return `${product} is busy right now. Wait a minute and try again.`;
  if (status < 500) return `Couldn't finish ${doing}: ${product} didn't accept the request.`;
  return `${product} didn't respond in time. Try again in a moment.`;
}

/** Throw a product error with what we were doing; keep the body for the logs. */
export async function checked(res, what, product = 'Jira') {
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const e = new Error(`${what} failed (${res.status}): ${body.slice(0, 500)}`);
    Object.assign(e, { status: res.status, what, product, body });
    throw e;
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
