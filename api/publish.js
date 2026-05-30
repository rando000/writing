// API for managing essays stored in essays.json
// Actions: list, get, publish, edit, delete
// Uses GitHub Contents API. Each write performs read-modify-write with SHA for conflict detection.

const GITHUB_OWNER = 'rando000';
const GITHUB_REPO = 'writing';
const ESSAYS_PATH = 'essays.json';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let payload;
  try {
    payload = req.body;
    if (typeof payload === 'string') payload = JSON.parse(payload);
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const { password, action } = payload;

  if (!process.env.ADMIN_PASSWORD || !process.env.GITHUB_TOKEN) {
    return res.status(500).json({ error: 'Server not configured' });
  }
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    switch (action) {
      case 'list':    return await listEssays(res);
      case 'get':     return await getEssay(payload, res);
      case 'publish': return await publishEssay(payload, res);
      case 'edit':    return await editEssay(payload, res);
      case 'delete':  return await deleteEssay(payload, res);
      default:        return res.status(400).json({ error: 'Unknown action' });
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}

// ---------- GitHub helpers ----------

async function readEssaysFile() {
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${ESSAYS_PATH}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `token ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json'
    }
  });

  if (res.status === 404) {
    // File doesn't exist yet — return empty
    return { data: { essays: [] }, sha: null };
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`GitHub read failed: ${err.message || res.status}`);
  }

  const file = await res.json();
  const decoded = Buffer.from(file.content, 'base64').toString('utf8');
  let data;
  try {
    data = JSON.parse(decoded);
  } catch {
    throw new Error('essays.json is malformed');
  }
  if (!data.essays || !Array.isArray(data.essays)) data.essays = [];
  return { data, sha: file.sha };
}

async function writeEssaysFile(data, sha, commitMessage) {
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${ESSAYS_PATH}`;
  const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
  const body = { message: commitMessage, content };
  if (sha) body.sha = sha;

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `token ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (res.status === 409 || res.status === 422) {
      throw new Error('Conflict: someone else just edited. Refresh and try again.');
    }
    throw new Error(`GitHub write failed: ${err.message || res.status}`);
  }
}

// ---------- Validation ----------

function validateFields({ title, date, body }) {
  if (typeof title !== 'string' || !title.trim()) return 'Title required';
  if (typeof date !== 'string' || !date.trim()) return 'Date required';
  if (typeof body !== 'string' || !body.trim()) return 'Body required';
  if (title.length > 300) return 'Title too long';
  if (date.length > 100) return 'Date too long';
  if (body.length > 200000) return 'Body too long';
  return null;
}

// ---------- Actions ----------

async function listEssays(res) {
  const { data } = await readEssaysFile();
  const list = data.essays.map(e => ({ id: e.id, title: e.title, date: e.date }));
  return res.status(200).json({ essays: list });
}

async function getEssay({ essayId }, res) {
  if (!essayId) return res.status(400).json({ error: 'essayId required' });
  const { data } = await readEssaysFile();
  const essay = data.essays.find(e => e.id === essayId);
  if (!essay) return res.status(404).json({ error: 'Essay not found' });
  return res.status(200).json(essay);
}

async function publishEssay({ title, date, body }, res) {
  const err = validateFields({ title, date, body });
  if (err) return res.status(400).json({ error: err });

  const { data, sha } = await readEssaysFile();
  const newEssay = {
    id: 'essay_' + Date.now(),
    title: title.trim(),
    date: date.trim(),
    body: body.trim(),
    createdAt: new Date().toISOString()
  };
  data.essays.unshift(newEssay); // newest first
  await writeEssaysFile(data, sha, `Publish: ${newEssay.title}`);
  return res.status(200).json({ ok: true, id: newEssay.id });
}

async function editEssay({ essayId, title, date, body }, res) {
  if (!essayId) return res.status(400).json({ error: 'essayId required' });
  const err = validateFields({ title, date, body });
  if (err) return res.status(400).json({ error: err });

  const { data, sha } = await readEssaysFile();
  const idx = data.essays.findIndex(e => e.id === essayId);
  if (idx === -1) return res.status(404).json({ error: 'Essay not found' });

  data.essays[idx] = {
    ...data.essays[idx],
    title: title.trim(),
    date: date.trim(),
    body: body.trim(),
    updatedAt: new Date().toISOString()
  };
  await writeEssaysFile(data, sha, `Edit: ${data.essays[idx].title}`);
  return res.status(200).json({ ok: true });
}

async function deleteEssay({ essayId }, res) {
  if (!essayId) return res.status(400).json({ error: 'essayId required' });
  const { data, sha } = await readEssaysFile();
  const idx = data.essays.findIndex(e => e.id === essayId);
  if (idx === -1) return res.status(404).json({ error: 'Essay not found' });
  const removed = data.essays.splice(idx, 1)[0];
  await writeEssaysFile(data, sha, `Delete: ${removed.title}`);
  return res.status(200).json({ ok: true });
}
