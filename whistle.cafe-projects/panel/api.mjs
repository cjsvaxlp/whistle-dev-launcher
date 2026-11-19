const tokenMeta = document.querySelector('meta[name="cafe-token"]');
let token = tokenMeta.content;

export async function post(path) {
  const send = () => fetch(path, { method: 'POST', headers: { 'X-Cafe-Token': token } });
  let response = await send();
  if (response.status !== 403) return response;
  try {
    const current = await fetch('./api/token', { cache: 'no-store' });
    if (current.ok) {
      const data = await current.json();
      if (data.token) token = data.token;
    }
  } catch {
    // 取不到就按原错误返回。
  }
  response = await send();
  return response;
}

export async function currentServerToken() {
  try {
    const response = await fetch('./', { cache: 'no-store' });
    const text = await response.text();
    const match = /name="cafe-token" content="([a-f0-9]+)"/.exec(text);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}
